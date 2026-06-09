/**
 * ColorPanel — Flash 8 Color Mixer panel (Window > Color, Shift+F9).
 *
 * Features:
 * - Fill/Stroke tab toggle
 * - Fill type selector: None | Solid | Linear Gradient | Radial Gradient
 * - Solid color picker: hue/sat square, brightness bar, hex input, R/G/B/A inputs
 * - Alpha slider + % input
 * - Gradient editor: stop bar, draggable stops, angle/focal-point controls
 */

import React, { useCallback, useRef, useState } from "react";
import type { Color, Fill, GradientColorStop, LinearGradientFill, RadialGradientFill, SolidStroke } from "@flash/core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ColorPanelProps {
  fill: Fill | null;
  stroke: SolidStroke | null;
  onFillChange: (fill: Fill | null) => void;
  onStrokeChange: (stroke: SolidStroke | null) => void;
  isVisible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function colorToHex(c: Color): string {
  return (
    "#" +
    c.r.toString(16).padStart(2, "0") +
    c.g.toString(16).padStart(2, "0") +
    c.b.toString(16).padStart(2, "0")
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

/** Convert RGB (0-255) to HSV (h: 0-360, s: 0-1, v: 0-1). */
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h: h * 360, s, v };
}

/** Convert HSV (h: 0-360, s: 0-1, v: 0-1) to RGB (0-255 each). */
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hn = h / 360;
  const i = Math.floor(hn * 6);
  const f = hn * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ColorPickerProps {
  color: Color;
  onChange: (color: Color) => void;
}

function ColorPicker({ color, onChange }: ColorPickerProps): React.ReactElement {
  const squareRef = useRef<HTMLDivElement>(null);
  const { h, s, v } = rgbToHsv(color.r, color.g, color.b);

  const handleSquareMouse = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const newS = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const newV = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    const { r, g, b } = hsvToRgb(h, newS, newV);
    onChange({ r, g, b, a: color.a });
  }, [h, color.a, onChange]);

  const handleSquareDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    handleSquareMouse(e);
  }, [handleSquareMouse]);

  const handleHueSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newH = Number(e.target.value);
    const { r, g, b } = hsvToRgb(newH, s, v);
    onChange({ r, g, b, a: color.a });
  }, [s, v, color.a, onChange]);

  const handleAlphaSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newA = Math.round((Number(e.target.value) / 100) * 255);
    onChange({ ...color, a: newA });
  }, [color, onChange]);

  const handleHexChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rgb = hexToRgb(e.target.value);
    if (rgb) onChange({ ...rgb, a: color.a });
  }, [color.a, onChange]);

  const handleChannelChange = useCallback((ch: "r" | "g" | "b" | "a", val: string) => {
    const n = clamp(parseInt(val, 10) || 0, 0, 255);
    onChange({ ...color, [ch]: n });
  }, [color, onChange]);

  const alphaPercent = Math.round((color.a / 255) * 100);
  const pureHueColor = hsvToRgb(h, 1, 1);
  const pureHueCss = `rgb(${pureHueColor.r},${pureHueColor.g},${pureHueColor.b})`;

  return (
    <div>
      {/* Hue/Sat square */}
      <div
        ref={squareRef}
        style={{
          width: "160px",
          height: "100px",
          position: "relative",
          cursor: "crosshair",
          background: pureHueCss,
          flexShrink: 0,
        }}
        onMouseDown={handleSquareMouse}
        onMouseMove={handleSquareDrag}
      >
        {/* White gradient overlay (left to right) */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to right, #fff 0%, transparent 100%)",
        }} />
        {/* Black gradient overlay (top to bottom) */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, transparent 0%, #000 100%)",
        }} />
        {/* Crosshair cursor */}
        <div style={{
          position: "absolute",
          left: `${s * 100}%`,
          top: `${(1 - v) * 100}%`,
          width: "6px", height: "6px",
          borderRadius: "50%",
          border: "1px solid #fff",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          boxShadow: "0 0 0 1px #000",
        }} />
      </div>

      {/* Hue slider */}
      <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: "9px", color: "#aaa", width: "10px" }}>H</span>
        <input
          type="range" min={0} max={360} value={Math.round(h)}
          onChange={handleHueSlider}
          style={{
            width: "100%",
            background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
            height: "8px", cursor: "pointer", appearance: "none",
            border: "1px solid #555", borderRadius: "2px",
          }}
        />
      </div>

      {/* Alpha slider */}
      <div style={{ marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ fontSize: "9px", color: "#aaa", width: "10px" }}>A</span>
        <input
          type="range" min={0} max={100} value={alphaPercent}
          onChange={handleAlphaSlider}
          style={{
            width: "calc(100% - 46px)",
            height: "8px", cursor: "pointer", appearance: "none",
            background: `linear-gradient(to right, transparent, rgb(${color.r},${color.g},${color.b}))`,
            border: "1px solid #555", borderRadius: "2px",
          }}
        />
        <input
          type="number" min={0} max={100} value={alphaPercent}
          onChange={(e) => handleAlphaSlider({ target: { value: e.target.value } } as React.ChangeEvent<HTMLInputElement>)}
          style={inputStyle}
        />
        <span style={{ fontSize: "9px", color: "#aaa" }}>%</span>
      </div>

      {/* Hex + RGBA inputs */}
      <div style={{ marginTop: "4px", display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ fontSize: "9px", color: "#aaa", width: "10px" }}>#</span>
          <input
            type="text"
            value={colorToHex(color).slice(1).toUpperCase()}
            onChange={(e) => handleHexChange({ target: { value: "#" + e.target.value } } as React.ChangeEvent<HTMLInputElement>)}
            maxLength={6}
            style={{ ...inputStyle, width: "60px", fontFamily: "monospace" }}
          />
          {/* Color preview */}
          <div style={{
            width: "20px", height: "16px",
            background: `rgba(${color.r},${color.g},${color.b},${color.a / 255})`,
            border: "1px solid #555", flexShrink: 0,
          }} />
        </div>
        <div style={{ display: "flex", gap: "2px" }}>
          {(["r", "g", "b"] as const).map((ch) => (
            <div key={ch} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: "8px", color: "#aaa" }}>{ch.toUpperCase()}</span>
              <input
                type="number" min={0} max={255} value={color[ch]}
                onChange={(e) => handleChannelChange(ch, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: "8px", color: "#aaa" }}>A</span>
            <input
              type="number" min={0} max={255} value={color.a}
              onChange={(e) => handleChannelChange("a", e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gradient editor
// ---------------------------------------------------------------------------

interface GradientEditorProps {
  stops: readonly GradientColorStop[];
  angle?: number;
  focalPoint?: number;
  gradientType: "linear-gradient" | "radial-gradient";
  onStopsChange: (stops: GradientColorStop[]) => void;
  onAngleChange?: (angle: number) => void;
  onFocalPointChange?: (fp: number) => void;
}

const STOP_HANDLE_SIZE = 10;

function gradientCss(stops: readonly GradientColorStop[]): string {
  if (stops.length === 0) return "transparent";
  const sorted = [...stops].sort((a, b) => a.ratio - b.ratio);
  const parts = sorted.map((s) => {
    const pct = Math.round((s.ratio / 255) * 100);
    return `rgba(${s.color.r},${s.color.g},${s.color.b},${s.color.a / 255}) ${pct}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

function GradientEditor({
  stops,
  angle = 0,
  focalPoint = 0,
  gradientType,
  onStopsChange,
  onAngleChange,
  onFocalPointChange,
}: GradientEditorProps): React.ReactElement {
  const barRef = useRef<HTMLDivElement>(null);
  const [selectedStopIdx, setSelectedStopIdx] = useState(0);
  const draggingIdx = useRef<number | null>(null);

  const safeStops = stops.length > 0 ? stops : [
    { ratio: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
    { ratio: 255, color: { r: 255, g: 255, b: 255, a: 255 } },
  ];

  const selectedStop = safeStops[Math.min(selectedStopIdx, safeStops.length - 1)];

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * 255);
    // Check if clicking near an existing stop
    const clickedIdx = safeStops.findIndex((s) => Math.abs(s.ratio - ratio) < 10);
    if (clickedIdx >= 0) {
      setSelectedStopIdx(clickedIdx);
      return;
    }
    // Add a new stop by interpolating color at this position
    const newStop: GradientColorStop = { ratio, color: selectedStop.color };
    const newStops = [...safeStops, newStop].sort((a, b) => a.ratio - b.ratio);
    onStopsChange(newStops);
    setSelectedStopIdx(newStops.findIndex((s) => s.ratio === ratio));
  }, [safeStops, selectedStop, onStopsChange]);

  const handleStopMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStopIdx(idx);
    draggingIdx.current = idx;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingIdx.current === null || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * 255);
    const newStops = safeStops.map((s, i) =>
      i === draggingIdx.current ? { ...s, ratio } : s
    );
    onStopsChange(newStops.sort((a, b) => a.ratio - b.ratio));
  }, [safeStops, onStopsChange]);

  const handleMouseUp = useCallback(() => {
    draggingIdx.current = null;
  }, []);

  const handleStopColorChange = useCallback((newColor: Color) => {
    const idx = Math.min(selectedStopIdx, safeStops.length - 1);
    const newStops = safeStops.map((s, i) => i === idx ? { ...s, color: newColor } : s);
    onStopsChange([...newStops]);
  }, [safeStops, selectedStopIdx, onStopsChange]);

  const handleRemoveStop = useCallback(() => {
    if (safeStops.length <= 2) return; // keep at least 2 stops
    const newStops = safeStops.filter((_, i) => i !== selectedStopIdx);
    onStopsChange(newStops);
    setSelectedStopIdx(Math.max(0, selectedStopIdx - 1));
  }, [safeStops, selectedStopIdx, onStopsChange]);

  return (
    <div>
      {/* Gradient preview bar with stop handles */}
      <div style={{ position: "relative", marginBottom: "14px" }}>
        <div
          ref={barRef}
          style={{
            height: "16px",
            background: gradientCss(safeStops),
            border: "1px solid #555",
            cursor: "crosshair",
            userSelect: "none",
          }}
          onClick={handleBarClick}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {/* Stop handles */}
        {safeStops.map((stop, idx) => {
          const left = (stop.ratio / 255) * 100;
          const isSelected = idx === Math.min(selectedStopIdx, safeStops.length - 1);
          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                top: "16px",
                left: `calc(${left}% - ${STOP_HANDLE_SIZE / 2}px)`,
                width: `${STOP_HANDLE_SIZE}px`,
                height: `${STOP_HANDLE_SIZE}px`,
                background: `rgb(${stop.color.r},${stop.color.g},${stop.color.b})`,
                border: isSelected ? "2px solid #fff" : "1px solid #888",
                cursor: "ew-resize",
                boxSizing: "border-box",
                clipPath: "polygon(50% 0%, 100% 50%, 100% 100%, 0% 100%, 0% 50%)",
              }}
              onMouseDown={(e) => handleStopMouseDown(idx, e)}
              title={`Stop ${idx + 1}: ratio ${stop.ratio}`}
            />
          );
        })}
      </div>

      {/* Remove stop button */}
      <div style={{ display: "flex", gap: "4px", alignItems: "center", marginBottom: "4px" }}>
        <button
          type="button"
          onClick={handleRemoveStop}
          disabled={safeStops.length <= 2}
          style={{
            ...smallBtnStyle,
            opacity: safeStops.length <= 2 ? 0.4 : 1,
          }}
          title="Remove selected stop"
        >
          - Stop
        </button>
        <span style={{ fontSize: "9px", color: "#aaa" }}>
          {safeStops.length} stops
        </span>
      </div>

      {/* Selected stop color picker */}
      <div style={{ fontSize: "9px", color: "#aaa", marginBottom: "2px" }}>
        Stop {Math.min(selectedStopIdx, safeStops.length - 1) + 1} color:
      </div>
      <ColorPicker color={selectedStop.color} onChange={handleStopColorChange} />

      {/* Angle input (linear only) */}
      {gradientType === "linear-gradient" && (
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
          <span style={{ fontSize: "9px", color: "#aaa" }}>Angle:</span>
          <input
            type="number" min={0} max={360} value={Math.round(angle)}
            onChange={(e) => onAngleChange?.(clamp(Number(e.target.value), 0, 360))}
            style={inputStyle}
          />
          <span style={{ fontSize: "9px", color: "#aaa" }}>deg</span>
        </div>
      )}

      {/* Focal point slider (radial only) */}
      {gradientType === "radial-gradient" && (
        <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
          <span style={{ fontSize: "9px", color: "#aaa" }}>Focal:</span>
          <input
            type="range" min={-100} max={100}
            value={Math.round(focalPoint * 100)}
            onChange={(e) => onFocalPointChange?.(Number(e.target.value) / 100)}
            style={{ flex: 1, height: "8px" }}
          />
          <input
            type="number" min={-100} max={100}
            value={Math.round(focalPoint * 100)}
            onChange={(e) => onFocalPointChange?.(clamp(Number(e.target.value) / 100, -1, 1))}
            style={inputStyle}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: "36px",
  background: "#1a1a1a",
  color: "#e0e0e0",
  border: "1px solid #555",
  fontSize: "10px",
  padding: "1px 2px",
  textAlign: "right",
  appearance: "none",
};

const smallBtnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  color: "#c0c0c0",
  border: "1px solid #555",
  fontSize: "9px",
  padding: "1px 4px",
  cursor: "pointer",
};

// ---------------------------------------------------------------------------
// ColorPanel
// ---------------------------------------------------------------------------

type EditTarget = "fill" | "stroke";
type FillTypeId = "none" | "solid" | "linear-gradient" | "radial-gradient";

function fillToTypeId(fill: Fill | null): FillTypeId {
  if (!fill) return "none";
  return fill.type;
}

const DEFAULT_SOLID_COLOR: Color = { r: 255, g: 0, b: 0, a: 255 };
const DEFAULT_STOPS: GradientColorStop[] = [
  { ratio: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
  { ratio: 255, color: { r: 255, g: 255, b: 255, a: 255 } },
];

export function ColorPanel({
  fill,
  stroke,
  onFillChange,
  onStrokeChange,
  isVisible,
  onClose,
}: ColorPanelProps): React.ReactElement | null {
  const [editTarget, setEditTarget] = useState<EditTarget>("fill");

  // Local gradient state (persists stops while switching types)
  const [gradientStops, setGradientStops] = useState<GradientColorStop[]>(DEFAULT_STOPS);
  const [gradientAngle, setGradientAngle] = useState(0);
  const [gradientFocalPoint, setGradientFocalPoint] = useState(0);

  if (!isVisible) return null;

  // Determine current color/fill being edited
  const activeFill: Fill | null = editTarget === "fill" ? fill : null;
  const activeStrokeColor: Color = stroke?.color ?? { r: 0, g: 0, b: 0, a: 255 };

  // Active color for the solid color picker
  const solidColor: Color =
    editTarget === "fill"
      ? activeFill?.type === "solid"
        ? activeFill.color
        : DEFAULT_SOLID_COLOR
      : activeStrokeColor;

  const fillTypeId: FillTypeId =
    editTarget === "fill" ? fillToTypeId(fill) : "solid";

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleFillTypeChange(typeId: FillTypeId) {
    if (editTarget !== "fill") return;
    if (typeId === "none") {
      onFillChange(null);
    } else if (typeId === "solid") {
      const color = fill?.type === "solid" ? fill.color : DEFAULT_SOLID_COLOR;
      onFillChange({ type: "solid", color });
    } else if (typeId === "linear-gradient") {
      const stops = fill && "stops" in fill ? [...fill.stops] : [...gradientStops];
      const angle = fill?.type === "linear-gradient" ? fill.angle : gradientAngle;
      const newFill: LinearGradientFill = { type: "linear-gradient", stops, angle };
      onFillChange(newFill);
    } else if (typeId === "radial-gradient") {
      const stops = fill && "stops" in fill ? [...fill.stops] : [...gradientStops];
      const fp = fill?.type === "radial-gradient" ? fill.focalPoint : gradientFocalPoint;
      const newFill: RadialGradientFill = { type: "radial-gradient", stops, focalPoint: fp };
      onFillChange(newFill);
    }
  }

  function handleSolidColorChange(color: Color) {
    if (editTarget === "fill") {
      onFillChange({ type: "solid", color });
    } else {
      if (!stroke) return;
      onStrokeChange({ ...stroke, color });
    }
  }

  function handleGradientStopsChange(newStops: GradientColorStop[]) {
    setGradientStops(newStops);
    if (editTarget !== "fill") return;
    if (fill?.type === "linear-gradient") {
      onFillChange({ ...fill, stops: newStops });
    } else if (fill?.type === "radial-gradient") {
      onFillChange({ ...fill, stops: newStops });
    }
  }

  function handleAngleChange(angle: number) {
    setGradientAngle(angle);
    if (fill?.type === "linear-gradient") {
      onFillChange({ ...fill, angle });
    }
  }

  function handleFocalPointChange(fp: number) {
    setGradientFocalPoint(fp);
    if (fill?.type === "radial-gradient") {
      onFillChange({ ...fill, focalPoint: fp });
    }
  }

  // Gradient stops from the current fill (if applicable)
  const activeStops: readonly GradientColorStop[] =
    fill?.type === "linear-gradient" || fill?.type === "radial-gradient"
      ? fill.stops
      : gradientStops;
  const activeAngle = fill?.type === "linear-gradient" ? fill.angle : gradientAngle;
  const activeFocalPoint = fill?.type === "radial-gradient" ? fill.focalPoint : gradientFocalPoint;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      style={{
        position: "fixed",
        top: "60px",
        right: "210px",
        width: "190px",
        background: "#2d2d2d",
        border: "1px solid #1a1a1a",
        boxShadow: "2px 2px 8px rgba(0,0,0,0.6)",
        zIndex: 500,
        userSelect: "none",
        fontSize: "11px",
        color: "#e0e0e0",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#222",
        padding: "3px 6px",
        borderBottom: "1px solid #1a1a1a",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "11px", fontWeight: "bold" }}>Color</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#aaa",
            cursor: "pointer",
            fontSize: "12px",
            padding: 0,
            lineHeight: 1,
          }}
        >
          X
        </button>
      </div>

      <div style={{ padding: "6px" }}>
        {/* Fill / Stroke tabs */}
        <div style={{ display: "flex", gap: "0", marginBottom: "6px" }}>
          {(["fill", "stroke"] as EditTarget[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setEditTarget(t)}
              style={{
                flex: 1,
                fontSize: "10px",
                padding: "2px 0",
                background: editTarget === t ? "#3a3a3a" : "#1a1a1a",
                color: editTarget === t ? "#fff" : "#888",
                border: "1px solid #444",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Fill type selector (only for fill, not stroke) */}
        {editTarget === "fill" && (
          <div style={{ marginBottom: "6px" }}>
            <select
              value={fillTypeId}
              onChange={(e) => handleFillTypeChange(e.target.value as FillTypeId)}
              style={{
                width: "100%",
                background: "#1a1a1a",
                color: "#e0e0e0",
                border: "1px solid #555",
                fontSize: "10px",
                padding: "2px",
              }}
            >
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="linear-gradient">Linear Gradient</option>
              <option value="radial-gradient">Radial Gradient</option>
            </select>
          </div>
        )}

        {/* Solid color picker */}
        {(fillTypeId === "solid" || editTarget === "stroke") && fillTypeId !== "none" && (
          <ColorPicker color={solidColor} onChange={handleSolidColorChange} />
        )}

        {/* Gradient editor */}
        {editTarget === "fill" &&
          (fillTypeId === "linear-gradient" || fillTypeId === "radial-gradient") && (
            <GradientEditor
              stops={activeStops}
              angle={activeAngle}
              focalPoint={activeFocalPoint}
              gradientType={fillTypeId}
              onStopsChange={handleGradientStopsChange}
              onAngleChange={handleAngleChange}
              onFocalPointChange={handleFocalPointChange}
            />
          )}

        {/* None fill indicator */}
        {editTarget === "fill" && fillTypeId === "none" && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "40px",
            color: "#888",
            fontSize: "11px",
            border: "1px dashed #555",
          }}>
            No Fill
          </div>
        )}
      </div>
    </div>
  );
}
