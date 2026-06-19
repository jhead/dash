/**
 * TraceBitmapDialog — Modify > Bitmap > Trace Bitmap...
 *
 * Presents the four Trace Bitmap parameters:
 *   - Color Threshold (1–500, default 100)
 *   - Minimum Area    (1–1000, default 8)
 *   - Curve Fit       (select)
 *   - Corner Threshold (select)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CurveFit, CornerThreshold, TraceBitmapOptions } from "@flash/core";
import { chrome, halo, chromeFont, inputStyle, buttonStyle } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Styles (Flash 8 light "Halo" chrome)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  dialog: {
    background: chrome.appBg,
    border: `1px solid ${chrome.separator}`,
    boxShadow: "4px 4px 12px rgba(0,0,0,0.45)",
    minWidth: "300px",
    zIndex: 2000,
    ...chromeFont(),
  },
  titleBar: {
    background: `linear-gradient(${halo.panelHeaderGrad[0]}, ${halo.panelHeaderGrad[1]})`,
    borderBottom: `1px solid ${halo.headerDivider}`,
    padding: "4px 6px",
    ...chromeFont(),
    fontWeight: "bold",
    color: chrome.textDefault,
    userSelect: "none",
    cursor: "default",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  body: {
    padding: "12px 16px",
    background: halo.panelContentBg,
  },
  row: {
    display: "flex",
    alignItems: "center",
    marginBottom: "10px",
    gap: "8px",
  },
  label: {
    width: "130px",
    flexShrink: 0,
    ...chromeFont(),
    color: chrome.textDefault,
  },
  input: {
    width: "70px",
    ...inputStyle(),
  },
  select: {
    flex: 1,
    ...inputStyle(),
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    padding: "8px 16px 12px",
    borderTop: `1px solid ${chrome.separator}`,
    background: halo.panelContentBg,
  },
  button: {
    ...buttonStyle("up"),
    padding: "3px 14px",
    minWidth: "58px",
  },
  buttonPrimary: {
    ...buttonStyle("up"),
    padding: "3px 14px",
    minWidth: "58px",
    borderColor: halo.haloBlue,
    color: chrome.textDefault,
    fontWeight: "bold",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TraceBitmapDialogProps {
  open: boolean;
  initialOptions?: Partial<TraceBitmapOptions>;
  onConfirm: (options: TraceBitmapOptions) => void;
  onClose: () => void;
}

const CURVE_FIT_OPTIONS: Array<{ value: CurveFit; label: string }> = [
  { value: "pixels",      label: "Pixels" },
  { value: "very-tight",  label: "Very Tight" },
  { value: "tight",       label: "Tight" },
  { value: "normal",      label: "Normal" },
  { value: "smooth",      label: "Smooth" },
  { value: "very-smooth", label: "Very Smooth" },
];

const CORNER_OPTIONS: Array<{ value: CornerThreshold; label: string }> = [
  { value: "many",   label: "Many Corners" },
  { value: "normal", label: "Normal" },
  { value: "few",    label: "Few Corners" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TraceBitmapDialog({
  open,
  initialOptions,
  onConfirm,
  onClose,
}: TraceBitmapDialogProps): React.ReactElement | null {
  const [colorThreshold, setColorThreshold] = useState(
    initialOptions?.colorThreshold ?? 100
  );
  const [minimumArea, setMinimumArea] = useState(
    initialOptions?.minimumArea ?? 8
  );
  const [curveFit, setCurveFit] = useState<CurveFit>(
    initialOptions?.curveFit ?? "normal"
  );
  const [cornerThreshold, setCornerThreshold] = useState<CornerThreshold>(
    initialOptions?.cornerThreshold ?? "normal"
  );

  // Keep values in sync if initialOptions changes while the dialog is open
  useEffect(() => {
    if (!open) return;
    if (initialOptions?.colorThreshold !== undefined)
      setColorThreshold(initialOptions.colorThreshold);
    if (initialOptions?.minimumArea !== undefined)
      setMinimumArea(initialOptions.minimumArea);
    if (initialOptions?.curveFit !== undefined)
      setCurveFit(initialOptions.curveFit);
    if (initialOptions?.cornerThreshold !== undefined)
      setCornerThreshold(initialOptions.cornerThreshold);
  }, [open, initialOptions]);

  // Draggable titlebar
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);

  const handleTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!dialogRef.current) return;
    const rect = dialogRef.current.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !dialogRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      dialogRef.current.style.left = `${dragRef.current.origLeft + dx}px`;
      dialogRef.current.style.top = `${dragRef.current.origTop + dy}px`;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({
      colorThreshold: Math.max(1, Math.min(500, colorThreshold)),
      minimumArea: Math.max(1, Math.min(1000, minimumArea)),
      curveFit,
      cornerThreshold,
    });
  }, [colorThreshold, minimumArea, curveFit, cornerThreshold, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleConfirm();
      if (e.key === "Escape") onClose();
    },
    [handleConfirm, onClose]
  );

  if (!open) return null;

  return (
    <div style={styles.overlay} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        style={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title bar */}
        <div style={styles.titleBar} onMouseDown={handleTitleMouseDown}>
          <span>Trace Bitmap</span>
        </div>

        {/* Body */}
        <div style={styles.body}>
          {/* Color Threshold */}
          <div style={styles.row}>
            <span style={styles.label}>Color Threshold:</span>
            <input
              type="number"
              min={1}
              max={500}
              value={colorThreshold}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setColorThreshold(v);
              }}
              style={styles.input}
              autoFocus
            />
          </div>

          {/* Minimum Area */}
          <div style={styles.row}>
            <span style={styles.label}>Minimum Area:</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={minimumArea}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setMinimumArea(v);
              }}
              style={styles.input}
            />
          </div>

          {/* Curve Fit */}
          <div style={styles.row}>
            <span style={styles.label}>Curve Fit:</span>
            <select
              value={curveFit}
              onChange={(e) => setCurveFit(e.target.value as CurveFit)}
              style={styles.select}
            >
              {CURVE_FIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Corner Threshold */}
          <div style={styles.row}>
            <span style={styles.label}>Corner Threshold:</span>
            <select
              value={cornerThreshold}
              onChange={(e) => setCornerThreshold(e.target.value as CornerThreshold)}
              style={styles.select}
            >
              {CORNER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.button} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...styles.button, ...styles.buttonPrimary }}
            onClick={handleConfirm}
          >
            Trace
          </button>
        </div>
      </div>
    </div>
  );
}
