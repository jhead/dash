import { useCallback, useEffect, useReducer } from "react";
import type { FlashDocument } from "@flash/core";
import {
  createHistory,
  pushState,
  undo as historyUndo,
  redo as historyRedo,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  type HistoryState,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type HistoryAction =
  | { type: "PUSH"; nextDoc: FlashDocument }
  | { type: "REPLACE"; nextDoc: FlashDocument }
  | { type: "COMMIT_DRAG"; preDragDoc: FlashDocument; finalDoc: FlashDocument }
  | { type: "UNDO" }
  | { type: "REDO" };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "PUSH":
      return pushState(state, action.nextDoc);
    case "REPLACE":
      // Update present without recording an undo entry (used for per-frame drag updates)
      return { ...state, present: action.nextDoc, future: [] };
    case "COMMIT_DRAG": {
      // Record the pre-drag snapshot as the undo entry, set final position as present.
      // This gives one clean undo step for the entire drag gesture.
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
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseHistoryResult {
  /** The current document snapshot. */
  doc: FlashDocument;
  /** Record a new document state (clears the redo stack). */
  push: (nextDoc: FlashDocument) => void;
  /**
   * Silently update the current document WITHOUT recording an undo entry.
   * Use this for high-frequency interim updates (e.g., per-mousemove drag).
   * Call `commitDrag` once the gesture is complete to commit to the undo stack.
   */
  replace: (nextDoc: FlashDocument) => void;
  /**
   * Commit the result of a drag gesture to the undo stack.
   * Records `preDragDoc` as the undo entry and `finalDoc` as the new present.
   * This produces one clean undo step for the entire gesture regardless of how
   * many `replace` calls were made during the drag.
   */
  commitDrag: (preDragDoc: FlashDocument, finalDoc: FlashDocument) => void;
  /** Step back one state, if possible. */
  undo: () => void;
  /** Step forward one state, if possible. */
  redo: () => void;
  /** Whether an undo step is available. */
  canUndo: boolean;
  /** Whether a redo step is available. */
  canRedo: boolean;
  /** Number of entries in the undo stack (past snapshots). */
  undoDepth: number;
}

/**
 * React hook providing document-level undo/redo backed by immutable snapshots.
 *
 * Keyboard shortcuts are bound to the DOM `document` object:
 *   - Ctrl/Cmd + Z           → undo
 *   - Ctrl/Cmd + Shift + Z   → redo
 */
export function useHistory(initial: FlashDocument): UseHistoryResult {
  const [state, dispatch] = useReducer(historyReducer, initial, createHistory);

  const push = useCallback((nextDoc: FlashDocument) => {
    dispatch({ type: "PUSH", nextDoc });
  }, []);

  const replace = useCallback((nextDoc: FlashDocument) => {
    dispatch({ type: "REPLACE", nextDoc });
  }, []);

  const commitDrag = useCallback((preDragDoc: FlashDocument, finalDoc: FlashDocument) => {
    dispatch({ type: "COMMIT_DRAG", preDragDoc, finalDoc });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redoFn = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  // Keyboard shortcut listener — bound to the DOM document.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      if (event.key === "z" || event.key === "Z") {
        if (event.shiftKey) {
          event.preventDefault();
          dispatch({ type: "REDO" });
        } else {
          event.preventDefault();
          dispatch({ type: "UNDO" });
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return {
    doc: state.present,
    push,
    replace,
    commitDrag,
    undo,
    redo: redoFn,
    canUndo: historyCanUndo(state),
    canRedo: historyCanRedo(state),
    undoDepth: state.past.length,
  };
}
