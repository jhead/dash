// ---------------------------------------------------------------------------
// recentProjects — the small, synchronously-readable persistence layer for the
// project feature: the ACTIVE project name (web) / path (Tauri), and the
// most-recent-first OPEN RECENT list.
//
// Why localStorage and not IndexedDB: these values are tiny (a few names/paths),
// must be read synchronously on the very first render (to decide what to restore
// before the async IndexedDB read resolves), and should survive an IndexedDB
// eviction. The heavy serialized `.fla` bytes live in projectStore (IndexedDB).
//
// This mirrors preferences.ts / editorLayout.ts hygiene: a schema version, a
// normalize() guard, and try/catch around every localStorage access (quota /
// privacy-mode safe).
//
// On the web a "recent entry" is a project NAME (the IndexedDB key). On Tauri a
// "recent entry" is a file PATH (real `.fla` on disk). We keep them in the SAME
// list shape (`{ id, label, updatedAt }`) so the File-menu rendering is uniform;
// `id` is the name (web) or absolute path (Tauri), `label` is the display text.
// ---------------------------------------------------------------------------

export const RECENT_PROJECTS_SCHEMA_VERSION = 1;

/** Max entries kept in the Open Recent list. */
export const RECENT_PROJECTS_CAP = 15;

const STORAGE_KEY = "flash8.recentProjects";

/** One entry in the Open Recent list. */
export interface RecentEntry {
  /** Stable identity: the project name (web) or absolute file path (Tauri). */
  readonly id: string;
  /** Display label (project name, or the path's basename). */
  readonly label: string;
  /** Epoch-ms of the last open/save. */
  readonly updatedAt: number;
}

/** Persisted shape: the active project + the recent list. */
export interface RecentProjectsState {
  /** Name (web) or path (Tauri) of the currently-active project, if any. */
  readonly activeId?: string;
  /** Most-recent-first, capped to RECENT_PROJECTS_CAP. */
  readonly recent: readonly RecentEntry[];
}

export const EMPTY_RECENT_STATE: RecentProjectsState = { recent: [] };

function normalizeEntry(raw: unknown): RecentEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const label =
    typeof o.label === "string" && o.label.trim().length > 0
      ? o.label.trim()
      : id;
  const updatedAt =
    typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt)
      ? o.updatedAt
      : 0;
  return { id, label, updatedAt };
}

/** Coerce an arbitrary parsed value into a valid, de-duplicated, capped state. */
function normalize(raw: unknown): RecentProjectsState {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawList = Array.isArray(obj.recent) ? obj.recent : [];
  const seen = new Set<string>();
  const recent: RecentEntry[] = [];
  for (const item of rawList) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    recent.push(entry);
    if (recent.length >= RECENT_PROJECTS_CAP) break;
  }
  recent.sort((a, b) => b.updatedAt - a.updatedAt);
  const activeId =
    typeof obj.activeId === "string" && obj.activeId.trim().length > 0
      ? obj.activeId.trim()
      : undefined;
  return activeId !== undefined ? { activeId, recent } : { recent };
}

/** Read the recent-projects state from localStorage, falling back to empty. */
export function loadRecentProjects(): RecentProjectsState {
  if (typeof localStorage === "undefined") return { ...EMPTY_RECENT_STATE };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...EMPTY_RECENT_STATE };
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      // Versioned envelope: { version, state }. Tolerate a future version by
      // normalizing the known fields; reject an unparseable body to defaults.
      return normalize((parsed as { state?: unknown }).state);
    }
    // Legacy/unversioned: treat the whole object as the state.
    return normalize(parsed);
  } catch {
    return { ...EMPTY_RECENT_STATE };
  }
}

/** Persist the recent-projects state (no-op when storage is unavailable). */
export function saveRecentProjects(state: RecentProjectsState): void {
  if (typeof localStorage === "undefined") return;
  try {
    const envelope = {
      version: RECENT_PROJECTS_SCHEMA_VERSION,
      state: normalize(state),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Ignore quota / privacy-mode write failures.
  }
}

/**
 * Push `entry` to the front of the recent list (de-duplicating by id, capped),
 * set it as the active project, persist, and return the new state. Pure given
 * the prior state; the storage write is the only side effect.
 */
export function touchRecentProject(
  prev: RecentProjectsState,
  entry: RecentEntry
): RecentProjectsState {
  const normalized = normalizeEntry(entry);
  if (!normalized) return prev;
  const rest = prev.recent.filter((e) => e.id !== normalized.id);
  const recent = [normalized, ...rest].slice(0, RECENT_PROJECTS_CAP);
  const next: RecentProjectsState = { activeId: normalized.id, recent };
  saveRecentProjects(next);
  return next;
}

/** Remove an entry from the recent list (delete-from-recent), persist, return new state. */
export function removeRecentProject(
  prev: RecentProjectsState,
  id: string
): RecentProjectsState {
  const recent = prev.recent.filter((e) => e.id !== id);
  const activeId = prev.activeId === id ? undefined : prev.activeId;
  const next: RecentProjectsState =
    activeId !== undefined ? { activeId, recent } : { recent };
  saveRecentProjects(next);
  return next;
}

/** Clear the active project id (e.g. after New) without touching the recent list. */
export function clearActiveProject(prev: RecentProjectsState): RecentProjectsState {
  const next: RecentProjectsState = { recent: prev.recent };
  saveRecentProjects(next);
  return next;
}
