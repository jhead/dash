import type { FlashDocument } from "../model/types.js";

/**
 * A reversible authoring operation.
 *
 * Both `execute` and `undo` must be pure functions — they receive the current
 * document and return a brand-new `FlashDocument` object without mutating the
 * one passed in.
 *
 * The `label` is displayed in the History panel (deferred feature).
 */
export interface Command {
  /** Human-readable description shown in the History panel, e.g. "Draw Oval" */
  label: string;
  /**
   * Apply the operation and return the new document state.
   * Must NOT mutate `doc`.
   */
  execute(doc: FlashDocument): FlashDocument;
  /**
   * Revert the operation and return the previous document state.
   * Must NOT mutate `doc`.
   */
  undo(doc: FlashDocument): FlashDocument;
}
