/**
 * ColorMixerPanel — Flash 8-style Color Mixer panel (Window > Color Mixer, Shift+F9).
 *
 * Provides fine-grained color control with RGB/HSB sliders, hex input, alpha,
 * and a gradient editor for linear/radial gradient fills.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import type { BitmapFill, BitmapItem, Fill, GradientColorStop } from "@flash/core";
import {
  chrome,
  halo,
  chromeFont,
  inputStyle as haloInputStyle,
  titleBarStyle as haloTitleBarStyle,
} from "./theme/flash8Theme.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ColorMixerPanelProps {
  fillColor: string;        // CSS hex e.g. "#ff0000"
  strokeColor: string;      // CSS hex
  fillAlpha: number;        // 0-100
  strokeAlpha: number;      // 0-100
  /** Full fill object — used to read/write gradient/bitmap fills */
  fill?: Fill | null;
  onFillColorChange: (color: string, alpha: number) => void;
  onStrokeColorChange: (color: string, alpha: number) => void;
  /** Called when a gradient or bitmap fill is created/updated */
  onFillChange?: (fill: Fill | null) => void;
  /** Library bitmap items available for bitmap fill selection */
  bitmapItems?: readonly BitmapItem[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Color conversion helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    Math.round(r).toString(16).padStart(2, "0") +
    Math.round(g).toString(16).padStart(2, "0") +
    Math.round(b).toString(16).padStart(2, "0")
  );
}

function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = 60 * (((gn - bn) / delta) % 6);
    } else if (max === gn) {
      h = 60 * ((bn - rn) / delta + 2);
    } else {
      h = 60 * ((rn - gn) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const bv = max;

  return [Math.round(h), Math.round(s * 100), Math.round(bv * 100)];
}

function hsbToRgb(h: number, s: number, bv: number): [number, number, number] {
  const sn = s / 100;
  const vn = bv / 100;

  if (sn === 0) {
    const val = Math.round(vn * 255);
    return [val, val, val];
  }

  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;

  let rp = 0, gp = 0, bp = 0;
  if (h < 60)       { rp = c; gp = x; bp = 0; }
  else if (h < 120) { rp = x; gp = c; bp = 0; }
  else if (h < 180) { rp = 0; gp = c; bp = x; }
  else if (h < 240) { rp = 0; gp = x; bp = c; }
  else if (h < 300) { rp = x; gp = 0; bp = c; }
  else              { rp = c; gp = 0; bp = x; }

  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

/** Convert a GradientColorStop to a CSS rgba string for gradient preview */
function stopToCss(stop: GradientColorStop): string {
  const { r, g, b, a } = stop.color;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** Build a CSS linear-gradient string from stops (sorted by ratio) for the band preview */
function buildGradientCss(stops: readonly GradientColorStop[]): string {
  if (stops.length === 0) return "linear-gradient(to right, #000, #fff)";
  const sorted = [...stops].sort((a, b) => a.ratio - b.ratio);
  const parts = sorted.map((s) => `${stopToCss(s)} ${((s.ratio / 255) * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** Default gradient stops (black-to-white) */
function defaultStops(): GradientColorStop[] {
  return [
    { ratio: 0,   color: { r: 0,   g: 0,   b: 0,   a: 255 } },
    { ratio: 255, color: { r: 255, g: 255, b: 255, a: 255 } },
  ];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  left: "60px",
  width: "240px",
  background: chrome.panelBg,
  border: `${chrome.borderThin}px solid ${chrome.separator}`,
  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  display: "flex",
  flexDirection: "column",
  zIndex: 1800,
  ...chromeFont(),
  overflow: "hidden",
  userSelect: "none",
};

const titleBarStyle: React.CSSProperties = {
  ...haloTitleBarStyle(),
  justifyContent: "space-between",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: chrome.textDefault,
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  padding: "0 2px",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: "4px",
  marginBottom: "4px",
};

const labelStyle: React.CSSProperties = {
  ...chromeFont(),
  width: "16px",
  textAlign: "right",
  flexShrink: 0,
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  height: "14px",
  cursor: "pointer",
  accentColor: halo.haloBlue,
};

const numberInputStyle: React.CSSProperties = {
  ...haloInputStyle(),
  width: "36px",
  textAlign: "right",
  flexShrink: 0,
};

const hexInputStyle: React.CSSProperties = {
  ...haloInputStyle(),
  flex: 1,
  fontFamily: "monospace",
  textTransform: "uppercase",
};

const selectStyle: React.CSSProperties = {
  ...haloInputStyle(),
  flex: 1,
};

const modeBtnStyle = (active: boolean): React.CSSProperties => ({
  ...chromeFont(),
  background: active ? halo.haloBlue : chrome.panelBg,
  border: `1px solid ${active ? halo.haloBlue : halo.borderColor}`,
  color: active ? "#FFFFFF" : chrome.textDefault,
  fontSize: "10px",
  cursor: "pointer",
  padding: "1px 6px",
  borderRadius: halo.cornerRadius,
});

// ---------------------------------------------------------------------------
// ColorType derived from Fill
// ---------------------------------------------------------------------------

type ColorType = "solid" | "none" | "linearGradient" | "radialGradient" | "bitmap";

function fillToColorType(fill: Fill | null | undefined): ColorType {
  if (!fill) return "none";
  if (fill.type === "solid") return "solid";
  if (fill.type === "linear-gradient") return "linearGradient";
  if (fill.type === "radial-gradient") return "radialGradient";
  if (fill.type === "bitmap") return "bitmap";
  return "solid";
}

// ---------------------------------------------------------------------------
// Gradient band + stop marker sub-component
// ---------------------------------------------------------------------------

interface GradientEditorProps {
  stops: GradientColorStop[];
  selectedStopIndex: number;
  onSelectStop: (index: number) => void;
  onAddStop: (ratio: number) => void;
  onDeleteStop: (index: number) => void;
  onStopRatioChange: (index: number, ratio: number) => void;
}

function GradientEditor({
  stops,
  selectedStopIndex,
  onSelectStop,
  onAddStop,
  onDeleteStop,
  onStopRatioChange,
}: GradientEditorProps): React.ReactElement {
  const bandRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ index: number; startX: number; startRatio: number } | null>(null);

  const gradientCss = buildGradientCss(stops);

  const handleBandClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't add a stop if we're over an existing stop marker (handled separately)
    if (!bandRef.current) return;
    const rect = bandRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.round((x / rect.width) * 255);
    const clampedRatio = Math.max(0, Math.min(255, ratio));
    onAddStop(clampedRatio);
  };

  const handleMarkerMouseDown = (
    e: React.MouseEvent<HTMLDivElement>,
    index: number
  ) => {
    e.stopPropagation();
    onSelectStop(index);
    draggingRef.current = {
      index,
      startX: e.clientX,
      startRatio: stops[index]?.ratio ?? 0,
    };

    const handleMouseMove = (me: MouseEvent) => {
      if (!draggingRef.current || !bandRef.current) return;
      const rect = bandRef.current.getBoundingClientRect();
      const dx = me.clientX - draggingRef.current.startX;
      const dRatio = Math.round((dx / rect.width) * 255);
      const newRatio = Math.max(0, Math.min(255, draggingRef.current.startRatio + dRatio));
      onStopRatioChange(draggingRef.current.index, newRatio);
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const selectedStop = stops[selectedStopIndex];

  return (
    <div style={{ marginBottom: "6px" }}>
      {/* Gradient color band */}
      <div
        ref={bandRef}
        style={{
          position: "relative",
          height: "18px",
          borderRadius: "2px",
          border: `1px solid ${halo.inputBorder}`,
          background: gradientCss,
          cursor: "crosshair",
          marginBottom: "14px",
        }}
        onClick={handleBandClick}
      >
        {/* Stop markers */}
        {stops.map((stop, i) => {
          const pct = (stop.ratio / 255) * 100;
          const isSelected = i === selectedStopIndex;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                top: "100%",
                left: `${pct}%`,
                transform: "translateX(-50%)",
                width: "10px",
                height: "10px",
                background: rgbToHex(stop.color.r, stop.color.g, stop.color.b),
                // Flash 8: selected stop pointer is black, unselected white.
                border: isSelected ? "2px solid #000000" : "2px solid #FFFFFF",
                outline: `1px solid ${halo.borderCap}`,
                borderRadius: "2px",
                cursor: "ew-resize",
                zIndex: 2,
                boxSizing: "border-box",
              }}
              onMouseDown={(e) => handleMarkerMouseDown(e, i)}
              title={`Stop ${i + 1}: ratio ${stop.ratio}`}
            />
          );
        })}
      </div>

      {/* Selected stop controls */}
      {selectedStop && (
        <div style={{ ...rowStyle, marginTop: "4px" }}>
          <span style={labelStyle}>Pos</span>
          <input
            type="range"
            min={0}
            max={255}
            value={selectedStop.ratio}
            style={sliderStyle}
            onChange={(e) => onStopRatioChange(selectedStopIndex, Number(e.target.value))}
          />
          <input
            type="number"
            min={0}
            max={255}
            value={selectedStop.ratio}
            style={numberInputStyle}
            onChange={(e) =>
              onStopRatioChange(selectedStopIndex, Math.max(0, Math.min(255, Number(e.target.value))))
            }
          />
          {stops.length > 2 && (
            <button
              style={{
                ...chromeFont(),
                background: chrome.panelBg,
                border: `1px solid ${halo.borderColor}`,
                color: halo.error,
                fontSize: "10px",
                cursor: "pointer",
                padding: "1px 4px",
                borderRadius: halo.cornerRadius,
                flexShrink: 0,
              }}
              title="Delete stop"
              onClick={() => onDeleteStop(selectedStopIndex)}
            >
              Del
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColorMixerPanel component
// ---------------------------------------------------------------------------

export function ColorMixerPanel({
  fillColor,
  strokeColor,
  fillAlpha,
  strokeAlpha,
  fill,
  onFillColorChange,
  onStrokeColorChange,
  onFillChange,
  bitmapItems,
  onClose,
}: ColorMixerPanelProps): React.ReactElement {
  // Which color target is active
  const [activeTarget, setActiveTarget] = useState<"fill" | "stroke">("fill");
  // Color mode: RGB or HSB
  const [colorMode, setColorMode] = useState<"rgb" | "hsb">("rgb");
  // Color type
  const [colorType, setColorType] = useState<ColorType>(() => fillToColorType(fill));

  // Gradient state
  const [gradientStops, setGradientStops] = useState<GradientColorStop[]>(() => {
    if (fill?.type === "linear-gradient" || fill?.type === "radial-gradient") {
      return [...fill.stops];
    }
    return defaultStops();
  });
  const [selectedStopIndex, setSelectedStopIndex] = useState(0);
  const [gradientAngle, setGradientAngle] = useState<number>(() => {
    if (fill?.type === "linear-gradient") return fill.angle;
    return 0;
  });
  const [focalPoint, setFocalPoint] = useState<number>(() => {
    if (fill?.type === "radial-gradient") return fill.focalPoint;
    return 0;
  });
  const [gradientSpreadMode, setGradientSpreadMode] = useState<"extend" | "reflect" | "repeat">(() => {
    if (fill?.type === "linear-gradient" || fill?.type === "radial-gradient") {
      return fill.spreadMode ?? "extend";
    }
    return "extend";
  });
  const [gradientInterpolation, setGradientInterpolation] = useState<"rgb" | "linearRGB">(() => {
    if (fill?.type === "linear-gradient" || fill?.type === "radial-gradient") {
      return fill.interpolation ?? "rgb";
    }
    return "rgb";
  });

  // Bitmap fill state
  const [selectedBitmapId, setSelectedBitmapId] = useState<string | null>(() => {
    if (fill?.type === "bitmap") return (fill as BitmapFill).bitmapId;
    return null;
  });
  const [bitmapRepeat, setBitmapRepeat] = useState<boolean>(() => {
    if (fill?.type === "bitmap") return (fill as BitmapFill).repeat;
    return true;
  });
  const [bitmapSmooth, setBitmapSmooth] = useState<boolean>(() => {
    if (fill?.type === "bitmap") return (fill as BitmapFill).smooth;
    return false;
  });

  // Sync colorType when fill prop changes from outside
  useEffect(() => {
    const newType = fillToColorType(fill);
    setColorType(newType);
    if (fill?.type === "linear-gradient" || fill?.type === "radial-gradient") {
      setGradientStops([...fill.stops]);
      if (fill.type === "linear-gradient") setGradientAngle(fill.angle);
      if (fill.type === "radial-gradient") setFocalPoint(fill.focalPoint);
      setGradientSpreadMode(fill.spreadMode ?? "extend");
      setGradientInterpolation(fill.interpolation ?? "rgb");
    }
    if (fill?.type === "bitmap") {
      setSelectedBitmapId((fill as BitmapFill).bitmapId);
      setBitmapRepeat((fill as BitmapFill).repeat);
      setBitmapSmooth((fill as BitmapFill).smooth);
    }
  }, [fill]);

  // Derive the "active color" for the color picker — in gradient mode it's the selected stop
  const isGradient = colorType === "linearGradient" || colorType === "radialGradient";
  const activeStopColor = isGradient
    ? gradientStops[selectedStopIndex]?.color
    : null;

  const activeColor = activeTarget === "fill"
    ? (isGradient && activeStopColor
        ? rgbToHex(activeStopColor.r, activeStopColor.g, activeStopColor.b)
        : fillColor)
    : strokeColor;

  const activeAlpha = activeTarget === "fill"
    ? (isGradient && activeStopColor
        ? Math.round((activeStopColor.a / 255) * 100)
        : fillAlpha)
    : strokeAlpha;

  // Parse the active hex color into RGB
  const [r, g, b] = hexToRgb(activeColor ?? "#000000");
  const [h, s, bv] = rgbToHsb(r, g, b);

  // Local state for inputs (for hex text field editing)
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  // Reset hex draft when active color changes externally
  useEffect(() => {
    setHexDraft(null);
  }, [activeColor]);

  // -------------------------------------------------------------------------
  // Gradient helpers
  // -------------------------------------------------------------------------

  const commitGradient = useCallback(
    (
      newStops: GradientColorStop[],
      newAngle: number,
      newFocalPoint: number,
      type: ColorType,
      spreadMode: "extend" | "reflect" | "repeat" = gradientSpreadMode,
      interpolation: "rgb" | "linearRGB" = gradientInterpolation,
    ) => {
      if (!onFillChange) return;
      if (type === "linearGradient") {
        onFillChange({ type: "linear-gradient", stops: newStops, angle: newAngle, spreadMode, interpolation });
      } else if (type === "radialGradient") {
        onFillChange({ type: "radial-gradient", stops: newStops, focalPoint: newFocalPoint, spreadMode, interpolation });
      }
    },
    [onFillChange, gradientSpreadMode, gradientInterpolation]
  );

  const handleStopRatioChange = useCallback(
    (index: number, ratio: number) => {
      setGradientStops((prev) => {
        const next = prev.map((s, i) => i === index ? { ...s, ratio } : s);
        commitGradient(next, gradientAngle, focalPoint, colorType);
        return next;
      });
    },
    [commitGradient, gradientAngle, focalPoint, colorType]
  );

  const handleAddStop = useCallback(
    (ratio: number) => {
      // Interpolate color at this ratio
      const sorted = [...gradientStops].sort((a, b) => a.ratio - b.ratio);
      let color = { r: 128, g: 128, b: 128, a: 255 };
      if (sorted.length >= 2) {
        let lo = sorted[0];
        let hi = sorted[sorted.length - 1];
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].ratio <= ratio && sorted[i + 1].ratio >= ratio) {
            lo = sorted[i];
            hi = sorted[i + 1];
            break;
          }
        }
        const range = hi.ratio - lo.ratio;
        const t = range === 0 ? 0 : (ratio - lo.ratio) / range;
        color = {
          r: Math.round(lo.color.r + (hi.color.r - lo.color.r) * t),
          g: Math.round(lo.color.g + (hi.color.g - lo.color.g) * t),
          b: Math.round(lo.color.b + (hi.color.b - lo.color.b) * t),
          a: Math.round(lo.color.a + (hi.color.a - lo.color.a) * t),
        };
      }
      const newStop: GradientColorStop = { ratio, color };
      setGradientStops((prev) => {
        const next = [...prev, newStop];
        const newIndex = next.length - 1;
        setSelectedStopIndex(newIndex);
        commitGradient(next, gradientAngle, focalPoint, colorType);
        return next;
      });
    },
    [gradientStops, commitGradient, gradientAngle, focalPoint, colorType]
  );

  const handleDeleteStop = useCallback(
    (index: number) => {
      setGradientStops((prev) => {
        if (prev.length <= 2) return prev; // keep minimum 2 stops
        const next = prev.filter((_, i) => i !== index);
        const newSelected = Math.min(selectedStopIndex, next.length - 1);
        setSelectedStopIndex(newSelected);
        commitGradient(next, gradientAngle, focalPoint, colorType);
        return next;
      });
    },
    [selectedStopIndex, commitGradient, gradientAngle, focalPoint, colorType]
  );

  const handleGradientAngleChange = useCallback(
    (angle: number) => {
      setGradientAngle(angle);
      commitGradient(gradientStops, angle, focalPoint, colorType);
    },
    [commitGradient, gradientStops, focalPoint, colorType]
  );

  const handleFocalPointChange = useCallback(
    (fp: number) => {
      setFocalPoint(fp);
      commitGradient(gradientStops, gradientAngle, fp, colorType);
    },
    [commitGradient, gradientStops, gradientAngle, colorType]
  );

  const handleSpreadModeChange = useCallback(
    (mode: "extend" | "reflect" | "repeat") => {
      setGradientSpreadMode(mode);
      commitGradient(gradientStops, gradientAngle, focalPoint, colorType, mode, gradientInterpolation);
    },
    [commitGradient, gradientStops, gradientAngle, focalPoint, colorType, gradientInterpolation]
  );

  const handleInterpolationChange = useCallback(
    (interp: "rgb" | "linearRGB") => {
      setGradientInterpolation(interp);
      commitGradient(gradientStops, gradientAngle, focalPoint, colorType, gradientSpreadMode, interp);
    },
    [commitGradient, gradientStops, gradientAngle, focalPoint, colorType, gradientSpreadMode]
  );

  // -------------------------------------------------------------------------
  // Commit helpers
  // -------------------------------------------------------------------------

  const commitRgb = useCallback(
    (nr: number, ng: number, nb: number, alpha: number) => {
      const hex = rgbToHex(nr, ng, nb);
      if (isGradient && activeTarget === "fill") {
        // Update the selected gradient stop color
        const aVal = Math.round((alpha / 100) * 255);
        setGradientStops((prev) => {
          const next = prev.map((s, i) =>
            i === selectedStopIndex
              ? { ...s, color: { r: nr, g: ng, b: nb, a: aVal } }
              : s
          );
          commitGradient(next, gradientAngle, focalPoint, colorType);
          return next;
        });
      } else if (activeTarget === "fill") {
        onFillColorChange(hex, alpha);
      } else {
        onStrokeColorChange(hex, alpha);
      }
    },
    [
      activeTarget,
      isGradient,
      selectedStopIndex,
      onFillColorChange,
      onStrokeColorChange,
      commitGradient,
      gradientAngle,
      focalPoint,
      colorType,
    ]
  );

  const commitHsb = useCallback(
    (nh: number, ns: number, nbv: number, alpha: number) => {
      const [nr, ng, nb] = hsbToRgb(nh, ns, nbv);
      commitRgb(nr, ng, nb, alpha);
    },
    [commitRgb]
  );

  // -------------------------------------------------------------------------
  // Slider handlers
  // -------------------------------------------------------------------------

  const handleRChange = (val: number) => commitRgb(val, g, b, activeAlpha);
  const handleGChange = (val: number) => commitRgb(r, val, b, activeAlpha);
  const handleBChange = (val: number) => commitRgb(r, g, val, activeAlpha);

  const handleHChange = (val: number) => commitHsb(val, s, bv, activeAlpha);
  const handleSChange = (val: number) => commitHsb(h, val, bv, activeAlpha);
  const handleBvChange = (val: number) => commitHsb(h, s, val, activeAlpha);

  const handleAlphaChange = (val: number) => {
    if (isGradient && activeTarget === "fill") {
      // Update alpha of selected stop
      const aVal = Math.round((val / 100) * 255);
      setGradientStops((prev) => {
        const next = prev.map((s, i) =>
          i === selectedStopIndex ? { ...s, color: { ...s.color, a: aVal } } : s
        );
        commitGradient(next, gradientAngle, focalPoint, colorType);
        return next;
      });
    } else if (activeTarget === "fill") {
      onFillColorChange(activeColor, val);
    } else {
      onStrokeColorChange(activeColor, val);
    }
  };

  // -------------------------------------------------------------------------
  // Hex input handlers
  // -------------------------------------------------------------------------

  const displayHex = hexDraft !== null
    ? hexDraft
    : (activeColor ?? "#000000").replace("#", "").toUpperCase();

  const handleHexChange = (val: string) => {
    setHexDraft(val.toUpperCase().replace(/[^0-9A-F]/g, "").substring(0, 6));
  };

  const commitHex = () => {
    if (hexDraft !== null && hexDraft.length === 6) {
      const hex = "#" + hexDraft;
      const [nr, ng, nb] = hexToRgb(hex);
      if (isGradient && activeTarget === "fill") {
        const aVal = Math.round((activeAlpha / 100) * 255);
        setGradientStops((prev) => {
          const next = prev.map((s, i) =>
            i === selectedStopIndex
              ? { ...s, color: { r: nr, g: ng, b: nb, a: aVal } }
              : s
          );
          commitGradient(next, gradientAngle, focalPoint, colorType);
          return next;
        });
      } else if (activeTarget === "fill") {
        onFillColorChange(hex, activeAlpha);
      } else {
        onStrokeColorChange(hex, activeAlpha);
      }
    }
    setHexDraft(null);
  };

  // -------------------------------------------------------------------------
  // Swap fill / stroke
  // -------------------------------------------------------------------------

  const handleSwap = () => {
    const tmpFill = fillColor;
    const tmpFillAlpha = fillAlpha;
    onFillColorChange(strokeColor, strokeAlpha);
    onStrokeColorChange(tmpFill, tmpFillAlpha);
  };

  // -------------------------------------------------------------------------
  // Color type handler
  // -------------------------------------------------------------------------

  const handleColorTypeChange = (type: ColorType) => {
    setColorType(type);
    if (type === "none") {
      if (activeTarget === "fill") {
        if (onFillChange) onFillChange(null);
        else onFillColorChange("#000000", 0);
      } else {
        onStrokeColorChange("#000000", 0);
      }
    } else if (type === "solid") {
      if (activeTarget === "fill") {
        onFillColorChange(fillColor, fillAlpha > 0 ? fillAlpha : 100);
      } else {
        onStrokeColorChange(strokeColor, strokeAlpha > 0 ? strokeAlpha : 100);
      }
    } else if (type === "linearGradient" || type === "radialGradient") {
      // Initialize stops from existing gradient if available, else default
      let initStops = gradientStops;
      if (!initStops || initStops.length === 0) {
        initStops = defaultStops();
        setGradientStops(initStops);
      }
      setSelectedStopIndex(0);
      commitGradient(initStops, gradientAngle, focalPoint, type);
    } else if (type === "bitmap") {
      // Pick the first available bitmap item if none selected yet
      const initId = selectedBitmapId ?? bitmapItems?.[0]?.id ?? null;
      setSelectedBitmapId(initId);
      if (initId && onFillChange) {
        onFillChange({ type: "bitmap", bitmapId: initId, repeat: bitmapRepeat, smooth: bitmapSmooth });
      }
    }
  };

  // -------------------------------------------------------------------------
  // Bitmap fill helpers
  // -------------------------------------------------------------------------

  const handleBitmapSelect = useCallback((id: string) => {
    setSelectedBitmapId(id);
    if (onFillChange) {
      onFillChange({ type: "bitmap", bitmapId: id, repeat: bitmapRepeat, smooth: bitmapSmooth });
    }
  }, [onFillChange, bitmapRepeat, bitmapSmooth]);

  const handleBitmapRepeatChange = useCallback((repeat: boolean) => {
    setBitmapRepeat(repeat);
    if (selectedBitmapId && onFillChange) {
      onFillChange({ type: "bitmap", bitmapId: selectedBitmapId, repeat, smooth: bitmapSmooth });
    }
  }, [onFillChange, selectedBitmapId, bitmapSmooth]);

  const handleBitmapSmoothChange = useCallback((smooth: boolean) => {
    setBitmapSmooth(smooth);
    if (selectedBitmapId && onFillChange) {
      onFillChange({ type: "bitmap", bitmapId: selectedBitmapId, repeat: bitmapRepeat, smooth });
    }
  }, [onFillChange, selectedBitmapId, bitmapRepeat]);

  // -------------------------------------------------------------------------
  // Color preview background (alpha checkerboard + color overlay)
  // -------------------------------------------------------------------------

  const previewStyle: React.CSSProperties = {
    height: "18px",
    flex: 1,
    borderRadius: "2px",
    border: `1px solid ${halo.inputBorder}`,
    background: `linear-gradient(${activeColor}${Math.round(activeAlpha * 2.55).toString(16).padStart(2, "0")}, ${activeColor}${Math.round(activeAlpha * 2.55).toString(16).padStart(2, "0")}), repeating-conic-gradient(#CCCCCC 0% 25%, #FFFFFF 0% 50%) 0 0 / 8px 8px`,
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={panelStyle}>
      {/* Title bar */}
      <div style={titleBarStyle}>
        <span>Color Mixer</span>
        <button style={closeBtnStyle} onClick={onClose} title="Close">×</button>
      </div>

      {/* Body */}
      <div style={{ padding: "8px 8px 6px 8px" }}>

        {/* Fill/Stroke selector + swap */}
        <div style={{ ...rowStyle, marginBottom: "8px", alignItems: "flex-end" }}>
          {/* Swatch stack */}
          <div style={{ position: "relative", width: "44px", height: "36px", flexShrink: 0 }}>
            {/* Stroke swatch (back) */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "24px",
                height: "24px",
                background: strokeColor || "#000",
                border: activeTarget === "stroke" ? `2px solid ${halo.haloBlue}` : `2px solid ${halo.borderColor}`,
                cursor: "pointer",
                borderRadius: "2px",
                zIndex: 1,
              }}
              title="Stroke color"
              onClick={() => setActiveTarget("stroke")}
            />
            {/* Fill swatch (front) */}
            <div
              style={{
                position: "absolute",
                top: "12px",
                left: "14px",
                width: "24px",
                height: "24px",
                background: fillColor || "#fff",
                border: activeTarget === "fill" ? `2px solid ${halo.haloBlue}` : `2px solid ${halo.borderColor}`,
                cursor: "pointer",
                borderRadius: "2px",
                zIndex: 2,
              }}
              title="Fill color"
              onClick={() => setActiveTarget("fill")}
            />
          </div>

          {/* Swap button */}
          <button
            style={{
              ...chromeFont(),
              background: chrome.panelBg,
              border: `1px solid ${halo.borderColor}`,
              color: chrome.textDefault,
              fontSize: "12px",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: halo.cornerRadius,
            }}
            title="Swap fill and stroke"
            onClick={handleSwap}
          >
            ⇄
          </button>

          {/* No fill / no stroke buttons */}
          <button
            style={{
              ...chromeFont(),
              background: activeTarget === "fill" && activeAlpha === 0 ? halo.haloBlue : chrome.panelBg,
              border: `1px solid ${halo.borderColor}`,
              color: activeTarget === "fill" && activeAlpha === 0 ? "#FFFFFF" : chrome.textDefault,
              fontSize: "10px",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: halo.cornerRadius,
            }}
            title="No fill"
            onClick={() => {
              if (activeTarget === "fill") onFillColorChange(fillColor, 0);
            }}
          >
            ◻
          </button>
          <button
            style={{
              ...chromeFont(),
              background: activeTarget === "stroke" && activeAlpha === 0 ? halo.haloBlue : chrome.panelBg,
              border: `1px solid ${halo.borderColor}`,
              color: activeTarget === "stroke" && activeAlpha === 0 ? "#FFFFFF" : chrome.textDefault,
              fontSize: "10px",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: halo.cornerRadius,
            }}
            title="No stroke"
            onClick={() => {
              if (activeTarget === "stroke") onStrokeColorChange(strokeColor, 0);
            }}
          >
            ▭
          </button>
        </div>

        {/* Color type dropdown */}
        <div style={{ ...rowStyle, marginBottom: "8px" }}>
          <span style={labelStyle} />
          <select
            style={selectStyle}
            value={colorType}
            onChange={(e) => handleColorTypeChange(e.target.value as ColorType)}
          >
            <option value="solid">Solid</option>
            <option value="none">None</option>
            <option value="linearGradient">Linear Gradient</option>
            <option value="radialGradient">Radial Gradient</option>
            <option value="bitmap">Bitmap</option>
          </select>
          {/* RGB/HSB toggle (hidden for bitmap) */}
          {colorType !== "bitmap" && (
            <>
              <button style={modeBtnStyle(colorMode === "rgb")} onClick={() => setColorMode("rgb")}>R</button>
              <button style={modeBtnStyle(colorMode === "hsb")} onClick={() => setColorMode("hsb")}>H</button>
            </>
          )}
        </div>

        {/* Gradient editor (shown for gradient types, fill target only) */}
        {isGradient && activeTarget === "fill" && (
          <GradientEditor
            stops={gradientStops}
            selectedStopIndex={selectedStopIndex}
            onSelectStop={setSelectedStopIndex}
            onAddStop={handleAddStop}
            onDeleteStop={handleDeleteStop}
            onStopRatioChange={handleStopRatioChange}
          />
        )}

        {/* Bitmap fill picker */}
        {colorType === "bitmap" && activeTarget === "fill" && (
          <div style={{ marginBottom: "6px" }}>
            {/* Bitmap thumbnail grid */}
            {bitmapItems && bitmapItems.length > 0 ? (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "4px",
                maxHeight: "120px",
                overflowY: "auto",
                marginBottom: "6px",
              }}>
                {bitmapItems.map((item) => {
                  const isSelected = item.id === selectedBitmapId;
                  return (
                    <div
                      key={item.id}
                      title={item.name}
                      style={{
                        border: isSelected ? `2px solid ${halo.haloBlue}` : `1px solid ${halo.borderColor}`,
                        borderRadius: "2px",
                        cursor: "pointer",
                        overflow: "hidden",
                        background: halo.panelContentBg,
                        aspectRatio: "1",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onClick={() => handleBitmapSelect(item.id)}
                    >
                      {item.dataUri ? (
                        <img
                          src={item.dataUri}
                          alt={item.name}
                          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                        />
                      ) : (
                        <span style={{ fontSize: "9px", color: chrome.textDisabled, textAlign: "center", padding: "2px" }}>
                          {item.name}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: chrome.textDisabled, fontSize: "11px", marginBottom: "6px" }}>
                No bitmaps in library
              </div>
            )}
            {/* Selected bitmap name */}
            {selectedBitmapId && bitmapItems && (
              <div style={{ fontSize: "10px", color: chrome.textDefault, marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {bitmapItems.find((b) => b.id === selectedBitmapId)?.name ?? selectedBitmapId}
              </div>
            )}
            {/* Repeat / Clip toggle */}
            <div style={{ ...rowStyle, marginBottom: "4px" }}>
              <span style={{ ...labelStyle, width: "auto", marginRight: "4px" }}>Tile</span>
              <button
                style={modeBtnStyle(bitmapRepeat)}
                onClick={() => handleBitmapRepeatChange(true)}
                title="Tiled (repeat)"
              >
                Tile
              </button>
              <button
                style={modeBtnStyle(!bitmapRepeat)}
                onClick={() => handleBitmapRepeatChange(false)}
                title="Clipped (no repeat)"
              >
                Clip
              </button>
              <span style={{ ...labelStyle, width: "auto", marginLeft: "8px", marginRight: "4px" }}>Smooth</span>
              <button
                style={modeBtnStyle(bitmapSmooth)}
                onClick={() => handleBitmapSmoothChange(!bitmapSmooth)}
                title="Toggle smoothing"
              >
                {bitmapSmooth ? "On" : "Off"}
              </button>
            </div>
          </div>
        )}

        {/* Color sliders */}
        {colorMode === "rgb" && (colorType === "solid" || isGradient) && (
          <>
            {/* R */}
            <div style={rowStyle}>
              <span style={labelStyle}>R</span>
              <input
                type="range" min={0} max={255} value={r}
                style={sliderStyle}
                onChange={(e) => handleRChange(Number(e.target.value))}
              />
              <input
                type="number" min={0} max={255} value={r}
                style={numberInputStyle}
                onChange={(e) => handleRChange(Math.max(0, Math.min(255, Number(e.target.value))))}
              />
            </div>
            {/* G */}
            <div style={rowStyle}>
              <span style={labelStyle}>G</span>
              <input
                type="range" min={0} max={255} value={g}
                style={sliderStyle}
                onChange={(e) => handleGChange(Number(e.target.value))}
              />
              <input
                type="number" min={0} max={255} value={g}
                style={numberInputStyle}
                onChange={(e) => handleGChange(Math.max(0, Math.min(255, Number(e.target.value))))}
              />
            </div>
            {/* B */}
            <div style={rowStyle}>
              <span style={labelStyle}>B</span>
              <input
                type="range" min={0} max={255} value={b}
                style={sliderStyle}
                onChange={(e) => handleBChange(Number(e.target.value))}
              />
              <input
                type="number" min={0} max={255} value={b}
                style={numberInputStyle}
                onChange={(e) => handleBChange(Math.max(0, Math.min(255, Number(e.target.value))))}
              />
            </div>
          </>
        )}

        {colorMode === "hsb" && (colorType === "solid" || isGradient) && (
          <>
            {/* H */}
            <div style={rowStyle}>
              <span style={labelStyle}>H</span>
              <input
                type="range" min={0} max={360} value={h}
                style={sliderStyle}
                onChange={(e) => handleHChange(Number(e.target.value))}
              />
              <input
                type="number" min={0} max={360} value={h}
                style={numberInputStyle}
                onChange={(e) => handleHChange(Math.max(0, Math.min(360, Number(e.target.value))))}
              />
            </div>
            {/* S */}
            <div style={rowStyle}>
              <span style={labelStyle}>S</span>
              <input
                type="range" min={0} max={100} value={s}
                style={sliderStyle}
                onChange={(e) => handleSChange(Number(e.target.value))}
              />
              <input
                type="number" min={0} max={100} value={s}
                style={numberInputStyle}
                onChange={(e) => handleSChange(Math.max(0, Math.min(100, Number(e.target.value))))}
              />
            </div>
            {/* B (brightness) */}
            <div style={rowStyle}>
              <span style={labelStyle}>B</span>
              <input
                type="range" min={0} max={100} value={bv}
                style={sliderStyle}
                onChange={(e) => handleBvChange(Number(e.target.value))}
              />
              <input
                type="number" min={0} max={100} value={bv}
                style={numberInputStyle}
                onChange={(e) => handleBvChange(Math.max(0, Math.min(100, Number(e.target.value))))}
              />
            </div>
          </>
        )}

        {/* Alpha */}
        {(colorType === "solid" || isGradient) && (
          <div style={rowStyle}>
            <span style={labelStyle}>A</span>
            <input
              type="range" min={0} max={100} value={activeAlpha}
              style={sliderStyle}
              onChange={(e) => handleAlphaChange(Number(e.target.value))}
            />
            <input
              type="number" min={0} max={100} value={activeAlpha}
              style={numberInputStyle}
              onChange={(e) => handleAlphaChange(Math.max(0, Math.min(100, Number(e.target.value))))}
            />
          </div>
        )}

        {/* Hex + color preview */}
        {(colorType === "solid" || isGradient) && (
          <div style={{ ...rowStyle, marginTop: "4px" }}>
            <span style={{ ...labelStyle, width: "14px", fontSize: "11px" }}>#</span>
            <input
              type="text"
              maxLength={6}
              value={displayHex}
              style={hexInputStyle}
              onChange={(e) => handleHexChange(e.target.value)}
              onBlur={commitHex}
              onKeyDown={(e) => { if (e.key === "Enter") commitHex(); }}
            />
            {/* Color preview swatch */}
            <div style={previewStyle} title={`${activeColor} @ ${activeAlpha}%`} />
          </div>
        )}

        {/* Linear gradient angle control */}
        {colorType === "linearGradient" && activeTarget === "fill" && (
          <div style={{ ...rowStyle, marginTop: "4px" }}>
            <span style={labelStyle}>Ang</span>
            <input
              type="range"
              min={0}
              max={359}
              value={gradientAngle}
              style={sliderStyle}
              onChange={(e) => handleGradientAngleChange(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={359}
              value={gradientAngle}
              style={numberInputStyle}
              onChange={(e) =>
                handleGradientAngleChange(Math.max(0, Math.min(359, Number(e.target.value))))
              }
            />
          </div>
        )}

        {/* Radial gradient focal point control */}
        {colorType === "radialGradient" && activeTarget === "fill" && (
          <div style={{ ...rowStyle, marginTop: "4px" }}>
            <span style={labelStyle}>FP</span>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(focalPoint * 100)}
              style={sliderStyle}
              onChange={(e) => handleFocalPointChange(Number(e.target.value) / 100)}
            />
            <input
              type="number"
              min={-100}
              max={100}
              value={Math.round(focalPoint * 100)}
              style={numberInputStyle}
              onChange={(e) =>
                handleFocalPointChange(Math.max(-1, Math.min(1, Number(e.target.value) / 100)))
              }
            />
          </div>
        )}

        {/* Gradient overflow (spread mode) and color space controls */}
        {isGradient && activeTarget === "fill" && (
          <>
            <div style={{ ...rowStyle, marginTop: "4px" }}>
              <span style={{ ...labelStyle, width: "auto", marginRight: "4px", fontSize: "11px" }}>
                Overflow:
              </span>
              <select
                style={{ ...selectStyle, flex: 1 }}
                value={gradientSpreadMode}
                onChange={(e) => handleSpreadModeChange(e.target.value as "extend" | "reflect" | "repeat")}
                title="Gradient overflow / spread mode"
              >
                <option value="extend">Extend</option>
                <option value="reflect">Reflect</option>
                <option value="repeat">Repeat</option>
              </select>
            </div>
            <div style={{ ...rowStyle, marginTop: "2px" }}>
              <span style={{ ...labelStyle, width: "auto", marginRight: "4px", fontSize: "11px" }}>
                Color space:
              </span>
              <select
                style={{ ...selectStyle, flex: 1 }}
                value={gradientInterpolation}
                onChange={(e) => handleInterpolationChange(e.target.value as "rgb" | "linearRGB")}
                title="Gradient color interpolation space"
              >
                <option value="rgb">Normal (sRGB)</option>
                <option value="linearRGB">Linear RGB</option>
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
