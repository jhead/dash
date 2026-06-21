/**
 * Per-origin collaborative undo (Phase 3 — task 1346).
 *
 * A `Y.UndoManager` scoped to the LOCAL origin of a `FlashCollabBinding`. During
 * a collab session each peer's outbound edits are written to the shared Y.Doc in
 * a transaction tagged with that peer's `localOrigin` (see binding.ts OUTBOUND).
 * By setting `trackedOrigins = new Set([localOrigin])`, this UndoManager captures
 * ONLY this peer's own edits — so undo reverts MY last change and never clobbers a
 * concurrent edit a remote peer made.
 *
 * How an undo flows back to the UI:
 *   - `manager.undo()` applies the inverse change to the Y.Doc inside a Yjs
 *     transaction whose origin is the UndoManager itself (NOT `localOrigin`).
 *   - The binding's INBOUND `observeDeep` fires for any txn whose origin is not
 *     `localOrigin`, so it rebuilds the FlashDocument and calls `applyRemote`
 *     (wired to the store's `replaceDoc`) — the undone state lands in the store
 *     and the UI re-renders. Because `replaceDoc` does not push a snapshot entry,
 *     the snapshot stack stays frozen (which the host also enforces).
 *
 * This module is the only place `Y.UndoManager` is constructed; it stays in
 * `@flash/collab` so Yjs never leaks into `@flash/core` or the solo path.
 */
import * as Y from "yjs";
import type { FlashCollabBinding } from "./binding.js";

/** A minimal, host-facing undo controller backed by a `Y.UndoManager`. */
export interface CollabUndoManager {
  /** Undo this peer's last own edit. No-op when the stack is empty. */
  undo(): void;
  /** Redo this peer's last undone edit. No-op when the redo stack is empty. */
  redo(): void;
  /** True when there is at least one of this peer's edits to undo. */
  canUndo(): boolean;
  /** True when there is at least one undone edit to redo. */
  canRedo(): boolean;
  /** Drop the entire undo/redo stack (e.g. on doc reset). */
  clear(): void;
  /** The underlying Y.UndoManager (advanced use / tests). */
  readonly manager: Y.UndoManager;
  /** Detach: destroy the UndoManager (does not touch the Y.Doc or binding). */
  destroy(): void;
}

export interface CollabUndoOptions {
  /**
   * Coalesce edits made within this many ms into ONE undo step. Defaults to 0 so
   * each tracked transaction is its own step — the host (the zustand store) is the
   * authority on what one logical edit is, and it emits one transaction per
   * `pushDoc`/`commitDrag`. Set > 0 only if rapid edits should merge.
   */
  captureTimeout?: number;
}

/**
 * Build a `Y.UndoManager` scoped to the binding's root subtree and tracking ONLY
 * the binding's `localOrigin`. The result is a thin controller the host routes
 * its app-level undo/redo to during a collab session.
 */
export function createCollabUndoManager(
  binding: FlashCollabBinding,
  options: CollabUndoOptions = {},
): CollabUndoManager {
  const manager = new Y.UndoManager(binding.root, {
    // Scope undo to THIS peer's own writes. Remote peers tag their transactions
    // with their own (different) localOrigin, so they are never captured here.
    trackedOrigins: new Set([binding.localOrigin]),
    captureTimeout: options.captureTimeout ?? 0,
  });

  return {
    manager,
    undo: () => {
      manager.undo();
    },
    redo: () => {
      manager.redo();
    },
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    clear: () => manager.clear(),
    destroy: () => manager.destroy(),
  };
}
