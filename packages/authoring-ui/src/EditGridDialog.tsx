import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GridSettings } from "@flash/core";
import {
  chrome,
  halo,
  chromeFont,
  inputStyle,
  buttonStyle,
  type ButtonState,
} from "./theme/flash8Theme.js";

/** A Halo-skinned button that tracks its own hover/press state. */
function DialogButton({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}): React.ReactElement {
  const [state, setState] = useState<ButtonState>("up");
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setState("over")}
      onMouseLeave={() => setState("up")}
      onMouseDown={() => setState("down")}
      onMouseUp={() => setState("over")}
      style={{
        ...buttonStyle(state),
        ...(primary ? { color: chrome.textDefault, fontWeight: "bold" } : {}),
        padding: "3px 14px",
        minWidth: "58px",
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditGridDialogProps {
  grid: GridSettings;
  isOpen: boolean;
  onConfirm: (updated: GridSettings) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    position: "fixed",
    background: chrome.panelBg,
    border: `1px solid ${chrome.separator}`,
    boxShadow: "4px 4px 12px rgba(0,0,0,0.4)",
    minWidth: "300px",
    zIndex: 1000,
    ...chromeFont(),
    userSelect: "none",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: chrome.panelBg,
    borderBottom: `1px solid ${chrome.separator}`,
    padding: "4px 6px",
    cursor: "default",
  },
  titleText: {
    fontSize: "11px",
    fontWeight: "bold",
    color: chrome.textDefault,
  },
  closeBtn: {
    background: "none",
    border: `1px solid ${halo.borderColor}`,
    color: chrome.textDefault,
    width: "14px",
    height: "14px",
    fontSize: "10px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  },
  body: {
    padding: "10px 12px",
    background: halo.panelContentBg,
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
  },
  label: {
    width: "90px",
    flexShrink: 0,
    fontSize: "11px",
    color: chrome.textDefault,
  },
  inputSmall: {
    ...inputStyle(),
    width: "55px",
    padding: "2px 4px",
  },
  between: {
    margin: "0 6px",
    color: chrome.textDefault,
    fontSize: "11px",
  },
  colorSwatch: {
    width: "28px",
    height: "18px",
    border: `1px solid ${halo.borderColor}`,
    cursor: "pointer",
    flexShrink: 0,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: "6px",
    gap: "6px",
    cursor: "pointer",
  },
  divider: {
    height: "1px",
    background: chrome.separator,
    margin: "8px 0",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "10px",
  },
};

// ---------------------------------------------------------------------------
// EditGridDialog
// ---------------------------------------------------------------------------

export function EditGridDialog({
  grid,
  isOpen,
  onConfirm,
  onCancel,
}: EditGridDialogProps): React.ReactElement | null {
  const [gridWidth, setGridWidth] = useState(String(grid.gridWidth));
  const [gridHeight, setGridHeight] = useState(String(grid.gridHeight));
  const [gridColor, setGridColor] = useState(grid.gridColor);
  const [showGrid, setShowGrid] = useState(grid.showGrid);
  const [snapToGrid, setSnapToGrid] = useState(grid.snapToGrid);

  const colorInputRef = useRef<HTMLInputElement>(null);

  // Reset local state whenever the dialog opens with fresh grid settings
  useEffect(() => {
    if (isOpen) {
      setGridWidth(String(grid.gridWidth));
      setGridHeight(String(grid.gridHeight));
      setGridColor(grid.gridColor);
      setShowGrid(grid.showGrid);
      setSnapToGrid(grid.snapToGrid);
    }
  }, [isOpen, grid]);

  const handleOk = useCallback(() => {
    const parsedWidth = Math.max(1, parseInt(gridWidth, 10) || grid.gridWidth);
    const parsedHeight = Math.max(1, parseInt(gridHeight, 10) || grid.gridHeight);
    const updated: GridSettings = {
      showGrid,
      snapToGrid,
      gridColor,
      gridWidth: parsedWidth,
      gridHeight: parsedHeight,
    };
    onConfirm(updated);
  }, [grid, gridWidth, gridHeight, gridColor, showGrid, snapToGrid, onConfirm]);

  // Keyboard handler: Enter = OK, Escape = Cancel
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "TEXTAREA") {
          e.preventDefault();
          handleOk();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, gridWidth, gridHeight, gridColor, showGrid, snapToGrid]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Edit Grid</span>
          <button style={styles.closeBtn} onClick={onCancel} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Grid size */}
          <div style={styles.row}>
            <span style={styles.label}>Grid size:</span>
            <input
              type="number"
              min={1}
              max={999}
              value={gridWidth}
              onChange={(e) => setGridWidth(e.target.value)}
              style={styles.inputSmall}
              title="Grid width (px)"
            />
            <span style={styles.between}>x</span>
            <input
              type="number"
              min={1}
              max={999}
              value={gridHeight}
              onChange={(e) => setGridHeight(e.target.value)}
              style={styles.inputSmall}
              title="Grid height (px)"
            />
            <span style={{ ...styles.between, marginLeft: "4px" }}>px</span>
          </div>

          {/* Grid color */}
          <div style={styles.row}>
            <span style={styles.label}>Grid color:</span>
            <div
              style={{ ...styles.colorSwatch, background: gridColor }}
              onClick={() => colorInputRef.current?.click()}
              title={`Grid color: ${gridColor}`}
            />
            <input
              ref={colorInputRef}
              type="color"
              value={gridColor}
              onChange={(e) => setGridColor(e.target.value)}
              style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
              tabIndex={-1}
            />
            <span style={{ ...styles.between, color: chrome.textDefault }}>{gridColor}</span>
          </div>

          <div style={styles.divider} />

          {/* Show grid checkbox */}
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
            />
            <span>Show Grid</span>
          </label>

          {/* Snap to grid checkbox */}
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => setSnapToGrid(e.target.checked)}
            />
            <span>Snap to Grid</span>
          </label>

          {/* Buttons */}
          <div style={styles.btnRow}>
            <DialogButton onClick={onCancel}>Cancel</DialogButton>
            <DialogButton onClick={handleOk} primary>OK</DialogButton>
          </div>
        </div>
      </div>
    </div>
  );
}
