import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  FlashDocument,
  Library,
  DocumentProperties,
  Timeline as TimelineModel,
} from "@flash/core";
import {
  createHistory,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  type HistoryState,
} from "@flash/core";
import { historyReducer, type HistoryAction } from "./history.js";

/**
 * Per-instance document store: owns the undo/redo `HistoryState` and exposes the
 * same mutation surface Shell already uses (`pushDoc`/`replaceDoc`/`commitDrag`/
 * `undo`/`redo`). The current document is always `history.present`.
 *
 * Phase 1 will move the `withTimeline`/`withLibrary`/`withProperties` helpers in
 * here too; for now they remain in Shell and call `pushDoc` with the new doc.
 */
/**
 * A collaborative undo handler the store routes `undo`/`redo` to during a collab
 * session (task 1346 P3). When registered, the app's undo/redo are served by a
 * per-origin `Y.UndoManager` (so each peer undoes only its OWN edits) instead of
 * the snapshot reducer. When `null` (solo — the default), undo/redo use the
 * snapshot history EXACTLY as before, with zero change.
 */
export interface CollabUndoHandler {
  undo(): void;
  redo(): void;
}

export interface DocumentState {
  history: HistoryState;
  /** Record a new document state (clears the redo stack). */
  pushDoc: (next: FlashDocument) => void;
  /** Update the present doc WITHOUT recording an undo entry (interim drag updates). */
  replaceDoc: (next: FlashDocument) => void;
  /** Commit a drag gesture as one undo step (preDrag → undo entry, final → present). */
  commitDrag: (preDrag: FlashDocument, final: FlashDocument) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  /**
   * Route undo/redo to a collab UndoManager for the duration of a session.
   *
   * Pass a handler to BEGIN a collab session: the current snapshot
   * `HistoryState` is frozen aside and `undo`/`redo` delegate to the handler.
   * Pass `null` to END the session: the frozen snapshot stack is restored, so
   * solo undo continues exactly where it left off. While a handler is set, the
   * snapshot stack is not consulted by undo/redo (inbound remote + UndoManager
   * edits arrive via `replaceDoc`, which never pushes a snapshot entry).
   */
  setCollabUndo: (handler: CollabUndoHandler | null) => void;
}

export type DocumentStoreApi = StoreApi<DocumentState>;

export function createDocumentStore(initial: FlashDocument): DocumentStoreApi {
  return createStore<DocumentState>((set, get) => {
    const apply = (action: HistoryAction): void =>
      set({ history: historyReducer(get().history, action) });
    // The active collab undo handler (null = solo). Kept in closure state, not in
    // the store, so subscribing to document changes never sees it churn.
    let collabUndo: CollabUndoHandler | null = null;
    // The snapshot HistoryState frozen at session start, restored on session end.
    let frozenHistory: HistoryState | null = null;
    return {
      history: createHistory(initial),
      // While a collab session is active the snapshot stack is FROZEN: a local
      // edit updates the present (so it syncs out + renders) but does NOT push a
      // snapshot entry — undo/redo are served by the per-origin UndoManager
      // instead. Solo (no handler), this is the unchanged PUSH/COMMIT_DRAG path.
      pushDoc: (next) =>
        apply(collabUndo ? { type: "REPLACE", nextDoc: next } : { type: "PUSH", nextDoc: next }),
      replaceDoc: (next) => apply({ type: "REPLACE", nextDoc: next }),
      commitDrag: (preDrag, final) =>
        apply(
          collabUndo
            ? { type: "REPLACE", nextDoc: final }
            : { type: "COMMIT_DRAG", preDragDoc: preDrag, finalDoc: final },
        ),
      // SOLO: snapshot undo/redo, unchanged. COLLAB: delegate to the per-origin
      // UndoManager (which replaceDoc's the undone state back through the binding).
      undo: () => {
        if (collabUndo) collabUndo.undo();
        else apply({ type: "UNDO" });
      },
      redo: () => {
        if (collabUndo) collabUndo.redo();
        else apply({ type: "REDO" });
      },
      clearHistory: () => apply({ type: "CLEAR" }),
      setCollabUndo: (handler) => {
        if (handler) {
          // BEGIN: freeze the snapshot stack (so a session's edits don't grow it
          // and an end-of-session restore lands where solo left off).
          if (!collabUndo) frozenHistory = get().history;
          collabUndo = handler;
        } else {
          // END: restore the frozen snapshot stack onto the CURRENT present, so
          // the editor keeps the latest (possibly remotely-merged) document while
          // its past/future are the pre-session snapshot stack.
          collabUndo = null;
          if (frozenHistory) {
            const current = get().history.present;
            set({ history: { ...frozenHistory, present: current, future: [] } });
            frozenHistory = null;
          }
        }
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Selectors — pure derivations over DocumentState for use with useStore(...).
// ---------------------------------------------------------------------------

export const selectDoc = (s: DocumentState): FlashDocument => s.history.present;
export const selectLibrary = (s: DocumentState): Library => s.history.present.library;
export const selectProperties = (s: DocumentState): DocumentProperties =>
  s.history.present.properties;
export const selectCanUndo = (s: DocumentState): boolean => historyCanUndo(s.history);
export const selectCanRedo = (s: DocumentState): boolean => historyCanRedo(s.history);
export const selectUndoDepth = (s: DocumentState): number => s.history.past.length;
export const selectRedoDepth = (s: DocumentState): number => s.history.future.length;

/** Convenience updater factories mirroring Shell's withX helpers (scene-aware). */
export function withProperties(
  doc: FlashDocument,
  updater: (p: DocumentProperties) => DocumentProperties
): FlashDocument {
  return { ...doc, properties: updater(doc.properties) };
}

export function withLibrary(
  doc: FlashDocument,
  updater: (lib: Library) => Library
): FlashDocument {
  return { ...doc, library: updater(doc.library) };
}

export function withSceneTimeline(
  doc: FlashDocument,
  sceneIndex: number,
  updater: (t: TimelineModel) => TimelineModel
): FlashDocument {
  const idx = Math.min(sceneIndex, doc.scenes.length - 1);
  const scene = doc.scenes[idx];
  const t = updater(scene.timeline);
  const scenes = doc.scenes.map((s, i) => (i === idx ? { ...s, timeline: t } : s));
  return { ...doc, scenes };
}

export function withSymbolTimeline(
  doc: FlashDocument,
  symbolId: string,
  updater: (t: TimelineModel) => TimelineModel
): FlashDocument {
  const items = doc.library.items.map((item) =>
    item.id === symbolId && item.itemType === "symbol"
      ? { ...item, timeline: updater(item.timeline) }
      : item
  );
  return { ...doc, library: { ...doc.library, items } };
}
