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
  BitmapDisplayObject,
  ColorEffect,
  DisplayObject,
  DocumentProperties,
  EaseCurve,
  FlashDocument,
  Frame,
  GroupObject,
  LabelType,
  ShapeDisplayObject,
  SoundItem,
  SoundLinkage,
  SymbolInstance,
  TextDisplayObject,
  VideoDisplayObject,
  Fill,
  SolidStroke,
  StrokeCap,
  StrokeJoin,
  StrokeStyleType,
  Color,
  TextAlign,
  TextType,
  TweenType,
} from "@flash/core";
import { shapeBounds } from "@flash/core";
import { ColorPicker } from "./ColorPicker";
import { EaseCurveDialog } from "./EaseCurveDialog";

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
  /** The governing keyframe at the current cursor position (used for frame view). */
  currentFrame?: Frame | null;
  /** 0-based layer index of the active layer (used for frame view). */
  currentLayerIndex?: number;
  /** 0-based frame index of the current playhead position (used for frame view). */
  currentFrameIndex?: number;
  /** Callback to update frame properties. */
  onFrameUpdate?: (layerIndex: number, frameIndex: number, updates: Partial<Frame>) => void;
  /** Callback to swap the bitmap asset referenced by a BitmapDisplayObject. */
  onSwapBitmap?: (id: string) => void;
  /** Available sound items from the library (for frame sound section). */
  sounds?: SoundItem[];
  /** Callback to update the sound linkage for the current frame. */
  onSoundChange?: (frameIndex: number, layerIndex: number, sound: SoundLinkage | null) => void;
  /** Called when the user clicks "Ungroup" in the GroupView. */
  onUngroup?: () => void;
}

// ---------------------------------------------------------------------------
// View discriminator
// ---------------------------------------------------------------------------

type PanelView = "document" | "frame" | "shape" | "instance" | "text" | "bitmap" | "video" | "group" | "mixed";

function getView(selectedObjects: DisplayObject[]): PanelView {
  if (selectedObjects.length === 0) return "frame";
  if (selectedObjects.length > 1) return "mixed";
  const obj = selectedObjects[0];
  if (obj.type === "shape") return "shape";
  if (obj.type === "instance") return "instance";
  if (obj.type === "text") return "text";
  if (obj.type === "bitmap") return "bitmap";
  if (obj.type === "video") return "video";
  if (obj.type === "group") return "group";
  return "frame";
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
      {/* X / Y position */}
      <div style={S.fieldGroup}>
        <span style={S.label}>X:</span>
        <NumInput
          value={obj.x}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { x: v } as Partial<DisplayObject>)}
        />
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>Y:</span>
        <NumInput
          value={obj.y}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { y: v } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* Rotation */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Rot:</span>
        <NumInput
          value={obj.rotation ?? 0}
          min={-180}
          max={180}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { rotation: v } as Partial<DisplayObject>)}
        />
        <span style={S.label}>°</span>
      </div>

      <div style={S.separator} />

      {/* Scale X / Scale Y */}
      <div style={S.fieldGroup}>
        <span style={S.label}>SX:</span>
        <NumInput
          value={(obj.scaleX ?? 1) * 100}
          min={-9999}
          max={9999}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleX: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={S.label}>%</span>
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>SY:</span>
        <NumInput
          value={(obj.scaleY ?? 1) * 100}
          min={-9999}
          max={9999}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleY: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={S.label}>%</span>
      </div>

      {/* W / H pixel dimensions */}
      {(() => {
        const raw = shapeBounds(obj.shape, 0, 0);
        const displayW = raw.width * (obj.scaleX ?? 1);
        const displayH = raw.height * (obj.scaleY ?? 1);
        return (
          <>
            <div style={S.fieldGroup}>
              <span style={S.label}>W:</span>
              <NumInput
                value={Math.round(displayW * 100) / 100}
                min={0}
                style={{ width: 52 }}
                onChange={(v) => {
                  if (raw.width === 0) return;
                  onUpdateObject(obj.id, { scaleX: v / raw.width } as Partial<DisplayObject>);
                }}
              />
              <span style={S.label}>px</span>
            </div>
            <div style={S.fieldGroup}>
              <span style={S.label}>H:</span>
              <NumInput
                value={Math.round(displayH * 100) / 100}
                min={0}
                style={{ width: 52 }}
                onChange={(v) => {
                  if (raw.height === 0) return;
                  onUpdateObject(obj.id, { scaleY: v / raw.height } as Partial<DisplayObject>);
                }}
              />
              <span style={S.label}>px</span>
            </div>
          </>
        );
      })()}

      <div style={S.separator} />

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
  const [aspectLocked, setAspectLocked] = React.useState(true);
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

      {/* X / Y position */}
      <div style={S.fieldGroup}>
        <span style={S.label}>X:</span>
        <NumInput
          value={obj.x ?? 0}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { x: v } as Partial<DisplayObject>)}
        />
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>Y:</span>
        <NumInput
          value={obj.y ?? 0}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { y: v } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* W/H dimensions (editable, with aspect-lock) */}
      {(() => {
        const natW = obj.naturalWidth ?? 100;
        const natH = obj.naturalHeight ?? 100;
        const displayW = natW * (obj.scaleX ?? 1);
        const displayH = natH * (obj.scaleY ?? 1);
        return (
          <div style={S.fieldGroup}>
            <span style={S.label}>W:</span>
            <NumInput
              value={Math.round(displayW * 100) / 100}
              min={0}
              style={{ width: 52 }}
              onChange={(newW) => {
                const newScaleX = newW / natW;
                if (aspectLocked) {
                  const ratio = natW / natH;
                  const newScaleY = newScaleX / ratio;
                  onUpdateObject(obj.id, { scaleX: newScaleX, scaleY: newScaleY } as Partial<DisplayObject>);
                } else {
                  onUpdateObject(obj.id, { scaleX: newScaleX } as Partial<DisplayObject>);
                }
              }}
            />
            <button
              title={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              style={{
                ...S.toggleBtn,
                background: aspectLocked ? "#1a6ea8" : "#333",
                color: aspectLocked ? "#fff" : "#999",
                padding: "1px 4px",
                minWidth: 18,
              }}
              onClick={() => setAspectLocked((v) => !v)}
            >
              {aspectLocked ? "🔒" : "🔓"}
            </button>
            <span style={S.label}>H:</span>
            <NumInput
              value={Math.round(displayH * 100) / 100}
              min={0}
              style={{ width: 52 }}
              onChange={(newH) => {
                const newScaleY = newH / natH;
                if (aspectLocked) {
                  const ratio = natW / natH;
                  const newScaleX = newScaleY * ratio;
                  onUpdateObject(obj.id, { scaleX: newScaleX, scaleY: newScaleY } as Partial<DisplayObject>);
                } else {
                  onUpdateObject(obj.id, { scaleY: newScaleY } as Partial<DisplayObject>);
                }
              }}
            />
            <span style={S.label}>px</span>
          </div>
        );
      })()}

      <div style={S.separator} />

      {/* Rotation */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Rot:</span>
        <NumInput
          value={obj.rotation ?? 0}
          min={-180}
          max={180}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { rotation: v } as Partial<DisplayObject>)}
        />
        <span style={{ ...S.label, marginLeft: 2, color: "#a0a0a0" }}>°</span>
      </div>

      {/* ScaleX / ScaleY */}
      <div style={S.fieldGroup}>
        <span style={S.label}>ScX:</span>
        <NumInput
          value={Math.round((obj.scaleX ?? 1) * 100)}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleX: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={{ ...S.label, marginLeft: 2, color: "#a0a0a0" }}>%</span>
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>ScY:</span>
        <NumInput
          value={Math.round((obj.scaleY ?? 1) * 100)}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleY: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={{ ...S.label, marginLeft: 2, color: "#a0a0a0" }}>%</span>
      </div>

      {/* Visible */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Visible:</span>
        <input
          type="checkbox"
          checked={obj.visible !== false}
          onChange={(e) => onUpdateObject(obj.id, { visible: e.target.checked } as Partial<DisplayObject>)}
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

      <div style={S.separator} />

      {/* Loop mode (graphic symbols only) */}
      {(() => {
        const libItem2 = doc.library.items.find((i) => i.id === obj.symbolId);
        const isGraphic = libItem2?.itemType === "symbol" && libItem2.symbolType === "graphic";
        if (!isGraphic) return null;
        const loopMode = obj.loopMode ?? "loop";
        const firstFrameDisplay = (obj.firstFrame ?? 0) + 1;
        return (
          <>
            <div style={S.fieldGroup}>
              <span style={S.label}>Loop:</span>
              <select
                style={S.selectWide}
                value={loopMode}
                onChange={(e) => onUpdateObject(obj.id, { loopMode: e.target.value as SymbolInstance["loopMode"] } as Partial<DisplayObject>)}
              >
                <option value="loop">Loop</option>
                <option value="play-once">Play Once</option>
                <option value="single-frame">Single Frame</option>
              </select>
            </div>
            {loopMode === "single-frame" && (
              <div style={S.fieldGroup}>
                <span style={S.label}>Frame:</span>
                <NumInput
                  value={firstFrameDisplay}
                  min={1}
                  style={{ width: 52 }}
                  onChange={(v) => onUpdateObject(obj.id, { firstFrame: Math.max(0, v - 1) } as Partial<DisplayObject>)}
                />
              </div>
            )}
            <div style={S.separator} />
          </>
        );
      })()}

      {/* Color Effect */}
      <ColorEffectSection obj={obj} onUpdateObject={onUpdateObject} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color Effect section (used inside InstanceView)
// ---------------------------------------------------------------------------

type ColorEffectType = "none" | "brightness" | "tint" | "alpha" | "advanced";

const COLOR_EFFECT_OPTIONS: { value: ColorEffectType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "brightness", label: "Brightness" },
  { value: "tint", label: "Tint" },
  { value: "alpha", label: "Alpha" },
  { value: "advanced", label: "Advanced" },
];

function ColorEffectSection({
  obj,
  onUpdateObject,
}: {
  obj: SymbolInstance;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
}): React.ReactElement {
  const effectType: ColorEffectType = obj.colorEffect?.type ?? "none";

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.target.value as ColorEffectType;
    if (newType === "none") {
      onUpdateObject(obj.id, { colorEffect: undefined } as Partial<DisplayObject>);
    } else if (newType === "brightness") {
      onUpdateObject(obj.id, { colorEffect: { type: "brightness", brightness: 0 } } as Partial<DisplayObject>);
    } else if (newType === "tint") {
      onUpdateObject(obj.id, { colorEffect: { type: "tint", tintColor: "#ff0000", tintAmount: 100 } } as Partial<DisplayObject>);
    } else if (newType === "alpha") {
      onUpdateObject(obj.id, { colorEffect: { type: "alpha", alpha: 100 } } as Partial<DisplayObject>);
    } else if (newType === "advanced") {
      onUpdateObject(obj.id, { colorEffect: { type: "advanced", redMult: 100, greenMult: 100, blueMult: 100, redOffset: 0, greenOffset: 0, blueOffset: 0 } } as Partial<DisplayObject>);
    }
  }, [obj.id, onUpdateObject]);

  const updateEffect = useCallback((patch: Partial<ColorEffect>) => {
    const current = obj.colorEffect ?? { type: effectType as ColorEffect["type"] };
    onUpdateObject(obj.id, { colorEffect: { ...current, ...patch } } as Partial<DisplayObject>);
  }, [obj.id, obj.colorEffect, effectType, onUpdateObject]);

  return (
    <>
      {/* Color Effect type dropdown */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Color:</span>
        <select
          style={S.selectWide}
          value={effectType}
          onChange={handleTypeChange}
        >
          {COLOR_EFFECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Brightness controls */}
      {effectType === "brightness" && (
        <div style={S.fieldGroup}>
          <span style={S.label}>Bright:</span>
          <NumInput
            value={obj.colorEffect?.brightness ?? 0}
            min={-100}
            max={100}
            style={{ width: 52 }}
            onChange={(v) => updateEffect({ brightness: Math.round(v) })}
          />
          <span style={S.label}>%</span>
        </div>
      )}

      {/* Tint controls */}
      {effectType === "tint" && (
        <>
          <div style={S.fieldGroup}>
            <span style={S.label}>Tint:</span>
            <input
              type="color"
              style={{ ...S.colorSwatch, width: 28, height: 18 }}
              value={obj.colorEffect?.tintColor ?? "#ff0000"}
              onChange={(e) => updateEffect({ tintColor: e.target.value })}
            />
          </div>
          <div style={S.fieldGroup}>
            <span style={S.label}>Amt:</span>
            <NumInput
              value={obj.colorEffect?.tintAmount ?? 100}
              min={0}
              max={100}
              style={{ width: 52 }}
              onChange={(v) => updateEffect({ tintAmount: Math.round(v) })}
            />
            <span style={S.label}>%</span>
          </div>
        </>
      )}

      {/* Alpha controls */}
      {effectType === "alpha" && (
        <div style={S.fieldGroup}>
          <span style={S.label}>Alpha:</span>
          <NumInput
            value={obj.colorEffect?.alpha ?? 100}
            min={0}
            max={100}
            style={{ width: 52 }}
            onChange={(v) => updateEffect({ alpha: Math.round(v) })}
          />
          <span style={S.label}>%</span>
        </div>
      )}

      {/* Advanced controls */}
      {effectType === "advanced" && (
        <>
          <div style={S.fieldGroup}>
            <span style={S.label}>R×:</span>
            <NumInput value={obj.colorEffect?.redMult ?? 100} min={-100} max={100} style={{ width: 44 }}
              onChange={(v) => updateEffect({ redMult: Math.round(v) })} />
            <span style={S.label}>R+:</span>
            <NumInput value={obj.colorEffect?.redOffset ?? 0} min={-255} max={255} style={{ width: 44 }}
              onChange={(v) => updateEffect({ redOffset: Math.round(v) })} />
          </div>
          <div style={S.fieldGroup}>
            <span style={S.label}>G×:</span>
            <NumInput value={obj.colorEffect?.greenMult ?? 100} min={-100} max={100} style={{ width: 44 }}
              onChange={(v) => updateEffect({ greenMult: Math.round(v) })} />
            <span style={S.label}>G+:</span>
            <NumInput value={obj.colorEffect?.greenOffset ?? 0} min={-255} max={255} style={{ width: 44 }}
              onChange={(v) => updateEffect({ greenOffset: Math.round(v) })} />
          </div>
          <div style={S.fieldGroup}>
            <span style={S.label}>B×:</span>
            <NumInput value={obj.colorEffect?.blueMult ?? 100} min={-100} max={100} style={{ width: 44 }}
              onChange={(v) => updateEffect({ blueMult: Math.round(v) })} />
            <span style={S.label}>B+:</span>
            <NumInput value={obj.colorEffect?.blueOffset ?? 0} min={-255} max={255} style={{ width: 44 }}
              onChange={(v) => updateEffect({ blueOffset: Math.round(v) })} />
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Text view
// ---------------------------------------------------------------------------

const TEXT_TYPES: TextType[] = ["static", "dynamic", "input"];
const ALIGN_OPTIONS: TextAlign[] = ["left", "center", "right", "justify"];
const ALIGN_LABELS: Record<TextAlign, string> = { left: "L", center: "C", right: "R", justify: "J" };

type AntiAliasMode = "device" | "bitmap" | "animation" | "readability" | "custom";
const ANTI_ALIAS_OPTIONS: AntiAliasMode[] = ["device", "bitmap", "animation", "readability", "custom"];
const ANTI_ALIAS_LABELS: Record<AntiAliasMode, string> = {
  device: "Use device fonts",
  bitmap: "Bitmap (no anti-alias)",
  animation: "Anti-alias for animation",
  readability: "Anti-alias for readability",
  custom: "Custom anti-alias",
};

/** Common Flash 8 / web-safe fonts used as fallbacks when no system fonts are available. */
export const DEFAULT_FONTS: string[] = [
  "Arial",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Georgia",
  "Comic Sans MS",
  "_sans",
  "_serif",
  "_typewriter",
];

/** Returns a sorted list of available font families from the browser/system. */
export function useFontList(): string[] {
  const [fonts, setFonts] = React.useState<string[]>([]);
  useEffect(() => {
    if (typeof document === "undefined") {
      setFonts(DEFAULT_FONTS);
      return;
    }
    const families = new Set<string>();
    try {
      document.fonts.forEach((font) => families.add(font.family));
    } catch {
      // CSS Font Loading API not available
    }
    if ("queryLocalFonts" in window) {
      (window as any)
        .queryLocalFonts()
        .then((localFonts: any[]) => {
          localFonts.forEach((f) => families.add(f.family));
          const all = Array.from(families).sort();
          setFonts(all.length > 0 ? all : DEFAULT_FONTS);
        })
        .catch(() => {
          const all = Array.from(families).sort();
          setFonts(all.length > 0 ? all : DEFAULT_FONTS);
        });
    } else {
      const all = Array.from(families).sort();
      setFonts(all.length > 0 ? all : DEFAULT_FONTS);
    }
  }, []);
  return fonts;
}

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
  const fontList = useFontList();

  const [instanceNameDraft, setInstanceNameDraft] = useState(obj.instanceName ?? "");
  useEffect(() => {
    setInstanceNameDraft(obj.instanceName ?? "");
  }, [obj.instanceName, obj.id]);

  const commitFont = useCallback(() => {
    if (fontDraft.trim()) {
      onUpdateObject(obj.id, { fontFamily: fontDraft.trim() } as Partial<DisplayObject>);
    } else {
      setFontDraft(obj.fontFamily);
    }
  }, [obj.id, obj.fontFamily, fontDraft, onUpdateObject]);

  const commitInstanceName = useCallback(() => {
    onUpdateObject(obj.id, { instanceName: instanceNameDraft } as Partial<DisplayObject>);
  }, [obj.id, instanceNameDraft, onUpdateObject]);

  const textColorHex = colorToHex(obj.color);
  const isNotStatic = obj.textType !== "static";

  return (
    <div style={S.body}>
      {/* Instance name (dynamic/input only) */}
      {isNotStatic && (
        <>
          <div style={S.fieldGroup}>
            <span style={S.label}>Name:</span>
            <input
              style={S.inputWide}
              value={instanceNameDraft}
              placeholder="instance name"
              onChange={(e) => setInstanceNameDraft(e.target.value)}
              onBlur={commitInstanceName}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitInstanceName(); }
                if (e.key === "Escape") { e.preventDefault(); setInstanceNameDraft(obj.instanceName ?? ""); }
              }}
            />
          </div>
          <div style={S.separator} />
        </>
      )}

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
          list="font-list-datalist"
        />
        <datalist id="font-list-datalist">
          {fontList.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
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

      {/* Bold / Italic / Underline */}
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
        <button
          style={{
            ...S.toggleBtn,
            textDecoration: "underline",
            background: obj.underline ? "#1a6ea8" : "#333",
            color: obj.underline ? "#fff" : "#999",
          }}
          onClick={() => onUpdateObject(obj.id, { underline: !obj.underline } as Partial<DisplayObject>)}
          title="Underline"
        >
          U
        </button>
      </div>

      <div style={S.separator} />

      {/* Letter spacing */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Spacing:</span>
        <NumInput
          value={obj.letterSpacing ?? 0}
          min={-60}
          max={60}
          style={{ width: 40 }}
          onChange={(v) => onUpdateObject(obj.id, { letterSpacing: v } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* Leading */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Leading:</span>
        <NumInput
          value={obj.leading ?? 0}
          min={0}
          max={999}
          style={{ width: 40 }}
          onChange={(v) => onUpdateObject(obj.id, { leading: Math.round(v) } as Partial<DisplayObject>)}
        />
        <span style={S.label}>px</span>
      </div>

      <div style={S.separator} />

      {/* Left Margin / Right Margin */}
      <div style={S.fieldGroup}>
        <span style={S.label}>L Margin:</span>
        <NumInput
          value={obj.leftMargin ?? 0}
          min={0}
          max={720}
          style={{ width: 40 }}
          onChange={(v) => onUpdateObject(obj.id, { leftMargin: Math.round(v) } as Partial<DisplayObject>)}
        />
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>R Margin:</span>
        <NumInput
          value={obj.rightMargin ?? 0}
          min={0}
          max={720}
          style={{ width: 40 }}
          onChange={(v) => onUpdateObject(obj.id, { rightMargin: Math.round(v) } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* Indent */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Indent:</span>
        <NumInput
          value={obj.indent ?? 0}
          min={0}
          max={720}
          style={{ width: 40 }}
          onChange={(v) => onUpdateObject(obj.id, { indent: Math.round(v) } as Partial<DisplayObject>)}
        />
        <span style={S.label}>px</span>
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

      {/* Word Wrap */}
      <div style={S.fieldGroup}>
        <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={obj.wordWrap}
            onChange={(e) => onUpdateObject(obj.id, { wordWrap: e.target.checked } as Partial<DisplayObject>)}
          />
          Wrap
        </label>
      </div>

      {/* Multiline (dynamic/input only) */}
      {isNotStatic && (
        <div style={S.fieldGroup}>
          <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.multiline}
              onChange={(e) => onUpdateObject(obj.id, { multiline: e.target.checked } as Partial<DisplayObject>)}
            />
            Multiline
          </label>
        </div>
      )}

      {/* Scrollable (dynamic/input only) */}
      {isNotStatic && (
        <div style={S.fieldGroup}>
          <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.scrollable ?? false}
              onChange={(e) => onUpdateObject(obj.id, { scrollable: e.target.checked } as Partial<DisplayObject>)}
            />
            Scroll
          </label>
        </div>
      )}

      {/* Input-only properties: password, maxChars, hasBorder, hasBackground */}
      {obj.textType === "input" && (
        <>
          <div style={S.fieldGroup}>
            <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={obj.password ?? false}
                onChange={(e) => onUpdateObject(obj.id, { password: e.target.checked } as Partial<DisplayObject>)}
              />
              Password
            </label>
          </div>

          <div style={S.fieldGroup}>
            <span style={S.label}>Max Chars:</span>
            <NumInput
              value={obj.maxChars ?? 0}
              min={0}
              max={65535}
              style={{ width: 52 }}
              onChange={(v) => onUpdateObject(obj.id, { maxChars: Math.max(0, Math.round(v)) } as Partial<DisplayObject>)}
            />
          </div>

          <div style={S.fieldGroup}>
            <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={obj.hasBorder ?? false}
                onChange={(e) => onUpdateObject(obj.id, { hasBorder: e.target.checked } as Partial<DisplayObject>)}
              />
              Border
            </label>
          </div>

          <div style={S.fieldGroup}>
            <label style={{ ...S.label, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={obj.hasBackground ?? false}
                onChange={(e) => onUpdateObject(obj.id, { hasBackground: e.target.checked } as Partial<DisplayObject>)}
              />
              Background
            </label>
          </div>
        </>
      )}

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

      <div style={S.separator} />

      {/* Anti-alias mode */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Anti-alias:</span>
        <select
          style={{ ...S.select, maxWidth: 160 }}
          value={obj.antiAlias ?? "animation"}
          onChange={(e) =>
            onUpdateObject(obj.id, { antiAlias: e.target.value as AntiAliasMode } as Partial<DisplayObject>)
          }
        >
          {ANTI_ALIAS_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {ANTI_ALIAS_LABELS[m]}
            </option>
          ))}
        </select>
      </div>

      {/* Custom CSM sharpness/thickness — only shown when antiAlias === "custom" */}
      {(obj.antiAlias === "custom") && (
        <>
          <div style={S.fieldGroup}>
            <span style={S.label}>Sharpness:</span>
            <NumInput
              value={obj.csm?.sharpness ?? 0}
              min={-400}
              max={400}
              style={{ width: 48 }}
              onChange={(v) =>
                onUpdateObject(obj.id, {
                  csm: { sharpness: v, thickness: obj.csm?.thickness ?? 0 },
                } as Partial<DisplayObject>)
              }
            />
          </div>
          <div style={S.fieldGroup}>
            <span style={S.label}>Thickness:</span>
            <NumInput
              value={obj.csm?.thickness ?? 0}
              min={0}
              max={200}
              style={{ width: 48 }}
              onChange={(v) =>
                onUpdateObject(obj.id, {
                  csm: { sharpness: obj.csm?.sharpness ?? 0, thickness: v },
                } as Partial<DisplayObject>)
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bitmap view
// ---------------------------------------------------------------------------

function BitmapView({
  obj,
  doc,
  onUpdateObject,
  onSwapBitmap,
}: {
  obj: BitmapDisplayObject;
  doc: FlashDocument;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
  onSwapBitmap?: (id: string) => void;
}): React.ReactElement {
  const libItem = doc.library.items.find((i) => i.id === obj.libraryItemId && i.itemType === "bitmap");
  const bitmapName = libItem?.name ?? obj.libraryItemId;

  const [nameDraft, setNameDraft] = useState((obj as BitmapDisplayObject & { instanceName?: string }).instanceName ?? "");
  useEffect(() => {
    setNameDraft((obj as BitmapDisplayObject & { instanceName?: string }).instanceName ?? "");
  }, [(obj as BitmapDisplayObject & { instanceName?: string }).instanceName, obj.id]);

  const commitName = useCallback(() => {
    onUpdateObject(obj.id, { instanceName: nameDraft } as Partial<DisplayObject>);
  }, [obj.id, nameDraft, onUpdateObject]);

  return (
    <div style={S.body}>
      {/* Bitmap name (read-only) */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Bitmap:</span>
        <span
          style={{ ...S.label, color: "#c0c0c0", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={bitmapName}
        >
          {bitmapName}
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
            if (e.key === "Escape") {
              e.preventDefault();
              setNameDraft((obj as BitmapDisplayObject & { instanceName?: string }).instanceName ?? "");
            }
          }}
        />
      </div>

      <div style={S.separator} />

      {/* X / Y */}
      <div style={S.fieldGroup}>
        <span style={S.label}>X:</span>
        <NumInput
          value={obj.x}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { x: v } as Partial<DisplayObject>)}
        />
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>Y:</span>
        <NumInput
          value={obj.y}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { y: v } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* W / H (read-only — display size) */}
      <div style={S.fieldGroup}>
        <span style={S.label}>W:</span>
        <span style={{ ...S.label, color: "#c0c0c0", width: 44, textAlign: "right" }}>
          {Math.round(obj.width * (obj.scaleX ?? 1))}
        </span>
        <span style={{ ...S.label, marginLeft: 8 }}>H:</span>
        <span style={{ ...S.label, color: "#c0c0c0", width: 44, textAlign: "right" }}>
          {Math.round(obj.height * (obj.scaleY ?? 1))}
        </span>
      </div>

      <div style={S.separator} />

      {/* Rotation */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Rot:</span>
        <NumInput
          value={obj.rotation ?? 0}
          min={-180}
          max={180}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { rotation: v } as Partial<DisplayObject>)}
        />
        <span style={S.label}>°</span>
      </div>

      <div style={S.separator} />

      {/* Scale X / Scale Y */}
      <div style={S.fieldGroup}>
        <span style={S.label}>SX:</span>
        <NumInput
          value={(obj.scaleX ?? 1) * 100}
          min={-9999}
          max={9999}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleX: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={S.label}>%</span>
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>SY:</span>
        <NumInput
          value={(obj.scaleY ?? 1) * 100}
          min={-9999}
          max={9999}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleY: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={S.label}>%</span>
      </div>

      <div style={S.separator} />

      {/* Swap Bitmap */}
      {onSwapBitmap && (
        <div style={S.fieldGroup}>
          <button
            style={{
              ...S.toggleBtn,
              background: "#333",
              color: "#c0c0c0",
              border: "1px solid #555",
              padding: "2px 8px",
            }}
            onClick={() => onSwapBitmap(obj.id)}
            title="Choose a different bitmap from the library"
          >
            Swap Bitmap…
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Video view
// ---------------------------------------------------------------------------

function VideoView({
  obj,
  doc,
  onUpdateObject,
}: {
  obj: VideoDisplayObject;
  doc: FlashDocument;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
}): React.ReactElement {
  const libItem = doc.library.items.find((i) => i.id === obj.videoItemId && i.itemType === "video");
  const videoName = libItem?.name ?? obj.videoItemId;

  const [nameDraft, setNameDraft] = useState((obj as VideoDisplayObject & { instanceName?: string }).instanceName ?? "");
  useEffect(() => {
    setNameDraft((obj as VideoDisplayObject & { instanceName?: string }).instanceName ?? "");
  }, [(obj as VideoDisplayObject & { instanceName?: string }).instanceName, obj.id]);

  const commitName = useCallback(() => {
    onUpdateObject(obj.id, { instanceName: nameDraft } as Partial<DisplayObject>);
  }, [obj.id, nameDraft, onUpdateObject]);

  return (
    <div style={S.body}>
      {/* Video name (read-only) */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Video:</span>
        <span
          style={{ ...S.label, color: "#c0c0c0", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={videoName}
        >
          {videoName}
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
            if (e.key === "Escape") {
              e.preventDefault();
              setNameDraft((obj as VideoDisplayObject & { instanceName?: string }).instanceName ?? "");
            }
          }}
        />
      </div>

      <div style={S.separator} />

      {/* X / Y */}
      <div style={S.fieldGroup}>
        <span style={S.label}>X:</span>
        <NumInput
          value={obj.x}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { x: v } as Partial<DisplayObject>)}
        />
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>Y:</span>
        <NumInput
          value={obj.y}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { y: v } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* W / H (read-only) */}
      <div style={S.fieldGroup}>
        <span style={S.label}>W:</span>
        <span style={{ ...S.label, color: "#c0c0c0", width: 44, textAlign: "right" }}>
          {Math.round(obj.width * (obj.scaleX ?? 1))}
        </span>
        <span style={{ ...S.label, marginLeft: 8 }}>H:</span>
        <span style={{ ...S.label, color: "#c0c0c0", width: 44, textAlign: "right" }}>
          {Math.round(obj.height * (obj.scaleY ?? 1))}
        </span>
      </div>

      <div style={S.separator} />

      {/* Rotation */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Rot:</span>
        <NumInput
          value={obj.rotation ?? 0}
          min={-180}
          max={180}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { rotation: v } as Partial<DisplayObject>)}
        />
        <span style={S.label}>°</span>
      </div>

      <div style={S.separator} />

      {/* Scale X / Scale Y */}
      <div style={S.fieldGroup}>
        <span style={S.label}>SX:</span>
        <NumInput
          value={(obj.scaleX ?? 1) * 100}
          min={-9999}
          max={9999}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleX: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={S.label}>%</span>
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>SY:</span>
        <NumInput
          value={(obj.scaleY ?? 1) * 100}
          min={-9999}
          max={9999}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { scaleY: v / 100 } as Partial<DisplayObject>)}
        />
        <span style={S.label}>%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame view
// ---------------------------------------------------------------------------

const LABEL_TYPES: { value: LabelType; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "comment", label: "Comment" },
  { value: "anchor", label: "Anchor" },
];

const TWEEN_TYPES: { value: TweenType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "motion", label: "Motion" },
  { value: "shape", label: "Shape" },
];

const ROTATE_MODES: { value: "none" | "auto" | "cw" | "ccw"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "cw", label: "CW" },
  { value: "ccw", label: "CCW" },
  { value: "none", label: "None" },
];

const DEFAULT_EASE_CURVE: EaseCurve = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };

// ---------------------------------------------------------------------------
// Frame Sound Section
// ---------------------------------------------------------------------------

type SyncMode = SoundLinkage["syncMode"];

const SYNC_MODES: { value: SyncMode; label: string }[] = [
  { value: "event", label: "Event" },
  { value: "start", label: "Start" },
  { value: "stop", label: "Stop" },
  { value: "stream", label: "Stream" },
];

function FrameSoundSection({
  frame,
  layerIndex,
  frameIndex,
  sounds,
  onSoundChange,
}: {
  frame: Frame;
  layerIndex: number;
  frameIndex: number;
  sounds: SoundItem[];
  onSoundChange: (frameIndex: number, layerIndex: number, sound: SoundLinkage | null) => void;
}): React.ReactElement {
  const sound = frame.sound ?? null;
  const selectedSoundId = sound?.libraryItemId ?? "";
  const syncMode: SyncMode = sound?.syncMode ?? "event";
  const repeatCount: number = sound?.repeatCount ?? 1;

  const handleSoundSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      if (!id) {
        onSoundChange(frameIndex, layerIndex, null);
      } else {
        onSoundChange(frameIndex, layerIndex, {
          libraryItemId: id,
          syncMode: sound?.syncMode ?? "event",
          repeatCount: sound?.repeatCount ?? 1,
          effect: sound?.effect ?? "none",
        });
      }
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  const handleSyncChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!sound) return;
      onSoundChange(frameIndex, layerIndex, { ...sound, syncMode: e.target.value as SyncMode });
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  const handleRepeatChange = useCallback(
    (v: number) => {
      if (!sound) return;
      onSoundChange(frameIndex, layerIndex, { ...sound, repeatCount: Math.max(0, Math.round(v)) });
    },
    [frameIndex, layerIndex, sound, onSoundChange]
  );

  return (
    <>
      <div style={S.separator} />

      {/* Sound name */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Sound:</span>
        <select
          style={{ ...S.select, minWidth: 90 }}
          value={selectedSoundId}
          onChange={handleSoundSelect}
        >
          <option value="">None</option>
          {sounds.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sync + repeat — only when a sound is selected */}
      {sound && (
        <>
          <div style={S.separator} />

          <div style={S.fieldGroup}>
            <span style={S.label}>Sync:</span>
            <select
              style={S.select}
              value={syncMode}
              onChange={handleSyncChange}
            >
              {SYNC_MODES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={S.separator} />

          <div style={S.fieldGroup}>
            <span style={S.label}>Repeat:</span>
            <NumInput
              value={repeatCount}
              min={0}
              max={9999}
              style={{ width: 44 }}
              onChange={handleRepeatChange}
            />
            <span style={{ ...S.label, fontSize: "10px" }}>0=loop</span>
          </div>
        </>
      )}
    </>
  );
}

function FrameView({
  frame,
  layerIndex,
  frameIndex,
  onFrameUpdate,
  sounds,
  onSoundChange,
}: {
  frame: Frame | null | undefined;
  layerIndex: number;
  frameIndex: number;
  onFrameUpdate?: (layerIndex: number, frameIndex: number, updates: Partial<Frame>) => void;
  sounds?: SoundItem[];
  onSoundChange?: (frameIndex: number, layerIndex: number, sound: SoundLinkage | null) => void;
}): React.ReactElement {
  const label = frame?.label ?? "";
  const labelType: LabelType = frame?.labelType ?? "name";
  const tweenType: TweenType = frame?.tweenType ?? "none";
  const motionEase = frame?.motionEase ?? 0;
  const motionEaseCurve = frame?.motionEaseCurve ?? null;
  const motionRotate = frame?.motionRotate ?? "auto";
  const motionRotateCount = frame?.motionRotateCount ?? 0;

  const [labelDraft, setLabelDraft] = useState(label);
  const [showEaseCurveDialog, setShowEaseCurveDialog] = useState(false);
  useEffect(() => {
    setLabelDraft(frame?.label ?? "");
  }, [frame?.label, layerIndex, frameIndex]);

  const commitLabel = useCallback(() => {
    if (!frame) return;
    onFrameUpdate?.(layerIndex, frameIndex, { label: labelDraft });
  }, [frame, layerIndex, frameIndex, labelDraft, onFrameUpdate]);

  const isMotion = tweenType === "motion";

  if (!frame) {
    return (
      <div style={S.body}>
        <span style={S.placeholder}>No keyframe at current position</span>
      </div>
    );
  }

  return (
    <div style={S.body}>
      {/* Frame label */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Label:</span>
        <input
          style={S.inputWide}
          value={labelDraft}
          placeholder="frame label"
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitLabel(); }
            if (e.key === "Escape") { e.preventDefault(); setLabelDraft(frame.label); }
          }}
        />
      </div>

      {/* Label type */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Type:</span>
        <select
          style={S.select}
          value={labelType}
          onChange={(e) => onFrameUpdate?.(layerIndex, frameIndex, { labelType: e.target.value as LabelType })}
        >
          {LABEL_TYPES.map(({ value, label: lbl }) => (
            <option key={value} value={value}>{lbl}</option>
          ))}
        </select>
      </div>

      <div style={S.separator} />

      {/* Tween type */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Tween:</span>
        <select
          style={S.selectWide}
          value={tweenType}
          onChange={(e) => onFrameUpdate?.(layerIndex, frameIndex, { tweenType: e.target.value as TweenType })}
        >
          {TWEEN_TYPES.map(({ value, label: lbl }) => (
            <option key={value} value={value}>{lbl}</option>
          ))}
        </select>
      </div>

      {/* Motion tween fields */}
      {isMotion && (
        <>
          <div style={S.separator} />

          {/* Ease */}
          <div style={S.fieldGroup}>
            <span style={S.label}>Ease:</span>
            <NumInput
              value={motionEase}
              min={-100}
              max={100}
              style={{ width: 46 }}
              onChange={(v) => onFrameUpdate?.(layerIndex, frameIndex, { motionEase: Math.round(v) })}
            />
            <button
              style={{
                ...S.toggleBtn,
                background: motionEaseCurve ? "#225522" : "#333",
                color: motionEaseCurve ? "#88ee88" : "#888",
                fontSize: "10px",
                padding: "1px 4px",
                border: `1px solid ${motionEaseCurve ? "#44aa44" : "#444"}`,
              }}
              onClick={() => setShowEaseCurveDialog(true)}
              title="Open custom ease curve editor"
            >
              Custom…
            </button>
          </div>

          <div style={S.separator} />

          {/* Rotate mode */}
          <div style={S.fieldGroup}>
            <span style={S.label}>Rotate:</span>
            <select
              style={S.select}
              value={motionRotate}
              onChange={(e) =>
                onFrameUpdate?.(layerIndex, frameIndex, { motionRotate: e.target.value as "none" | "auto" | "cw" | "ccw" })
              }
            >
              {ROTATE_MODES.map(({ value, label: lbl }) => (
                <option key={value} value={value}>{lbl}</option>
              ))}
            </select>
          </div>

          {/* Rotate count (when explicit CW or CCW) */}
          {(motionRotate === "cw" || motionRotate === "ccw") && (
            <div style={S.fieldGroup}>
              <span style={S.label}>×</span>
              <NumInput
                value={motionRotateCount}
                min={0}
                max={99}
                style={{ width: 36 }}
                onChange={(v) => onFrameUpdate?.(layerIndex, frameIndex, { motionRotateCount: Math.round(v) })}
              />
            </div>
          )}
        </>
      )}

      {/* Custom ease curve dialog */}
      {showEaseCurveDialog && (
        <EaseCurveDialog
          initialCurve={motionEaseCurve ?? DEFAULT_EASE_CURVE}
          onConfirm={(curve) => {
            onFrameUpdate?.(layerIndex, frameIndex, { motionEaseCurve: curve });
          }}
          onClose={() => setShowEaseCurveDialog(false)}
        />
      )}

      {/* Sound section — always shown so user can assign/clear sounds */}
      {sounds && onSoundChange && (
        <FrameSoundSection
          frame={frame}
          layerIndex={layerIndex}
          frameIndex={frameIndex}
          sounds={sounds}
          onSoundChange={onSoundChange}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroupView
// ---------------------------------------------------------------------------

function GroupView({
  obj,
  onUpdateObject,
  onUngroup,
}: {
  obj: GroupObject;
  onUpdateObject: (id: string, changes: Partial<DisplayObject>) => void;
  onUngroup?: () => void;
}): React.ReactElement {
  // Compute the bounding box of all children relative to the group origin.
  let totalW = 0;
  let totalH = 0;
  if (obj.children.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expandBounds = (x: number, y: number, w: number, h: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    };
    for (const child of obj.children) {
      if (child.type === "shape" || child.type === "drawing-object") {
        const bounds = shapeBounds(child.shape, child.x, child.y);
        expandBounds(bounds.x, bounds.y, bounds.width, bounds.height);
      } else if ("x" in child && "y" in child) {
        // SymbolInstance, BitmapDisplayObject, TextDisplayObject, VideoDisplayObject, nested GroupObject
        const w = ("width" in child ? (child.width as number) : 0) * (("scaleX" in child ? (child.scaleX as number) : null) ?? 1);
        const h = ("height" in child ? (child.height as number) : 0) * (("scaleY" in child ? (child.scaleY as number) : null) ?? 1);
        expandBounds(child.x, child.y, w, h);
      }
    }
    if (isFinite(minX)) {
      totalW = Math.max(0, maxX - minX);
      totalH = Math.max(0, maxY - minY);
    }
  }

  return (
    <div style={S.body}>
      {/* Type indicator */}
      <div style={S.fieldGroup}>
        <span style={S.label}>Type:</span>
        <span style={{ ...S.label, color: "#c0c0c0" }}>Group</span>
        <span style={{ ...S.label, color: "#888", marginLeft: 4 }}>
          ({obj.children.length} item{obj.children.length !== 1 ? "s" : ""})
        </span>
      </div>

      <div style={S.separator} />

      {/* X / Y */}
      <div style={S.fieldGroup}>
        <span style={S.label}>X:</span>
        <NumInput
          value={obj.x}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { x: v } as Partial<DisplayObject>)}
        />
      </div>
      <div style={S.fieldGroup}>
        <span style={S.label}>Y:</span>
        <NumInput
          value={obj.y}
          style={{ width: 52 }}
          onChange={(v) => onUpdateObject(obj.id, { y: v } as Partial<DisplayObject>)}
        />
      </div>

      <div style={S.separator} />

      {/* W / H (read-only — derived from children bounds) */}
      <div style={S.fieldGroup}>
        <span style={S.label}>W:</span>
        <span style={{ ...S.label, color: "#c0c0c0", width: 44, textAlign: "right" }}>
          {Math.round(totalW)}
        </span>
        <span style={{ ...S.label, marginLeft: 8 }}>H:</span>
        <span style={{ ...S.label, color: "#c0c0c0", width: 44, textAlign: "right" }}>
          {Math.round(totalH)}
        </span>
      </div>

      <div style={S.separator} />

      {/* Ungroup button */}
      <div style={S.fieldGroup}>
        <button
          style={{
            ...S.toggleBtn,
            background: "#333",
            color: "#c0c0c0",
            border: "1px solid #555",
            padding: "2px 8px",
          }}
          onClick={() => onUngroup?.()}
          title="Break apart the group (Ctrl+Shift+G)"
        >
          Ungroup
        </button>
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
  currentFrame: currentFrameProp,
  currentLayerIndex = 0,
  currentFrameIndex = 0,
  onFrameUpdate,
  onSwapBitmap,
  sounds,
  onSoundChange,
  onUngroup,
}: PropertiesPanelProps): React.ReactElement {
  const view = getView(selectedObjects);

  let typeLabel = "Frame";
  if (view === "document") typeLabel = "Document";
  else if (view === "shape") typeLabel = "Shape";
  else if (view === "instance") typeLabel = "Symbol Instance";
  else if (view === "text") typeLabel = "Text Field";
  else if (view === "bitmap") typeLabel = "Bitmap";
  else if (view === "video") typeLabel = "Video";
  else if (view === "group") typeLabel = "Group";
  else if (view === "mixed") typeLabel = "Mixed";

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.headerLabel}>Properties</span>
        <span style={S.headerType}>{typeLabel}</span>
      </div>

      {view === "frame" && (
        <FrameView
          frame={currentFrameProp}
          layerIndex={currentLayerIndex}
          frameIndex={currentFrameIndex}
          onFrameUpdate={onFrameUpdate}
          sounds={sounds}
          onSoundChange={onSoundChange}
        />
      )}

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

      {view === "bitmap" && (
        <BitmapView
          obj={selectedObjects[0] as BitmapDisplayObject}
          doc={doc}
          onUpdateObject={onUpdateObject}
          onSwapBitmap={onSwapBitmap}
        />
      )}

      {view === "video" && (
        <VideoView
          obj={selectedObjects[0] as VideoDisplayObject}
          doc={doc}
          onUpdateObject={onUpdateObject}
        />
      )}

      {view === "group" && (
        <GroupView
          obj={selectedObjects[0] as GroupObject}
          onUpdateObject={onUpdateObject}
          onUngroup={onUngroup}
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
