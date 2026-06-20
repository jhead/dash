// ---------------------------------------------------------------------------
// projectSession — the orchestration layer that ties the IndexedDB projectStore
// and the localStorage recentProjects list together into the user-facing
// operations: Save As, Save, Open Recent, and restore-on-load.
//
// This module is pure-ish: every function takes the store/state it operates on
// (no hidden globals beyond the live store accessor) so it can be unit-tested
// with a fresh fake-indexeddb store and an in-memory recent state.
//
// WEB is the priority path. On Tauri the recent list tracks file PATHS instead
// of IndexedDB names (see useProjectActions for the desktop wiring); this module
// is the web mechanism.
// ---------------------------------------------------------------------------

import type { FlashDocument } from "@flash/core";
import { loadFla, saveFla } from "@flash/core";
import {
  CURRENT_WORKING_KEY,
  type ProjectStore,
  type ProjectMeta,
} from "./projectStore.js";
import {
  touchRecentProject,
  type RecentEntry,
  type RecentProjectsState,
} from "./recentProjects.js";

/** A sanitized, non-reserved project name, or null if the input is unusable. */
export function sanitizeProjectName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\.fla$/i, "").trim();
  if (!trimmed) return null;
  if (trimmed === CURRENT_WORKING_KEY) return null;
  return trimmed;
}

export interface RestoreResult {
  /** The restored document. */
  readonly doc: FlashDocument;
  /** The active project name to reflect in the title bar, or undefined (unnamed). */
  readonly name?: string;
  /** Whether the restored doc came from the autosave current-working slot. */
  readonly fromCurrentWorking: boolean;
}

/**
 * Restore the document to show on app load. Strategy:
 *   1. If the autosave current-working slot exists, restore it (the exact
 *      in-progress state from before the refresh). Its active name is the last
 *      active project name from the recent state, when still present.
 *   2. Else if there is a remembered active named project, load it.
 *   3. Else null → the caller starts a fresh document.
 * Returns null when there is nothing to restore or the bytes fail to parse.
 */
export async function restoreOnLoad(
  store: ProjectStore,
  recent: RecentProjectsState
): Promise<RestoreResult | null> {
  // 1) Current-working autosave slot — the F5 recovery path.
  const working = await store.get(CURRENT_WORKING_KEY);
  if (working) {
    const doc = tryLoad(working.bytes);
    if (doc) {
      const name = recent.activeId;
      // Only treat activeId as the name if it still resolves to a real project.
      const namedExists = name ? await store.has(name) : false;
      return {
        doc,
        ...(namedExists && name ? { name } : {}),
        fromCurrentWorking: true,
      };
    }
  }

  // 2) Remembered active named project.
  if (recent.activeId) {
    const named = await store.get(recent.activeId);
    if (named) {
      const doc = tryLoad(named.bytes);
      if (doc) {
        return { doc, name: recent.activeId, fromCurrentWorking: false };
      }
    }
  }

  return null;
}

/**
 * Save the document to the autosave current-working slot only (the debounced
 * autosave for an UNNAMED project). Returns the written metadata.
 */
export async function autosaveCurrentWorking(
  store: ProjectStore,
  bytes: Uint8Array,
  seq?: number
): Promise<ProjectMeta> {
  return store.put(CURRENT_WORKING_KEY, bytes, typeof seq === "number" ? { seq } : undefined);
}

/**
 * Save the document to a NAMED slot AND mirror it into the current-working slot
 * so a reload restores into the named project. Updates the recent list / active
 * project. Returns the new recent state + the written metadata.
 *
 * This backs both Save As (`name` chosen by the user) and plain Save (the
 * already-active `name`).
 */
export async function saveNamed(
  store: ProjectStore,
  recent: RecentProjectsState,
  name: string,
  doc: FlashDocument,
  seq?: number
): Promise<{ recent: RecentProjectsState; meta: ProjectMeta }> {
  const bytes = saveFla(doc);
  const now = Date.now();
  const seqExtra = typeof seq === "number" ? { seq } : {};
  const meta = await store.put(name, bytes, { updatedAt: now, ...seqExtra });
  // Mirror into the current-working slot so F5 recovers the named project.
  await store.put(CURRENT_WORKING_KEY, bytes, { updatedAt: now, ...seqExtra });
  const entry: RecentEntry = { id: name, label: name, updatedAt: now };
  const nextRecent = touchRecentProject(recent, entry);
  return { recent: nextRecent, meta };
}

/**
 * Open a named project from the store, returning the parsed document and an
 * updated recent state (the opened project becomes most-recent + active). Also
 * mirrors the opened bytes into the current-working slot so a subsequent F5
 * stays on it. Returns null if the project is missing or fails to parse.
 */
export async function openNamed(
  store: ProjectStore,
  recent: RecentProjectsState,
  name: string,
  seq?: number
): Promise<{ doc: FlashDocument; recent: RecentProjectsState } | null> {
  const record = await store.get(name);
  if (!record) return null;
  const doc = tryLoad(record.bytes);
  if (!doc) return null;
  await store.put(CURRENT_WORKING_KEY, record.bytes, {
    updatedAt: Date.now(),
    ...(typeof seq === "number" ? { seq } : {}),
  });
  const entry: RecentEntry = {
    id: name,
    label: name,
    updatedAt: Date.now(),
  };
  const nextRecent = touchRecentProject(recent, entry);
  return { doc, recent: nextRecent };
}

/** Parse `.fla` bytes, returning null on any failure (never throws). */
function tryLoad(bytes: Uint8Array): FlashDocument | null {
  try {
    return loadFla(bytes);
  } catch {
    return null;
  }
}
