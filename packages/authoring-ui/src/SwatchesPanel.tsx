/**
 * SwatchesPanel — Flash 8-style Color Swatches panel (Window > Color Swatches).
 *
 * Provides a grid of color swatches that can be clicked to apply fill/stroke colors.
 * Supports adding swatches via color picker, removing swatches (right-click or trash),
 * and loading/saving Adobe Color Table (.act) palette files.
 */

import React, { useState, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Default Flash 8 swatches palette (32-color default + web safe extension)
// ---------------------------------------------------------------------------

/** The default 32-color Flash 8 panel swatches */
export const DEFAULT_SWATCHES: readonly string[] = [
  "#000000", "#333333", "#666666", "#999999", "#cccccc", "#ffffff",
  "#ff0000", "#ff6600", "#ffcc00", "#ffff00", "#99cc00", "#00cc00",
  "#00cccc", "#0099ff", "#0000ff", "#6600cc", "#cc0099", "#ff0099",
  "#cc3300", "#ff9900", "#cccc00", "#99cc33", "#33cc33", "#00cc99",
  "#0099cc", "#3366ff", "#6633cc", "#cc33cc", "#ff3366", "#ffcccc",
  "#ffcc99", "#ccffcc",
];

// ---------------------------------------------------------------------------
// .act file format (Adobe Color Table)
// ---------------------------------------------------------------------------

/**
 * Parse an Adobe Color Table (.act) file.
 * Format: exactly 768 bytes — 256 × [R, G, B] bytes.
 * Trailing all-zero entries are treated as padding and filtered out.
 */
export function loadActPalette(bytes: Uint8Array): string[] {
  const swatches: string[] = [];
  const count = Math.floor(bytes.length / 3);
  for (let i = 0; i < Math.min(count, 256); i++) {
    const r = bytes[i * 3];
    const g = bytes[i * 3 + 1];
    const b = bytes[i * 3 + 2];
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    swatches.push(hex);
  }
  // Filter out trailing all-black padding (#000000 at end)
  let last = swatches.length - 1;
  while (last > 0 && swatches[last] === "#000000") {
    last--;
  }
  return swatches.slice(0, last + 1);
}

/**
 * Serialize current swatches to Adobe Color Table (.act) format.
 * Output is always 768 bytes (256 × 3), with unused entries zero-padded.
 */
export function saveActPalette(swatches: readonly string[]): Uint8Array {
  const bytes = new Uint8Array(768);
  const count = Math.min(swatches.length, 256);
  for (let i = 0; i < count; i++) {
    const hex = swatches[i].replace("#", "");
    bytes[i * 3]     = parseInt(hex.substring(0, 2), 16) || 0;
    bytes[i * 3 + 1] = parseInt(hex.substring(2, 4), 16) || 0;
    bytes[i * 3 + 2] = parseInt(hex.substring(4, 6), 16) || 0;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SwatchesPanelProps {
  swatches: readonly string[];
  onSelectSwatch: (color: string) => void;
  onAddSwatch: (color: string) => void;
  onRemoveSwatch: (index: number) => void;
  onSwatchesLoad: (swatches: string[]) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  right: "260px",
  width: "220px",
  background: "#2a2a2a",
  border: "1px solid #555",
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1800,
  fontFamily: "Arial, sans-serif",
  fontSize: "11px",
  color: "#d0d0d0",
  borderRadius: "3px",
  overflow: "hidden",
  userSelect: "none",
};

const titleBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "22px",
  background: "#3a3a3a",
  borderBottom: "1px solid #1a1a1a",
  padding: "0 6px",
  flexShrink: 0,
  fontSize: "11px",
  fontWeight: "bold",
  color: "#c0c0c0",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#999",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  padding: "0 2px",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "4px",
  padding: "4px 6px",
  borderBottom: "1px solid #1a1a1a",
  flexShrink: 0,
};

const toolBtnStyle: React.CSSProperties = {
  background: "#3c3c3c",
  border: "1px solid #555",
  color: "#c0c0c0",
  fontSize: "10px",
  cursor: "pointer",
  padding: "2px 6px",
  borderRadius: "2px",
  whiteSpace: "nowrap",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(16, 1fr)",
  gap: "1px",
  padding: "6px",
  overflowY: "auto",
  flex: 1,
};

// ---------------------------------------------------------------------------
// SwatchesPanel component
// ---------------------------------------------------------------------------

export function SwatchesPanel({
  swatches,
  onSelectSwatch,
  onAddSwatch,
  onRemoveSwatch,
  onSwatchesLoad,
  onClose,
}: SwatchesPanelProps): React.ReactElement {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const addColorInputRef = useRef<HTMLInputElement>(null);
  const loadFileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Swatch click / context-menu handlers
  // ---------------------------------------------------------------------------

  const handleSwatchClick = useCallback(
    (color: string) => {
      onSelectSwatch(color);
      setContextMenu(null);
    },
    [onSelectSwatch]
  );

  const handleSwatchContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      setContextMenu({ index, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleRemoveFromContext = useCallback(() => {
    if (contextMenu !== null) {
      onRemoveSwatch(contextMenu.index);
      setContextMenu(null);
    }
  }, [contextMenu, onRemoveSwatch]);

  // ---------------------------------------------------------------------------
  // Add swatch via color picker
  // ---------------------------------------------------------------------------

  const handleAddClick = useCallback(() => {
    addColorInputRef.current?.click();
  }, []);

  const handleAddColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onAddSwatch(e.target.value);
    },
    [onAddSwatch]
  );

  // ---------------------------------------------------------------------------
  // Load palette from .act file
  // ---------------------------------------------------------------------------

  const handleLoadClick = useCallback(() => {
    loadFileInputRef.current?.click();
  }, []);

  const handleLoadFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result;
        if (!(buffer instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(buffer);
        const loaded = loadActPalette(bytes);
        if (loaded.length > 0) {
          onSwatchesLoad(loaded);
        }
      };
      reader.readAsArrayBuffer(file);
      // Reset so the same file can be re-loaded
      e.target.value = "";
    },
    [onSwatchesLoad]
  );

  // ---------------------------------------------------------------------------
  // Save palette as .act file
  // ---------------------------------------------------------------------------

  const handleSaveClick = useCallback(() => {
    const bytes = saveActPalette(swatches);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "palette.act";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [swatches]);

  // ---------------------------------------------------------------------------
  // Dismiss context menu on click outside
  // ---------------------------------------------------------------------------

  const handlePanelClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={panelStyle} onClick={handlePanelClick}>
      {/* Title bar */}
      <div style={titleBarStyle}>
        <span>Color Swatches</span>
        <button style={closeBtnStyle} onClick={onClose} title="Close">
          {"×"}
        </button>
      </div>

      {/* Toolbar */}
      <div style={toolbarStyle}>
        <button style={toolBtnStyle} title="Add current color as swatch" onClick={handleAddClick}>
          +
        </button>
        <button style={toolBtnStyle} title="Load .act palette file" onClick={handleLoadClick}>
          Load...
        </button>
        <button
          style={toolBtnStyle}
          title="Save swatches as .act palette file"
          onClick={handleSaveClick}
          disabled={swatches.length === 0}
        >
          Save...
        </button>
        {/* Hidden color input for adding new swatches */}
        <input
          ref={addColorInputRef}
          type="color"
          style={{ display: "none" }}
          onChange={handleAddColorChange}
          title="Pick color to add"
        />
        {/* Hidden file input for loading .act files */}
        <input
          ref={loadFileInputRef}
          type="file"
          accept=".act"
          style={{ display: "none" }}
          onChange={handleLoadFileChange}
        />
      </div>

      {/* Swatch grid */}
      <div style={gridStyle}>
        {swatches.map((color, index) => (
          <div
            key={`${color}-${index}`}
            data-testid={`swatch-${index}`}
            style={{
              width: "100%",
              aspectRatio: "1",
              background: color,
              border: "1px solid #1a1a1a",
              cursor: "pointer",
              borderRadius: "1px",
              boxSizing: "border-box",
            }}
            title={color}
            onClick={() => handleSwatchClick(color)}
            onContextMenu={(e) => handleSwatchContextMenu(e, index)}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setTooltip({ text: color.toUpperCase(), x: rect.left, y: rect.bottom + 2 });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}

        {swatches.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              color: "#666",
              fontSize: "11px",
              padding: "8px 0",
              textAlign: "center",
            }}
          >
            No swatches — click + to add
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            background: "#222",
            border: "1px solid #555",
            color: "#e0e0e0",
            fontSize: "10px",
            padding: "2px 5px",
            borderRadius: "2px",
            pointerEvents: "none",
            zIndex: 9999,
            fontFamily: "monospace",
          }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Context menu (right-click on swatch) */}
      {contextMenu !== null && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            background: "#3c3c3c",
            border: "1px solid #1a1a1a",
            boxShadow: "2px 2px 6px rgba(0,0,0,0.5)",
            zIndex: 9999,
            minWidth: "120px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: "4px 16px",
              fontSize: "12px",
              color: "#e0e0e0",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "#0078d7";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = "transparent";
            }}
            onClick={handleRemoveFromContext}
          >
            Delete Swatch
          </div>
        </div>
      )}
    </div>
  );
}
