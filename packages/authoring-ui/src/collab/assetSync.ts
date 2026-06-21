/**
 * Asset-sync controller (collab P4 / docs 37 §11) — ties together the pieces:
 *
 *   AssetStore        content-addressed byte cache (hash → bytes)
 *   externalize       outbound: dataUri → asset-hash ref (bytes → store)
 *   internalize       inbound:  asset-hash ref → dataUri (bytes from store)
 *   AssetSyncEngine   lazy request/response over an AssetTransport
 *
 * It produces the `CollabAssetHook` the collab adapter consumes, and — crucially
 * — closes the loop: when a requested asset ARRIVES over the channel, it
 * re-internalizes the current document and `replaceDoc`s it so the placeholder
 * the user sees resolves to the real bitmap/sound/video. (`replaceDoc`, not
 * `pushDoc`, so the resolution is not a local undo entry — it is exactly like a
 * remote edit landing.)
 *
 * Solo has zero footprint: nothing here is constructed until a session attaches.
 */
import type { FlashDocument } from "@flash/core";
import type { DocumentStoreApi } from "../store/documentStore.js";
import type { CollabAssetHook } from "../store/collabAdapter.js";
import { AssetStore } from "./assetStore.js";
import {
  AssetSyncEngine,
  type AssetTransport,
  type AssetSyncEngineOptions,
} from "./assetChannel.js";
import {
  externalizeAssets,
  internalizeAssets,
  referencedAssetHashes,
} from "./assetExternalize.js";

export interface AssetSyncController {
  /** The content-addressed byte store (shared with the renderer / UI). */
  readonly store: AssetStore;
  /** The request/response engine. */
  readonly engine: AssetSyncEngine;
  /** The hook the collab adapter uses to externalize/internalize docs. */
  readonly hook: CollabAssetHook;
  /** Hashes the local doc references but does not yet hold (placeholders). */
  missingHashes(): string[];
  /** Tear everything down (engine timers, transport, store). */
  destroy(): void;
}

export interface AttachAssetSyncOptions extends AssetSyncEngineOptions {
  /** Reuse an existing store (e.g. seeded by the host's own document). */
  store?: AssetStore;
  /**
   * How to defer the missing-asset request issued during an inbound apply, so
   * the placeholder document lands in the store before the (possibly
   * synchronous) response arrives. Production defaults to `queueMicrotask`;
   * tests inject a synchronous-after-apply runner. Receives a thunk to run.
   */
  deferRequests?: (run: () => void) => void;
}

/**
 * Attach asset-sync to a document store over a transport. The host seeds its own
 * assets into the store as soon as the first outbound externalize runs (the
 * binding seeds the doc on attach), so a joiner's request is answerable
 * immediately.
 */
export function attachAssetSync(
  store: DocumentStoreApi,
  transport: AssetTransport,
  options: AttachAssetSyncOptions = {},
): AssetSyncController {
  const assetStore = options.store ?? new AssetStore();
  const engine = new AssetSyncEngine(transport, assetStore, options);
  const deferRequests =
    options.deferRequests ??
    ((run: () => void) => {
      if (typeof queueMicrotask === "function") queueMicrotask(run);
      else Promise.resolve().then(run);
    });

  // Re-apply a remotely-fetched asset: when bytes arrive, re-internalize the
  // current document so the placeholder resolves to the real asset. Guard
  // against re-entrancy and no-op resolutions (internalizeAssets returns the
  // SAME doc reference when nothing changed).
  const unsubArrival = assetStore.onAssetAvailable(() => {
    const present = store.getState().history.present;
    const { doc: resolved } = internalizeAssets(present, assetStore);
    if (resolved !== present) store.getState().replaceDoc(resolved);
  });

  // One-entry memo so externalize is STABLE per source-doc reference: the
  // binding skips a sync only when `getDoc() === lastSynced`, and `getDoc` runs
  // externalize on every store change. The local document keeps its REAL
  // dataUris (we never replaceDoc it with refs), so the same source doc would
  // otherwise re-externalize into a fresh object each call — defeating the skip
  // and forcing a full re-diff every keystroke. Caching by source reference
  // makes a no-op change a no-op again. (Cleared on store change because the
  // source doc reference changes; only repeated calls on the SAME doc hit it.)
  let lastSource: FlashDocument | null = null;
  let lastExternalized: FlashDocument | null = null;

  const hook: CollabAssetHook = {
    externalize: (doc: FlashDocument) => {
      if (doc === lastSource && lastExternalized) return lastExternalized;
      const out = externalizeAssets(doc, assetStore);
      lastSource = doc;
      lastExternalized = out;
      return out;
    },
    internalize: (doc: FlashDocument) => {
      const { doc: resolved, missing } = internalizeAssets(doc, assetStore);
      // Lazily fetch anything this doc references but we don't hold. DEFER the
      // request so the placeholder doc lands in the store FIRST: a synchronous
      // transport (the test loopback) can answer immediately, and the arrival
      // handler re-internalizes `history.present` — which must already be the
      // placeholder doc, not the pre-apply one. (`deferRequests` is identity in
      // production; tests can override it to run synchronously after replaceDoc.)
      if (missing.length > 0) deferRequests(() => engine.requestMany(missing));
      return resolved;
    },
  };

  return {
    store: assetStore,
    engine,
    hook,
    missingHashes: () => {
      const present = store.getState().history.present;
      return referencedAssetHashes(present).filter((h) => !assetStore.has(h));
    },
    destroy: () => {
      unsubArrival();
      engine.destroy(); // also destroys the transport + store listeners
      assetStore.clear();
    },
  };
}
