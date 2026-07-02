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
      persist: async ({ bytes, targetName, generation }) => {
        const store = getProjectStore();
        if (!store) return;
        // Defense-in-depth: stamp the write with the controller generation as a
        // monotonic per-slot seq so an out-of-order stale write is rejected by
        // the store even if it slips past the in-process supersession guard.
        // Always update the current-working recovery slot. During a collab
        // session this holds the shared/remote doc — that is ACCEPTED (it is the
        // session-scoped recovery slot; CLAUDE.md task-1348 item 4), and a rejoin
        // re-syncs from peers.
        await autosaveCurrentWorking(store, bytes, generation);
        // If a named project was active AT SCHEDULE TIME, keep it in sync too.
        // `targetName` was captured when this save was scheduled — NOT read here
        // at resolve time — so a Save As that switched the active slot during the
        // debounce/persist window cannot redirect these (older) bytes into the
        // newly-named slot (BUG 2, task 1316).
        //
        // SUSPEND the named-slot write while a collab session is active (task
        // 1377): joining a share link REPLACES the in-memory doc with the shared
        // document, so writing it to the local named slot would silently clobber
        // the user's own project — irreversible data loss. Checked HERE at persist
        // time (not schedule time) so the guard is correct even for the very first
        // autosave scheduled by the join's adoption replaceDoc (the collab handler
        // is attached synchronously as the session starts, well before this
        // debounced write resolves). On leave the handler is cleared and the named
        // slot resumes receiving writes.
        if (
          targetName &&
          targetName !== CURRENT_WORKING_KEY &&
          !documentStore.getState().isCollabActive()
        ) {
          await store.put(targetName, bytes, { seq: generation });
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
      // Capture the active named slot AT SCHEDULE TIME so a Save As during the
      // debounce window cannot retarget these bytes (BUG 2, task 1316).
      const target = activeNameRef.current;
      controller.schedule(nextDoc, target);
    });
    return unsub;
  }, [documentStore, restored, disabled, tauri]);

  // -------------------------------------------------------------------------
  // Last-chance durability flush (BUG 1, task 1316).
  //
  // IndexedDB writes are async and CANNOT be fully awaited during page unload —
  // the browser may tear the tab down before the transaction commits. We make the
  // unsaved window as small as practical and start the durable write at the
  // recommended lifecycle point:
  //   - visibilitychange -> 'hidden' is the PRIMARY durable flush: it fires while
  //     the page is still fully alive (unlike pagehide/beforeunload), so the
  //     IndexedDB transaction has the best chance to commit. We serialize the
  //     pending doc SYNCHRONOUSLY in the handler (takePendingPayload) and START
  //     the write immediately, rather than relying on the async debounced path.
  //   - pagehide is a BACKSTOP for the rare case the page goes straight to unload
  //     without a prior 'hidden' transition.
  //   - blur proactively flushes so the unsaved window is already tiny by the time
  //     the tab is hidden/closed.
  //
  // This is the documented BEST-EFFORT path: a save started here is durable in the
  // common case but is NOT guaranteed if the OS kills the tab mid-commit. The
  // debounced autosave + the current-working recovery slot remain the primary
  // durability mechanism; see docs/35-persistent-projects.md.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (disabled || tauri) return;

    // Synchronously serialize the pending doc and start its IndexedDB write.
    // Returns true if a write was started. Best-effort: errors are swallowed
    // (the in-memory doc + recovery slot are the source of truth).
    const startDurableFlush = (): boolean => {
      const controller = autosaveRef.current;
      if (!controller) return false;
      const payload = controller.takePendingPayload();
      if (!payload) return false;
      const store = getProjectStore();
      if (!store) return false;
      const { bytes, targetName, generation } = payload;
      // Fire the writes; do not await (we cannot reliably await during unload).
      void (async () => {
        try {
          await autosaveCurrentWorking(store, bytes, generation);
          // Same collab guard as the debounced persist (task 1377): never flush
          // the shared/remote session doc into the local named slot on unload.
          if (
            targetName &&
            targetName !== CURRENT_WORKING_KEY &&
            !documentStore.getState().isCollabActive()
          ) {
            await store.put(targetName, bytes, { seq: generation });
          }
        } catch {
          // Best-effort; ignore (quota/IO/teardown).
        }
      })();
      return true;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") startDurableFlush();
    };
    const onPageHide = () => {
      startDurableFlush();
    };
    const onBlur = () => {
      // Proactive: shrink the unsaved window before a possible close.
      startDurableFlush();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", onBlur);
    };
  }, [disabled, tauri, documentStore]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const saveProjectAs = useCallback(
    async (rawName: string, doc: FlashDocument): Promise<boolean> => {
      const name = sanitizeProjectName(rawName);
      if (!name) return false;
      const store = getProjectStore();
      if (!store) return false;
      // Supersede any pending/in-flight autosave BEFORE writing the named slot:
      // a debounced autosave that captured OLDER bytes (or the old target) must
      // not overwrite the slot this explicit Save As is about to own (BUG 2,
      // task 1316). The post-supersede generation is the monotonic seq we stamp
      // this write with, so a stale autosave's lower seq is rejected by the store.
      autosaveRef.current?.supersede();
      const seq = autosaveRef.current?.currentGeneration;
      // Point future autosaves at the new slot before any await yields.
      activeNameRef.current = name;
      try {
        const { recent } = await saveNamed(store, loadRecentProjects(), name, doc, seq);
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
      // Supersede pending autosave so a stale debounced write can't clobber this
      // explicit Save (BUG 2, task 1316); stamp with the post-supersede seq.
      autosaveRef.current?.supersede();
      const seq = autosaveRef.current?.currentGeneration;
      try {
        const { recent } = await saveNamed(store, loadRecentProjects(), name, doc, seq);
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
      // Supersede any pending autosave (it captured the doc we're navigating
      // AWAY from) so it cannot overwrite the freshly-opened current-working slot
      // (BUG 2, task 1316). Stamp the open's mirror write with the new seq.
      autosaveRef.current?.supersede();
      const seq = autosaveRef.current?.currentGeneration;
      const result = await openNamed(store, loadRecentProjects(), id, seq);
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
