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
} from "@flash/core";
import { ScriptEditor } from "./ActionsPanel";
import { createClassVfs } from "./vfs/factory.js";
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
//   edit  : vfs.write(path, source)  -> syncDocFromVfs    -> pushDoc (debounced)
//   add   : vfs.write(newPath, stub) -> syncDocFromVfs    -> pushDoc
//   remove: vfs.remove(path)         -> syncDocFromVfs    -> pushDoc
//   rename: vfs.write(new) + remove(old) -> syncDocFromVfs -> pushDoc
//
// `doc.asClasses` (the `.fla` embed) stays authoritative; the VFS is just the
// editing surface and is reconciled back via the P0 mutations on every change.
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

  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Reconcile VFS -> doc -> history.
  const syncToDoc = useCallback(async (): Promise<void> => {
    const vfs = vfsRef.current;
    if (!vfs) return;
    const { doc: nextDoc } = await syncDocFromVfs(docRef.current, vfs);
    // syncDocFromVfs returns the SAME reference when nothing changed, so this
    // never churns history needlessly.
    if (nextDoc !== docRef.current) {
      docRef.current = nextDoc;
      pushDoc(nextDoc);
    }
  }, [pushDoc]);

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
    // Re-run only on path change; doc edits flow through hydrate-on-mount + the
    // editor write path, not a full re-hydrate (which would clobber edits).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flaPath]);

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

  // Flush any pending debounced edit on unmount.
  useEffect(() => {
    return () => {
      if (editTimer.current) clearTimeout(editTimer.current);
    };
  }, []);

  // --- Editor edit ---------------------------------------------------------
  const handleScriptChange = useCallback(
    (next: string) => {
      setSource(next);
      const vfs = vfsRef.current;
      if (!vfs || selected === null) return;
      void vfs.write(selected, next);
      if (editTimer.current) clearTimeout(editTimer.current);
      editTimer.current = setTimeout(() => {
        void syncToDoc();
      }, EDIT_SYNC_DELAY_MS);
    },
    [selected, syncToDoc]
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
    await vfs.write(path, defaultClassSource(path));
    await refresh();
    await syncToDoc();
    setCreating(false);
    setNewName("");
    setError(null);
    setSelected(path);
  }, [newName, existingSet, refresh, syncToDoc]);

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
      await vfs.remove(path);
      const next = await refresh();
      await syncToDoc();
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
      const body = (await vfs.read(renaming)) ?? "";
      await vfs.write(path, body);
      await vfs.remove(renaming);
      await refresh();
      await syncToDoc();
      setSelected((prev) => (prev === renaming ? path : prev));
    }
    setRenaming(null);
    setRenameName("");
    setError(null);
  }, [renaming, renameName, existingSet, refresh, syncToDoc]);

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
