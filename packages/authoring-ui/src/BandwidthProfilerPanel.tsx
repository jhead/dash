/**
 * BandwidthProfilerPanel — Flash 8-style per-frame bandwidth profiler.
 *
 * Shows a bar chart of bytes-per-frame with a modem-speed budget line.
 * Bars that exceed the budget line (will cause streaming delay) are
 * highlighted yellow; bars within budget are shown in blue.
 */

import React, { useState, useCallback } from "react";
import type { FrameSizeReport } from "@flash/swf";
import { chrome, halo, chromeFont, titleBarStyle } from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Chart palette — re-picked for the LIGHT (white plot) Flash 8 theme.
// The original dark-bg colors (#2677c8 on #111) wash out on white, so these
// are chosen to read against #FFFFFF: a darker Halo blue for in-budget bars,
// a strong amber for over-budget, and a red budget line.
// ---------------------------------------------------------------------------

const PLOT_BG = halo.panelContentBg; // white
const PLOT_BORDER = halo.borderColor; // #B7BABC
const AXIS_TEXT = chrome.textDefault; // near-black
const AXIS_TEXT_DIM = chrome.textDisabled; // #808080
const GRIDLINE = halo.gridLineV; // subtle vertical hover line on white

const BAR_IN = "#2A6FB0"; // in-budget (darker Halo blue, reads on white)
const BAR_IN_HOVER = halo.haloBlue; // #009DFF halo accent on hover
const BAR_IN_LARGEST = "#1E5C96"; // largest in-budget (deeper)
const BAR_OVER = "#D98C00"; // over-budget amber (reads on white)
const BAR_OVER_HOVER = "#FFB400"; // brighter amber on hover
const BAR_OVER_LARGEST = "#B36F00"; // largest over-budget (deeper)
const BUDGET_LINE = "#CC2222"; // red budget line

// ---------------------------------------------------------------------------
// Modem speed presets (bits per second)
// ---------------------------------------------------------------------------

interface ModemPreset {
  label: string;
  bps: number;
}

const MODEM_PRESETS: ModemPreset[] = [
  { label: "14.4 Kbps", bps: 14_400 },
  { label: "28.8 Kbps", bps: 28_800 },
  { label: "56K Modem", bps: 56_000 },
  { label: "DSL (128 Kbps)", bps: 128_000 },
];

const DEFAULT_MODEM_INDEX = 2; // 56K

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BandwidthProfilerPanelProps {
  report: FrameSizeReport;
  /** Document frame rate (fps) used for budget calculation. */
  frameRate: number;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panel: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  left: "50%",
  transform: "translateX(-50%)",
  width: "520px",
  background: chrome.panelBg,
  border: `${chrome.borderThin}px solid ${chrome.separator}`,
  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  zIndex: 2000,
  display: "flex",
  flexDirection: "column",
  ...chromeFont(),
  userSelect: "none",
};

const titleBar: React.CSSProperties = {
  ...titleBarStyle(),
  justifyContent: "space-between",
};

const toolbar: React.CSSProperties = {
  padding: "6px 8px",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
  background: chrome.panelBg,
  flexShrink: 0,
  ...chromeFont(),
};

const chartArea: React.CSSProperties = {
  padding: "8px",
  flexGrow: 1,
  overflowX: "auto",
  overflowY: "hidden",
  background: halo.panelContentBg,
};

const statusBar: React.CSSProperties = {
  padding: "4px 8px",
  borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
  background: chrome.panelBg,
  display: "flex",
  gap: "16px",
  flexShrink: 0,
  ...chromeFont(),
};

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: chrome.textDefault,
  cursor: "pointer",
  fontSize: "14px",
  lineHeight: "1",
  padding: "0 4px",
};

const selectStyle: React.CSSProperties = {
  background: halo.inputBg,
  borderStyle: "solid",
  borderWidth: 1,
  borderTopColor: halo.inputBorderDark,
  borderLeftColor: halo.inputBorderDark,
  borderRightColor: halo.inputBorderLight,
  borderBottomColor: halo.inputBorderLight,
  color: halo.text,
  fontSize: "11px",
  fontFamily: chrome.fontFamily,
  padding: "2px 4px",
  cursor: "pointer",
};

// ---------------------------------------------------------------------------
// Chart constants
// ---------------------------------------------------------------------------

const CHART_WIDTH = 480;
const CHART_HEIGHT = 180;
const AXIS_LEFT = 52;   // pixels reserved for Y axis labels
const AXIS_BOTTOM = 20; // pixels reserved for X axis labels
const PLOT_W = CHART_WIDTH - AXIS_LEFT - 4;
const PLOT_H = CHART_HEIGHT - AXIS_BOTTOM;
const MIN_BAR_WIDTH = 6;
const MAX_BAR_WIDTH = 40;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the streaming budget in bytes per frame.
 * budget = bitsPerSec / fps / 8
 */
function bytesPerFrameBudget(bps: number, fps: number): number {
  return bps / Math.max(fps, 1) / 8;
}

/**
 * Format a byte count as a human-readable string.
 */
function fmtBytes(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BandwidthProfilerPanel({
  report,
  frameRate,
  onClose,
}: BandwidthProfilerPanelProps): React.ReactElement {
  const [modemIndex, setModemIndex] = useState(DEFAULT_MODEM_INDEX);
  const [hoveredFrame, setHoveredFrame] = useState<number | null>(null);

  const modem = MODEM_PRESETS[modemIndex]!;
  const budget = bytesPerFrameBudget(modem.bps, frameRate);

  const { frameSizes, frameCount, totalBytes, largestFrame, averageFrameBytes } = report;

  // ---- Compute chart geometry -------------------------------------------
  const maxBytes = Math.max(...frameSizes, budget * 1.1, 1);

  // Bar width: fit all frames into PLOT_W, clamped to [MIN_BAR_WIDTH, MAX_BAR_WIDTH]
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, Math.floor(PLOT_W / Math.max(frameCount, 1)) - 1)
  );
  const barGap = 1;
  const totalBarsW = frameCount * (barWidth + barGap);

  // Y scale: pixel height per byte
  const yScale = PLOT_H / maxBytes;

  // Budget line Y position (from top of plot area)
  const budgetY = PLOT_H - budget * yScale;

  // Y-axis labels: a handful of round values
  const yLabels: Array<{ label: string; y: number }> = [];
  const step = Math.pow(10, Math.floor(Math.log10(maxBytes))) / 2;
  for (let v = 0; v <= maxBytes; v += step) {
    const y = PLOT_H - v * yScale;
    if (y >= 0 && y <= PLOT_H) {
      yLabels.push({ label: v >= 1024 ? `${(v / 1024).toFixed(0)}K` : `${Math.round(v)}`, y });
    }
  }

  const handleMouseLeave = useCallback(() => setHoveredFrame(null), []);

  const hoveredBytes = hoveredFrame !== null ? frameSizes[hoveredFrame] ?? 0 : null;

  return (
    <div style={panel}>
      {/* Title bar */}
      <div style={titleBar}>
        <span style={{ fontWeight: "bold" }}>Bandwidth Profiler</span>
        <button style={closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      {/* Toolbar */}
      <div style={toolbar}>
        <label htmlFor="bwp-modem">Modem speed:</label>
        <select
          id="bwp-modem"
          style={selectStyle}
          value={modemIndex}
          onChange={(e) => setModemIndex(Number(e.target.value))}
        >
          {MODEM_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
          ))}
        </select>
        <span style={{ color: chrome.textDisabled }}>
          Budget: {fmtBytes(Math.round(budget))}/frame
        </span>
      </div>

      {/* Chart */}
      <div style={chartArea}>
        <svg
          width={AXIS_LEFT + Math.max(totalBarsW, PLOT_W) + 4}
          height={CHART_HEIGHT}
          style={{ display: "block" }}
          onMouseLeave={handleMouseLeave}
        >
          {/* Plot background */}
          <rect
            x={AXIS_LEFT}
            y={0}
            width={Math.max(totalBarsW, PLOT_W)}
            height={PLOT_H}
            fill={PLOT_BG}
            stroke={PLOT_BORDER}
            strokeWidth={1}
          />

          {/* Y-axis labels */}
          {yLabels.map(({ label, y }) => (
            <text
              key={label}
              x={AXIS_LEFT - 4}
              y={y + 3}
              textAnchor="end"
              fontSize={9}
              fill={AXIS_TEXT}
            >
              {label}
            </text>
          ))}

          {/* Bars */}
          {frameSizes.map((bytes: number, fi: number) => {
            const barH = Math.max(1, bytes * yScale);
            const barX = AXIS_LEFT + fi * (barWidth + barGap);
            const barY = PLOT_H - barH;
            const isOver = bytes > budget;
            const isHovered = hoveredFrame === fi;
            const isLargest = fi === largestFrame;
            let fill = isOver ? BAR_OVER : BAR_IN;
            if (isHovered) fill = isOver ? BAR_OVER_HOVER : BAR_IN_HOVER;
            if (isLargest && !isHovered) fill = isOver ? BAR_OVER_LARGEST : BAR_IN_LARGEST;
            return (
              <rect
                key={fi}
                x={barX}
                y={barY}
                width={barWidth}
                height={barH}
                fill={fill}
                stroke="none"
                style={{ cursor: "crosshair" }}
                onMouseEnter={() => setHoveredFrame(fi)}
              />
            );
          })}

          {/* Budget (modem speed) line — red horizontal line */}
          {budgetY >= 0 && budgetY <= PLOT_H && (
            <line
              x1={AXIS_LEFT}
              y1={budgetY}
              x2={AXIS_LEFT + Math.max(totalBarsW, PLOT_W)}
              y2={budgetY}
              stroke={BUDGET_LINE}
              strokeWidth={1.5}
              strokeDasharray="4 2"
            />
          )}

          {/* Budget line label */}
          {budgetY >= 0 && budgetY <= PLOT_H && (
            <text
              x={AXIS_LEFT + 4}
              y={Math.max(8, budgetY - 3)}
              fontSize={8}
              fill={BUDGET_LINE}
            >
              {modem.label}
            </text>
          )}

          {/* X axis: frame number labels (every Nth frame) */}
          {frameSizes.map((_: number, fi: number) => {
            if (frameCount <= 20 || fi % Math.max(1, Math.round(frameCount / 10)) === 0) {
              const lx = AXIS_LEFT + fi * (barWidth + barGap) + barWidth / 2;
              return (
                <text
                  key={`x-${fi}`}
                  x={lx}
                  y={PLOT_H + 13}
                  textAnchor="middle"
                  fontSize={8}
                  fill={AXIS_TEXT_DIM}
                >
                  {fi + 1}
                </text>
              );
            }
            return null;
          })}

          {/* Hovered frame highlight line */}
          {hoveredFrame !== null && (
            <line
              x1={AXIS_LEFT + hoveredFrame * (barWidth + barGap) + barWidth / 2}
              y1={0}
              x2={AXIS_LEFT + hoveredFrame * (barWidth + barGap) + barWidth / 2}
              y2={PLOT_H}
              stroke={GRIDLINE}
              strokeWidth={0.5}
              strokeOpacity={0.8}
            />
          )}
        </svg>
      </div>

      {/* Status bar */}
      <div style={statusBar}>
        <span>
          <b>Frame:</b>{" "}
          {hoveredFrame !== null ? hoveredFrame + 1 : "—"}
        </span>
        <span>
          <b>Bytes:</b>{" "}
          {hoveredFrame !== null && hoveredBytes !== null
            ? fmtBytes(hoveredBytes)
            : "—"}
        </span>
        <span>
          <b>Total:</b> {fmtBytes(totalBytes)}
        </span>
        <span>
          <b>Avg/frame:</b> {fmtBytes(Math.round(averageFrameBytes))}
        </span>
        <span>
          <b>Frames:</b> {frameCount}
        </span>
      </div>
    </div>
  );
}
