/**
 * PropertiesPanel — Flash 8-style context-sensitive Properties panel.
 *
 * Shows different controls depending on what is selected:
 *   - Nothing selected  → Document properties (fps, size, bg color)
 *   - Shape selected    → Fill color, stroke color, stroke weight
 *   - Symbol instance   → Instance name, symbol name, blend mode
 *   - Text field        → Font, size, bold/italic, align, color, text type
 *   - Multiple mixed    → "Mixed selection" message
 */

import React, { useState, useEffect, useCallback } from "react";
import type {
  DisplayObject,
  DocumentProperties,
  FlashDocument,
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
  Fill,
  SolidStroke,
  StrokeCap,
  StrokeJoin,
  StrokeStyleType,
  Color,
  TextAlign,
  TextType,
} from "@flash/core";
import { ColorPicker } from "./ColorPicker";

// ---------------------------------------------------------------------------
// Re-exported legacy types (kept for backward compatibility)
// ---------------------------------------------------------------------------

export interface PlacedInstance {
  id: string;
  libraryItemId: string;
  instanceName: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
}

/** @deprecated Use DocumentProperties from \@flash/core directly. */
export interface DocumentInfo {
  width: number;
  height: number;
  frameRate: number;
  backgroundColor: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PropertiesPanelProps {
  doc: FlashDocument;
  selectedObjects: DisplayObject[];
  onUpdateDocProperties: (props: Partial<DocumentProperties>) => void;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
}

// ---------------------------------------------------------------------------
// View discriminator
// ---------------------------------------------------------------------------

type PanelView = "document" | "shape" | "instance" | "text" | "mixed";

function getView(selectedObjects: DisplayObject[]): PanelView {
  if (selectedObjects.length === 0) return "document";
  if (selectedObjects.length > 1) return "mixed";
  const obj = selectedObjects[0];
  if (obj.type === "shape") return "shape";
  if (obj.type === "instance") return "instance";
  if (obj.type === "text") return "text";
  return "document";
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    background: "#2d2d2d",
    borderTop: "1px solid #1a1a1a",
    flexShrink: 0,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    height: "22px",
    background: "#3a3a3a",
    borderBottom: "1px solid #1a1a1a",
    padding: "0 8px",
    flexShrink: 0,
    userSelect: "none",
  },
  headerLabel: {
    fontSize: "11px",
    color: "#c0c0c0",
    fontWeight: "bold",
    marginRight: 8,
  },
  headerType: {
    fontSize: "10px",
    color: "#888",
  },
  body: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: "4px 8px",
    gap: "6px 12px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
  },
  label: {
    fontSize: "11px",
    color: "#888",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  input: {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    padding: "1px 4px",
    width: "52px",
  },
  inputWide: {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    padding: "1px 4px",
    width: "90px",
  },
  colorSwatch: {
    width: "20px",
    height: "16px",
    border: "1px solid #555",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  },
  select: {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    padding: "1px 2px",
  },
  selectWide: {
    fontSize: "11px",
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    padding: "1px 2px",
    minWidth: "80px",
  },
  toggleBtn: {
    fontSize: "11px",
    padding: "1px 6px",
    border: "1px solid #444",
    cursor: "pointer",
    userSelect: "none",
    minWidth: "20px",
    textAlign: "center",
  },
  alignBtn: {
    fontSize: "11px",
    padding: "1px 5px",
    border: "1px solid #444",
    cursor: "pointer",
    userSelect: "none",
  },
  placeholder: {
    padding: "6px 8px",
    fontSize: "11px",
    color: "#666",
    fontStyle: "italic",
  },
  separator: {
    width: "1px",
    height: "16px",
    background: "#444",
    flexShrink: 0,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Numeric input that commits on blur/Enter, reverts on Escape. */
function NumInput({
  value,
  min,
  max,
  style,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  style?: React.CSSProperties;
  onChange: (v: number) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));

  useEffect(() => {
    setDraft(String(Math.round(value * 100) / 100));
  }, [value]);

  const commit = useCallback(() => {
    const n = parseFloat(draft);
    if (!isNaN(n)) {
      let v = n;
      if (min !== undefined) v = Math.max(min, v);
      if (max !== undefined) v = Math.min(max, v);
      onChange(v);
    } else {
      setDraft(String(Math.round(value * 100) / 100));
    }
  }, [draft, value, min, max, onChange]);

  return (
    <input
      type="number"
      style={{ ...S.input, ...style }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); setDraft(String(Math.round(value * 100) / 100)); }
      }}
    />
  );
}

/** Convert Color (r,g,b,a 0-255) to CSS hex. */
function colorToHex(c: Color): string {
  return `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`;
}

/** Parse CSS hex to Color. */
function hexToColorLocal(hex: string, a = 255): Color {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return { r, g, b, a };
}

// ---------------------------------------------------------------------------
// Document view
// ---------------------------------------------------------------------------

function DocumentView({
  doc,
  onUpdateDocProperties,
}: {
  doc: FlashDocument;
  onUpdateDocProperties: (p: Partial<DocumentProperties>) => void;
}): React.ReactElement {
  const p = doc.properties;

  return (
    <div style={S.body}>
      {/* Size */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Size:</span>
        <NumInput
          value={p.width}
          min={1}
          max={10000}
          style={{ width: 44 }}
          onChange={(v) => onUpdateDocProperties({ width: Math.round(v) })}
        />
        <span style={S.label}>×</span>
        <NumInput
          value={p.height}
          min={1}
          max={10000}
          style={{ width: 44 }}
          onChange={(v) => onUpdateDocProperties({ height: Math.round(v) })}
        />
        <span style={S.label}>px</span>
      </div>

      <div style={S.separator} />

      {/* FPS */}
      <div style={S.fieldGroup}>
        <span style={S.label}>FPS:</span>
        <NumInput
          value={p.frameRate}
          min={0.01}
          max={120}
          style={{ width: 40 }}
          onChange={(v) => onUpdateDocProperties({ frameRate: v })}
        />
      </div>

      <div style={S.separator} />

      {/* Background */}
      <div style={S.fieldGroup}>
        <ColorPicker
          color={p.backgroundColor}
          onChange={(newColor) => onUpdateDocProperties({ backgroundColor: newColor })}
          label="BG"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shape view
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Stroke style option constants
// ---------------------------------------------------------------------------

const STROKE_LINE_STYLES: { value: StrokeStyleType; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "ragged", label: "Ragged" },
  { value: "stippled", label: "Stipple" },
  { value: "hatched", label: "Hatched" },
];

const CAP_OPTIONS: { value: StrokeCap; label: string; title: string }[] = [
  { value: "none", label: "⊓", title: "No cap (butt)" },
  { value: "round", label: "◯", title: "Round cap" },
  { value: "square", label: "□", title: "Square cap" },
];

const JOIN_OPTIONS: { value: StrokeJoin; label: string; title: string }[] = [
  { value: "miter", label: "⌐", title: "Miter join" },
  { value: "round", label: "◡", title: "Round join" },
  { value: "bevel", label: "⌐̈", title: "Bevel join" },
];

// ---------------------------------------------------------------------------
// ShapeView
// ---------------------------------------------------------------------------

function ShapeView({
  obj,
  onUpdateObject,
}: {
  obj: ShapeDisplayObject;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
}): React.ReactElement {
  // Gather fill/stroke from first path
  const firstPath = obj.shape.paths[0];
  const fill: Fill | null = firstPath?.fill ?? null;
  const stroke: SolidStroke | null = (firstPath?.stroke as SolidStroke | undefined) ?? null;

  const fillHex = fill?.type === "solid" ? colorToHex(fill.color) : "#000000";
  const hasFill = fill !== null;
  const strokeHex = stroke ? colorToHex(stroke.color) : "#000000";
  const hasStroke = stroke !== null;
  const strokeWeight = stroke?.width ?? 1;
  const strokeCaps: StrokeCap = stroke?.caps ?? "round";
  const strokeJoints: StrokeJoin = stroke?.joints ?? "round";
  const strokeMiterLimit = stroke?.miterLimit ?? 3;
  const strokeLineStyle: StrokeStyleType = stroke?.style?.type ?? "solid";

  const updateAllPaths = useCallback(
    (patchFn: (f: Fill | undefined, s: SolidStroke | undefined) => { fill?: Fill | null; stroke?: SolidStroke | null }) => {
      const newPaths = obj.shape.paths.map((p) => {
        const patch = patchFn(p.fill, p.stroke as SolidStroke | undefined);
        const next = { ...p };
        if ("fill" in patch) {
          if (patch.fill === null) {
            // Remove fill key
            const { fill: _f, ...rest } = next;
            void _f;
            return rest;
          } else if (patch.fill !== undefined) {
            return { ...next, fill: patch.fill };
          }
        }
        if ("stroke" in patch) {
          if (patch.stroke === null) {
            const { stroke: _s, ...rest } = next;
            void _s;
            return rest;
          } else if (patch.stroke !== undefined) {
            return { ...next, stroke: patch.stroke };
          }
        }
        return next;
      });
      onUpdateObject(obj.id, { shape: { ...obj.shape, paths: newPaths } } as Partial<DisplayObject>);
    },
    [obj, onUpdateObject]
  );

  const handleFillColorChange = useCallback((hex: string) => {
    updateAllPaths((f, s) => ({
      fill: f ? { ...f, type: "solid" as const, color: hexToColorLocal(hex, f.type === "solid" ? f.color.a : 255) } : { type: "solid" as const, color: hexToColorLocal(hex) },
      stroke: s,
    }));
  }, [updateAllPaths]);

  const handleFillNoneToggle = useCallback(() => {
    if (hasFill) {
      updateAllPaths(() => ({ fill: null }));
    } else {
      updateAllPaths(() => ({ fill: { type: "solid" as const, color: hexToColorLocal(fillHex) } }));
    }
  }, [hasFill, fillHex, updateAllPaths]);

  const handleStrokeColorChange = useCallback((hex: string) => {
    updateAllPaths((_f, s) => ({
      stroke: s
        ? { ...s, color: hexToColorLocal(hex, s.color.a) }
        : { type: "solid" as const, color: hexToColorLocal(hex), width: strokeWeight, caps: "round" as const, joints: "round" as const, miterLimit: 3 },
    }));
  }, [strokeWeight, updateAllPaths]);

  const handleStrokeNoneToggle = useCallback(() => {
    if (hasStroke) {
      updateAllPaths(() => ({ stroke: null }));
    } else {
      updateAllPaths(() => ({
        stroke: {
          type: "solid" as const,
          color: hexToColorLocal(strokeHex),
          width: strokeWeight,
          caps: "round" as const,
          joints: "round" as const,
          miterLimit: 3,
        },
      }));
    }
  }, [hasStroke, strokeHex, strokeWeight, updateAllPaths]);

  const handleStrokeWeightChange = useCallback((w: number) => {
    updateAllPaths((_f, s) => ({
      stroke: s
        ? { ...s, width: w }
        : { type: "solid" as const, color: hexToColorLocal(strokeHex), width: w, caps: "round" as const, joints: "round" as const, miterLimit: 3 },
    }));
  }, [strokeHex, updateAllPaths]);

  const handleStrokeLineStyleChange = useCallback((styleType: StrokeStyleType) => {
    updateAllPaths((_f, s) => {
      if (!s) return {};
      let newStyle: SolidStroke["style"];
      switch (styleType) {
        case "solid":    newStyle = { type: "solid" }; break;
        case "dashed":   newStyle = { type: "dashed", dashLength: 8, gapLength: 4 }; break;
        case "dotted":   newStyle = { type: "dotted", dotSpacing: 6 }; break;
        case "ragged":   newStyle = { type: "ragged", roughness: "normal", pattern: "simple", waveHeight: "wavy" }; break;
        case "stippled": newStyle = { type: "stippled", dotSize: "medium", dotVariation: "oneSize", density: "dense" }; break;
        case "hatched":  newStyle = { type: "hatched", hatchThickness: "thin", space: "close", jiggle: "none", rotate: "none", curve: "straight", length: "equal" }; break;
        default:         newStyle = { type: "solid" };
      }
      return { stroke: { ...s, style: newStyle } };
    });
  }, [updateAllPaths]);

  const handleStrokeCapChange = useCallback((cap: StrokeCap) => {
    updateAllPaths((_f, s) => s ? { stroke: { ...s, caps: cap } } : {});
  }, [updateAllPaths]);

  const handleStrokeJoinChange = useCallback((join: StrokeJoin) => {
    updateAllPaths((_f, s) => s ? { stroke: { ...s, joints: join } } : {});
  }, [updateAllPaths]);

  const handleMiterLimitChange = useCallback((v: number) => {
    updateAllPaths((_f, s) => s ? { stroke: { ...s, miterLimit: v } } : {});
  }, [updateAllPaths]);

  return (
    <div style={S.body}>
      {/* Fill */}
      <div style={S.fieldGroup}>
        <div style={{ opacity: hasFill ? 1 : 0.4, pointerEvents: hasFill ? "auto" : "none" }}>
          <ColorPicker
            color={fillHex}
            onChange={handleFillColorChange}
            label="Fill"
          />
        </div>
        <button
          style={{
            ...S.toggleBtn,
            background: hasFill ? "#333" : "#1a6ea8",
            color: hasFill ? "#999" : "#fff",
          }}
          onClick={handleFillNoneToggle}
          title={hasFill ? "Remove fill" : "Add fill"}
        >
          {hasFill ? "—" : "None"}
        </button>
      </div>

      <div style={S.separator} />

      {/* Stroke */}
      <div style={S.fieldGroup}>
        <div style={{ opacity: hasStroke ? 1 : 0.4, pointerEvents: hasStroke ? "auto" : "none" }}>
          <ColorPicker
            color={strokeHex}
            onChange={handleStrokeColorChange}
            label="Stroke"
          />
        </div>
        <button
          style={{
            ...S.toggleBtn,
            background: hasStroke ? "#333" : "#1a6ea8",
            color: hasStroke ? "#999" : "#fff",
          }}
          onClick={handleStrokeNoneToggle}
          title={hasStroke ? "Remove stroke" : "Add stroke"}
        >
          {hasStroke ? "—" : "None"}
        </button>
      </div>

      <div style={S.separator} />

      {/* Stroke weight */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Weight:</span>
        <NumInput
          value={strokeWeight}
          min={0.1}
          max={200}
          style={{ width: 40 }}
          onChange={handleStrokeWeightChange}
        />
        <span style={S.label}>px</span>
      </div>

      {hasStroke && (
        <>
          <div style={S.separator} />

          {/* Line style */}
          <div style={S.fieldGroup}>
            <span style={S.label}>Style:</span>
            <select
              style={S.select}
              value={strokeLineStyle}
              onChange={(e) => handleStrokeLineStyleChange(e.target.value as StrokeStyleType)}
            >
              {STROKE_LINE_STYLES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={S.separator} />

          {/* Cap style */}
          <div style={S.fieldGroup}>
            <span style={S.label}>Cap:</span>
            {CAP_OPTIONS.map(({ value, label, title }) => (
              <button
                key={value}
                style={{
                  ...S.toggleBtn,
                  background: strokeCaps === value ? "#1a6ea8" : "#333",
                  color: strokeCaps === value ? "#fff" : "#999",
                  fontFamily: "monospace",
                }}
                onClick={() => handleStrokeCapChange(value)}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={S.separator} />

          {/* Join style */}
          <div style={S.fieldGroup}>
            <span style={S.label}>Join:</span>
            {JOIN_OPTIONS.map(({ value, label, title }) => (
              <button
                key={value}
                style={{
                  ...S.toggleBtn,
                  background: strokeJoints === value ? "#1a6ea8" : "#333",
                  color: strokeJoints === value ? "#fff" : "#999",
                  fontFamily: "monospace",
                }}
                onClick={() => handleStrokeJoinChange(value)}
                title={title}
              >
                {label}
              </button>
            ))}
            {strokeJoints === "miter" && (
              <>
                <span style={S.label}>Limit:</span>
                <NumInput
                  value={strokeMiterLimit}
                  min={1}
                  max={60}
                  style={{ width: 36 }}
                  onChange={handleMiterLimitChange}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbol Instance view
// ---------------------------------------------------------------------------

const BLEND_MODES = [
  "normal", "layer", "multiply", "screen", "lighten", "darken",
  "difference", "add", "subtract", "invert", "alpha", "erase",
  "overlay", "hardlight",
] as const;

type BlendMode = typeof BLEND_MODES[number];

function InstanceView({
  obj,
  doc,
  onUpdateObject,
}: {
  obj: SymbolInstance;
  doc: FlashDocument;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
}): React.ReactElement {
  const libItem = doc.library.items.find((i) => i.id === obj.symbolId);
  const symbolName = libItem?.name ?? obj.symbolId;

  const [nameDraft, setNameDraft] = useState(obj.instanceName ?? "");
  useEffect(() => {
    setNameDraft(obj.instanceName ?? "");
  }, [obj.instanceName, obj.id]);

  const commitName = useCallback(() => {
    onUpdateObject(obj.id, { instanceName: nameDraft } as Partial<DisplayObject>);
  }, [obj.id, nameDraft, onUpdateObject]);

  const handleBlendChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onUpdateObject(obj.id, { blendMode: e.target.value as BlendMode } as Partial<DisplayObject>);
  }, [obj.id, onUpdateObject]);

  return (
    <div style={S.body}>
      {/* Symbol name (read-only) */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Symbol:</span>
        <span style={{ ...S.label, color: "#c0c0c0", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={symbolName}>
          {symbolName}
        </span>
      </div>

      <div style={S.separator} />

      {/* Instance name */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Name:</span>
        <input
          style={S.inputWide}
          value={nameDraft}
          placeholder="instance name"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitName(); }
            if (e.key === "Escape") { e.preventDefault(); setNameDraft(obj.instanceName ?? ""); }
          }}
        />
      </div>

      <div style={S.separator} />

      {/* Blend mode */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Blend:</span>
        <select
          style={S.selectWide}
          value={obj.blendMode ?? "normal"}
          onChange={handleBlendChange}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text view
// ---------------------------------------------------------------------------

const TEXT_TYPES: TextType[] = ["static", "dynamic", "input"];
const ALIGN_OPTIONS: TextAlign[] = ["left", "center", "right", "justify"];
const ALIGN_LABELS: Record<TextAlign, string> = { left: "L", center: "C", right: "R", justify: "J" };

function TextView({
  obj,
  onUpdateObject,
}: {
  obj: TextDisplayObject;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
}): React.ReactElement {
  const [fontDraft, setFontDraft] = useState(obj.fontFamily);
  useEffect(() => {
    setFontDraft(obj.fontFamily);
  }, [obj.fontFamily, obj.id]);

  const commitFont = useCallback(() => {
    if (fontDraft.trim()) {
      onUpdateObject(obj.id, { fontFamily: fontDraft.trim() } as Partial<DisplayObject>);
    } else {
      setFontDraft(obj.fontFamily);
    }
  }, [obj.id, obj.fontFamily, fontDraft, onUpdateObject]);

  const textColorHex = colorToHex(obj.color);

  return (
    <div style={S.body}>
      {/* Font family */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Font:</span>
        <input
          style={S.inputWide}
          value={fontDraft}
          onChange={(e) => setFontDraft(e.target.value)}
          onBlur={commitFont}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitFont(); }
            if (e.key === "Escape") { e.preventDefault(); setFontDraft(obj.fontFamily); }
          }}
        />
      </div>

      {/* Font size */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Size:</span>
        <NumInput
          value={obj.fontSize}
          min={1}
          max={500}
          style={{ width: 40 }}
          onChange={(v) => onUpdateObject(obj.id, { fontSize: Math.round(v) } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* Bold / Italic */}
      <div style={S.fieldGroup}>
        <button
          style={{
            ...S.toggleBtn,
            fontWeight: "bold",
            background: obj.bold ? "#1a6ea8" : "#333",
            color: obj.bold ? "#fff" : "#999",
          }}
          onClick={() => onUpdateObject(obj.id, { bold: !obj.bold } as Partial<DisplayObject>)}
          title="Bold"
        >
          B
        </button>
        <button
          style={{
            ...S.toggleBtn,
            fontStyle: "italic",
            background: obj.italic ? "#1a6ea8" : "#333",
            color: obj.italic ? "#fff" : "#999",
          }}
          onClick={() => onUpdateObject(obj.id, { italic: !obj.italic } as Partial<DisplayObject>)}
          title="Italic"
        >
          I
        </button>
      </div>

      <div style={S.separator} />

      {/* Color */}
      <div style={S.fieldGroup}>
        <ColorPicker
          color={textColorHex}
          onChange={(newColor) =>
            onUpdateObject(obj.id, { color: hexToColorLocal(newColor, obj.color.a) } as Partial<DisplayObject>)
          }
          label="Color"
        />
      </div>

      <div style={S.separator} />

      {/* Align */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Align:</span>
        {ALIGN_OPTIONS.map((a) => (
          <button
            key={a}
            style={{
              ...S.alignBtn,
              background: obj.align === a ? "#1a6ea8" : "#333",
              color: obj.align === a ? "#fff" : "#999",
            }}
            onClick={() => onUpdateObject(obj.id, { align: a } as Partial<DisplayObject>)}
            title={a}
          >
            {ALIGN_LABELS[a]}
          </button>
        ))}
      </div>

      <div style={S.separator} />

      {/* Type */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Type:</span>
        <select
          style={S.select}
          value={obj.textType}
          onChange={(e) =>
            onUpdateObject(obj.id, { textType: e.target.value as TextType } as Partial<DisplayObject>)
          }
        >
          {TEXT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PropertiesPanel
// ---------------------------------------------------------------------------

export function PropertiesPanel({
  doc,
  selectedObjects,
  onUpdateDocProperties,
  onUpdateObject,
}: PropertiesPanelProps): React.ReactElement {
  const view = getView(selectedObjects);

  let typeLabel = "Document";
  if (view === "shape") typeLabel = "Shape";
  else if (view === "instance") typeLabel = "Symbol Instance";
  else if (view === "text") typeLabel = "Text Field";
  else if (view === "mixed") typeLabel = "Mixed";

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.headerLabel}>Properties</span>
        <span style={S.headerType}>{typeLabel}</span>
      </div>

      {view === "document" && (
        <DocumentView doc={doc} onUpdateDocProperties={onUpdateDocProperties} />
      )}

      {view === "shape" && (
        <ShapeView
          obj={selectedObjects[0] as ShapeDisplayObject}
          onUpdateObject={onUpdateObject}
        />
      )}

      {view === "instance" && (
        <InstanceView
          obj={selectedObjects[0] as SymbolInstance}
          doc={doc}
          onUpdateObject={onUpdateObject}
        />
      )}

      {view === "text" && (
        <TextView
          obj={selectedObjects[0] as TextDisplayObject}
          onUpdateObject={onUpdateObject}
        />
      )}

      {view === "mixed" && (
        <div style={S.placeholder}>
          {selectedObjects.length} objects selected
        </div>
      )}
    </div>
  );
}
