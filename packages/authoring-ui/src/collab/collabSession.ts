/**
 * Collaboration session — the opt-in y-webrtc transport (task 1344 P1).
 *
 * This is the ONLY place a network provider is constructed, and it is
 * constructed ONLY when `startCollab`/`joinCollab` is explicitly called. At
 * startup (and in the solo app) nothing here runs: no provider, no signaling
 * connection, no awareness, no WebRTC. Default OFF — see COLLAB_ENABLED_DEFAULT.
 *
 * Flow:
 *   - START ("Start collaborating"): mint a fresh room + E2E key, attach the P0
 *     binding (seeds the local doc into a new Y.Doc), THEN bring up the y-webrtc
 *     provider. The local document becomes the shared session state; the returned
 *     link is what you hand to a collaborator.
 *   - JOIN (opening a share link): bring up the provider FIRST and wait for the
 *     first sync so the Y.Doc is populated with the existing session's state,
 *     THEN attach the binding — which, seeing a non-empty Y.Doc, ADOPTS the
 *     remote state via `replaceDoc` (P0's late-join path), merging it into the
 *     local editor. After that, local and remote edits flow both ways and Yjs
 *     reconciles them.
 *
 * Reconnection is handled entirely by y-webrtc/Yjs: on a dropped peer, only the
 * missing updates are re-exchanged via the Yjs state-vector protocol.
 */
import type { Awareness } from "y-protocols/awareness";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";
import {
  attachCollab,
  type AttachCollabResult,
} from "../store/collabAdapter.js";
import type { DocumentStoreApi } from "../store/documentStore.js";
import type { UiStoreApi } from "../store/uiStore.js";
import {
  type AwarenessController,
  attachAwareness,
} from "./awareness.js";
import {
  type CollabLink,
  buildShareUrl,
  collabLinkToFragment,
  generateCollabLink,
} from "./collabLink.js";
import { type CollabUser, getLocalUser } from "./localUser.js";
import { getSignalingServers } from "./signaling.js";
import { attachAssetSync, type AssetSyncController } from "./assetSync.js";
import type { AssetStore } from "./assetStore.js";
import type { AssetTransport } from "./assetChannel.js";
import { webrtcAssetTransport } from "./webrtcAssetTransport.js";
import { attachReconnect, type ReconnectController } from "./reconnect.js";

/** A live collaboration session. Owns the Y.Doc, binding, and provider. */
export interface CollabSession {
  /** The room id + E2E key for this session (the secret of the share link). */
  readonly link: CollabLink;
  /** The Y.Doc this session syncs through (owned by the session). */
  readonly ydoc: Y.Doc;
  /** The y-webrtc provider. Exposed for P2 (awareness) — see `awareness`. */
  readonly provider: WebrtcProvider;
  /** The P0 binding wiring the store to the Y.Doc. */
  readonly binding: AttachCollabResult["binding"];
  /** The signaling servers this session connects through (handshake only). */
  readonly signaling: readonly string[];
  /** The local user identity broadcast on the awareness channel. */
  readonly user: CollabUser;
  /**
   * The y-protocols awareness instance (P2 presence). Owned by the provider; the
   * uiStore is wired to it via `awarenessController`. Inert until a peer joins.
   */
  readonly awareness: Awareness;
  /**
   * The presence controller (P2). Reads remote peers and bridges the uiStore to
   * the awareness channel. Present whenever a `uiStore` was supplied to
   * start/join; undefined otherwise (headless / doc-only sessions).
   */
  readonly awarenessController?: AwarenessController;
  /**
   * The out-of-band asset-sync controller (P4). Keeps bitmap/sound/video BYTES
   * out of the CRDT (the Y.Doc carries only an `asset-hash:` reference) and
   * lazily transfers them peer-to-peer over the y-webrtc mesh. Present when a
   * `documentStore` flow constructed it (start/join always do); the content
   * store is also reachable via `assetStore` for the renderer.
   */
  readonly assetSync?: AssetSyncController;
  /** The content-addressed asset byte store (shared with the renderer). */
  readonly assetStore?: AssetStore;
  /**
   * The P5 reconnection / signaling-health controller. Re-broadcasts presence
   * on a new peer connection (churn/reconnect resilience) and reports whether a
   * signaling server is reachable. Always present for a networked session.
   */
  readonly reconnect: ReconnectController;
  /** True once the provider has reached its first sync with a peer/room. */
  readonly synced: boolean;
  /** True iff a signaling server is currently reachable (P5 ops surfacing). */
  readonly signalingConnected: boolean;
  /** Build the full shareable URL from a base (e.g. `location.origin + path`). */
  shareUrl(baseUrl: string): string;
  /** The `#room=…&k=…` fragment alone (for appending to the current URL). */
  fragment(): string;
  /** Tear the session down: detach the binding and destroy the provider/Y.Doc. */
  stop(): void;
}

export interface StartCollabOptions {
  /** Override the signaling servers (defaults to the user/public config). */
  signaling?: string[];
  /**
   * Reuse a specific room/key instead of minting a fresh one. Used internally by
   * `joinCollab`; callers normally let `startCollab` generate the link.
   */
  link?: CollabLink;
  /**
   * The UI store to bridge to the awareness channel (P2 presence). When given,
   * the session wires uiStore → awareness (cursor/selection/scene/frame/tool)
   * and reads remote peers back. Omit for a headless / doc-only session (no
   * presence). The Shell always passes it; tests may omit it.
   */
  uiStore?: UiStoreApi;
  /** Override the local user identity (defaults to the persisted local user). */
  user?: CollabUser;
  /**
   * Override the asset transport (tests inject a loopback transport; production
   * defaults to a transport riding the y-webrtc mesh). Pass `null` to disable
   * out-of-band asset sync entirely (media bytes then stay inline in the CRDT,
   * the pre-P4 behavior — used by headless/doc-only sessions).
   */
  assetTransport?: AssetTransport | null;
}

function buildProvider(
  link: CollabLink,
  ydoc: Y.Doc,
  signaling: string[],
): WebrtcProvider {
  // `password` is the y-webrtc room password = our E2E key. y-webrtc derives an
  // AES-GCM key from it and encrypts every message; peers without it cannot
  // join or read. The signaling server only sees the (random) room name.
  return new WebrtcProvider(link.room, ydoc, {
    signaling,
    password: link.key,
  });
}

function makeSession(
  link: CollabLink,
  ydoc: Y.Doc,
  provider: WebrtcProvider,
  binding: AttachCollabResult,
  signaling: string[],
  user: CollabUser,
  awarenessController: AwarenessController | undefined,
  assetSync: AssetSyncController | undefined,
): CollabSession {
  let synced = false;
  provider.on("synced", () => {
    synced = true;
  });
  // P5: reconnection + signaling-health. Re-broadcasts presence whenever a peer
  // connection is (re)established so churn/reconnect re-syncs awareness, and
  // tracks signaling reachability for the ops/error surfacing.
  const reconnect = attachReconnect(
    provider as unknown as import("./reconnect.js").ReconnectProviderLike,
    { awarenessController },
  );
  return {
    link,
    ydoc,
    provider,
    binding: binding.binding,
    signaling,
    user,
    awareness: provider.awareness,
    awarenessController,
    assetSync,
    assetStore: assetSync?.store,
    reconnect,
    get synced() {
      return synced;
    },
    get signalingConnected() {
      return reconnect.signalingConnected();
    },
    shareUrl: (baseUrl: string) => buildShareUrl(baseUrl, link),
    fragment: () => collabLinkToFragment(link),
    stop: () => {
      // Detach presence FIRST so we broadcast our own offline state before the
      // provider tears the transport down (peers see us leave immediately; the
      // awareness TTL is only the fallback for an ungraceful drop).
      awarenessController?.detach();
      reconnect.detach();
      binding.detach();
      assetSync?.destroy();
      provider.destroy();
      ydoc.destroy();
    },
  };
}

/**
 * START a collaboration session as the host. Mints a fresh room + key (unless
 * one is supplied), seeds the local document into a new Y.Doc via the binding,
 * then brings up the provider. Returns immediately with a live session whose
 * `link` is the invite to share.
 */
export function startCollab(
  store: DocumentStoreApi,
  options: StartCollabOptions = {},
): CollabSession {
  const link = options.link ?? generateCollabLink();
  const signaling = options.signaling ?? getSignalingServers();
  const user = options.user ?? getLocalUser();
  const ydoc = new Y.Doc();

  // Bring up the provider first so the P4 asset transport can ride its mesh.
  // (For a fresh host room the Y.Doc is empty and there is nothing to adopt, so
  // attaching the binding after the provider still seeds the local doc.)
  const provider = buildProvider(link, ydoc, signaling);

  // P4: out-of-band asset sync. Constructed BEFORE the binding so the binding's
  // seeding externalize() runs through the hook (stashing the host's own asset
  // bytes so a joiner's request is answerable). `assetTransport: null` disables.
  const assetSync = makeAssetSync(store, provider, options);

  // START: attach the binding — it seeds the local doc into the empty Y.Doc
  // (the host's document becomes the shared session state), externalizing media
  // bytes out of the CRDT via the asset hook.
  const binding = attachCollab(store, ydoc, { assets: assetSync?.hook });

  // P2: bridge the uiStore to the provider's awareness channel (presence).
  const awarenessController = options.uiStore
    ? attachAwareness(provider.awareness, options.uiStore, user)
    : undefined;

  return makeSession(
    link,
    ydoc,
    provider,
    binding,
    signaling,
    user,
    awarenessController,
    assetSync,
  );
}

/**
 * Construct the P4 asset-sync controller for a session, or `undefined` when
 * out-of-band sync is disabled (`assetTransport: null`). The transport defaults
 * to one riding the provider's WebRTC mesh; tests inject a loopback transport.
 */
function makeAssetSync(
  store: DocumentStoreApi,
  provider: WebrtcProvider,
  options: StartCollabOptions,
): AssetSyncController | undefined {
  if (options.assetTransport === null) return undefined;
  const transport = options.assetTransport ?? webrtcAssetTransport(provider);
  return attachAssetSync(store, transport);
}

/**
 * JOIN an existing session from a parsed share link. Brings the provider up
 * first and resolves once the Y.Doc has synced with the room (or the timeout
 * elapses), THEN attaches the binding so it ADOPTS the existing remote document
 * into the local editor (P0 late-join adoption). The promise resolves to a live
 * session.
 *
 * @param syncTimeoutMs how long to wait for the first sync before binding anyway
 *   (a fresh/empty room never fires `synced`, so we bind on timeout too). A
 *   bound-anyway empty room behaves like a host start.
 */
export async function joinCollab(
  store: DocumentStoreApi,
  link: CollabLink,
  options: StartCollabOptions & { syncTimeoutMs?: number } = {},
): Promise<CollabSession> {
  const signaling = options.signaling ?? getSignalingServers();
  const user = options.user ?? getLocalUser();
  const syncTimeoutMs = options.syncTimeoutMs ?? 8000;
  const ydoc = new Y.Doc();

  // JOIN: connect FIRST, wait for the room's state to arrive, THEN attach so the
  // binding sees a populated Y.Doc and adopts it (merges remote into local).
  const provider = buildProvider(link, ydoc, signaling);

  await waitForSync(provider, syncTimeoutMs);

  // P4: asset sync over the live mesh. Built before the binding so the adoption
  // internalize() (which finds the externalized refs the host wrote) can request
  // the missing bytes immediately.
  const assetSync = makeAssetSync(store, provider, options);

  const binding = attachCollab(store, ydoc, { assets: assetSync?.hook });

  // P2: bridge the uiStore to the provider's awareness channel (presence).
  const awarenessController = options.uiStore
    ? attachAwareness(provider.awareness, options.uiStore, user)
    : undefined;

  return makeSession(
    link,
    ydoc,
    provider,
    binding,
    signaling,
    user,
    awarenessController,
    assetSync,
  );
}

/** Resolve when the provider first syncs, or after `timeoutMs`. */
function waitForSync(provider: WebrtcProvider, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      provider.off("synced", onSynced);
      resolve();
    };
    const onSynced = (e: { synced: boolean }) => {
      if (e.synced) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    provider.on("synced", onSynced);
  });
}
