/**
 * Opt-in collaboration adapter (Phase 0 — default OFF, no networking).
 *
 * Bridges the per-instance zustand `DocumentStoreApi` to a `FlashCollabBinding`
 * (@flash/collab) so the immutable FlashDocument is projected onto a Y.Doc and
 * kept in sync. Solo behavior is UNCHANGED unless `attachCollab` is called:
 *   - The binding is created lazily and only by an explicit caller.
 *   - OUTBOUND: it subscribes to the store and diffs `history.present`.
 *   - INBOUND: remote-originated Y.Doc updates rebuild the doc and call
 *     `replaceDoc` (NOT `pushDoc`) — a remote edit never creates a local undo
 *     entry, exactly as the spec requires.
 *
 * @flash/collab (and thus Yjs) is imported here and NOWHERE in the solo path, so
 * a build that never calls `attachCollab` does not pull Yjs into the hot path.
 */
import type { FlashDocument } from "@flash/core";
import {
  FlashCollabBinding,
  createCollabUndoManager,
  type CollabUndoManager,
  type DocSource,
  type FlashCollabBindingOptions,
} from "@flash/collab";
import type * as Y from "yjs";
import type { DocumentStoreApi } from "./documentStore.js";

/**
 * Optional out-of-band asset hook (collab P4). When supplied, media bytes are
 * kept OUT of the CRDT: outbound docs are externalized (dataUri → asset-hash
 * ref + bytes stashed locally) and inbound docs are internalized (refs resolved
 * to bytes held locally; missing ones requested over the asset channel).
 */
export interface CollabAssetHook {
  /** Outbound: strip media bytes, stash them, return the externalized doc. */
  externalize(doc: FlashDocument): FlashDocument;
  /**
   * Inbound: resolve externalized refs against locally-held bytes and request
   * any that are missing over the asset channel. Returns the resolved doc.
   */
  internalize(doc: FlashDocument): FlashDocument;
}

/** Wrap a document store as the generic DocSource the binding consumes. */
export function storeAsDocSource(
  store: DocumentStoreApi,
  assets?: CollabAssetHook,
): DocSource {
  return {
    // OUTBOUND: externalize media bytes so the Y.Doc only ever carries the
    // small content-hash reference (P4: large bytes never enter the CRDT).
    getDoc: () => {
      const doc = store.getState().history.present;
      return assets ? assets.externalize(doc) : doc;
    },
    // INBOUND: resolve asset references to bytes held locally (missing ones are
    // requested over the asset channel and re-applied when they arrive).
    // Remote edits use replaceDoc so they do NOT push a local undo entry.
    applyRemote: (doc: FlashDocument) =>
      store.getState().replaceDoc(assets ? assets.internalize(doc) : doc),
    subscribe: (listener) => store.subscribe(listener),
  };
}

export interface AttachCollabResult {
  binding: FlashCollabBinding;
  /**
   * The per-origin collaborative UndoManager (P3). Tracks ONLY this peer's own
   * edits and is registered as the store's undo/redo handler for the lifetime of
   * the attachment, so the app's undo reverts only MY last edit (never a remote
   * peer's concurrent edit).
   */
  undoManager: CollabUndoManager;
  /** Detach the binding + UndoManager and restore solo (snapshot) undo. */
  detach: () => void;
}

/**
 * Attach a collaboration binding to a document store and a (caller-owned) Y.Doc.
 * The caller wires the Y.Doc to a provider (y-webrtc / y-websocket / a test
 * wire). This function does NO networking.
 *
 * This is the single opt-in entry point — calling it is what turns collaboration
 * on for a given Shell/store instance. Beyond the P0 binding it now (P3) creates
 * a per-origin `Y.UndoManager` and registers it as the store's undo handler:
 * while attached, `store.undo()`/`store.redo()` route to the UndoManager (whose
 * inverse edits flow back through the binding's inbound `replaceDoc`), and the
 * snapshot stack is frozen. `detach()` unregisters it and restores solo undo.
 */
export function attachCollab(
  store: DocumentStoreApi,
  ydoc: Y.Doc,
  options?: FlashCollabBindingOptions & { assets?: CollabAssetHook },
): AttachCollabResult {
  const binding = new FlashCollabBinding(
    ydoc,
    storeAsDocSource(store, options?.assets),
    options,
  );
  const undoManager = createCollabUndoManager(binding);
  // Route the app's undo/redo to the per-origin UndoManager and freeze the
  // snapshot stack for the session's duration.
  store.getState().setCollabUndo(undoManager);
  return {
    binding,
    undoManager,
    detach: () => {
      // Restore solo (snapshot) undo FIRST, then tear the Yjs pieces down.
      store.getState().setCollabUndo(null);
      undoManager.destroy();
      binding.destroy();
    },
  };
}
