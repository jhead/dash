import type { FlashDocument } from "@flash/core";
import {
  pushState,
  undo as historyUndo,
  redo as historyRedo,
  type HistoryState,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Pure history reducer
//
// Extracted from hooks/useHistory.ts so it can be reused by the Zustand
// documentStore WITHOUT pulling React into the store module graph. The React
// hook (hooks/useHistory.ts) re-exports `historyReducer`/`HistoryAction` so the
// existing useHistory.test.ts import path stays valid.
// ---------------------------------------------------------------------------

export type HistoryAction =
  | { type: "PUSH"; nextDoc: FlashDocument }
  | { type: "REPLACE"; nextDoc: FlashDocument }
  | { type: "COMMIT_DRAG"; preDragDoc: FlashDocument; finalDoc: FlashDocument }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "CLEAR" };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "PUSH":
      return pushState(state, action.nextDoc);
    case "REPLACE":
      // Update present without recording an undo entry (per-frame drag updates)
      return { ...state, present: action.nextDoc, future: [] };
    case "COMMIT_DRAG": {
      // Record the pre-drag snapshot as the undo entry, set final position as present.
      // One clean undo step for the entire drag gesture.
      const newPast = [...state.past, action.preDragDoc];
      const trimmed =
        newPast.length > state.maxSize
          ? newPast.slice(newPast.length - state.maxSize)
          : newPast;
      return { past: trimmed, present: action.finalDoc, future: [], maxSize: state.maxSize };
    }
    case "UNDO":
      return historyUndo(state);
    case "REDO":
      return historyRedo(state);
    case "CLEAR":
      // Reset to initial: keep present, clear past and future
      return { past: [], present: state.present, future: [], maxSize: state.maxSize };
  }
}
