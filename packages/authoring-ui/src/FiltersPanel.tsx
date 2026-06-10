/**
 * FiltersPanel — Flash 8-style Filters panel for display objects.
 *
 * Provides add/remove/enable/disable per filter with an editable parameters
 * area. Supports Drop Shadow, Glow, Blur, and Bevel filters.
 */

import React, { useState, useCallback } from "react";
import type {
  AdjustColorFilter,
  BevelFilter,
  BlurFilter,
  Color,
  DropShadowFilter,
  FlashFilter,
  GlowFilter,
  GradientBevelFilter,
  GradientGlowFilter,
} from "@flash/core";
import {
  defaultAdjustColor,
  defaultBevel,
  defaultBlur,
  defaultDropShadow,
  defaultGlow,
  defaultGradientBevel,
  defaultGradientGlow,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FiltersPanelProps {
  filters: readonly FlashFilter[];
  onFiltersChange: (filters: FlashFilter[]) => void;
  isVisible: boolean;
  onClose?: () => void;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panel: React.CSSProperties = {
  position: "fixed",
  top: "80px",
  right: "220px",
  width: "320px",
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
};

const titleBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "22px",
  background: "#3a3a3a",
  borderBottom: "1px solid #1a1a1a",
  padding: "0 6px",
  flexShrink: 0,
  userSelect: "none",
  fontSize: "11px",
  fontWeight: "bold",
  color: "#c0c0c0",
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#999",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  padding: "0 2px",
};

const filterList: React.CSSProperties = {
  minHeight: "60px",
  maxHeight: "140px",
  overflowY: "auto",
  borderBottom: "1px solid #1a1a1a",
  flexShrink: 0,
};

const filterRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "22px",
  padding: "0 4px",
  gap: "4px",
  cursor: "default",
};

const filterRowSelected: React.CSSProperties = {
  ...filterRow,
  background: "#1a5280",
};

const addBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "24px",
  padding: "0 4px",
  gap: "4px",
  borderBottom: "1px solid #1a1a1a",
  background: "#303030",
  flexShrink: 0,
};

const addBtnStyle: React.CSSProperties = {
  background: "#3a3a3a",
  border: "1px solid #555",
  color: "#d0d0d0",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: "1",
  padding: "1px 6px",
  borderRadius: "2px",
};

const paramsArea: React.CSSProperties = {
  flex: 1,
  padding: "6px",
  overflowY: "auto",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  marginBottom: "4px",
};

const label: React.CSSProperties = {
  width: "90px",
  flexShrink: 0,
  color: "#999",
  fontSize: "11px",
};

const numInput: React.CSSProperties = {
  width: "60px",
  fontSize: "11px",
  background: "#222",
  color: "#e0e0e0",
  border: "1px solid #444",
  padding: "1px 4px",
};

const colorInput: React.CSSProperties = {
  width: "36px",
  height: "18px",
  border: "1px solid #444",
  padding: "0",
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  cursor: "pointer",
  accentColor: "#1a6ea8",
};

const selectStyle: React.CSSProperties = {
  fontSize: "11px",
  background: "#222",
  color: "#e0e0e0",
  border: "1px solid #444",
  padding: "1px 2px",
};

const emptyNote: React.CSSProperties = {
  padding: "6px",
  color: "#666",
  fontStyle: "italic",
  fontSize: "11px",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colorToHex(c: Color): string {
  return (
    "#" +
    c.r.toString(16).padStart(2, "0") +
    c.g.toString(16).padStart(2, "0") +
    c.b.toString(16).padStart(2, "0")
  );
}

function hexToColorRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function filterLabel(f: FlashFilter): string {
  switch (f.type) {
    case "drop-shadow": return "Drop Shadow";
    case "glow": return "Glow";
    case "blur": return "Blur";
    case "bevel": return "Bevel";
    case "gradientGlow": return "Gradient Glow";
    case "gradientBevel": return "Gradient Bevel";
    case "adjustColor": return "Adjust Color";
    default: return "Filter";
  }
}

// ---------------------------------------------------------------------------
// Parameter sub-components
// ---------------------------------------------------------------------------

function NumField({
  lbl,
  value,
  onChange,
  min,
  max,
  step,
}: {
  lbl: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div style={row}>
      <span style={label}>{lbl}</span>
      <input
        type="number"
        style={numInput}
        value={Math.round(value * 100) / 100}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
      />
    </div>
  );
}

function ColorField({
  lbl,
  color,
  alpha,
  onColorChange,
  onAlphaChange,
}: {
  lbl: string;
  color: Color;
  alpha: number;
  onColorChange: (c: Color) => void;
  onAlphaChange: (a: number) => void;
}) {
  return (
    <div style={row}>
      <span style={label}>{lbl}</span>
      <input
        type="color"
        style={colorInput}
        value={colorToHex(color)}
        onChange={(e) => {
          const { r, g, b } = hexToColorRGB(e.target.value);
          onColorChange({ r, g, b, a: color.a });
        }}
      />
      <input
        type="number"
        style={{ ...numInput, width: "44px" }}
        min={0}
        max={100}
        value={Math.round(alpha * 100)}
        title="Alpha %"
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onAlphaChange(Math.max(0, Math.min(1, n / 100)));
        }}
      />
      <span style={{ color: "#666", fontSize: "10px" }}>%</span>
    </div>
  );
}

function CheckField({
  lbl,
  value,
  onChange,
}: {
  lbl: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={row}>
      <span style={label}>{lbl}</span>
      <input
        type="checkbox"
        style={checkboxStyle}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-filter parameter editors
// ---------------------------------------------------------------------------

function DropShadowParams({
  filter,
  onChange,
}: {
  filter: DropShadowFilter;
  onChange: (f: DropShadowFilter) => void;
}) {
  const upd = (partial: Partial<DropShadowFilter>) =>
    onChange({ ...filter, ...partial });

  return (
    <>
      <NumField lbl="Blur X" value={filter.blurX} onChange={(v) => upd({ blurX: v })} min={0} />
      <NumField lbl="Blur Y" value={filter.blurY} onChange={(v) => upd({ blurY: v })} min={0} />
      <NumField lbl="Strength" value={filter.strength} onChange={(v) => upd({ strength: v })} min={0} max={255} />
      <NumField lbl="Angle" value={filter.angle} onChange={(v) => upd({ angle: v })} />
      <NumField lbl="Distance" value={filter.distance} onChange={(v) => upd({ distance: v })} min={0} />
      <ColorField
        lbl="Color"
        color={filter.color}
        alpha={filter.alpha}
        onColorChange={(c) => upd({ color: c })}
        onAlphaChange={(a) => upd({ alpha: a })}
      />
      <CheckField lbl="Inner Shadow" value={filter.inner} onChange={(v) => upd({ inner: v })} />
      <CheckField lbl="Knockout" value={filter.knockout} onChange={(v) => upd({ knockout: v })} />
      <CheckField lbl="Hide Object" value={filter.hideObject} onChange={(v) => upd({ hideObject: v })} />
    </>
  );
}

function GlowParams({
  filter,
  onChange,
}: {
  filter: GlowFilter;
  onChange: (f: GlowFilter) => void;
}) {
  const upd = (partial: Partial<GlowFilter>) => onChange({ ...filter, ...partial });

  return (
    <>
      <NumField lbl="Blur X" value={filter.blurX} onChange={(v) => upd({ blurX: v })} min={0} />
      <NumField lbl="Blur Y" value={filter.blurY} onChange={(v) => upd({ blurY: v })} min={0} />
      <NumField lbl="Strength" value={filter.strength} onChange={(v) => upd({ strength: v })} min={0} max={255} />
      <ColorField
        lbl="Color"
        color={filter.color}
        alpha={filter.alpha}
        onColorChange={(c) => upd({ color: c })}
        onAlphaChange={(a) => upd({ alpha: a })}
      />
      <CheckField lbl="Inner Glow" value={filter.inner} onChange={(v) => upd({ inner: v })} />
      <CheckField lbl="Knockout" value={filter.knockout} onChange={(v) => upd({ knockout: v })} />
    </>
  );
}

function BlurParams({
  filter,
  onChange,
}: {
  filter: BlurFilter;
  onChange: (f: BlurFilter) => void;
}) {
  const upd = (partial: Partial<BlurFilter>) => onChange({ ...filter, ...partial });
  const qualityLabels: Record<1 | 2 | 3, string> = { 1: "Low", 2: "Medium", 3: "High" };

  return (
    <>
      <NumField lbl="Blur X" value={filter.blurX} onChange={(v) => upd({ blurX: v })} min={0} />
      <NumField lbl="Blur Y" value={filter.blurY} onChange={(v) => upd({ blurY: v })} min={0} />
      <div style={row}>
        <span style={label}>Quality</span>
        <select
          style={selectStyle}
          value={filter.quality}
          onChange={(e) => upd({ quality: parseInt(e.target.value) as 1 | 2 | 3 })}
        >
          {([1, 2, 3] as const).map((q) => (
            <option key={q} value={q}>{qualityLabels[q]}</option>
          ))}
        </select>
      </div>
    </>
  );
}

function BevelParams({
  filter,
  onChange,
}: {
  filter: BevelFilter;
  onChange: (f: BevelFilter) => void;
}) {
  const upd = (partial: Partial<BevelFilter>) => onChange({ ...filter, ...partial });
  const qualityLabels: Record<1 | 2 | 3, string> = { 1: "Low", 2: "Medium", 3: "High" };

  return (
    <>
      <NumField lbl="Distance" value={filter.distance} onChange={(v) => upd({ distance: v })} min={0} max={100} />
      <NumField lbl="Angle" value={filter.angle} onChange={(v) => upd({ angle: v })} min={0} max={360} />
      <ColorField
        lbl="Shadow Color"
        color={filter.shadowColor}
        alpha={filter.shadowAlpha}
        onColorChange={(c) => upd({ shadowColor: c })}
        onAlphaChange={(a) => upd({ shadowAlpha: a })}
      />
      <ColorField
        lbl="Highlight Color"
        color={filter.highlightColor}
        alpha={filter.highlightAlpha}
        onColorChange={(c) => upd({ highlightColor: c })}
        onAlphaChange={(a) => upd({ highlightAlpha: a })}
      />
      <NumField lbl="Blur X" value={filter.blurX} onChange={(v) => upd({ blurX: v })} min={0} />
      <NumField lbl="Blur Y" value={filter.blurY} onChange={(v) => upd({ blurY: v })} min={0} />
      <NumField lbl="Strength" value={filter.strength} onChange={(v) => upd({ strength: v })} min={0} max={1000} />
      <div style={row}>
        <span style={label}>Quality</span>
        <select
          style={selectStyle}
          value={filter.quality}
          onChange={(e) => upd({ quality: parseInt(e.target.value) as 1 | 2 | 3 })}
        >
          {([1, 2, 3] as const).map((q) => (
            <option key={q} value={q}>{qualityLabels[q]}</option>
          ))}
        </select>
      </div>
      <div style={row}>
        <span style={label}>Type</span>
        <select
          style={selectStyle}
          value={filter.bevelType}
          onChange={(e) => upd({ bevelType: e.target.value as "inner" | "outer" | "full" })}
        >
          <option value="inner">Inner</option>
          <option value="outer">Outer</option>
          <option value="full">Full</option>
        </select>
      </div>
      <CheckField lbl="Knockout" value={filter.knockout} onChange={(v) => upd({ knockout: v })} />
    </>
  );
}

function GradientGlowParams({
  filter,
  onChange,
}: {
  filter: GradientGlowFilter;
  onChange: (f: GradientGlowFilter) => void;
}) {
  const upd = (partial: Partial<GradientGlowFilter>) => onChange({ ...filter, ...partial });
  const qualityLabels: Record<1 | 2 | 3, string> = { 1: "Low", 2: "Medium", 3: "High" };

  const updateStop = (
    index: number,
    partial: Partial<{ color: string; alpha: number; ratio: number }>
  ) => {
    const gradient = filter.gradient.map((s, i) =>
      i === index ? { ...s, ...partial } : s
    );
    upd({ gradient });
  };

  const addStop = () => {
    const last = filter.gradient[filter.gradient.length - 1];
    const ratio = last ? Math.min(255, Math.round(last.ratio) + 32) : 128;
    upd({ gradient: [...filter.gradient, { color: "#808080", alpha: 1, ratio }] });
  };

  const removeStop = (index: number) => {
    if (filter.gradient.length <= 2) return;
    upd({ gradient: filter.gradient.filter((_, i) => i !== index) });
  };

  return (
    <>
      <NumField lbl="Distance" value={filter.distance} onChange={(v) => upd({ distance: v })} min={0} max={100} />
      <NumField lbl="Angle" value={filter.angle} onChange={(v) => upd({ angle: v })} min={0} max={360} />
      <NumField lbl="Blur X" value={filter.blurX} onChange={(v) => upd({ blurX: v })} min={0} />
      <NumField lbl="Blur Y" value={filter.blurY} onChange={(v) => upd({ blurY: v })} min={0} />
      <NumField lbl="Strength" value={filter.strength} onChange={(v) => upd({ strength: v })} min={0} max={1000} />
      <div style={row}>
        <span style={label}>Quality</span>
        <select
          style={selectStyle}
          value={filter.quality}
          onChange={(e) => upd({ quality: parseInt(e.target.value) as 1 | 2 | 3 })}
        >
          {([1, 2, 3] as const).map((q) => (
            <option key={q} value={q}>{qualityLabels[q]}</option>
          ))}
        </select>
      </div>
      <CheckField lbl="Inner Glow" value={filter.inner} onChange={(v) => upd({ inner: v })} />
      <CheckField lbl="Knockout" value={filter.knockout} onChange={(v) => upd({ knockout: v })} />
      {/* Gradient stops */}
      <div style={{ marginTop: "6px", borderTop: "1px solid #444", paddingTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ color: "#999", fontSize: "11px" }}>Gradient Stops</span>
          <button style={addBtnStyle} onClick={addStop} title="Add gradient stop">+</button>
        </div>
        {filter.gradient.map((stop, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "3px" }}>
            <input
              type="color"
              style={colorInput}
              value={stop.color.length === 7 ? stop.color : "#808080"}
              onChange={(e) => updateStop(i, { color: e.target.value })}
            />
            <input
              type="number"
              style={{ ...numInput, width: "40px" }}
              min={0}
              max={100}
              value={Math.round(stop.alpha * 100)}
              title="Alpha %"
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) updateStop(i, { alpha: Math.max(0, Math.min(1, n / 100)) });
              }}
            />
            <input
              type="number"
              style={{ ...numInput, width: "40px" }}
              min={0}
              max={255}
              value={Math.round(stop.ratio)}
              title="Ratio (0–255)"
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) updateStop(i, { ratio: Math.max(0, Math.min(255, n)) });
              }}
            />
            <button
              style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer", fontSize: "11px", padding: "0 2px" }}
              onClick={() => removeStop(i)}
              disabled={filter.gradient.length <= 2}
              title="Remove stop"
            >
              &#x2715;
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function GradientBevelParams({
  filter,
  onChange,
}: {
  filter: GradientBevelFilter;
  onChange: (f: GradientBevelFilter) => void;
}) {
  const upd = (partial: Partial<GradientBevelFilter>) => onChange({ ...filter, ...partial });
  const qualityLabels: Record<1 | 2 | 3, string> = { 1: "Low", 2: "Medium", 3: "High" };

  const updateStop = (
    index: number,
    partial: Partial<{ color: string; alpha: number; ratio: number }>
  ) => {
    const gradient = filter.gradient.map((s, i) =>
      i === index ? { ...s, ...partial } : s
    );
    upd({ gradient });
  };

  const addStop = () => {
    const last = filter.gradient[filter.gradient.length - 1];
    const ratio = last ? Math.min(255, Math.round(last.ratio) + 32) : 128;
    upd({ gradient: [...filter.gradient, { color: "#808080", alpha: 1, ratio }] });
  };

  const removeStop = (index: number) => {
    if (filter.gradient.length <= 2) return;
    upd({ gradient: filter.gradient.filter((_, i) => i !== index) });
  };

  return (
    <>
      <NumField lbl="Distance" value={filter.distance} onChange={(v) => upd({ distance: v })} min={0} max={100} />
      <NumField lbl="Angle" value={filter.angle} onChange={(v) => upd({ angle: v })} min={0} max={360} />
      <NumField lbl="Blur X" value={filter.blurX} onChange={(v) => upd({ blurX: v })} min={0} />
      <NumField lbl="Blur Y" value={filter.blurY} onChange={(v) => upd({ blurY: v })} min={0} />
      <NumField lbl="Strength" value={filter.strength} onChange={(v) => upd({ strength: v })} min={0} max={1000} />
      <div style={row}>
        <span style={label}>Quality</span>
        <select
          style={selectStyle}
          value={filter.quality}
          onChange={(e) => upd({ quality: parseInt(e.target.value) as 1 | 2 | 3 })}
        >
          {([1, 2, 3] as const).map((q) => (
            <option key={q} value={q}>{qualityLabels[q]}</option>
          ))}
        </select>
      </div>
      <CheckField lbl="Inner" value={filter.inner} onChange={(v) => upd({ inner: v })} />
      <CheckField lbl="Knockout" value={filter.knockout} onChange={(v) => upd({ knockout: v })} />
      {/* Gradient stops */}
      <div style={{ marginTop: "6px", borderTop: "1px solid #444", paddingTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <span style={{ color: "#999", fontSize: "11px" }}>Gradient Stops</span>
          <button style={addBtnStyle} onClick={addStop} title="Add gradient stop">+</button>
        </div>
        {filter.gradient.map((stop, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "3px" }}>
            <input
              type="color"
              style={colorInput}
              value={stop.color.length === 7 ? stop.color : "#808080"}
              onChange={(e) => updateStop(i, { color: e.target.value })}
            />
            <input
              type="number"
              style={{ ...numInput, width: "40px" }}
              min={0}
              max={100}
              value={Math.round(stop.alpha * 100)}
              title="Alpha %"
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) updateStop(i, { alpha: Math.max(0, Math.min(1, n / 100)) });
              }}
            />
            <input
              type="number"
              style={{ ...numInput, width: "40px" }}
              min={0}
              max={255}
              value={Math.round(stop.ratio)}
              title="Ratio (0–255)"
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!isNaN(n)) updateStop(i, { ratio: Math.max(0, Math.min(255, n)) });
              }}
            />
            <button
              style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer", fontSize: "11px", padding: "0 2px" }}
              onClick={() => removeStop(i)}
              disabled={filter.gradient.length <= 2}
              title="Remove stop"
            >
              &#x2715;
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function AdjustColorParams({
  filter,
  onChange,
}: {
  filter: AdjustColorFilter;
  onChange: (f: AdjustColorFilter) => void;
}) {
  const upd = (partial: Partial<AdjustColorFilter>) => onChange({ ...filter, ...partial });

  return (
    <>
      <NumField lbl="Brightness" value={filter.brightness} onChange={(v) => upd({ brightness: v })} min={-100} max={100} />
      <NumField lbl="Contrast" value={filter.contrast} onChange={(v) => upd({ contrast: v })} min={-100} max={100} />
      <NumField lbl="Saturation" value={filter.saturation} onChange={(v) => upd({ saturation: v })} min={-100} max={100} />
      <NumField lbl="Hue" value={filter.hue} onChange={(v) => upd({ hue: v })} min={-180} max={180} />
    </>
  );
}

// ---------------------------------------------------------------------------
// FiltersPanel
// ---------------------------------------------------------------------------

export function FiltersPanel({
  filters,
  onFiltersChange,
  isVisible,
  onClose,
}: FiltersPanelProps): React.ReactElement | null {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    filters.length > 0 ? 0 : null
  );
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);

  // Ensure selectedIndex stays in bounds when filters change
  const safeIndex =
    selectedIndex !== null && selectedIndex < filters.length
      ? selectedIndex
      : filters.length > 0
      ? 0
      : null;

  const handleToggleEnabled = useCallback(
    (index: number) => {
      const updated = filters.map((f, i) =>
        i === index ? { ...f, enabled: !f.enabled } : f
      );
      onFiltersChange(updated as FlashFilter[]);
    },
    [filters, onFiltersChange]
  );

  const handleDeleteFilter = useCallback(
    (index: number) => {
      const updated = filters.filter((_, i) => i !== index);
      onFiltersChange(updated as FlashFilter[]);
      setSelectedIndex(
        updated.length === 0 ? null : Math.min(index, updated.length - 1)
      );
    },
    [filters, onFiltersChange]
  );

  const handleAddFilter = useCallback(
    (type: FlashFilter["type"]) => {
      setAddDropdownOpen(false);
      let newFilter: FlashFilter;
      switch (type) {
        case "drop-shadow":   newFilter = defaultDropShadow();   break;
        case "glow":          newFilter = defaultGlow();         break;
        case "blur":          newFilter = defaultBlur();         break;
        case "bevel":         newFilter = defaultBevel();        break;
        case "gradientGlow":  newFilter = defaultGradientGlow(); break;
        case "gradientBevel": newFilter = defaultGradientBevel(); break;
        case "adjustColor":   newFilter = defaultAdjustColor();  break;
        default: return;
      }
      const updated = [...filters, newFilter];
      onFiltersChange(updated as FlashFilter[]);
      setSelectedIndex(updated.length - 1);
    },
    [filters, onFiltersChange]
  );

  const handleParamChange = useCallback(
    (index: number, updated: FlashFilter) => {
      const newFilters = filters.map((f, i) => (i === index ? updated : f));
      onFiltersChange(newFilters as FlashFilter[]);
    },
    [filters, onFiltersChange]
  );

  if (!isVisible) return null;

  const selectedFilter = safeIndex !== null ? filters[safeIndex] : null;

  return (
    <div style={panel}>
      {/* Title bar */}
      <div style={titleBar}>
        <span>Filters</span>
        <button style={closeBtn} onClick={onClose} title="Close">
          &#x2715;
        </button>
      </div>

      {/* Filter list */}
      <div style={filterList}>
        {filters.length === 0 && (
          <div style={emptyNote}>No filters applied.</div>
        )}
        {filters.map((f, i) => (
          <div
            key={i}
            style={i === safeIndex ? filterRowSelected : filterRow}
            onClick={() => setSelectedIndex(i)}
          >
            {/* Enable/disable checkbox */}
            <input
              type="checkbox"
              style={checkboxStyle}
              checked={f.enabled}
              title={f.enabled ? "Disable filter" : "Enable filter"}
              onChange={(e) => {
                e.stopPropagation();
                handleToggleEnabled(i);
              }}
            />
            {/* Filter name */}
            <span style={{ flex: 1, userSelect: "none" }}>{filterLabel(f)}</span>
            {/* Delete button */}
            <button
              style={{
                background: "transparent",
                border: "none",
                color: "#888",
                cursor: "pointer",
                fontSize: "12px",
                padding: "0 2px",
                lineHeight: "1",
              }}
              title="Remove filter"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteFilter(i);
              }}
            >
              &#x2715;
            </button>
          </div>
        ))}
      </div>

      {/* Add filter bar */}
      <div style={addBar}>
        <div style={{ position: "relative" }}>
          <button
            style={addBtnStyle}
            title="Add filter"
            onClick={() => setAddDropdownOpen((v) => !v)}
          >
            +
          </button>
          {addDropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "22px",
                left: 0,
                background: "#3c3c3c",
                border: "1px solid #555",
                zIndex: 100,
                minWidth: "130px",
                boxShadow: "2px 2px 6px rgba(0,0,0,0.5)",
              }}
            >
              {(
                [
                  ["drop-shadow", "Drop Shadow"],
                  ["glow", "Glow"],
                  ["blur", "Blur"],
                  ["bevel", "Bevel"],
                  ["gradientGlow", "Gradient Glow"],
                  ["gradientBevel", "Gradient Bevel"],
                  ["adjustColor", "Adjust Color"],
                ] as const
              ).map(([type, name]) => (
                <FilterDropdownItem
                  key={type}
                  label={name}
                  onActivate={() => handleAddFilter(type)}
                />
              ))}
            </div>
          )}
        </div>
        <span style={{ color: "#666", fontSize: "10px" }}>Add filter</span>
      </div>

      {/* Parameters area */}
      <div style={paramsArea}>
        {selectedFilter === null && (
          <div style={emptyNote}>Select a filter to edit its parameters.</div>
        )}
        {selectedFilter && safeIndex !== null && (
          <>
            <div
              style={{
                fontSize: "11px",
                fontWeight: "bold",
                color: "#c0c0c0",
                marginBottom: "6px",
                paddingBottom: "4px",
                borderBottom: "1px solid #444",
              }}
            >
              {filterLabel(selectedFilter)}
            </div>
            {selectedFilter.type === "drop-shadow" && (
              <DropShadowParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
            {selectedFilter.type === "glow" && (
              <GlowParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
            {selectedFilter.type === "blur" && (
              <BlurParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
            {selectedFilter.type === "bevel" && (
              <BevelParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
            {selectedFilter.type === "gradientGlow" && (
              <GradientGlowParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
            {selectedFilter.type === "gradientBevel" && (
              <GradientBevelParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
            {selectedFilter.type === "adjustColor" && (
              <AdjustColorParams
                filter={selectedFilter}
                onChange={(f) => handleParamChange(safeIndex, f)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown item
// ---------------------------------------------------------------------------

function FilterDropdownItem({
  label: itemLabel,
  onActivate,
}: {
  label: string;
  onActivate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        padding: "4px 12px",
        fontSize: "11px",
        color: "#e0e0e0",
        cursor: "default",
        background: hovered ? "#0078d7" : "transparent",
        userSelect: "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onActivate}
    >
      {itemLabel}
    </div>
  );
}
