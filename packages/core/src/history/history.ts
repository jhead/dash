import type { FlashDocument } from "../model/types.js";

/** Default undo level count (matches Flash 8 default of 100). */
const DEFAULT_MAX_SIZE = 100;

/**
 * Immutable snapshot-based undo/redo state.
 *
 * `past`    — older document snapshots (index 0 = oldest)
 * `present` — the current document
 * `future`  — snapshots available for redo (index 0 = next redo target)
 *
 * All functions return a NEW `HistoryState`; nothing is mutated.
 */
export interface HistoryState {
  readonly past: readonly FlashDocument[];
  readonly present: FlashDocument;
  readonly future: readonly FlashDocument[];
  readonly maxSize: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the initial `HistoryState` wrapping the given document.
 */
export function createHistory(
  initial: FlashDocument,
  maxSize: number = DEFAULT_MAX_SIZE
): HistoryState {
  return { past: [], present: initial, future: [], maxSize };
}

// ---------------------------------------------------------------------------
// Mutations (all return new HistoryState)
// ---------------------------------------------------------------------------

/**
 * Record a new document state as the current "present".
 *
 * The previous `present` is pushed onto `past` (trimmed to `maxSize`).
 * Any `future` entries are discarded (consistent with Flash 8 behaviour).
 */
export function pushState(
  history: HistoryState,
  nextDoc: FlashDocument
): HistoryState {
  const newPast = [...history.past, history.present];
  // Trim to maxSize — remove oldest entries from the front.
  const trimmed =
    newPast.length > history.maxSize
      ? newPast.slice(newPast.length - history.maxSize)
      : newPast;

  return {
    past: trimmed,
    present: nextDoc,
    future: [],
    maxSize: history.maxSize,
  };
}

/**
 * Move one step back in history.
 * Returns the same `HistoryState` unchanged when there is nothing to undo.
 */
export function undo(history: HistoryState): HistoryState {
  if (history.past.length === 0) return history;

  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, history.past.length - 1),
    present: previous,
    future: [history.present, ...history.future],
    maxSize: history.maxSize,
  };
}

/**
 * Move one step forward in history (re-apply a previously undone action).
 * Returns the same `HistoryState` unchanged when there is nothing to redo.
 */
export function redo(history: HistoryState): HistoryState {
  if (history.future.length === 0) return history;

  const next = history.future[0];
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
    maxSize: history.maxSize,
  };
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** Returns `true` when there is at least one state to undo. */
export function canUndo(history: HistoryState): boolean {
  return history.past.length > 0;
}

/** Returns `true` when there is at least one state to redo. */
export function canRedo(history: HistoryState): boolean {
  return history.future.length > 0;
}
