// ---------------------------------------------------------------------------
// useProjectActions — the React adapter that wires browser-persistent projects
// into Shell: debounced autosave to IndexedDB, Save As / Save into named slots,
// Open Recent, and restore-on-load.
//
// WEB is the priority. On Tauri the same hook tracks recent FILE PATHS and lets
// the desktop Save/Open path drive the recent list (via `noteOpenedPath`), while
// the IndexedDB autosave is skipped (desktop projects are real `.fla` files).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import type { FlashDocument } from "@flash/core";
import { saveFla } from "@flash/core";
import type { DocumentStoreApi } from "../store/index.js";
import { selectDoc } from "../store/documentStore.js";
import {
  getProjectStore,
  CURRENT_WORKING_KEY,
  ProjectQuotaError,
  type ProjectMeta,
} from "./projectStore.js";
import {
  loadRecentProjects,
  touchRecentProject,
  removeRecentProject,
  clearActiveProject,
  type RecentEntry,
  type RecentProjectsState,
} from "./recentProjects.js";
import {
  autosaveCurrentWorking,
  openNamed,
  restoreOnLoad,
  saveNamed,
  sanitizeProjectName,
} from "./projectSession.js";
import { AutosaveController } from "./autosaveController.js";

/** True when running inside a Tauri desktop app (projects are real `.fla` files). */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Basename of a file path (for the recent-list label on desktop). */
function basename(path: string): string {
  const segs = path.replace(/\\/g, "/").split("/");
  return segs[segs.length - 1] || path;
}

export interface UseProjectActionsDeps {
  /** The live per-instance document store. */
  readonly documentStore: DocumentStoreApi;
  /** Replace the present doc + wipe history (Shell's handleDocumentChange). */
  readonly onRestoreDocument: (doc: FlashDocument, name?: string) => void;
  /**
   * Autosave debounce in ms. Defaults to 1500. Exposed for tests / tuning.
   */
  readonly autosaveDelayMs?: number;
  /** Disable autosave + restore (e.g. headless tests). Defaults to false. */
  readonly disabled?: boolean;
}

export interface UseProjectActionsResult {
  /** Most-recent-first recent list for the File > Open Recent menu. */
  readonly recent: readonly RecentEntry[];
  /** Active project name (web) / path (Tauri), reflected in the title bar. */
  readonly activeName: string | undefined;
  /** True once the initial restore-on-load attempt has completed. */
  readonly restored: boolean;
  /** Save As: prompt-free — caller supplies the chosen name. Web only. */
  readonly saveProjectAs: (name: string, doc: FlashDocument) => Promise<boolean>;
  /** Plain Save: write the active named slot (or fall through to Save As). */
  readonly saveProject: (doc: FlashDocument) => Promise<boolean>;
  /** Open a recent project by id (web: name; Tauri: caller handles path open). */
  readonly openRecent: (id: string) => Promise<FlashDocument | null>;
  /** Remove an entry from the recent list (delete-from-recent). */
  readonly removeRecent: (id: string) => void;
  /** Record a desktop file open/save (Tauri recent-paths tracking). */
  readonly noteOpenedPath: (path: string) => void;
  /** Reset the active project (after New) without clearing the recent list. */
  readonly resetActive: () => void;
  /** Force-flush any pending autosave (e.g. before publish / explicit save). */
  readonly flushAutosave: () => Promise<void>;
}

/**
 * Wire browser-persistent projects to the document store. Mount once in Shell
 * after the stores exist.
 */
export function useProjectActions(deps: UseProjectActionsDeps): UseProjectActionsResult {
  const { documentStore, onRestoreDocument, autosaveDelayMs, disabled } = deps;
  const tauri = isTauri();

  const [recentState, setRecentState] = useState<RecentProjectsState>(loadRecentProjects);
  const [restored, setRestored] = useState(false);
  const quotaWarnedRef = useRef(false);

  // Keep the active name in a ref so the autosave persist closure (created once)
  // always targets the CURRENT named slot after a Save As / Open.
  const activeNameRef = useRef<string | undefined>(recentState.activeId);
  activeNameRef.current = recentState.activeId;

  // -------------------------------------------------------------------------
  // Autosave controller — created once; serializes the latest doc and persists
  // it to the current-working slot AND (if named) the active named slot.
  // -------------------------------------------------------------------------
  const autosaveRef = useRef<AutosaveController | null>(null);
  if (!autosaveRef.current && !disabled) {
    autosaveRef.current = new AutosaveController({
      serialize: saveFla,
      persist: async (bytes) => {
        const store = getProjectStore();
        if (!store) return;
        // Always update the current-working recovery slot.
        await autosaveCurrentWorking(store, bytes);
        // If a named project is active, keep it in sync too.
        const name = activeNameRef.current;
        if (name && name !== CURRENT_WORKING_KEY) {
          await store.put(name, bytes);
        }
      },
      delayMs: autosaveDelayMs,
      onError: (err) => {
        if (err instanceof ProjectQuotaError && !quotaWarnedRef.current) {
          quotaWarnedRef.current = true;
          console.warn("[projects] autosave skipped — storage quota exceeded:", err);
        } else if (!(err instanceof ProjectQuotaError)) {
          console.warn("[projects] autosave failed:", err);
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // Restore-on-load — run ONCE after mount. On Tauri this is a no-op for the
  // IndexedDB path (the desktop reopen-last-path is handled by the caller via
  // the returned recent list + noteOpenedPath); on the web it pulls the
  // current-working / last-active project back.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (disabled || tauri) {
      setRestored(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const store = getProjectStore();
      if (!store) {
        if (!cancelled) setRestored(true);
        return;
      }
      try {
        const result = await restoreOnLoad(store, loadRecentProjects());
        if (cancelled) return;
        if (result) {
          onRestoreDocument(result.doc, result.name);
          if (result.name) {
            // Keep the active name aligned with what we restored.
            setRecentState((prev) =>
              prev.activeId === result.name ? prev : { ...prev, activeId: result.name }
            );
          }
        }
      } catch (err) {
        console.warn("[projects] restore-on-load failed:", err);
      } finally {
        if (!cancelled) setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Subscribe to document mutations → schedule debounced autosave. Skipped on
  // Tauri and until the initial restore completes (so restoring doesn't trip
  // an immediate redundant save).
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (disabled || tauri) return;
    if (!restored) return;
    const controller = autosaveRef.current;
    if (!controller) return;
    // Prime with the current doc so the first quiet period after restore saves.
    let prevDoc = selectDoc(documentStore.getState());
    const unsub = documentStore.subscribe((state) => {
      const nextDoc = selectDoc(state);
      if (nextDoc === prevDoc) return;
      prevDoc = nextDoc;
      controller.schedule(nextDoc);
    });
    return unsub;
  }, [documentStore, restored, disabled, tauri]);

  // Flush pending autosave when the tab is hidden / closed so the very latest
  // edit survives an abrupt close (debounce may not have fired yet).
  useEffect(() => {
    if (disabled || tauri) return;
    const onHide = () => {
      void autosaveRef.current?.flush();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("visibilitychange", onHide);
    };
  }, [disabled, tauri]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const saveProjectAs = useCallback(
    async (rawName: string, doc: FlashDocument): Promise<boolean> => {
      const name = sanitizeProjectName(rawName);
      if (!name) return false;
      const store = getProjectStore();
      if (!store) return false;
      try {
        const { recent } = await saveNamed(store, loadRecentProjects(), name, doc);
        setRecentState(recent);
        activeNameRef.current = name;
        return true;
      } catch (err) {
        if (err instanceof ProjectQuotaError) {
          window.alert(
            `Could not save "${name}": browser storage is full. ` +
              `Delete some recent projects and try again.`
          );
        } else {
          console.error("[projects] saveProjectAs failed:", err);
        }
        return false;
      }
    },
    []
  );

  const saveProject = useCallback(
    async (doc: FlashDocument): Promise<boolean> => {
      const name = activeNameRef.current;
      if (!name || name === CURRENT_WORKING_KEY) {
        // No active named project — Save behaves like Save As; the caller
        // (MenuBar) prompts for a name and routes to saveProjectAs.
        return false;
      }
      const store = getProjectStore();
      if (!store) return false;
      try {
        const { recent } = await saveNamed(store, loadRecentProjects(), name, doc);
        setRecentState(recent);
        return true;
      } catch (err) {
        if (err instanceof ProjectQuotaError) {
          window.alert(`Could not save "${name}": browser storage is full.`);
        } else {
          console.error("[projects] saveProject failed:", err);
        }
        return false;
      }
    },
    []
  );

  const openRecent = useCallback(
    async (id: string): Promise<FlashDocument | null> => {
      if (tauri) {
        // Desktop: the recent id is a file PATH; the caller opens it via the
        // native FS path and then calls noteOpenedPath. Nothing to do here.
        return null;
      }
      const store = getProjectStore();
      if (!store) return null;
      const result = await openNamed(store, loadRecentProjects(), id);
      if (!result) {
        // Stale recent entry (project deleted) — drop it.
        setRecentState((prev) => removeRecentProject(prev, id));
        return null;
      }
      setRecentState(result.recent);
      activeNameRef.current = id;
      return result.doc;
    },
    [tauri]
  );

  const removeRecent = useCallback((id: string) => {
    setRecentState((prev) => removeRecentProject(prev, id));
  }, []);

  const noteOpenedPath = useCallback((path: string) => {
    const entry: RecentEntry = {
      id: path,
      label: basename(path),
      updatedAt: Date.now(),
    };
    setRecentState((prev) => touchRecentProject(prev, entry));
    activeNameRef.current = path;
  }, []);

  const resetActive = useCallback(() => {
    setRecentState((prev) => clearActiveProject(prev));
    activeNameRef.current = undefined;
    autosaveRef.current?.cancel();
  }, []);

  const flushAutosave = useCallback(async () => {
    await autosaveRef.current?.flush();
  }, []);

  return {
    recent: recentState.recent,
    activeName: recentState.activeId,
    restored,
    saveProjectAs,
    saveProject,
    openRecent,
    removeRecent,
    noteOpenedPath,
    resetActive,
    flushAutosave,
  };
}

/** Re-export for convenience. */
export type { ProjectMeta };
