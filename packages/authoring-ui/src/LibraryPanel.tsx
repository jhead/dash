import React, { useState, useCallback, useRef, useMemo } from "react";
import type { FlashDocument, Library, LibraryItem, LibraryFolder, SymbolType } from "@flash/core";

export interface LibraryPanelProps {
  library: Library;
  doc?: FlashDocument;
  documentName: string;
  selectedItemId: string | null;
  onItemSelect: (id: string | null) => void;
  onCreateSymbol: (name: string, type: SymbolType) => void;
  onDeleteItem: (id: string) => void;
  onEditInPlace: (itemId: string) => void;
  onDragStart?: (itemId: string) => void;
  onRenameItem?: (id: string, newName: string) => void;
  onDuplicateItem?: (id: string) => void;
  onAddFolder?: (name: string) => void;
  onMoveItemToFolder?: (itemId: string, folderId: string | null) => void;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function itemTypeLabel(item: LibraryItem): string {
  if (item.itemType === "symbol") {
    switch (item.symbolType) {
      case "movieclip": return "Movie Clip";
      case "button":    return "Button";
      case "graphic":   return "Graphic";
    }
  }
  if (item.itemType === "bitmap")    return "Bitmap";
  if (item.itemType === "sound")     return "Sound";
  if (item.itemType === "video")     return "Video";
  if (item.itemType === "font")      return "Font";
  if (item.itemType === "component") return "Component";
  return "Unknown";
}

/** Short text label for the type badge column */
function itemTypeShort(item: LibraryItem): string {
  if (item.itemType === "symbol") {
    switch (item.symbolType) {
      case "movieclip": return "MC";
      case "button":    return "Btn";
      case "graphic":   return "Grfx";
    }
  }
  if (item.itemType === "bitmap") return "Img";
  if (item.itemType === "sound")  return "Snd";
  if (item.itemType === "video")  return "Vid";
  if (item.itemType === "font")   return "Font";
  return "?";
}

// Returns { text, color } for a colored badge next to the item name
function itemBadge(item: LibraryItem): { text: string; color: string } | null {
  if (item.itemType === "symbol") {
    switch (item.symbolType) {
      case "movieclip": return { text: "MC", color: "#4a9eff" };
      case "button":    return { text: "Btn", color: "#5cb85c" };
      case "graphic":   return { text: "Grfx", color: "#999999" };
    }
  }
  if (item.itemType === "bitmap") return { text: "Img", color: "#cc8800" };
  if (item.itemType === "sound")  return { text: "Snd", color: "#aa44cc" };
  if (item.itemType === "video")  return { text: "Vid", color: "#e05050" };
  if (item.itemType === "font")   return { text: "Font", color: "#888888" };
  return null;
}

/**
 * Returns a unicode icon character for each library item type.
 * For symbols, further differentiates by symbolType.
 */
export function getItemIcon(item: LibraryItem): string {
  if (item.itemType === "symbol") {
    switch (item.symbolType) {
      case "movieclip": return "▶"; // ▶ film/clip
      case "button":    return "⬡"; // ⬡ hexagon / button
      case "graphic":   return "◇"; // ◇ diamond / graphic
    }
  }
  if (item.itemType === "bitmap")    return "⊞"; // ⊞ squared plus / image grid
  if (item.itemType === "sound")     return "♪"; // ♪ musical note
  if (item.itemType === "video")     return "▣"; // ▣ square with inner square / video
  if (item.itemType === "font")      return "Aa";
  if (item.itemType === "component") return "⚙"; // ⚙ gear
  return "○"; // ○ fallback
}

/** Compute how many times a library item is used across all scene timelines. */
function computeUseCount(doc: FlashDocument, itemId: string): number {
  let count = 0;
  for (const scene of doc.scenes) {
    for (const layer of scene.timeline.layers) {
      for (const frame of layer.frames) {
        if (frame.isKeyframe) {
          count += frame.displayObjects.filter(
            (obj) => obj.type === "instance" && (obj as { symbolId?: string }).symbolId === itemId
          ).length;
        }
      }
    }
  }
  return count;
}

// ----------------------------------------------------------------------------
// New Symbol dialog (inline)
// ----------------------------------------------------------------------------

interface NewSymbolDialogProps {
  onConfirm: (name: string, type: SymbolType) => void;
  onCancel: () => void;
}

function NewSymbolDialog({ onConfirm, onCancel }: NewSymbolDialogProps): React.ReactElement {
  const [name, setName] = useState("Symbol 1");
  const [type, setType] = useState<SymbolType>("movieclip");

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, type);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") onCancel();
  };

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  };

  const dialogStyle: React.CSSProperties = {
    background: "#3a3a3a",
    border: "1px solid #555",
    padding: "12px",
    minWidth: "220px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#e0e0e0",
    marginBottom: "4px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#c0c0c0",
    width: "50px",
    flexShrink: 0,
  };

  const inputStyle: React.CSSProperties = {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #555",
    padding: "2px 4px",
    flex: 1,
  };

  const selectStyle: React.CSSProperties = {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #555",
    padding: "2px 4px",
    flex: 1,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
  };

  const btnStyle: React.CSSProperties = {
    fontSize: "11px",
    background: "#555",
    color: "#e0e0e0",
    border: "1px solid #666",
    padding: "3px 10px",
    cursor: "pointer",
  };

  const btnPrimaryStyle: React.CSSProperties = {
    ...btnStyle,
    background: "#1a6ea8",
    border: "1px solid #2288cc",
  };

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div style={titleStyle}>Create New Symbol</div>
        <div style={rowStyle}>
          <span style={labelStyle}>Name:</span>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Type:</span>
          <select
            style={selectStyle}
            value={type}
            onChange={(e) => setType(e.target.value as SymbolType)}
          >
            <option value="movieclip">Movie Clip</option>
            <option value="graphic">Graphic</option>
            <option value="button">Button</option>
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", gap: "6px", marginTop: "4px" }}>
          <button style={btnStyle} onClick={onCancel}>Cancel</button>
          <button style={btnPrimaryStyle} onClick={handleConfirm}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Context menu
// ----------------------------------------------------------------------------

interface ContextMenuProps {
  x: number;
  y: number;
  item: LibraryItem;
  useCount: number;
  folders: readonly LibraryFolder[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onEditInPlace: (id: string) => void;
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMoveToFolder: (itemId: string, folderId: string | null) => void;
}

function ContextMenu({
  x, y, item, useCount, folders,
  onClose, onDelete, onEditInPlace, onRename, onDuplicate, onMoveToFolder,
}: ContextMenuProps): React.ReactElement {
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    top: y,
    left: x,
    background: "#3a3a3a",
    border: "1px solid #555",
    zIndex: 200,
    minWidth: "160px",
  };

  const menuItemStyle: React.CSSProperties = {
    padding: "4px 12px",
    fontSize: "11px",
    color: "#c0c0c0",
    cursor: "pointer",
    userSelect: "none",
  };

  const menuItemHoverStyle: React.CSSProperties = {
    ...menuItemStyle,
    background: "#1a6ea8",
    color: "#fff",
  };

  const separatorStyle: React.CSSProperties = {
    borderTop: "1px solid #555",
    margin: "2px 0",
  };

  const subHeaderStyle: React.CSSProperties = {
    padding: "3px 12px",
    fontSize: "10px",
    color: "#777",
    userSelect: "none",
  };

  const [hovered, setHovered] = useState<string | null>(null);

  const MenuItemEl = ({ id, label, onClick }: { id: string; label: string; onClick: () => void }) => (
    <div
      style={hovered === id ? menuItemHoverStyle : menuItemStyle}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => { onClick(); onClose(); }}
    >
      {label}
    </div>
  );

  const canEdit = item.itemType === "symbol";

  const handleDelete = () => {
    if (useCount > 0) {
      const confirmed = window.confirm(
        `"${item.name}" is used ${useCount} time${useCount !== 1 ? "s" : ""} on the stage.\nDelete it anyway?`
      );
      if (!confirmed) return;
    }
    onDelete(item.id);
  };

  return (
    <>
      <div
        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 199 }}
        onClick={onClose}
      />
      <div style={menuStyle}>
        <MenuItemEl id="rename" label="Rename" onClick={() => onRename(item.id)} />
        <MenuItemEl id="duplicate" label="Duplicate" onClick={() => onDuplicate(item.id)} />
        <div style={separatorStyle} />
        {canEdit && (
          <MenuItemEl id="edit" label="Edit" onClick={() => onEditInPlace(item.id)} />
        )}
        {canEdit && (
          <MenuItemEl id="editInPlace" label="Edit in Place" onClick={() => onEditInPlace(item.id)} />
        )}
        {canEdit && <div style={separatorStyle} />}
        {/* Move to Folder submenu */}
        {folders.length > 0 && (
          <>
            <div style={subHeaderStyle}>Move to Folder</div>
            <MenuItemEl
              id="folder-none"
              label="(No Folder)"
              onClick={() => onMoveToFolder(item.id, null)}
            />
            {folders.map((f) => (
              <MenuItemEl
                key={f.id}
                id={`folder-${f.id}`}
                label={`  ${f.name}`}
                onClick={() => onMoveToFolder(item.id, f.id)}
              />
            ))}
            <div style={separatorStyle} />
          </>
        )}
        <div
          style={hovered === "delete" ? { ...menuItemHoverStyle, color: "#ff6666" } : { ...menuItemStyle, color: "#ff8888" }}
          onMouseEnter={() => setHovered("delete")}
          onMouseLeave={() => setHovered(null)}
          onClick={() => { handleDelete(); onClose(); }}
        >
          Delete{useCount > 0 ? ` (used ${useCount}x)` : ""}
        </div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------
// Sort helpers
// ----------------------------------------------------------------------------

type SortField = "name" | "type" | "useCount";
type SortDir = "asc" | "desc";

function sortItems(
  items: LibraryItem[],
  useCounts: Map<string, number>,
  field: SortField,
  dir: SortDir
): LibraryItem[] {
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (field === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (field === "type") {
      cmp = itemTypeLabel(a).localeCompare(itemTypeLabel(b));
    } else if (field === "useCount") {
      cmp = (useCounts.get(a.id) ?? 0) - (useCounts.get(b.id) ?? 0);
    }
    return dir === "asc" ? cmp : -cmp;
  });
  return sorted;
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export function LibraryPanel({
  library,
  doc,
  documentName,
  selectedItemId,
  onItemSelect,
  onCreateSymbol,
  onDeleteItem,
  onEditInPlace,
  onDragStart,
  onRenameItem,
  onDuplicateItem,
  onAddFolder,
  onMoveItemToFolder,
}: LibraryPanelProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [showNewSymbolDialog, setShowNewSymbolDialog] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: LibraryItem;
  } | null>(null);

  // Inline rename state: id of item being renamed, or null
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  // Search
  const [search, setSearch] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Folder expand/collapse
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Compute use counts (only when doc is provided)
  const useCounts = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!doc) return map;
    for (const item of library.items) {
      map.set(item.id, computeUseCount(doc, item.id));
    }
    return map;
  }, [doc, library.items]);

  // Filtered + sorted items
  const filteredItems = useMemo<LibraryItem[]>(() => {
    const q = search.trim().toLowerCase();
    const items = q
      ? library.items.filter((i) => i.name.toLowerCase().includes(q))
      : [...library.items];
    return sortItems(items, useCounts, sortField, sortDir);
  }, [library.items, search, sortField, sortDir, useCounts]);

  // Group items by folderId (null = top-level)
  const itemsByFolder = useMemo<Map<string | null, LibraryItem[]>>(() => {
    const map = new Map<string | null, LibraryItem[]>();
    map.set(null, []);
    for (const folder of library.folders) {
      map.set(folder.id, []);
    }
    for (const item of filteredItems) {
      const folderId = (item as LibraryItem & { folderId?: string | null }).folderId ?? null;
      const key = folderId && map.has(folderId) ? folderId : null;
      map.get(key)!.push(item);
    }
    return map;
  }, [filteredItems, library.folders]);

  const handleSortClick = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const handleRowClick = useCallback(
    (item: LibraryItem) => {
      // Don't trigger selection clicks while renaming
      if (renamingId) return;
      onItemSelect(item.id);

      // Double-click detection — starts inline rename
      const now = Date.now();
      if (
        lastClickRef.current &&
        lastClickRef.current.id === item.id &&
        now - lastClickRef.current.time < 400
      ) {
        // Double-click: start inline rename
        setRenamingId(item.id);
        setRenameValue(item.name);
        lastClickRef.current = null;
        // Focus the input after render
        setTimeout(() => {
          renameInputRef.current?.select();
        }, 0);
        return;
      }
      lastClickRef.current = { id: item.id, time: now };
    },
    [onItemSelect, renamingId]
  );

  const handleRenameCommit = useCallback(() => {
    if (renamingId && onRenameItem) {
      const trimmed = renameValue.trim();
      if (trimmed) {
        onRenameItem(renamingId, trimmed);
      }
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, onRenameItem]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleRenameCommit();
      } else if (e.key === "Escape") {
        setRenamingId(null);
        setRenameValue("");
      }
    },
    [handleRenameCommit]
  );

  const handleStartRename = useCallback((id: string) => {
    const item = library.items.find((i) => i.id === id);
    if (!item) return;
    setRenamingId(id);
    setRenameValue(item.name);
    onItemSelect(id);
    setTimeout(() => {
      renameInputRef.current?.select();
    }, 0);
  }, [library.items, onItemSelect]);

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, item: LibraryItem) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, item });
    },
    []
  );

  const handleRowDragStart = useCallback(
    (e: React.DragEvent, item: LibraryItem) => {
      e.dataTransfer.setData("application/flash-library-item", item.id);
      e.dataTransfer.effectAllowed = "copy";
      onDragStart?.(item.id);
    },
    [onDragStart]
  );

  const handleNewSymbol = useCallback(
    (name: string, type: SymbolType) => {
      onCreateSymbol(name, type);
      setShowNewSymbolDialog(false);
    },
    [onCreateSymbol]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedItemId) onDeleteItem(selectedItemId);
  }, [selectedItemId, onDeleteItem]);

  const handleAddFolder = useCallback(() => {
    const name = window.prompt("Folder name:", "New Folder");
    if (!name || !name.trim()) return;
    onAddFolder?.(name.trim());
  }, [onAddFolder]);

  const handleToggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleMoveToFolder = useCallback((itemId: string, folderId: string | null) => {
    onMoveItemToFolder?.(itemId, folderId);
  }, [onMoveItemToFolder]);

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    background: "#2d2d2d",
    position: "relative",
    overflow: "hidden",
  };

  const titleBarStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: "22px",
    background: "#3a3a3a",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 6px",
    flexShrink: 0,
    userSelect: "none",
    cursor: "pointer",
  };

  const titleLabelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#c0c0c0",
    fontWeight: "bold",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const toolbarStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "24px",
    background: "#333",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 4px",
    flexShrink: 0,
    gap: "2px",
  };

  const toolBtnStyle: React.CSSProperties = {
    fontSize: "12px",
    background: "transparent",
    color: "#c0c0c0",
    border: "1px solid transparent",
    padding: "0 4px",
    height: "18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  };

  const searchBarStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "22px",
    background: "#2a2a2a",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 4px",
    flexShrink: 0,
    gap: "2px",
  };

  const searchInputStyle: React.CSSProperties = {
    flex: 1,
    fontSize: "10px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    padding: "1px 4px",
    height: "16px",
    outline: "none",
  };

  const clearBtnStyle: React.CSSProperties = {
    fontSize: "11px",
    background: "transparent",
    color: "#888",
    border: "none",
    padding: "0 2px",
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
  };

  const colHeaderStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "18px",
    background: "#2a2a2a",
    borderBottom: "1px solid #1a1a1a",
    flexShrink: 0,
    userSelect: "none",
  };

  const colHeaderCellStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "#888",
    padding: "0 4px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  };

  const colHeaderCellActiveStyle: React.CSSProperties = {
    ...colHeaderCellStyle,
    color: "#bbb",
    fontWeight: "bold",
  };

  const itemListStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
  };

  const getRowStyle = (isSelected: boolean, isUnused: boolean): React.CSSProperties => ({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "20px",
    background: isSelected ? "#1a5f8a" : "transparent",
    cursor: "pointer",
    userSelect: "none",
    opacity: isUnused ? 0.55 : 1,
  });

  const rowNameStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#c0c0c0",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingLeft: "2px",
  };

  const rowTypeStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "#888",
    width: "38px",
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingRight: "2px",
    textAlign: "right",
  };

  const rowUsesStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "#666",
    width: "24px",
    flexShrink: 0,
    textAlign: "right",
    paddingRight: "4px",
  };

  const renameInputStyle: React.CSSProperties = {
    fontSize: "11px",
    background: "#1a3a5a",
    color: "#e0e0e0",
    border: "1px solid #4a9eff",
    padding: "0 2px",
    flex: 1,
    height: "16px",
    outline: "none",
  };

  const emptyStyle: React.CSSProperties = {
    padding: "8px 6px",
    fontSize: "11px",
    color: "#666",
    fontStyle: "italic",
    textAlign: "center",
  };

  const folderRowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "20px",
    background: "#353535",
    cursor: "pointer",
    userSelect: "none",
    borderBottom: "1px solid #2a2a2a",
  };

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ^" : " v";
  };

  // ---------------------------------------------------------------------------
  // Row renderer
  // ---------------------------------------------------------------------------

  const renderItemRow = (item: LibraryItem, indent: number) => {
    const badge = itemBadge(item);
    const icon = getItemIcon(item);
    const isRenaming = renamingId === item.id;
    const isSelected = item.id === selectedItemId;
    const useCount = useCounts.get(item.id) ?? 0;
    const isUnused = doc != null && useCount === 0 && item.itemType === "symbol";

    return (
      <div
        key={item.id}
        style={getRowStyle(isSelected, isUnused)}
        onClick={() => handleRowClick(item)}
        onContextMenu={(e) => handleRowContextMenu(e, item)}
        draggable={!isRenaming}
        onDragStart={(e) => handleRowDragStart(e, item)}
      >
        {/* Indent spacer */}
        {indent > 0 && <div style={{ width: indent, flexShrink: 0 }} />}

        {/* Type icon + badge */}
        <div style={{
          width: "28px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "2px",
        }}>
          {/* Unicode icon */}
          <span
            title={itemTypeLabel(item)}
            style={{
              fontSize: "11px",
              color: badge ? badge.color : "#888",
              lineHeight: 1,
              userSelect: "none",
            }}
          >
            {icon}
          </span>
        </div>

        {/* Name or rename input */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            style={renameInputStyle}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span style={rowNameStyle} title={item.name}>{item.name}</span>
        )}

        {/* Type label (dimmer color) */}
        {!isRenaming && (
          <span
            style={{ ...rowTypeStyle, color: badge ? badge.color : "#666" }}
            title={itemTypeLabel(item)}
          >
            {itemTypeShort(item)}
          </span>
        )}

        {/* Use count */}
        {!isRenaming && doc != null && (
          <span style={{ ...rowUsesStyle, color: useCount === 0 ? "#555" : "#999" }}>
            {useCount}
          </span>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Build the tree view (folders + items)
  // ---------------------------------------------------------------------------

  const renderTree = () => {
    const rows: React.ReactNode[] = [];

    // Top-level items (no folder)
    const topItems = itemsByFolder.get(null) ?? [];
    for (const item of topItems) {
      rows.push(renderItemRow(item, 0));
    }

    // Folders
    for (const folder of library.folders) {
      const isExpanded = expandedFolders.has(folder.id);
      const folderItems = itemsByFolder.get(folder.id) ?? [];

      rows.push(
        <div
          key={`folder-${folder.id}`}
          style={folderRowStyle}
          onClick={() => handleToggleFolder(folder.id)}
          title={folder.name}
        >
          <div style={{ width: "28px", flexShrink: 0, textAlign: "center", fontSize: "9px", color: "#aaa" }}>
            {isExpanded ? "v" : ">"}
          </div>
          <span style={{ fontSize: "11px", color: "#d4a017", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {folder.name}
          </span>
          <span style={{ fontSize: "10px", color: "#666", paddingRight: "4px" }}>
            {folderItems.length}
          </span>
        </div>
      );

      if (isExpanded) {
        for (const item of folderItems) {
          rows.push(renderItemRow(item, 16));
        }
      }
    }

    return rows;
  };

  const totalItems = filteredItems.length;

  return (
    <div style={panelStyle}>
      {/* Title bar */}
      <div style={titleBarStyle} onClick={() => setCollapsed((c) => !c)}>
        <span style={titleLabelStyle}>Library - {documentName}</span>
        <span style={{ fontSize: "10px", color: "#888" }}>{collapsed ? ">" : "v"}</span>
      </div>

      {!collapsed && (
        <>
          {/* Toolbar */}
          <div style={toolbarStyle}>
            <button
              style={toolBtnStyle}
              title="New Symbol"
              onClick={() => setShowNewSymbolDialog(true)}
            >
              +
            </button>
            <button
              style={{
                ...toolBtnStyle,
                color: selectedItemId ? "#e05050" : "#555",
                cursor: selectedItemId ? "pointer" : "default",
              }}
              title="Delete Item"
              onClick={handleDeleteSelected}
              disabled={!selectedItemId}
            >
              X
            </button>
            {onAddFolder && (
              <button
                style={{ ...toolBtnStyle, fontSize: "10px", color: "#d4a017" }}
                title="New Folder"
                onClick={handleAddFolder}
              >
                +Folder
              </button>
            )}
          </div>

          {/* Search bar */}
          <div style={searchBarStyle}>
            <input
              style={searchInputStyle}
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button style={clearBtnStyle} onClick={() => setSearch("")} title="Clear search">
                x
              </button>
            )}
          </div>

          {/* Column headers */}
          <div style={colHeaderStyle}>
            <div style={{ width: "28px", flexShrink: 0 }} />
            <div
              style={sortField === "name" ? colHeaderCellActiveStyle : colHeaderCellStyle}
              onClick={() => handleSortClick("name")}
              title="Sort by name"
            >
              {"Name" + sortArrow("name")}
            </div>
            <div
              style={{ ...(sortField === "type" ? colHeaderCellActiveStyle : colHeaderCellStyle), width: "38px", flexShrink: 0, textAlign: "right" }}
              onClick={() => handleSortClick("type")}
              title="Sort by type"
            >
              {"Type" + sortArrow("type")}
            </div>
            {doc != null && (
              <div
                style={{ ...(sortField === "useCount" ? colHeaderCellActiveStyle : colHeaderCellStyle), width: "24px", flexShrink: 0, textAlign: "right", paddingRight: "4px" }}
                onClick={() => handleSortClick("useCount")}
                title="Sort by use count"
              >
                {"#" + sortArrow("useCount")}
              </div>
            )}
          </div>

          {/* Item list */}
          <div style={itemListStyle}>
            {totalItems === 0 && library.folders.length === 0 ? (
              <div style={emptyStyle}>
                {search ? "No matches" : "Library is empty"}
              </div>
            ) : (
              renderTree()
            )}
          </div>
        </>
      )}

      {/* New Symbol dialog */}
      {showNewSymbolDialog && (
        <NewSymbolDialog
          onConfirm={handleNewSymbol}
          onCancel={() => setShowNewSymbolDialog(false)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          useCount={useCounts.get(contextMenu.item.id) ?? 0}
          folders={library.folders}
          onClose={() => setContextMenu(null)}
          onDelete={onDeleteItem}
          onEditInPlace={onEditInPlace}
          onRename={handleStartRename}
          onDuplicate={(id) => onDuplicateItem?.(id)}
          onMoveToFolder={handleMoveToFolder}
        />
      )}
    </div>
  );
}
