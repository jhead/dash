/**
 * Reconnection + signaling-health controller (collab P5 / docs 37 §13).
 *
 * Yjs/y-webrtc already recover the DOCUMENT automatically: a dropped peer that
 * reconnects re-exchanges only the missing updates via the state-vector
 * protocol, so the CRDT converges with no help from us. Two things, however, are
 * NOT recovered for free and are what this controller hardens:
 *
 *   1. AWARENESS (presence) is non-persistent and EXPIRES. When a peer drops,
 *      the protocol's 30 s outdatedTimeout reaps its presence on the other
 *      peers; symmetrically, while we are disconnected we stop hearing other
 *      peers' keepalives, so they fade from OUR view. On reconnect the document
 *      re-syncs but presence would stay stale until each peer's next field
 *      change. We therefore RE-BROADCAST our full awareness state the moment a
 *      new peer connection is established (provider 'peers' with `added`), so a
 *      reconnecting / newly-arriving peer immediately sees us — and our own
 *      keepalive (in the awareness controller) keeps us alive meanwhile.
 *
 *   2. SIGNALING HEALTH is invisible. The signaling server only brokers the
 *      WebRTC handshake, but if EVERY configured signaling server is down a new
 *      peer can never find an existing one (already-connected peers keep working
 *      P2P). y-webrtc exposes this via the provider's `status` event /
 *      `provider.connected` getter (true iff at least one signaling conn is up).
 *      We surface it so the UI can show a clear "can't reach the signaling
 *      server" message and point the user at the editable signaling-URL field.
 *
 * This module is framework-free (no React) and depends only on the minimal slice
 * of the provider it uses, so it is unit-testable with a tiny event-emitter mock
 * and a fake awareness controller.
 */
import type { AwarenessController } from "./awareness.js";

/** The minimal provider surface this controller observes. */
export interface ReconnectProviderLike {
  /** True iff at least one signaling connection is currently up. */
  readonly connected: boolean;
  on(event: "peers", cb: (e: PeersEvent) => void): void;
  on(event: "status", cb: (e: StatusEvent) => void): void;
  off(event: "peers", cb: (e: PeersEvent) => void): void;
  off(event: "status", cb: (e: StatusEvent) => void): void;
}

interface PeersEvent {
  added?: unknown[];
  removed?: unknown[];
  webrtcPeers?: unknown[];
  bcPeers?: unknown[];
}

interface StatusEvent {
  connected: boolean;
}

export interface ReconnectController {
  /** True iff a signaling server is currently reachable. */
  signalingConnected(): boolean;
  /** Subscribe to signaling-connectivity changes; returns an unsubscribe. */
  onSignalingChange(listener: (connected: boolean) => void): () => void;
  /** Stop observing the provider. */
  detach(): void;
}

export interface AttachReconnectOptions {
  /**
   * The presence controller to re-flush on a new peer connection. Optional: a
   * headless/doc-only session has no awareness, and document re-sync needs no
   * help (Yjs handles it), so the controller is still useful purely for
   * signaling-health reporting.
   */
  awarenessController?: AwarenessController;
}

/**
 * Attach the reconnection/health controller to a live provider.
 *
 * On every `peers` event that ADDS a peer, re-broadcast the local awareness
 * state (a churn-resilient presence refresh). On every `status` change, fan the
 * new signaling connectivity out to listeners. Detaching removes both handlers.
 */
export function attachReconnect(
  provider: ReconnectProviderLike,
  options: AttachReconnectOptions = {},
): ReconnectController {
  const { awarenessController } = options;
  const signalingListeners = new Set<(connected: boolean) => void>();
  let lastSignaling = provider.connected;

  const onPeers = (e: PeersEvent): void => {
    // A NEW peer connection appeared (initial join, churn, or reconnect). Our
    // presence may have been reaped on that peer (or never seen), so push our
    // full state again. Harmless when no awareness is wired.
    if ((e.added?.length ?? 0) > 0) {
      awarenessController?.flush();
    }
  };

  const onStatus = (e: StatusEvent): void => {
    if (e.connected === lastSignaling) return;
    lastSignaling = e.connected;
    for (const l of signalingListeners) l(e.connected);
  };

  provider.on("peers", onPeers);
  provider.on("status", onStatus);

  return {
    signalingConnected: () => lastSignaling,
    onSignalingChange(listener) {
      signalingListeners.add(listener);
      return () => signalingListeners.delete(listener);
    },
    detach() {
      provider.off("peers", onPeers);
      provider.off("status", onStatus);
      signalingListeners.clear();
    },
  };
}
