import React, { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentProperties, RulerUnits } from "@flash/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentPropertiesDialogProps {
  properties: DocumentProperties;
  isOpen: boolean;
  onConfirm: (updated: DocumentProperties) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RULER_UNIT_LABELS: { value: RulerUnits; label: string }[] = [
  { value: "px", label: "Pixels" },
  { value: "inches", label: "Inches" },
  { value: "points", label: "Points" },
  { value: "cm", label: "Centimeters" },
  { value: "mm", label: "Millimeters" },
];

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
  section: {
    marginBottom: "10px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "6px",
  },
  label: {
    width: "90px",
    flexShrink: 0,
    fontSize: "11px",
    color: "#ccc",
  },
  inputSmall: {
    width: "55px",
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 4px",
    outline: "none",
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
    padding: "2px 2px",
    outline: "none",
  },
  between: {
    margin: "0 4px",
    color: "#aaa",
    fontSize: "11px",
  },
  colorSwatch: {
    width: "28px",
    height: "18px",
    border: "1px solid #888",
    cursor: "pointer",
    flexShrink: 0,
  },
  matchBtn: {
    marginLeft: "6px",
    background: "#555",
    border: "1px solid #777",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 8px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  contentsSelect: {
    background: "#1e1e1e",
    border: "1px solid #555",
    color: "#e0e0e0",
    fontSize: "11px",
    padding: "2px 2px",
    marginLeft: "4px",
    outline: "none",
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
};

// ---------------------------------------------------------------------------
// DocumentPropertiesDialog
// ---------------------------------------------------------------------------

export function DocumentPropertiesDialog({
  properties,
  isOpen,
  onConfirm,
  onCancel,
}: DocumentPropertiesDialogProps): React.ReactElement | null {
  // Local editable state
  const [width, setWidth] = useState(String(properties.width));
  const [height, setHeight] = useState(String(properties.height));
  const [frameRate, setFrameRate] = useState(String(properties.frameRate));
  const [backgroundColor, setBackgroundColor] = useState(properties.backgroundColor);
  const [rulerUnits, setRulerUnits] = useState<RulerUnits>(properties.rulerUnits);

  // Hidden color input ref
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Reset local state whenever the dialog opens with fresh properties
  useEffect(() => {
    if (isOpen) {
      setWidth(String(properties.width));
      setHeight(String(properties.height));
      setFrameRate(String(properties.frameRate));
      setBackgroundColor(properties.backgroundColor);
      setRulerUnits(properties.rulerUnits);
    }
  }, [isOpen, properties]);

  // Keyboard handler: Enter = OK, Escape = Cancel
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // Only trigger if not inside a text input that might use Enter
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
  }, [isOpen, width, height, frameRate, backgroundColor, rulerUnits]);

  const handleOk = useCallback(() => {
    const parsedWidth = Math.max(1, parseInt(width, 10) || properties.width);
    const parsedHeight = Math.max(1, parseInt(height, 10) || properties.height);
    const parsedFrameRate = Math.min(
      120,
      Math.max(0.01, parseFloat(frameRate) || properties.frameRate)
    );

    const updated: DocumentProperties = {
      ...properties,
      width: parsedWidth,
      height: parsedHeight,
      frameRate: parsedFrameRate,
      backgroundColor,
      rulerUnits,
    };
    onConfirm(updated);
  }, [properties, width, height, frameRate, backgroundColor, rulerUnits, onConfirm]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.titleText}>Document Properties</span>
          <button style={styles.closeBtn} onClick={onCancel} title="Close">
            ×
          </button>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Dimensions */}
          <div style={styles.section}>
            <div style={styles.row}>
              <span style={styles.label}>Dimensions:</span>
              <input
                type="number"
                min={1}
                max={9999}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                style={styles.inputSmall}
                title="Width (px)"
              />
              <span style={styles.between}>×</span>
              <input
                type="number"
                min={1}
                max={9999}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                style={styles.inputSmall}
                title="Height (px)"
              />
              <span style={{ ...styles.between, marginLeft: "4px" }}>px</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label} />
              <button
                style={styles.matchBtn}
                onClick={() => {
                  /* Match Contents: no-op for MVP */
                }}
                title="Resize stage to fit placed objects"
              >
                Match Contents
              </button>
              <select style={styles.contentsSelect} defaultValue="center">
                <option value="center">Center</option>
                <option value="top-left">Top-Left</option>
              </select>
            </div>
          </div>

          <div style={styles.divider} />

          {/* Background color */}
          <div style={{ ...styles.section, ...styles.row }}>
            <span style={styles.label}>Background color:</span>
            <div
              style={{
                ...styles.colorSwatch,
                background: backgroundColor,
              }}
              onClick={() => colorInputRef.current?.click()}
              title={`Background color: ${backgroundColor}`}
            />
            <span style={{ marginLeft: "6px", fontSize: "11px", color: "#aaa" }}>
              {backgroundColor}
            </span>
            {/* Hidden native color picker */}
            <input
              ref={colorInputRef}
              type="color"
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
              tabIndex={-1}
            />
          </div>

          <div style={styles.divider} />

          {/* Frame rate */}
          <div style={{ ...styles.section, ...styles.row }}>
            <span style={styles.label}>Frame rate:</span>
            <input
              type="number"
              min={0.01}
              max={120}
              step={0.01}
              value={frameRate}
              onChange={(e) => setFrameRate(e.target.value)}
              style={styles.inputSmall}
              title="Frame rate (fps)"
            />
            <span style={styles.between}>fps</span>
          </div>

          {/* Ruler units */}
          <div style={{ ...styles.section, ...styles.row }}>
            <span style={styles.label}>Ruler units:</span>
            <select
              value={rulerUnits}
              onChange={(e) => setRulerUnits(e.target.value as RulerUnits)}
              style={styles.select}
            >
              {RULER_UNIT_LABELS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Buttons */}
          <div style={styles.btnRow}>
            <button style={styles.btn} onClick={onCancel}>
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
