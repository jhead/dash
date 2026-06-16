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
}

export type DocumentStoreApi = StoreApi<DocumentState>;

export function createDocumentStore(initial: FlashDocument): DocumentStoreApi {
  return createStore<DocumentState>((set, get) => {
    const apply = (action: HistoryAction): void =>
      set({ history: historyReducer(get().history, action) });
    return {
      history: createHistory(initial),
      pushDoc: (next) => apply({ type: "PUSH", nextDoc: next }),
      replaceDoc: (next) => apply({ type: "REPLACE", nextDoc: next }),
      commitDrag: (preDrag, final) =>
        apply({ type: "COMMIT_DRAG", preDragDoc: preDrag, finalDoc: final }),
      undo: () => apply({ type: "UNDO" }),
      redo: () => apply({ type: "REDO" }),
      clearHistory: () => apply({ type: "CLEAR" }),
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
