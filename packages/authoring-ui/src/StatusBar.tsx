import React from "react";
import { chrome, chromeFont } from "./theme/flash8Theme.js";

export interface StatusBarProps {
  zoom?: number;
  frameRate?: number;
  currentFrame?: number;
  onZoomChange?: (zoom: number) => void;
  /** Stage-space cursor X in pixels, or null when cursor is outside the stage. */
  cursorX?: number | null;
  /** Stage-space cursor Y in pixels, or null when cursor is outside the stage. */
  cursorY?: number | null;
}

// Preset zoom levels as percentages
const ZOOM_PRESETS = [25, 50, 100, 150, 200, 400, 800];

const styles: Record<string, React.CSSProperties> = {
  statusBar: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    height: "20px",
    background: chrome.insetFieldStrip,
    borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
    padding: "0 6px",
    flexShrink: 0,
    userSelect: "none",
    gap: "12px",
    ...chromeFont(),
  },
  item: {
    ...chromeFont(),
    color: chrome.textDefault,
    whiteSpace: "nowrap",
  },
  separator: {
    ...chromeFont(),
    color: chrome.textDisabled,
  },
  zoomSelect: {
    ...chromeFont(),
    color: chrome.textDefault,
    background: "transparent",
    border: "none",
    outline: "none",
    cursor: "pointer",
    padding: 0,
    // Match the text color of surrounding items
    WebkitAppearance: "none",
    MozAppearance: "none",
    appearance: "none",
  },
};

export function StatusBar({
  zoom = 100,
  frameRate = 12,
  currentFrame = 1,
  onZoomChange,
  cursorX = null,
  cursorY = null,
}: StatusBarProps): React.ReactElement {
  // zoom prop is a percentage (100 = 100%)
  const zoomPct = Math.round(zoom);

  const handleZoomSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "fit") {
      // Signal "fit" as 0 — Shell will interpret
      onZoomChange?.(0);
    } else {
      onZoomChange?.(Number(val));
    }
  };

  return (
    <div style={styles.statusBar}>
      <span style={styles.item}>
        {cursorX != null && cursorY != null
          ? `X: ${Math.round(cursorX)}  Y: ${Math.round(cursorY)}`
          : "X: —  Y: —"}
      </span>
      <span style={styles.separator}>|</span>
      <span style={styles.item}>Frame: {currentFrame}</span>
      <span style={styles.separator}>|</span>
      <span style={styles.item}>{frameRate} fps</span>
      <span style={styles.separator}>|</span>
      <select
        style={styles.zoomSelect}
        value={ZOOM_PRESETS.includes(zoomPct) ? String(zoomPct) : "custom"}
        onChange={handleZoomSelect}
        title="Zoom level"
      >
        <option value="fit">Fit</option>
        {ZOOM_PRESETS.map((z) => (
          <option key={z} value={String(z)}>
            {z}%
          </option>
        ))}
        {!ZOOM_PRESETS.includes(zoomPct) && (
          <option value="custom" disabled>
            {zoomPct}%
          </option>
        )}
      </select>
    </div>
  );
}
