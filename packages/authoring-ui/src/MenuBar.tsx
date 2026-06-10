import React, { useState, useCallback, useRef, useEffect } from "react";
import { useFileActions } from "./hooks/useFileActions";
import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MenuItem {
  label: string;
  /** Called when the item is activated. */
  action: () => void;
  /** Show a horizontal separator above this item. */
  separator?: boolean;
}

interface MenuDefinition {
  name: string;
  items?: MenuItem[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  menuBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "22px",
    background: "#3c3c3c",
    borderBottom: "1px solid #1a1a1a",
    flexShrink: 0,
    userSelect: "none",
    position: "relative",
    zIndex: 1000,
  },
  menuItem: {
    padding: "0 8px",
    height: "100%",
    display: "flex",
    alignItems: "center",
    fontSize: "12px",
    color: "#e0e0e0",
    cursor: "default",
    whiteSpace: "nowrap",
    position: "relative",
  },
  menuItemActive: {
    background: "#555555",
  },
  dropdown: {
    position: "absolute",
    top: "22px",
    left: 0,
    minWidth: "160px",
    background: "#3c3c3c",
    border: "1px solid #1a1a1a",
    boxShadow: "2px 2px 6px rgba(0,0,0,0.5)",
    zIndex: 1001,
  },
  dropdownItem: {
    padding: "4px 16px",
    fontSize: "12px",
    color: "#e0e0e0",
    cursor: "default",
    whiteSpace: "nowrap",
  },
  dropdownItemHover: {
    background: "#0078d7",
    color: "#ffffff",
  },
  separator: {
    height: "1px",
    background: "#555555",
    margin: "2px 0",
  },
};

// ---------------------------------------------------------------------------
// DropdownItem
// ---------------------------------------------------------------------------

interface DropdownItemProps {
  item: MenuItem;
  onActivate: () => void;
}

function DropdownItem({ item, onActivate }: DropdownItemProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);

  return (
    <>
      {item.separator && <div style={styles.separator} />}
      <div
        style={{
          ...styles.dropdownItem,
          ...(hovered ? styles.dropdownItemHover : {}),
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onActivate}
      >
        {item.label}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// MenuBarItem (top-level label + optional dropdown)
// ---------------------------------------------------------------------------

interface MenuBarItemProps {
  menu: MenuDefinition;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function MenuBarItem({
  menu,
  isOpen,
  onOpen,
  onClose,
}: MenuBarItemProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div
      ref={ref}
      style={{ ...styles.menuItem, ...(isOpen ? styles.menuItemActive : {}) }}
      onMouseDown={isOpen ? onClose : onOpen}
    >
      {menu.name}
      {isOpen && menu.items && menu.items.length > 0 && (
        <div
          style={styles.dropdown}
          // Without this, mousedown on an item bubbles to the parent toggle,
          // which unmounts the dropdown before mouseup — so the item's click
          // (and its action) never fires.
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.items.map((item, i) => (
            <DropdownItem
              key={i}
              item={item}
              onActivate={() => {
                onClose();
                item.action();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuBar props & component
// ---------------------------------------------------------------------------

export interface MenuBarProps {
  /** Current open document, used by save actions. */
  document?: FlashDocument;
  /** Current file path (if known) for save-without-dialog. */
  filePath?: string;
  /** Called after New, Open actions return a new document. */
  onDocumentChange?: (doc: FlashDocument, path?: string) => void;
  /** Called after a save action resolves the file path. */
  onFilePathChange?: (path: string) => void;
  /** Called when Control > Test Movie is activated (Ctrl/Cmd+Enter). */
  onTestMovie?: () => void;
  /** Called when Control > Publish is activated. */
  onPublish?: () => void;
  /** Called when File > Publish Settings is activated. */
  onPublishSettings?: () => void;
  /** Called when Window > Color is toggled (Shift+F9). */
  onColorPanelToggle?: () => void;
  /** Called when Window > Actions (F9) is activated. */
  onActionsToggle?: () => void;
  /** Called when Window > Filters is toggled. */
  onFiltersPanelToggle?: () => void;
  /** Called when Modify > Document (Ctrl+J) is activated. */
  onDocPropsOpen?: () => void;
  /** Called when View > Rulers is toggled (Ctrl+Alt+R). */
  onRulersToggle?: () => void;
  /** Whether rulers are currently shown (for checkmark display). */
  showRulers?: boolean;
  /** Called when File > Import > Import to Library... is activated. */
  onImportToLibrary?: () => void;
  /** Called when File > Import > Import Sound... is activated. */
  onImportSound?: () => void;
  /** Called when Edit > Undo is activated (Ctrl+Z). */
  onUndo?: () => void;
  /** Called when Edit > Redo is activated (Ctrl+Shift+Z). */
  onRedo?: () => void;
  /** Whether undo is currently available. */
  canUndo?: boolean;
  /** Whether redo is currently available. */
  canRedo?: boolean;
  /** Called when Insert/Modify > Convert to Symbol (F8) is activated. */
  onConvertToSymbol?: () => void;
  /** Called when Edit > Copy (Ctrl+C) is activated. */
  onCopy?: () => void;
  /** Called when Edit > Cut (Ctrl+X) is activated. */
  onCut?: () => void;
  /** Called when Edit > Paste (Ctrl+V) is activated. */
  onPaste?: () => void;
  /** Called when Edit > Paste in Place (Ctrl+Shift+V) is activated. */
  onPasteInPlace?: () => void;
  /** Called when Edit > Duplicate (Ctrl+D) is activated. */
  onDuplicate?: () => void;
  /** Called when Modify > Arrange > ... is activated. */
  onArrange?: (direction: "front" | "back" | "forward" | "backward") => void;
  /** Called when Modify > Group (Ctrl+G) is activated. */
  onGroup?: () => void;
  /** Called when Modify > Ungroup (Ctrl+Shift+G) is activated. */
  onUngroup?: () => void;
  /** Called when Window > Align (Ctrl+K) is toggled. */
  onAlignPanelToggle?: () => void;
  /** Whether the Align panel is currently visible (for checkmark display). */
  alignPanelVisible?: boolean;
  /** Called when Window > Scene (Ctrl+Shift+S) is toggled. */
  onScenePanelToggle?: () => void;
  /** Whether the Scene panel is currently visible (for checkmark display). */
  scenePanelVisible?: boolean;
  /** Called when Window > Color Mixer (Shift+F9) is toggled. */
  onColorMixerToggle?: () => void;
  /** Whether the Color Mixer panel is currently visible (for checkmark display). */
  colorMixerVisible?: boolean;
}

export function MenuBar({
  document,
  filePath,
  onDocumentChange,
  onFilePathChange,
  onTestMovie,
  onPublish,
  onPublishSettings,
  onColorPanelToggle,
  onActionsToggle,
  onFiltersPanelToggle,
  onDocPropsOpen,
  onRulersToggle,
  showRulers = false,
  onImportToLibrary,
  onImportSound,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onConvertToSymbol,
  onCopy,
  onCut,
  onPaste,
  onPasteInPlace,
  onDuplicate,
  onArrange,
  onGroup,
  onUngroup,
  onAlignPanelToggle,
  alignPanelVisible = false,
  onScenePanelToggle,
  scenePanelVisible = false,
  onColorMixerToggle,
  colorMixerVisible = false,
}: MenuBarProps = {}): React.ReactElement {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const { newDocument, openDocument, saveDocument, saveDocumentAs } =
    useFileActions();

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const handleNew = useCallback(() => {
    const doc = newDocument();
    onDocumentChange?.(doc, undefined);
  }, [newDocument, onDocumentChange]);

  const handleOpen = useCallback(async () => {
    const doc = await openDocument();
    if (doc) {
      onDocumentChange?.(doc, undefined);
    }
  }, [openDocument, onDocumentChange]);

  const handleSave = useCallback(async () => {
    if (!document) return;
    const savedPath = await saveDocument(document, filePath);
    if (savedPath) onFilePathChange?.(savedPath);
  }, [document, filePath, saveDocument, onFilePathChange]);

  const handleSaveAs = useCallback(async () => {
    if (!document) return;
    const savedPath = await saveDocumentAs(document, filePath);
    if (savedPath) onFilePathChange?.(savedPath);
  }, [document, filePath, saveDocumentAs, onFilePathChange]);

  const MENUS: MenuDefinition[] = [
    {
      name: "File",
      items: [
        { label: "New", action: handleNew },
        { label: "Open...", action: () => { void handleOpen(); } },
        { label: "Save", action: () => { void handleSave(); }, separator: true },
        { label: "Save As...", action: () => { void handleSaveAs(); } },
        { label: "Import to Library...", action: () => { onImportToLibrary?.(); }, separator: true },
        { label: "Import Sound...", action: () => { onImportSound?.(); } },
        { label: "Publish Settings...", action: () => { onPublishSettings?.(); }, separator: true },
        { label: "Publish  Ctrl+Shift+F12", action: () => { onPublish?.(); } },
      ],
    },
    {
      name: "Edit",
      items: [
        {
          label: `Undo  Ctrl+Z`,
          action: () => { onUndo?.(); },
          ...(canUndo ? {} : { disabled: true }),
        },
        {
          label: `Redo  Ctrl+Shift+Z`,
          action: () => { onRedo?.(); },
          ...(canRedo ? {} : { disabled: true }),
        },
        {
          label: "Cut  Ctrl+X",
          action: () => { onCut?.(); },
          separator: true,
        },
        {
          label: "Copy  Ctrl+C",
          action: () => { onCopy?.(); },
        },
        {
          label: "Paste  Ctrl+V",
          action: () => { onPaste?.(); },
        },
        {
          label: "Paste in Place  Ctrl+Shift+V",
          action: () => { onPasteInPlace?.(); },
        },
        {
          label: "Duplicate  Ctrl+D",
          action: () => { onDuplicate?.(); },
          separator: true,
        },
      ],
    },
    {
      name: "View",
      items: [
        {
          label: `${showRulers ? "+ " : "  "}Rulers  Ctrl+Alt+R`,
          action: () => { onRulersToggle?.(); },
        },
      ],
    },
    {
      name: "Insert",
      items: [
        {
          label: "Convert to Symbol...  F8",
          action: () => { onConvertToSymbol?.(); },
        },
      ],
    },
    {
      name: "Modify",
      items: [
        {
          label: "Document...  Ctrl+J",
          action: () => { onDocPropsOpen?.(); },
        },
        {
          label: "Convert to Symbol...  F8",
          action: () => { onConvertToSymbol?.(); },
          separator: true,
        },
        {
          label: "Group  Ctrl+G",
          action: () => { onGroup?.(); },
          separator: true,
        },
        {
          label: "Ungroup  Ctrl+Shift+G",
          action: () => { onUngroup?.(); },
        },
        {
          label: "Arrange: Bring to Front  Ctrl+Shift+Up",
          action: () => { onArrange?.("front"); },
          separator: true,
        },
        {
          label: "Arrange: Bring Forward  Ctrl+Up",
          action: () => { onArrange?.("forward"); },
        },
        {
          label: "Arrange: Send Backward  Ctrl+Down",
          action: () => { onArrange?.("backward"); },
        },
        {
          label: "Arrange: Send to Back  Ctrl+Shift+Down",
          action: () => { onArrange?.("back"); },
        },
      ],
    },
    { name: "Text" },
    {
      name: "Control",
      items: [
        {
          label: "Test Movie  Ctrl+Enter",
          action: () => { onTestMovie?.(); },
        },
        {
          label: "Publish",
          action: () => { onPublish?.(); },
          separator: true,
        },
      ],
    },
    { name: "Commands" },
    {
      name: "Window",
      items: [
        {
          label: "Actions  F9",
          action: () => { onActionsToggle?.(); },
        },
        {
          label: `${alignPanelVisible ? "+ " : "  "}Align  Ctrl+K`,
          action: () => { onAlignPanelToggle?.(); },
        },
        {
          label: "Color  Shift+F9",
          action: () => { onColorPanelToggle?.(); },
          separator: true,
        },
        {
          label: `${colorMixerVisible ? "+ " : "  "}Color Mixer  Shift+F9`,
          action: () => { onColorMixerToggle?.(); },
        },
        {
          label: "Filters",
          action: () => { onFiltersPanelToggle?.(); },
        },
        {
          label: `${scenePanelVisible ? "+ " : "  "}Scene  Ctrl+Shift+S`,
          action: () => { onScenePanelToggle?.(); },
          separator: true,
        },
      ],
    },
    { name: "Help" },
  ];

  return (
    <div style={styles.menuBar}>
      {MENUS.map((menu) => (
        <MenuBarItem
          key={menu.name}
          menu={menu}
          isOpen={openMenu === menu.name}
          onOpen={() => setOpenMenu(menu.name)}
          onClose={closeMenu}
        />
      ))}
    </div>
  );
}
