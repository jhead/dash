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
// This is the SINGLE source of truth for undo/redo history transitions. The
// Zustand documentStore (store/documentStore.ts) owns the one live HistoryState
// and routes every mutation (pushDoc/replaceDoc/commitDrag/undo/redo) through
// this reducer, so there is exactly one history stack in the app. Keyboard
// undo/redo (Ctrl+Z / Ctrl+Shift+Z) flows through the command registry
// (dispatch/keyboard.ts → commands/history.ts) into that same store — never a
// second listener. (The former React `useHistory` hook, which kept its own
// parallel reducer + a global keydown listener, was dead code and was removed in
// task 1391 to eliminate the divergent/double-binding hazard.)
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
