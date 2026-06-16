import { useCallback } from "react";
import {
  updateDisplayObject,
  type FlashDocument,
  type Timeline as TimelineModel,
  type ObjectAccessibility,
  type DocumentAccessibility,
} from "@flash/core";
import { saveCommand, deleteCommand, type SavedCommand } from "../savedCommands.js";
import type { UiStoreApi } from "../store/index.js";

export interface HistoryCommandHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  timeline: TimelineModel;
  safeActiveLayerIndex: number;
  currentFrame: number;
  historyPast: readonly FlashDocument[];
  savedCommands: SavedCommand[];
  pushDoc: (doc: FlashDocument) => void;
  withTimeline: (updater: (t: TimelineModel) => TimelineModel) => FlashDocument;
  undo: () => void;
  redo: () => void;
}

/**
 * Accessibility, History-panel jump, and Commands-menu (save/run/delete)
 * handlers. Extracted out of Shell verbatim; behaviour-preserving.
 */
export function useHistoryCommandHandlers(deps: HistoryCommandHandlersDeps) {
  const {
    uiStore, doc, timeline, safeActiveLayerIndex, currentFrame,
    historyPast, savedCommands, pushDoc, withTimeline, undo, redo,
  } = deps;
  const setSavedCommands = uiStore.getState().setSavedCommands;

  const handleDocAccessibilityChange = useCallback(
    (a: DocumentAccessibility) => {
      pushDoc({ ...doc, accessibility: a });
    },
    [doc, pushDoc]
  );

  const handleObjectAccessibilityChange = useCallback(
    (id: string, a: ObjectAccessibility) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, { accessibility: a })
      ));
    },
    [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  // ---------------------------------------------------------------------------
  // History panel — jump to a specific step
  // ---------------------------------------------------------------------------

  /**
   * Jump to an arbitrary step in the history list.
   * Index 0 = Initial State, index 1..past.length = past steps,
   * index past.length = current state (no-op).
   * Calls undo() or redo() as many times as needed.
   */
  const handleJumpToHistory = useCallback(
    (targetIndex: number) => {
      const currentIndex = historyPast.length;
      if (targetIndex === currentIndex) return; // already there
      if (targetIndex < currentIndex) {
        // Need to undo (currentIndex - targetIndex) times
        const steps = currentIndex - targetIndex;
        for (let i = 0; i < steps; i++) {
          undo();
        }
      } else {
        // Need to redo (targetIndex - currentIndex) times
        const steps = targetIndex - currentIndex;
        for (let i = 0; i < steps; i++) {
          redo();
        }
      }
    },
    [historyPast.length, undo, redo]
  );

  // ---------------------------------------------------------------------------
  // Commands menu — Save as Command, Run Command, Delete Command
  // ---------------------------------------------------------------------------

  /**
   * Save selected past steps (or all past steps) as a named command.
   * Called from HistoryPanel's "Save as Command..." button.
   * @param name - user-supplied name
   * @param stepIndices - 1-based past-step indices to save; empty = save all past steps
   */
  const handleSaveAsCommand = useCallback(
    (name: string, stepIndices: number[]) => {
      // Determine which snapshots to capture.
      // historyPast[i] is the doc that was present BEFORE step i+1 was applied,
      // so to replay step i+1 we push historyPast[i+1] (or doc for the current step).
      // For simplicity, we store the "result" snapshots that follow each selected step.
      // If stepIndices is empty we capture all past steps.
      const indicesToUse =
        stepIndices.length > 0 ? stepIndices : Array.from({ length: historyPast.length }, (_, i) => i + 1);

      const steps = indicesToUse.map((idx) => {
        // idx is 1-based; historyPast[idx-1] is the doc snapshot BEFORE that step.
        // The result of applying step idx is historyPast[idx] if it exists, else doc (current).
        return historyPast[idx] ?? doc;
      });

      setSavedCommands((prev) => saveCommand(name, steps, prev));
    },
    [historyPast, doc]
  );

  /**
   * Replay a saved command by pushing each stored doc snapshot onto the history stack.
   */
  const handleRunCommand = useCallback(
    (id: string) => {
      const cmd = savedCommands.find((c) => c.id === id);
      if (!cmd) return;
      for (const step of cmd.steps) {
        pushDoc(step);
      }
    },
    [savedCommands, pushDoc]
  );

  /**
   * Delete a saved command by id.
   */
  const handleDeleteCommand = useCallback(
    (id: string) => {
      setSavedCommands((prev) => deleteCommand(id, prev));
    },
    []
  );


  return {
    handleDocAccessibilityChange, handleObjectAccessibilityChange,
    handleJumpToHistory, handleSaveAsCommand, handleRunCommand, handleDeleteCommand,
  };
}
