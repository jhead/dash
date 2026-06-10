import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Scale9Grid, SymbolLinkage, SymbolType } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolPropertiesData {
  name: string;
  symbolType: SymbolType;
  linkage: SymbolLinkage;
  scale9Grid: Scale9Grid | null;
}

export interface SymbolPropertiesDialogProps {
  open: boolean;
  data: SymbolPropertiesData;
  onConfirm: (data: SymbolPropertiesData) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    position: "fixed",
    background: "#3c3c3c",
    border: "1px solid #666",
    boxShadow: "4px 4px 12px rgba(0,0,0,0.6)",
    minWidth: "340px",
    zIndex: 1000,
    fontFamily: "Tahoma, Arial, sans-serif",
    fontSize: "11px",
    color: "#e0e0e0",
    userSelect: "none",
  },
  titleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "#2a2a2a",
    borderBottom: "1px solid #555",
    padding: "4px 6px",
    cursor: "default",
  },
  titleText: {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#e0e0e0",
  },
  closeBtn: {
    background: "#666",
    border: "1px solid #888",
    color: "#e0e0e0",
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
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "8px",
  },
  label: {
    width: "60px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  inputWide: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  select: {
    flex: 1,
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
  },
  sectionHeader: {
    fontSize: "11px",
    fontWeight: "bold",
    color: "#bbb",
    borderBottom: "1px solid #555",
    paddingBottom: "4px",
    marginBottom: "8px",
    marginTop: "4px",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "8px",
    cursor: "pointer",
    fontSize: "11px",
    color: "#e0e0e0",
  },
  gridRow: {
    display: "flex",
    alignItems: "center",
    marginBottom: "6px",
    marginLeft: "18px",
  },
  gridLabel: {
    width: "60px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  numberInput: {
    width: "64px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
    textAlign: "right" as const,
  },
  numberInputDisabled: {
    width: "64px",
    background: "#2a2a2a",
    border: "1px solid #444",
    color: "#666",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
    textAlign: "right" as const,
    cursor: "not-allowed",
  },
  divider: {
    height: "1px",
    background: "#555",
    margin: "8px 0",
  },
  btnRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "10px",
  },
  btn: {
    background: "#555",
    border: "1px solid #777",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
  btnPrimary: {
    background: "#1a6ea8",
    border: "1px solid #2288cc",
    color: "#fff",
    fontSize: "11px",
    padding: "3px 14px",
    cursor: "pointer",
    minWidth: "58px",
  },
  hint: {
    fontSize: "10px",
    color: "#888",
    marginLeft: "18px",
    marginBottom: "4px",
    fontStyle: "italic",
  },
};

// ---------------------------------------------------------------------------
// SymbolPropertiesDialog
// ---------------------------------------------------------------------------

export function SymbolPropertiesDialog({
  open,
  data,
  onConfirm,
  onClose,
}: SymbolPropertiesDialogProps): React.ReactElement | null {
  const [name, setName] = useState(data.name);
  const [symbolType, setSymbolType] = useState<SymbolType>(data.symbolType);
  const [gridEnabled, setGridEnabled] = useState(data.scale9Grid !== null);
  const [gridX, setGridX] = useState(String(data.scale9Grid?.x ?? 0));
  const [gridY, setGridY] = useState(String(data.scale9Grid?.y ?? 0));
  const [gridW, setGridW] = useState(String(data.scale9Grid?.width ?? 0));
  const [gridH, setGridH] = useState(String(data.scale9Grid?.height ?? 0));

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync state when dialog opens
  useEffect(() => {
    if (open) {
      setName(data.name);
      setSymbolType(data.symbolType);
      const g = data.scale9Grid;
      setGridEnabled(g !== null);
      setGridX(String(g?.x ?? 0));
      setGridY(String(g?.y ?? 0));
      setGridW(String(g?.width ?? 0));
      setGridH(String(g?.height ?? 0));
      setTimeout(() => {
        nameInputRef.current?.select();
        nameInputRef.current?.focus();
      }, 0);
    }
  }, [open, data]);

  const handleOk = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;

    let scale9Grid: Scale9Grid | null = null;
    if (gridEnabled && symbolType === "movieclip") {
      const x = parseFloat(gridX) || 0;
      const y = parseFloat(gridY) || 0;
      const width = parseFloat(gridW) || 0;
      const height = parseFloat(gridH) || 0;
      scale9Grid = { x, y, width, height };
    }

    onConfirm({
      name: trimmed,
      symbolType,
      linkage: data.linkage,
      scale9Grid,
    });
  }, [name, symbolType, gridEnabled, gridX, gridY, gridW, gridH, data.linkage, onConfirm]);

  // Keyboard handler: Enter = OK, Escape = Cancel
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleOk();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, name, symbolType, gridEnabled, gridX, gridY, gridW, gridH]);

  if (!open) return null;

  const isMovieClip = symbolType === "movieclip";
  const gridActive = gridEnabled && isMovieClip;

  return (
    <div
      style={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Symbol Properties</span>
          <button style={styles.closeBtn} onClick={onClose} title="Close">
            x
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Name */}
          <div style={styles.row}>
            <span style={styles.label}>Name:</span>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.inputWide}
              placeholder="Symbol name"
            />
          </div>

          {/* Type */}
          <div style={styles.row}>
            <span style={styles.label}>Type:</span>
            <select
              value={symbolType}
              onChange={(e) => setSymbolType(e.target.value as SymbolType)}
              style={styles.select}
            >
              <option value="movieclip">Movie Clip</option>
              <option value="button">Button</option>
              <option value="graphic">Graphic</option>
            </select>
          </div>

          <div style={styles.divider} />

          {/* 9-slice section — only relevant for Movie Clips */}
          <div style={styles.sectionHeader}>9-Slice Scaling</div>

          {!isMovieClip && (
            <div style={styles.hint}>
              9-slice scaling is only available for Movie Clip symbols.
            </div>
          )}

          <label style={{ ...styles.checkRow, opacity: isMovieClip ? 1 : 0.4 }}>
            <input
              type="checkbox"
              checked={gridEnabled && isMovieClip}
              onChange={(e) => setGridEnabled(e.target.checked)}
              disabled={!isMovieClip}
              style={{ margin: 0, cursor: isMovieClip ? "pointer" : "not-allowed" }}
            />
            Enable guides for 9-slice scaling
          </label>

          {/* Grid coordinate inputs */}
          <div style={styles.gridRow}>
            <span style={styles.gridLabel}>X:</span>
            <input
              type="number"
              value={gridX}
              onChange={(e) => setGridX(e.target.value)}
              disabled={!gridActive}
              style={gridActive ? styles.numberInput : styles.numberInputDisabled}
              placeholder="0"
            />
          </div>
          <div style={styles.gridRow}>
            <span style={styles.gridLabel}>Y:</span>
            <input
              type="number"
              value={gridY}
              onChange={(e) => setGridY(e.target.value)}
              disabled={!gridActive}
              style={gridActive ? styles.numberInput : styles.numberInputDisabled}
              placeholder="0"
            />
          </div>
          <div style={styles.gridRow}>
            <span style={styles.gridLabel}>Width:</span>
            <input
              type="number"
              value={gridW}
              onChange={(e) => setGridW(e.target.value)}
              disabled={!gridActive}
              style={gridActive ? styles.numberInput : styles.numberInputDisabled}
              placeholder="0"
            />
          </div>
          <div style={styles.gridRow}>
            <span style={styles.gridLabel}>Height:</span>
            <input
              type="number"
              value={gridH}
              onChange={(e) => setGridH(e.target.value)}
              disabled={!gridActive}
              style={gridActive ? styles.numberInput : styles.numberInputDisabled}
              placeholder="0"
            />
          </div>

          <div style={styles.divider} />

          {/* Buttons */}
          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button style={styles.btnPrimary} onClick={handleOk}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
