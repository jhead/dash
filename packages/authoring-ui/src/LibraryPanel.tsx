import React, { useState, useCallback, useRef, useMemo } from "react";
import type { BitmapItem, FlashDocument, Library, LibraryItem, LibraryFolder, Symbol, SymbolLinkage, SymbolType } from "@flash/core";
import { LibraryPreview } from "./LibraryPreview";
import { SymbolLinkageDialog } from "./SymbolLinkageDialog";
import { SymbolPropertiesDialog } from "./SymbolPropertiesDialog";
import type { SymbolPropertiesData } from "./SymbolPropertiesDialog";
import { chrome, halo, chromeFont, titleBarStyle as themeTitleBar } from "./theme/flash8Theme.js";

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
  onSetLinkage?: (id: string, linkage: SymbolLinkage) => void;
  onSetSymbolProperties?: (id: string, data: SymbolPropertiesData) => void;
  /** Called when a BitmapItem row is double-clicked (opens Bitmap Properties). */
  onBitmapDoubleClick?: (item: BitmapItem) => void;
  /** Called when a folder's collapsed state changes — used to persist to the model. */
  onUpdateFolder?: (folderId: string, collapsed: boolean) => void;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Fully-qualified AS2 class names available in the document, for the Symbol
 * Linkage dialog's "AS2 Class" autocomplete. Derived from `doc.asClasses`: each
 * `.as` file maps to a dotted class name from its classpath-relative path
 * (`com/example/Foo.as` → `com.example.Foo`). Returns a sorted, de-duplicated list.
 */
export function deriveAsClassNames(doc: FlashDocument | undefined): string[] {
  const classes = doc?.asClasses;
  if (!classes || classes.length === 0) return [];
  const names = new Set<string>();
  for (const file of classes) {
    const path = file.path;
    if (!path.endsWith(".as")) continue;
    const dotted = path
      .slice(0, -".as".length)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\//g, ".");
    if (dotted.length > 0) names.add(dotted);
  }
  return Array.from(names).sort();
}

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

// Returns { text, color } for a colored type icon next to the item name. Colors are
// dark enough to read on the white item list (Flash 8 Halo light surface).
function itemBadge(item: LibraryItem): { text: string; color: string } | null {
  if (item.itemType === "symbol") {
    switch (item.symbolType) {
      case "movieclip": return { text: "MC", color: "#0066B3" };
      case "button":    return { text: "Btn", color: "#2E7D32" };
      case "graphic":   return { text: "Grfx", color: halo.iconColor };
    }
  }
  if (item.itemType === "bitmap") return { text: "Img", color: "#A66A00" };
  if (item.itemType === "sound")  return { text: "Snd", color: "#7B2FA3" };
  if (item.itemType === "video")  return { text: "Vid", color: "#B33636" };
  if (item.itemType === "font")   return { text: "Font", color: halo.iconColor };
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
    background: chrome.panelBg,
    border: `${chrome.borderThin}px solid ${chrome.separator}`,
    borderTop: `${chrome.borderThin}px solid ${chrome.bevelLight}`,
    borderLeft: `${chrome.borderThin}px solid ${chrome.bevelLight}`,
    padding: "12px",
    minWidth: "220px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    ...chromeFont(),
  };

  const titleStyle: React.CSSProperties = {
    ...chromeFont(),
    fontWeight: "bold",
    color: chrome.textDefault,
    marginBottom: "4px",
  };

  const labelStyle: React.CSSProperties = {
    ...chromeFont(),
    color: chrome.textDefault,
    width: "50px",
    flexShrink: 0,
  };

  const inputStyle: React.CSSProperties = {
    ...chromeFont(),
    background: halo.inputBg,
    color: halo.text,
    borderStyle: "solid",
    borderWidth: 1,
    borderTopColor: halo.inputBorderDark,
    borderLeftColor: halo.inputBorderDark,
    borderRightColor: halo.inputBorderLight,
    borderBottomColor: halo.inputBorderLight,
    padding: "2px 4px",
    flex: 1,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
  };

  const btnStyle: React.CSSProperties = {
    ...chromeFont(),
    background: `linear-gradient(${chrome.bevelLight}, ${chrome.insetFieldStrip})`,
    color: chrome.textDefault,
    borderStyle: "solid",
    borderWidth: 1,
    borderTopColor: chrome.bevelLight,
    borderLeftColor: chrome.bevelLight,
    borderRightColor: chrome.bevelDark,
    borderBottomColor: chrome.bevelDark,
    borderRadius: halo.cornerRadius,
    padding: "3px 10px",
    cursor: "pointer",
  };

  const btnPrimaryStyle: React.CSSProperties = {
    ...btnStyle,
    borderColor: halo.haloBlue,
    background: `linear-gradient(${chrome.bevelLight}, ${halo.rollOverColor})`,
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
  onLinkage?: (id: string) => void;
  onSymbolProperties?: (id: string) => void;
}

function ContextMenu({
  x, y, item, useCount, folders,
  onClose, onDelete, onEditInPlace, onRename, onDuplicate, onMoveToFolder, onLinkage, onSymbolProperties,
}: ContextMenuProps): React.ReactElement {
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    top: y,
    left: x,
    background: halo.panelContentBg,
    border: `${chrome.borderThin}px solid ${chrome.separator}`,
    zIndex: 200,
    minWidth: "160px",
    ...chromeFont(),
  };

  const menuItemStyle: React.CSSProperties = {
    padding: "4px 12px",
    ...chromeFont(),
    color: chrome.textDefault,
    cursor: "pointer",
    userSelect: "none",
  };

  const menuItemHoverStyle: React.CSSProperties = {
    ...menuItemStyle,
    background: halo.selectionColor,
    color: halo.textSelected,
  };

  const separatorStyle: React.CSSProperties = {
    borderTop: `1px solid ${halo.separator}`,
    margin: "2px 0",
  };

  const subHeaderStyle: React.CSSProperties = {
    padding: "3px 12px",
    ...chromeFont(),
    color: chrome.textDisabled,
    userSelect: "none",
  };

  const [hovered, setHovered] = useState<string | null>(null);

  const MenuItemEl = ({ id, label, onClick }: { id: string; label: string; onClick: () => void }) => (
    <div
      data-testid={`library-menu-${id}`}
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
        {canEdit && onLinkage && (
          <MenuItemEl id="linkage" label="Linkage..." onClick={() => onLinkage(item.id)} />
        )}
        {canEdit && onSymbolProperties && (
          <MenuItemEl id="symbolProperties" label="Symbol Properties..." onClick={() => onSymbolProperties(item.id)} />
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
          style={hovered === "delete" ? { ...menuItemHoverStyle, color: halo.error } : { ...menuItemStyle, color: halo.error }}
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
  onSetLinkage,
  onSetSymbolProperties,
  onBitmapDoubleClick,
  onUpdateFolder,
}: LibraryPanelProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [showNewSymbolDialog, setShowNewSymbolDialog] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: LibraryItem;
  } | null>(null);

  // Linkage dialog state
  const [linkageDialog, setLinkageDialog] = useState<{
    item: Symbol;
  } | null>(null);

  // AS2 class names for the linkage dialog's "AS2 Class" autocomplete.
  const asClassNames = useMemo(() => deriveAsClassNames(doc), [doc]);

  // Symbol Properties dialog state
  const [symbolPropertiesDialog, setSymbolPropertiesDialog] = useState<{
    item: Symbol;
  } | null>(null);

  // Inline rename state: id of item being renamed, or null
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  // Hovered row (for Halo roll-over highlight)
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Search
  const [search, setSearch] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Folder expand/collapse — seeded from model: collapsed !== true means expanded
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(library.folders.filter((f) => f.collapsed !== true).map((f) => f.id))
  );

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

      // Double-click detection
      const now = Date.now();
      if (
        lastClickRef.current &&
        lastClickRef.current.id === item.id &&
        now - lastClickRef.current.time < 400
      ) {
        lastClickRef.current = null;
        // Bitmap double-click → open Bitmap Properties dialog
        if (item.itemType === "bitmap" && onBitmapDoubleClick) {
          onBitmapDoubleClick(item as BitmapItem);
          return;
        }
        // All other items: start inline rename
        setRenamingId(item.id);
        setRenameValue(item.name);
        // Focus the input after render
        setTimeout(() => {
          renameInputRef.current?.select();
        }, 0);
        return;
      }
      lastClickRef.current = { id: item.id, time: now };
    },
    [onItemSelect, renamingId, onBitmapDoubleClick]
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
        onUpdateFolder?.(folderId, true);
      } else {
        next.add(folderId);
        onUpdateFolder?.(folderId, false);
      }
      return next;
    });
  }, [onUpdateFolder]);

  const handleMoveToFolder = useCallback((itemId: string, folderId: string | null) => {
    onMoveItemToFolder?.(itemId, folderId);
  }, [onMoveItemToFolder]);

  const handleOpenLinkage = useCallback((id: string) => {
    const item = library.items.find((i) => i.id === id);
    if (!item || item.itemType !== "symbol") return;
    setLinkageDialog({ item: item as Symbol });
  }, [library.items]);

  const handleLinkageConfirm = useCallback((linkage: SymbolLinkage) => {
    if (!linkageDialog) return;
    onSetLinkage?.(linkageDialog.item.id, linkage);
    setLinkageDialog(null);
  }, [linkageDialog, onSetLinkage]);

  const handleOpenSymbolProperties = useCallback((id: string) => {
    const item = library.items.find((i) => i.id === id);
    if (!item || item.itemType !== "symbol") return;
    setSymbolPropertiesDialog({ item: item as Symbol });
  }, [library.items]);

  const handleSymbolPropertiesConfirm = useCallback((data: SymbolPropertiesData) => {
    if (!symbolPropertiesDialog) return;
    onSetSymbolProperties?.(symbolPropertiesDialog.item.id, data);
    setSymbolPropertiesDialog(null);
  }, [symbolPropertiesDialog, onSetSymbolProperties]);

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const panelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    background: chrome.panelBg,
    position: "relative",
    overflow: "hidden",
    ...chromeFont(),
  };

  // Panel title bar: the shared Halo header gradient + gripper-dot idiom, plus the
  // collapse caret laid out at the right (themeTitleBar handles font/border/gradient).
  const titleBarStyle: React.CSSProperties = {
    ...themeTitleBar(),
    justifyContent: "space-between",
    cursor: "pointer",
  };

  const titleLabelStyle: React.CSSProperties = {
    ...chromeFont(),
    color: chrome.textDefault,
    fontWeight: "bold",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  // Bottom toolbar (New Symbol / New Folder / Properties / Delete): recessed inset strip.
  const toolbarStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "24px",
    background: chrome.insetFieldStrip,
    borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
    padding: "0 4px",
    flexShrink: 0,
    gap: "2px",
  };

  const toolBtnStyle: React.CSSProperties = {
    ...chromeFont(),
    fontSize: "12px",
    background: "transparent",
    color: chrome.textDefault,
    border: "1px solid transparent",
    padding: "0 4px",
    height: "18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  };

  // Preview pane / search strip sits above the white item list, on the light chrome.
  const searchBarStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "22px",
    background: chrome.panelBg,
    borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
    padding: "0 4px",
    flexShrink: 0,
    gap: "2px",
  };

  const searchInputStyle: React.CSSProperties = {
    flex: 1,
    ...chromeFont(),
    fontSize: "10px",
    background: halo.inputBg,
    color: halo.text,
    borderStyle: "solid",
    borderWidth: 1,
    borderTopColor: halo.inputBorderDark,
    borderLeftColor: halo.inputBorderDark,
    borderRightColor: halo.inputBorderLight,
    borderBottomColor: halo.inputBorderLight,
    padding: "1px 4px",
    height: "16px",
    outline: "none",
  };

  const clearBtnStyle: React.CSSProperties = {
    ...chromeFont(),
    background: "transparent",
    color: chrome.textDisabled,
    border: "none",
    padding: "0 2px",
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
  };

  // Column header row (Name / Type / Use Count): light header gradient, divider below.
  const colHeaderStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "18px",
    background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
    borderBottom: `${chrome.borderThin}px solid ${halo.headerDivider}`,
    flexShrink: 0,
    userSelect: "none",
  };

  const colHeaderCellStyle: React.CSSProperties = {
    ...chromeFont(),
    fontSize: "10px",
    color: chrome.textDefault,
    padding: "0 4px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
    borderRight: `${chrome.borderThin}px solid ${halo.separator}`,
  };

  const colHeaderCellActiveStyle: React.CSSProperties = {
    ...colHeaderCellStyle,
    color: chrome.textDefault,
    fontWeight: "bold",
  };

  // White item list (Halo data grid content surface).
  const itemListStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    background: halo.panelContentBg,
  };

  const getRowStyle = (
    isSelected: boolean,
    isUnused: boolean,
    isHovered: boolean
  ): React.CSSProperties => ({
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "20px",
    background: isSelected
      ? halo.selectionColor
      : isHovered
        ? halo.rollOverColor
        : "transparent",
    cursor: "pointer",
    userSelect: "none",
    opacity: isUnused ? 0.55 : 1,
  });

  const rowNameStyle: React.CSSProperties = {
    ...chromeFont(),
    color: chrome.textDefault,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingLeft: "2px",
  };

  const rowTypeStyle: React.CSSProperties = {
    ...chromeFont(),
    fontSize: "10px",
    color: chrome.textDefault,
    width: "38px",
    flexShrink: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    paddingRight: "2px",
    textAlign: "right",
  };

  const rowUsesStyle: React.CSSProperties = {
    ...chromeFont(),
    fontSize: "10px",
    color: chrome.textDisabled,
    width: "24px",
    flexShrink: 0,
    textAlign: "right",
    paddingRight: "4px",
  };

  const renameInputStyle: React.CSSProperties = {
    ...chromeFont(),
    background: halo.inputBg,
    color: halo.text,
    border: `1px solid ${halo.haloBlue}`,
    padding: "0 2px",
    flex: 1,
    height: "16px",
    outline: "none",
  };

  const emptyStyle: React.CSSProperties = {
    padding: "8px 6px",
    ...chromeFont(),
    color: chrome.textDisabled,
    fontStyle: "italic",
    textAlign: "center",
  };

  const folderRowStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "20px",
    background: halo.alternatingRows[0],
    cursor: "pointer",
    userSelect: "none",
    borderBottom: `${chrome.borderThin}px solid ${halo.separator}`,
  };

  // Sort triangle (▲ asc / ▼ desc) next to the active column header.
  const sortArrow = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  };

  // ---------------------------------------------------------------------------
  // Row renderer
  // ---------------------------------------------------------------------------

  const renderItemRow = (item: LibraryItem, indent: number) => {
    const badge = itemBadge(item);
    const icon = getItemIcon(item);
    const isRenaming = renamingId === item.id;
    const isSelected = item.id === selectedItemId;
    const isHovered = hoveredId === item.id && !isSelected;
    const useCount = useCounts.get(item.id) ?? 0;
    const isUnused = doc != null && useCount === 0 && item.itemType === "symbol";
    // Linkage column: show the AS2 export identifier when the symbol is exported.
    const linkageId =
      item.itemType === "symbol" && item.linkage?.exportForActionScript
        ? item.linkage.linkageIdentifier || ""
        : "";
    // Date Modified column: model carries no timestamp yet (spec column placeholder).
    const dateModified = "";

    return (
      <div
        key={item.id}
        data-testid={`library-item-${item.name}`}
        style={getRowStyle(isSelected, isUnused, isHovered)}
        onClick={() => handleRowClick(item)}
        onContextMenu={(e) => handleRowContextMenu(e, item)}
        onMouseEnter={() => setHoveredId(item.id)}
        onMouseLeave={() => setHoveredId((h) => (h === item.id ? null : h))}
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
          {/* Unicode type icon — 16px per Flash 8 Library spec */}
          <span
            title={itemTypeLabel(item)}
            style={{
              fontSize: "16px",
              color: badge ? badge.color : halo.iconColor,
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

        {/* Type label */}
        {!isRenaming && (
          <span
            style={{ ...rowTypeStyle, width: "48px", color: badge ? badge.color : chrome.textDefault }}
            title={itemTypeLabel(item)}
          >
            {itemTypeShort(item)}
          </span>
        )}

        {/* Use count */}
        {!isRenaming && doc != null && (
          <span style={{ ...rowUsesStyle, width: "60px", color: useCount === 0 ? chrome.textDisabled : chrome.textDefault }}>
            {useCount}
          </span>
        )}

        {/* Linkage */}
        {!isRenaming && (
          <span style={{ ...rowTypeStyle, width: "56px", textAlign: "left", paddingLeft: "4px", color: chrome.textDefault }}>
            {linkageId}
          </span>
        )}

        {/* Date Modified */}
        {!isRenaming && (
          <span style={{ ...rowTypeStyle, width: "90px", textAlign: "left", paddingLeft: "4px", color: chrome.textDisabled }}>
            {dateModified}
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
          <div style={{ width: "28px", flexShrink: 0, textAlign: "center", fontSize: "9px", color: chrome.textDefault }}>
            {isExpanded ? "▼" : "▶"}
          </div>
          <span style={{ ...chromeFont(), color: chrome.textDefault, fontWeight: "bold", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {folder.name}
          </span>
          <span style={{ ...chromeFont(), fontSize: "10px", color: chrome.textDisabled, paddingRight: "4px" }}>
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
        <span style={{ ...chromeFont(), fontSize: "10px", color: chrome.textDefault }}>{collapsed ? "▶" : "▼"}</span>
      </div>

      {!collapsed && (
        <>
          {/* Item-preview pane (Flash 8): shows the selected item above the list. */}
          <LibraryPreview
            library={library}
            selectedItemId={selectedItemId}
            fps={doc?.properties.frameRate}
          />

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

          {/* Column headers: Name / Type / Use Count / Linkage / Date Modified */}
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
              style={{ ...(sortField === "type" ? colHeaderCellActiveStyle : colHeaderCellStyle), width: "48px", flexShrink: 0, textAlign: "right" }}
              onClick={() => handleSortClick("type")}
              title="Sort by type"
            >
              {"Type" + sortArrow("type")}
            </div>
            {doc != null && (
              <div
                style={{ ...(sortField === "useCount" ? colHeaderCellActiveStyle : colHeaderCellStyle), width: "60px", flexShrink: 0, textAlign: "right", paddingRight: "4px" }}
                onClick={() => handleSortClick("useCount")}
                title="Sort by use count"
              >
                {"Use Count" + sortArrow("useCount")}
              </div>
            )}
            <div style={{ ...colHeaderCellStyle, cursor: "default", width: "56px", flexShrink: 0 }} title="Linkage">
              Linkage
            </div>
            <div style={{ ...colHeaderCellStyle, cursor: "default", width: "90px", flexShrink: 0, borderRight: "none" }} title="Date Modified">
              Date Modified
            </div>
          </div>

          {/* Item list (white Halo data-grid surface) */}
          <div style={itemListStyle}>
            {totalItems === 0 && library.folders.length === 0 ? (
              <div style={emptyStyle}>
                {search ? "No matches" : "Library is empty"}
              </div>
            ) : (
              renderTree()
            )}
          </div>

          {/* Bottom toolbar: New Symbol / New Folder / Properties / Delete */}
          <div style={toolbarStyle}>
            <button
              style={toolBtnStyle}
              title="New Symbol"
              onClick={() => setShowNewSymbolDialog(true)}
            >
              +
            </button>
            {onAddFolder && (
              <button
                style={{ ...toolBtnStyle, fontSize: "10px" }}
                title="New Folder"
                onClick={handleAddFolder}
              >
                +Folder
              </button>
            )}
            {onSetSymbolProperties && (
              <button
                style={{
                  ...toolBtnStyle,
                  fontSize: "10px",
                  color: selectedItemId ? chrome.textDefault : chrome.textDisabled,
                  cursor: selectedItemId ? "pointer" : "default",
                }}
                title="Properties"
                onClick={() => selectedItemId && handleOpenSymbolProperties(selectedItemId)}
                disabled={!selectedItemId}
              >
                Properties
              </button>
            )}
            <button
              style={{
                ...toolBtnStyle,
                color: selectedItemId ? halo.error : chrome.textDisabled,
                cursor: selectedItemId ? "pointer" : "default",
              }}
              title="Delete Item"
              onClick={handleDeleteSelected}
              disabled={!selectedItemId}
            >
              X
            </button>
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
          onLinkage={onSetLinkage ? handleOpenLinkage : undefined}
          onSymbolProperties={onSetSymbolProperties ? handleOpenSymbolProperties : undefined}
        />
      )}

      {/* Symbol Linkage dialog */}
      {linkageDialog && (
        <SymbolLinkageDialog
          open={true}
          symbolName={linkageDialog.item.name}
          linkage={linkageDialog.item.linkage}
          classNames={asClassNames}
          onConfirm={handleLinkageConfirm}
          onClose={() => setLinkageDialog(null)}
        />
      )}

      {/* Symbol Properties dialog */}
      {symbolPropertiesDialog && (
        <SymbolPropertiesDialog
          open={true}
          data={{
            name: symbolPropertiesDialog.item.name,
            symbolType: symbolPropertiesDialog.item.symbolType,
            linkage: symbolPropertiesDialog.item.linkage,
            scale9Grid: symbolPropertiesDialog.item.scale9Grid,
          }}
          onConfirm={handleSymbolPropertiesConfirm}
          onClose={() => setSymbolPropertiesDialog(null)}
        />
      )}
    </div>
  );
}
