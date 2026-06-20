import { useCallback, useEffect, useReducer } from "react";
import type { FlashDocument } from "@flash/core";
import {
  createHistory,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
} from "@flash/core";
import { historyReducer, type HistoryAction } from "../store/history.js";
import { isWithinRufflePlayer } from "../dispatch/playerFocus.js";

// The pure reducer now lives in store/history.ts so the Zustand documentStore
// can reuse it without importing React. Re-export it (and HistoryAction) here so
// existing import paths — e.g. __tests__/useHistory.test.ts — keep working.
export { historyReducer };
export type { HistoryAction };

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
  /** Number of entries in the redo stack (future snapshots). */
  redoDepth: number;
  /** Past document snapshots (oldest first). Length equals undoDepth. */
  past: readonly FlashDocument[];
  /** Future document snapshots (next redo first). Length equals redoDepth. */
  future: readonly FlashDocument[];
  /** Clear all past and future history, keeping only the current document. */
  clearHistory: () => void;
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

  const clearHistory = useCallback(() => {
    dispatch({ type: "CLEAR" });
  }, []);

  // Keyboard shortcut listener — bound to the DOM document.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // Undo/redo must not fire while a Ruffle player (Test Movie / Live Preview)
      // owns keyboard input — those keys belong to the SWF.
      if (isWithinRufflePlayer(event)) return;
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
    redoDepth: state.future.length,
    past: state.past,
    future: state.future,
    clearHistory,
  };
}
