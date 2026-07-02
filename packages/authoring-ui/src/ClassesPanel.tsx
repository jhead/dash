import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FlashDocument, ClassVfs, IdentifiedClassVfs } from "@flash/core";
import {
  normalizeClassPath,
  splitClassPath,
  hydrateVfsFromDoc,
  syncDocFromVfs,
  addAsClass,
} from "@flash/core";
import { ScriptEditor } from "./ActionsPanel";
import { createClassVfs } from "./vfs/factory.js";
import { ClassVfsQuotaError, isQuotaError } from "./vfs/quota.js";
import {
  buildClassTree,
  classNameToPath,
  defaultClassSource,
  dottedNameFromPath,
  validateClassPath,
  type ClassTreeFolder,
  type ClassTreeNode,
} from "./classTree.js";
import { chrome, halo, chromeFont } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// ClassesPanel (task 1302 P4) — the bottom-dock "Classes" tab.
//
// Two panes:
//   * LEFT  — a file TREE of package folders + `.as` files, with add / remove /
//     rename actions.
//   * RIGHT — the REUSED `ScriptEditor` from ActionsPanel.tsx, editing the
//     selected `.as` file (AS2 syntax highlight + live parse-error gutter for
//     free).
//
// Data flow (docs/33-as2-classes-vfs.md):
//   open  : hydrateVfsFromDoc(doc, vfs, { prune:true })  — mirror embed -> VFS
//   edit  : vfs.write(path, source) + addAsClass -> pushDoc SYNCHRONOUSLY,
//           plus a debounced full syncDocFromVfs to catch external/disk edits
//   add   : vfs.write(newPath, stub) -> syncDocFromVfs    -> pushDoc
//   remove: vfs.remove(path)         -> syncDocFromVfs    -> pushDoc
//   rename: vfs.write(new) + remove(old) -> syncDocFromVfs -> pushDoc
//
// SYNC SEMANTICS (task 1317 — data-loss fix): `doc.asClasses` (the `.fla`
// embed) is authoritative and EVERY editor keystroke folds straight into it
// (synchronously, via `addAsClass` + `pushDoc`) so anything that compiles or
// persists off `doc.asClasses` — Test Movie, Publish, Live Preview recompile,
// autosave, Save — always sees the latest edit with NO debounce window in which
// the edit could be lost. The 600ms timer no longer gates correctness: it only
// runs a deferred FULL `syncDocFromVfs` to reconcile out-of-band changes (e.g.
// an external desktop/disk edit, or a class removed via the VFS) and to coalesce
// history. That pending reconcile is also FLUSHED on unmount (closing the tab)
// so it can never be dropped. A re-hydrate fires when `doc.asClasses` identity
// changes after mount (e.g. a project restore), guarded so it never clobbers an
// in-progress edit.
// ---------------------------------------------------------------------------

export interface ClassesPanelProps {
  /** The current document (source of truth for `asClasses`). */
  readonly doc: FlashDocument;
  /** History-safe document mutator (Shell's `pushDoc`). */
  readonly pushDoc: (next: FlashDocument) => void;
  /** Project `.fla` path (drives the Tauri disk-mirror root); may be undefined. */
  readonly flaPath?: string;
  /** Collapse the dock (wired to the tab's close affordance). */
  readonly onClose?: () => void;
  /**
   * Test/SSR seam: provide a VFS factory instead of the platform one. The
   * panel owns the lifecycle either way.
   */
  readonly createVfs?: (flaPath?: string) => IdentifiedClassVfs;
}

// Debounce window for editor edits before reconciling into the doc/history.
const EDIT_SYNC_DELAY_MS = 600;

export function ClassesPanel({
  doc,
  pushDoc,
  flaPath,
  onClose,
  createVfs,
}: ClassesPanelProps): React.ReactElement {
  // --- VFS lifecycle -------------------------------------------------------
  // One VFS per flaPath. Recreated when the project path changes.
  const vfsRef = useRef<ClassVfs | null>(null);
  const [vfsReady, setVfsReady] = useState(false);

  // Snapshot of the latest pushed doc so async syncs read fresh state without
  // re-subscribing the effect (mirrors the Shell pushDoc ref pattern).
  const docRef = useRef(doc);
  docRef.current = doc;

  // Tree listing (sorted classpath-relative paths of `.as` files).
  const [paths, setPaths] = useState<readonly string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");

  // Collapsed-folder set (keyed by folder path); folders open by default.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Inline new-class / rename input + error.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Non-fatal warning shown when a VFS write fails to PERSIST (e.g. OPFS/
  // IndexedDB storage quota exceeded, task 1404). The edit still lives in
  // `doc.asClasses` (folded synchronously below), so this only tells the user
  // local mirroring is degraded — it is not data loss within the session.
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  // Warn about a full-storage quota only ONCE (a keystroke-rate stream of
  // rejections must not spam the banner). Reset when a later write succeeds.
  const quotaWarnedRef = useRef(false);

  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the editor has an unflushed edit that is NOT yet reflected by a
  // full VFS reconcile. Guards the doc-change re-hydrate from clobbering the
  // user's in-progress typing, and tells the unmount/flush path there is work.
  const pendingEditRef = useRef(false);
  // The `asClasses` reference this panel itself last folded into the doc. The
  // doc-change re-hydrate effect compares against it so the panel's OWN
  // synchronous edits (which re-render it with a fresh doc) don't trigger a
  // self-clobbering re-hydrate — only an EXTERNAL identity change (e.g. project
  // restore / undo) re-mirrors the embed into the VFS.
  const lastSyncedAsClassesRef = useRef<FlashDocument["asClasses"]>(doc.asClasses);
  // Count of panel-initiated VFS mutations (create/remove/rename) currently
  // mid-flight. While > 0 the re-hydrate effect must NOT prune-mirror the VFS:
  // those ops write/remove a file and only THEN await syncToDoc, so a re-hydrate
  // interleaving that async window could delete a just-created file that isn't in
  // the (about-to-be-pushed) doc yet.
  const vfsOpInFlightRef = useRef(0);

  // True while the panel is mounted. Async reconciles (`syncToDoc`) and observed
  // VFS writes (`observeVfsWrite`) resolve on a microtask that can land AFTER the
  // Classes tab is closed (unmount) — most notably the unmount FLUSH itself kicks
  // off an async `syncToDoc` whose `pushDoc` would otherwise run post-unmount
  // ("Cannot update an unmounted root"). Every state push/setState that happens
  // after an `await` is gated on this ref. The synchronous per-keystroke fold in
  // `handleScriptChange` already captured the latest edit into `doc.asClasses`
  // BEFORE unmount, so skipping the post-unmount reconcile loses no data.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Re-list the VFS into `paths` (and prune a stale selection).
  const refresh = useCallback(async (): Promise<readonly string[]> => {
    const vfs = vfsRef.current;
    if (!vfs) return [];
    const entries = await vfs.list();
    const next = entries
      .map((e) => normalizeClassPath(e.path))
      .filter((p) => /\.as$/i.test(p))
      .sort();
    setPaths(next);
    return next;
  }, []);

  // Reconcile VFS -> doc -> history (full reconcile; async because it lists +
  // reads the whole VFS). Used by add/remove/rename and the deferred edit
  // reconcile. The per-keystroke doc update is handled SYNCHRONOUSLY by
  // `handleScriptChange` so this is never on the data-loss critical path.
  const syncToDoc = useCallback(async (): Promise<void> => {
    const vfs = vfsRef.current;
    if (!vfs) return;
    const { doc: nextDoc } = await syncDocFromVfs(docRef.current, vfs);
    // The panel may have unmounted while the async reconcile was in flight (e.g.
    // the unmount flush kicked this off). Pushing after unmount updates a
    // torn-down root — bail out. The synchronous per-keystroke fold already put
    // the latest edit in `doc.asClasses`, so nothing is lost.
    if (!mountedRef.current) return;
    // syncDocFromVfs returns the SAME reference when nothing changed, so this
    // never churns history needlessly.
    if (nextDoc !== docRef.current) {
      docRef.current = nextDoc;
      lastSyncedAsClassesRef.current = nextDoc.asClasses;
      pushDoc(nextDoc);
    }
  }, [pushDoc]);

  // Cancel the pending debounced reconcile and run it NOW (synchronously kick
  // off the async full reconcile). Called on unmount so closing the Classes tab
  // with a pending reconcile can't drop an out-of-band change. The synchronous
  // per-keystroke doc update already guarantees the latest *editor* edit is in
  // `doc.asClasses`; this additionally captures any VFS-level reconcile work.
  const flushPendingSync = useCallback((): void => {
    if (editTimer.current) {
      clearTimeout(editTimer.current);
      editTimer.current = null;
    }
    if (pendingEditRef.current) {
      pendingEditRef.current = false;
      void syncToDoc();
    }
  }, [syncToDoc]);

  // (Re)create + hydrate the VFS whenever the project path changes.
  useEffect(() => {
    let cancelled = false;
    setVfsReady(false);
    const make = createVfs ?? createClassVfs;
    const vfs = createVfs
      ? createVfs(flaPath)
      : (make as typeof createClassVfs)({ flaPath });
    vfsRef.current = vfs;
    (async () => {
      // Exact mirror of the embed on (re)open.
      await hydrateVfsFromDoc(docRef.current, vfs, { prune: true });
      lastSyncedAsClassesRef.current = docRef.current.asClasses;
      const next = await refresh();
      if (cancelled) return;
      setSelected((prev) => (prev && next.includes(prev) ? prev : next[0] ?? null));
      setVfsReady(true);
    })().catch(() => {
      if (!cancelled) setVfsReady(true);
    });
    return () => {
      cancelled = true;
    };
    // Re-run only on path change; an EXTERNAL doc.asClasses change is handled by
    // the dedicated re-hydrate effect below (the per-keystroke edit path keeps
    // the doc current without a full re-hydrate, which would clobber edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaPath]);

  // Re-hydrate the VFS when `doc.asClasses` IDENTITY changes from OUTSIDE the
  // panel after mount — e.g. a project restore, undo/redo, or an MCP mutation
  // swaps in a different embed while the Classes tab is open. Without this the
  // panel keeps showing the pre-restore classes (the path-keyed effect above
  // never re-runs because flaPath is unchanged). Guarded so it NEVER clobbers
  // the user's typing: skipped while an edit is pending, and skipped when the
  // incoming reference is the one the panel itself just pushed (our own
  // synchronous per-keystroke edit re-renders with a fresh doc — that must not
  // trigger a self-clobbering re-hydrate).
  useEffect(() => {
    const incoming = doc.asClasses;
    if (incoming === lastSyncedAsClassesRef.current) return; // our own / unchanged
    if (pendingEditRef.current) {
      // A debounced editor edit is mid-flight; don't re-mirror over it. Adopt
      // the reference so a later genuine external change is still detected once
      // the edit settles. (The synchronous per-keystroke fold already put the
      // latest text in the doc, so adopting here loses nothing.)
      lastSyncedAsClassesRef.current = incoming;
      return;
    }
    if (vfsOpInFlightRef.current > 0) {
      // A create/remove/rename is mid-flight (it writes/removes a file, THEN
      // awaits syncToDoc). Pruning now could delete a just-created file not yet
      // in the doc. Skip WITHOUT adopting the reference: the in-flight op's
      // syncToDoc reconciles the (React-updated) external doc with the VFS, so
      // the external change is folded in rather than lost.
      return;
    }
    const vfs = vfsRef.current;
    if (!vfs) return;
    let cancelled = false;
    lastSyncedAsClassesRef.current = incoming;
    (async () => {
      await hydrateVfsFromDoc(docRef.current, vfs, { prune: true });
      const next = await refresh();
      if (cancelled) return;
      let nextSelected: string | null = null;
      setSelected((prev) => {
        nextSelected = prev && next.includes(prev) ? prev : next[0] ?? null;
        return nextSelected;
      });
      // Re-read the (possibly changed) selected file's source into the editor;
      // the selected-source effect is keyed on `selected`/`vfsReady`, neither of
      // which necessarily changes here.
      const sel = nextSelected;
      if (sel !== null) {
        const s = await vfs.read(sel);
        if (!cancelled) setSource(s ?? "");
      } else {
        setSource("");
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.asClasses, refresh]);

  // Load the selected file's source into the editor.
  useEffect(() => {
    let cancelled = false;
    const vfs = vfsRef.current;
    if (!vfs || selected === null) {
      setSource("");
      return;
    }
    vfs.read(selected).then((s) => {
      if (!cancelled) setSource(s ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [selected, vfsReady]);

  // FLUSH any pending debounced reconcile on unmount (closing the Classes tab)
  // so an out-of-band change can't be dropped. Use a ref to the latest flush so
  // the cleanup runs only on actual unmount, not on every flush-identity change.
  const flushRef = useRef(flushPendingSync);
  flushRef.current = flushPendingSync;
  useEffect(() => {
    return () => {
      flushRef.current();
    };
  }, []);

  // Surface a VFS write/persist failure without aborting the session — the edit
  // already lives in `doc.asClasses`, so a failed OPFS/IndexedDB mirror is a
  // degraded-persistence warning, not data loss (task 1404). Quota errors warn
  // exactly once; any other write failure is reported with its message.
  const reportVfsWriteError = useCallback((err: unknown): void => {
    if (err instanceof ClassVfsQuotaError || isQuotaError(err)) {
      if (quotaWarnedRef.current) return;
      quotaWarnedRef.current = true;
      setPersistWarning(
        "Local storage is full — class edits are kept in the document (and " +
          "will be saved with the project) but could not be mirrored to local " +
          "storage. Free up space to restore local class persistence."
      );
      return;
    }
    setPersistWarning(
      `Failed to persist class to local storage: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }, []);

  // Observe a fire-and-forget VFS write so a rejection (quota/I-O) is surfaced
  // instead of being swallowed by the microtask. On success, clear a prior
  // warning and re-arm the one-time quota notice.
  const observeVfsWrite = useCallback(
    (p: Promise<void>): void => {
      p.then(
        () => {
          // The write may resolve after the tab is closed; don't setState on an
          // unmounted panel.
          if (!mountedRef.current) return;
          if (quotaWarnedRef.current) quotaWarnedRef.current = false;
          setPersistWarning((prev) => (prev === null ? prev : null));
        },
        (err: unknown) => {
          if (!mountedRef.current) return;
          reportVfsWriteError(err);
        }
      );
    },
    [reportVfsWriteError]
  );

  // --- Editor edit ---------------------------------------------------------
  const handleScriptChange = useCallback(
    (next: string) => {
      setSource(next);
      const vfs = vfsRef.current;
      if (!vfs || selected === null) return;
      // Awaited-via-callback, NOT fire-and-forget: a QuotaExceededError (or any
      // write failure) is now observed and surfaced as a one-time warning
      // (task 1404) rather than being dropped by the microtask.
      observeVfsWrite(vfs.write(selected, next));
      // (a) DATA-LOSS FIX: fold the edit into `doc.asClasses` SYNCHRONOUSLY so
      // any compile/persist that reads the doc (Test Movie, Publish, Live
      // Preview recompile, autosave, Save) sees this exact edit immediately —
      // there is no debounce window in which it can be lost. Skip the push when
      // the source is byte-identical (`addAsClass` always allocates a new doc,
      // so we must compare here) to avoid a history entry per no-op keystroke.
      const path = normalizeClassPath(selected);
      const existing = (docRef.current.asClasses ?? []).find(
        (c) => normalizeClassPath(c.path) === path
      );
      if (!existing || existing.source !== next) {
        const nextDoc = addAsClass(docRef.current, { path, source: next });
        docRef.current = nextDoc;
        lastSyncedAsClassesRef.current = nextDoc.asClasses;
        pushDoc(nextDoc);
      }
      // Keep a light debounced FULL reconcile to coalesce history and catch
      // VFS-level changes (external/disk edits) that the synchronous single-file
      // update doesn't cover. This is flushed on unmount; it is NOT on the
      // data-loss critical path.
      pendingEditRef.current = true;
      if (editTimer.current) clearTimeout(editTimer.current);
      editTimer.current = setTimeout(() => {
        editTimer.current = null;
        pendingEditRef.current = false;
        void syncToDoc();
      }, EDIT_SYNC_DELAY_MS);
    },
    [selected, syncToDoc, pushDoc, observeVfsWrite]
  );

  // --- Add ----------------------------------------------------------------
  const beginCreate = useCallback(() => {
    setError(null);
    setNewName("");
    setRenaming(null);
    setCreating(true);
  }, []);

  const existingSet = useMemo(() => new Set(paths), [paths]);

  const commitCreate = useCallback(async () => {
    const vfs = vfsRef.current;
    if (!vfs) return;
    let path: string;
    try {
      path = classNameToPath(newName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const invalid = validateClassPath(path, existingSet);
    if (invalid) {
      setError(invalid);
      return;
    }
    vfsOpInFlightRef.current += 1;
    try {
      await vfs.write(path, defaultClassSource(path));
      await refresh();
      await syncToDoc();
    } catch (e) {
      // A write failure here (quota/I-O) means the new class was NOT persisted;
      // surface it as a one-time warning instead of an unhandled rejection
      // (task 1404) and keep the create input open.
      reportVfsWriteError(e);
      return;
    } finally {
      vfsOpInFlightRef.current -= 1;
    }
    setCreating(false);
    setNewName("");
    setError(null);
    setSelected(path);
  }, [newName, existingSet, refresh, syncToDoc, reportVfsWriteError]);

  // --- Remove -------------------------------------------------------------
  const handleRemove = useCallback(
    async (path: string) => {
      const vfs = vfsRef.current;
      if (!vfs) return;
      // eslint-disable-next-line no-alert
      const ok =
        typeof window === "undefined" ||
        window.confirm(`Delete class ${dottedNameFromPath(path)}?`);
      if (!ok) return;
      let next: readonly string[];
      vfsOpInFlightRef.current += 1;
      try {
        await vfs.remove(path);
        next = await refresh();
        await syncToDoc();
      } finally {
        vfsOpInFlightRef.current -= 1;
      }
      setSelected((prev) =>
        prev === path ? next[0] ?? null : prev
      );
    },
    [refresh, syncToDoc]
  );

  // --- Rename -------------------------------------------------------------
  const beginRename = useCallback((path: string) => {
    setError(null);
    setCreating(false);
    setRenaming(path);
    setRenameName(dottedNameFromPath(path));
  }, []);

  const commitRename = useCallback(async () => {
    const vfs = vfsRef.current;
    if (!vfs || renaming === null) return;
    let path: string;
    try {
      path = classNameToPath(renameName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const invalid = validateClassPath(path, existingSet, renaming);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (path !== normalizeClassPath(renaming)) {
      vfsOpInFlightRef.current += 1;
      try {
        const body = (await vfs.read(renaming)) ?? "";
        await vfs.write(path, body);
        await vfs.remove(renaming);
        await refresh();
        await syncToDoc();
      } catch (e) {
        // Rename write failed (quota/I-O): surface a one-time warning rather
        // than an unhandled rejection (task 1404) and keep the rename open.
        reportVfsWriteError(e);
        return;
      } finally {
        vfsOpInFlightRef.current -= 1;
      }
      setSelected((prev) => (prev === renaming ? path : prev));
    }
    setRenaming(null);
    setRenameName("");
    setError(null);
  }, [renaming, renameName, existingSet, refresh, syncToDoc, reportVfsWriteError]);

  // --- Tree ----------------------------------------------------------------
  const tree = useMemo(() => buildClassTree(paths), [paths]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // --- Styles --------------------------------------------------------------
  const containerStyle: React.CSSProperties = {
    ...chromeFont(),
    display: "flex",
    flexDirection: "row",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    background: chrome.panelBg,
  };

  const treePaneStyle: React.CSSProperties = {
    width: 240,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
    overflow: "hidden",
    background: chrome.panelBg,
  };

  const toolbarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 4px",
    borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
    background: chrome.insetFieldStrip,
    flexShrink: 0,
  };

  const toolBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: `${chrome.borderThin}px solid transparent`,
    borderRadius: 3,
    color: chrome.textDefault,
    cursor: "pointer",
    fontSize: 12,
    padding: "1px 6px",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
  };

  const treeListStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "2px 0",
    fontSize: 12,
    background: halo.panelContentBg,
  };

  const inputStyle: React.CSSProperties = {
    background: halo.inputBg,
    color: chrome.textDefault,
    border: `${chrome.borderThin}px solid ${halo.inputBorder}`,
    borderRadius: 3,
    padding: "1px 4px",
    fontSize: 12,
    outline: "none",
    flex: 1,
    minWidth: 0,
  };

  // --- Tree row rendering --------------------------------------------------
  const renderNode = (
    node: ClassTreeNode,
    depth: number
  ): React.ReactNode => {
    const indent = 6 + depth * 14;
    if (node.kind === "folder") {
      const isCollapsed = collapsed.has(node.path);
      return (
        <div key={`d:${node.path}`}>
          <div
            data-testid={`class-folder-${node.path}`}
            onClick={() => toggleFolder(node.path)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "1px 6px",
              paddingLeft: indent,
              cursor: "pointer",
              color: chrome.textDefault,
              userSelect: "none",
            }}
          >
            <span style={{ width: 10, display: "inline-block", color: chrome.textDisabled }}>
              {isCollapsed ? "▸" : "▾"}
            </span>
            <span aria-hidden>{"📁"}</span>
            <span>{node.name}</span>
          </div>
          {!isCollapsed &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    // File leaf
    if (renaming === node.path) {
      return (
        <div
          key={`f:${node.path}`}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 6px", paddingLeft: indent }}
        >
          <input
            data-testid="class-rename-input"
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              else if (e.key === "Escape") {
                setRenaming(null);
                setError(null);
              }
            }}
            onBlur={() => void commitRename()}
            style={inputStyle}
          />
        </div>
      );
    }
    const isSel = selected === node.path;
    return (
      <div
        key={`f:${node.path}`}
        data-testid={`class-file-${node.path}`}
        aria-selected={isSel}
        onClick={() => setSelected(node.path)}
        onDoubleClick={() => beginRename(node.path)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "1px 6px",
          paddingLeft: indent,
          cursor: "pointer",
          background: isSel ? halo.selectionColor : undefined,
          color: isSel ? "#fff" : chrome.textDefault,
          userSelect: "none",
        }}
      >
        <span aria-hidden>{"📄"}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        <button
          data-testid={`class-remove-${node.path}`}
          title="Delete class"
          onClick={(e) => {
            e.stopPropagation();
            void handleRemove(node.path);
          }}
          style={{
            ...toolBtnStyle,
            color: isSel ? "#fff" : chrome.textDisabled,
            padding: "0 4px",
          }}
        >
          {"✕"}
        </button>
      </div>
    );
  };

  const isEmpty = paths.length === 0 && !creating;

  return (
    <div style={containerStyle} data-testid="classes-panel">
      {/* LEFT: file tree */}
      <div style={treePaneStyle}>
        <div style={toolbarStyle}>
          <span style={{ flex: 1, color: chrome.textDefault, fontSize: 12, fontWeight: "bold" }}>
            Classes
          </span>
          <button
            data-testid="class-add"
            style={toolBtnStyle}
            title="New AS2 class"
            onClick={beginCreate}
          >
            {"＋ New"}
          </button>
        </div>

        <div style={treeListStyle} data-testid="class-tree">
          {creating && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 6px" }}>
              <input
                data-testid="class-new-input"
                autoFocus
                placeholder="com.example.Foo"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitCreate();
                  else if (e.key === "Escape") {
                    setCreating(false);
                    setError(null);
                  }
                }}
                style={inputStyle}
              />
            </div>
          )}

          {isEmpty ? (
            <div
              data-testid="classes-empty"
              style={{
                padding: "16px 12px",
                color: chrome.textDisabled,
                fontSize: 12,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              No AS2 classes yet.
              <br />
              Click <strong>{"＋ New"}</strong> to add an external class
              (e.g. <code>com.example.Main</code>).
            </div>
          ) : (
            (tree as ClassTreeFolder).children.map((child) => renderNode(child, 0))
          )}
        </div>

        {error && (
          <div
            data-testid="class-error"
            style={{
              flexShrink: 0,
              background: "#FDE8E8",
              borderTop: `${chrome.borderThin}px solid ${halo.error}`,
              padding: "3px 8px",
              fontSize: 12,
              color: "#C00000",
            }}
          >
            {error}
          </div>
        )}

        {persistWarning && (
          <div
            data-testid="class-persist-warning"
            role="alert"
            style={{
              flexShrink: 0,
              background: "#FFF6E0",
              borderTop: `${chrome.borderThin}px solid #E0A100`,
              padding: "3px 8px",
              fontSize: 12,
              color: "#7A5200",
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
            }}
          >
            <span style={{ flex: 1 }}>⚠ {persistWarning}</span>
            <button
              type="button"
              aria-label="Dismiss warning"
              onClick={() => setPersistWarning(null)}
              style={{
                flexShrink: 0,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#7A5200",
                fontSize: 12,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* RIGHT: reused ScriptEditor for the selected .as file */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>
        {selected !== null ? (
          <>
            <div
              style={{
                ...toolbarStyle,
                justifyContent: "space-between",
              }}
            >
              <span
                data-testid="class-editor-title"
                style={{ color: chrome.textDefault, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {dottedNameFromPath(selected)}
                <span style={{ color: chrome.textDisabled, marginLeft: 6 }}>
                  ({splitClassPath(selected).file})
                </span>
              </span>
              {onClose && (
                <button style={toolBtnStyle} onClick={onClose} title="Collapse panel">
                  {"✕"}
                </button>
              )}
            </div>
            <ScriptEditor
              key={selected}
              script={source}
              onScriptChange={handleScriptChange}
            />
          </>
        ) : (
          <div
            data-testid="classes-editor-empty"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: chrome.textDisabled,
              fontSize: 13,
              padding: 24,
              textAlign: "center",
            }}
          >
            Select a class on the left, or create one with{" "}
            <strong style={{ margin: "0 4px" }}>{"＋ New"}</strong> to edit
            its ActionScript.
          </div>
        )}
      </div>
    </div>
  );
}
