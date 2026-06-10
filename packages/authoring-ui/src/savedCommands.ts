/**
 * Saved Commands — persist named macros (history step sequences) to localStorage.
 *
 * A "command" is a sequence of FlashDocument snapshots (the same shape as the
 * history past array). Replaying a command re-applies each document transition
 * in order by calling pushDoc() for each snapshot.
 *
 * Storage: JSON-serialised in localStorage under STORAGE_KEY.
 */

import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedCommand {
  /** Unique identifier (UUID-style timestamp string). */
  id: string;
  /** Human-readable name chosen by the user. */
  name: string;
  /**
   * Sequence of document snapshots to replay.
   * Each element is a full FlashDocument to push onto the history stack.
   */
  steps: FlashDocument[];
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "flash8-saved-commands";

/** Load all saved commands from localStorage. Returns [] on parse error. */
export function loadCommands(): SavedCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedCommand[];
  } catch {
    return [];
  }
}

/** Persist the full command list to localStorage. */
function persistCommands(commands: SavedCommand[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
  } catch {
    // localStorage unavailable (e.g. in a sandboxed iframe) — silently ignore.
  }
}

/** Save a new command (or overwrite one with the same name). Returns updated list. */
export function saveCommand(
  name: string,
  steps: FlashDocument[],
  existing: SavedCommand[]
): SavedCommand[] {
  const id = `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const newCommand: SavedCommand = { id, name, steps };
  const updated = [...existing, newCommand];
  persistCommands(updated);
  return updated;
}

/** Delete a command by id. Returns updated list. */
export function deleteCommand(
  id: string,
  existing: SavedCommand[]
): SavedCommand[] {
  const updated = existing.filter((c) => c.id !== id);
  persistCommands(updated);
  return updated;
}
