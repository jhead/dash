import React, { useEffect, useRef } from "react";
import type { FreeTransformMode, PolyStarOptions, ToolId, ToolState } from "./tools/types";
import { OBJECT_DRAWING_TOOLS } from "./tools/types";
import type { Fill } from "@flash/core";

// ---------------------------------------------------------------------------
// Flash 8 toolbox icons — 16×16 inline SVG, stroke="currentColor"
// ---------------------------------------------------------------------------

const ArrowIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 1 L2 13 L5.5 9.5 L8.5 14.5 L10.5 13.5 L7.5 8.5 L12 8.5 Z"
          stroke="currentColor" strokeWidth="1" fill="currentColor" strokeLinejoin="round"/>
  </svg>
);

const SubselectIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 1 L2 13 L5.5 9.5 L8.5 14.5 L10.5 13.5 L7.5 8.5 L12 8.5 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
  </svg>
);

const FreeTransformIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="8" height="8" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1"/>
    <rect x="2.5" y="2.5" width="2" height="2" fill="currentColor"/>
    <rect x="11.5" y="2.5" width="2" height="2" fill="currentColor"/>
    <rect x="2.5" y="11.5" width="2" height="2" fill="currentColor"/>
    <rect x="11.5" y="11.5" width="2" height="2" fill="currentColor"/>
    <rect x="7" y="2.5" width="2" height="2" fill="currentColor"/>
    <rect x="7" y="11.5" width="2" height="2" fill="currentColor"/>
    <rect x="2.5" y="7" width="2" height="2" fill="currentColor"/>
    <rect x="11.5" y="7" width="2" height="2" fill="currentColor"/>
  </svg>
);


const LassoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3 C4 3 2 5 2 7 C2 10 5 12 8 12 C11 12 14 10 14 7 C14 5 12 3 8 3 Z"
          stroke="currentColor" strokeWidth="1" fill="none"/>
    <path d="M8 12 L6 16" stroke="currentColor" strokeWidth="1"/>
    <path d="M6 16 L10 14" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const PenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M10 2 L14 6 L6 14 L2 14 L2 10 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <path d="M8 4 L12 8" stroke="currentColor" strokeWidth="1"/>
    <circle cx="2.5" cy="13.5" r="1" fill="currentColor"/>
  </svg>
);

const TextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 3 L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M8 3 L8 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M5 13 L11 13" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    <line x1="12" y1="8" x2="12" y2="14" stroke="currentColor" strokeWidth="1"/>
    <line x1="10" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const LineIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const RectIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="4" width="12" height="8" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const OvalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <ellipse cx="8" cy="8" rx="6" ry="5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

const PolyStarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <polygon points="8,2 9.8,6.2 14.4,6.5 11,9.5 12.1,14 8,11.5 3.9,14 5,9.5 1.6,6.5 6.2,6.2"
             stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
  </svg>
);

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M11 2 L14 5 L5 14 L2 14 L2 11 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <line x1="9" y1="4" x2="12" y2="7" stroke="currentColor" strokeWidth="1"/>
    <path d="M2 14 L3 11" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const BrushIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M12 2 L14 4 L6 12 C5 13 3 14 2 14 C2 13 3 11 4 10 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <line x1="10" y1="4" x2="12" y2="6" stroke="currentColor" strokeWidth="1"/>
    <ellipse cx="3" cy="13" rx="1.5" ry="1" fill="currentColor" transform="rotate(-45 3 13)"/>
  </svg>
);

const InkBottleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5" y="1" width="6" height="3" rx="0.5" stroke="currentColor" strokeWidth="1"/>
    <path d="M5 4 L4 7 L4 13 C4 13.5 4.5 14 5 14 L11 14 C11.5 14 12 13.5 12 13 L12 7 L11 4 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <path d="M4 8 L12 8" stroke="currentColor" strokeWidth="0.5"/>
    <path d="M13 11 L15 11 L15 14 L13 14" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const PaintBucketIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2 6 L6 2 L12 8 L8 12 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <line x1="4" y1="4" x2="10" y2="10" stroke="currentColor" strokeWidth="1"/>
    <path d="M10 12 C10 11 11 10 12 10 C13 10 14 11 14 12 C14 13.5 12 15 12 15 C12 15 10 13.5 10 12 Z"
          stroke="currentColor" strokeWidth="1" fill="none"/>
  </svg>
);

const EyedropperIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M11 2 C12 1 14 2 13 4 L8 9 L7 12 L4 12 L4 9 L9 4 Z"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <rect x="3" y="11" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1" fill="currentColor"/>
    <line x1="8" y1="5" x2="11" y2="2" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const EraserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="5" width="12" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="7" y1="5" x2="7" y2="12" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

const GradientTransformIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {/* Gradient square */}
    <rect x="2" y="2" width="10" height="10" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1"/>
    {/* Center circle */}
    <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1" fill="none"/>
    {/* Edge scale handle (right) */}
    <rect x="12" y="5.5" width="3" height="3" fill="currentColor"/>
    {/* Corner rotation handle */}
    <circle cx="13.5" cy="2.5" r="1.5" stroke="currentColor" strokeWidth="1" fill="none"/>
  </svg>
);

const HandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 7 L6 3 C6 2.5 6.5 2 7 2 C7.5 2 8 2.5 8 3 L8 6"
          stroke="currentColor" strokeWidth="1" fill="none"/>
    <path d="M8 5.5 C8 5 8.5 4.5 9 4.5 C9.5 4.5 10 5 10 5.5 L10 7"
          stroke="currentColor" strokeWidth="1" fill="none"/>
    <path d="M10 6 C10 5.5 10.5 5 11 5 C11.5 5 12 5.5 12 6 L12 9"
          stroke="currentColor" strokeWidth="1" fill="none"/>
    <path d="M6 7 L6 12 C6 13 7 14 8 14 L10 14 C11.5 14 12 13 12 12 L12 9 L6 9 L6 7"
          stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
    <path d="M4 9 C3 9 2 8.5 2 7.5 L2 7 C2 6.5 2.5 6 3 6 L6 7"
          stroke="currentColor" strokeWidth="1" fill="none"/>
  </svg>
);

const ZoomIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="5" y1="7" x2="9" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    <line x1="7" y1="5" x2="7" y2="9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
  </svg>
);

export interface ToolsPanelExtraProps {
  onPencilModeChange?: (mode: "straighten" | "smooth" | "ink") => void;
  onBrushSizeChange?: (size: number) => void;
  onEraserSizeChange?: (size: number) => void;
  onFreeTransformModeChange?: (mode: FreeTransformMode) => void;
  onLassoPolygonModeChange?: (polygonMode: boolean) => void;
  onLassoMagicWandChange?: (magicWand: boolean) => void;
  onMagicWandThresholdChange?: (threshold: number) => void;
  onMagicWandSmoothingChange?: (smoothing: "pixels" | "rough" | "normal" | "smooth") => void;
  onPolyStarOptionsChange?: (opts: Partial<PolyStarOptions>) => void;
}

export interface ToolsPanelProps {
  toolState: ToolState;
  onToolChange: (tool: ToolId) => void;
  onStrokeColorChange: (color: string) => void;
  onFillColorChange: (color: string | null) => void;
  onObjectDrawingToggle: () => void;
  onPencilModeChange?: (mode: "straighten" | "smooth" | "ink") => void;
  onBrushSizeChange?: (size: number) => void;
  onEraserSizeChange?: (size: number) => void;
  onFreeTransformModeChange?: (mode: FreeTransformMode) => void;
  onLassoPolygonModeChange?: (polygonMode: boolean) => void;
  onLassoMagicWandChange?: (magicWand: boolean) => void;
  onMagicWandThresholdChange?: (threshold: number) => void;
  onMagicWandSmoothingChange?: (smoothing: "pixels" | "rough" | "normal" | "smooth") => void;
  onPolyStarOptionsChange?: (opts: Partial<PolyStarOptions>) => void;
}

interface ToolDef {
  id: ToolId;
  icon: () => React.ReactElement;
  shortcut: string;
  title: string;
}

// Flash 8 tool grid — 2 columns, top to bottom
// In Flash 8, Gradient Transform (F) and Free Transform (Q) share the second row.
const TOOL_ROWS: ToolDef[][] = [
  [
    { id: "selection",         icon: ArrowIcon,             shortcut: "v", title: "Selection (V)" },
    { id: "subselect",         icon: SubselectIcon,         shortcut: "a", title: "Subselection (A)" },
  ],
  [
    { id: "free-transform",    icon: FreeTransformIcon,     shortcut: "q", title: "Free Transform (Q)" },
    { id: "gradientTransform", icon: GradientTransformIcon, shortcut: "f", title: "Gradient Transform (F)" },
  ],
  [
    { id: "lasso",             icon: LassoIcon,             shortcut: "l", title: "Lasso (L)" },
    { id: "pen",               icon: PenIcon,               shortcut: "p", title: "Pen (P)" },
  ],
  [
    { id: "line",              icon: LineIcon,              shortcut: "n", title: "Line (N)" },
    { id: "text",              icon: TextIcon,              shortcut: "t", title: "Text (T)" },
  ],
  [
    { id: "oval",              icon: OvalIcon,              shortcut: "o", title: "Oval (O)" },
    { id: "rect",              icon: RectIcon,              shortcut: "r", title: "Rectangle (R)" },
  ],
  [
    { id: "polystar",          icon: PolyStarIcon,          shortcut: "",  title: "PolyStar (polygon/star)" },
    { id: "pencil",            icon: PencilIcon,            shortcut: "y", title: "Pencil (Y)" },
  ],
  [
    { id: "brush",             icon: BrushIcon,             shortcut: "b", title: "Brush (B)" },
    { id: "ink-bottle",        icon: InkBottleIcon,         shortcut: "s", title: "Ink Bottle (S)" },
  ],
  [
    { id: "fill",              icon: PaintBucketIcon,       shortcut: "k", title: "Paint Bucket (K)" },
    { id: "eyedropper",        icon: EyedropperIcon,        shortcut: "i", title: "Eyedropper (I)" },
  ],
  [
    { id: "eraser",            icon: EraserIcon,            shortcut: "e", title: "Eraser (E)" },
    { id: "hand",              icon: HandIcon,              shortcut: "h", title: "Hand (H)" },
  ],
  [
    { id: "zoom",              icon: ZoomIcon,              shortcut: "z", title: "Zoom (Z)" },
  ],
];

// Flat lookup for keyboard shortcut handling
const SHORTCUT_MAP: Record<string, ToolId> = {};
for (const row of TOOL_ROWS) {
  for (const tool of row) {
    if (tool.shortcut) {
      SHORTCUT_MAP[tool.shortcut] = tool.id;
    }
  }
}

const BTN_SIZE = 18;
const PANEL_WIDTH = 44;

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    width: `${PANEL_WIDTH}px`,
    background: "#2d2d2d",
    borderRight: "1px solid #1a1a1a",
    flexShrink: 0,
    alignItems: "center",
    paddingTop: "4px",
    overflowY: "auto",
    overflowX: "hidden",
    userSelect: "none",
  },
  toolGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1px",
    width: "100%",
    padding: "0 1px",
    boxSizing: "border-box",
  },
  toolBtn: {
    width: `${BTN_SIZE}px`,
    height: `${BTN_SIZE}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "9px",
    color: "#c0c0c0",
    cursor: "default",
    border: "1px solid transparent",
    borderRadius: "1px",
    background: "transparent",
    padding: 0,
    boxSizing: "border-box",
    lineHeight: 1,
    justifySelf: "center",
  },
  toolBtnActive: {
    background: "#5a5a5a",
    border: "1px solid #888",
    color: "#ffffff",
  },
  divider: {
    width: "24px",
    height: "1px",
    background: "#1a1a1a",
    margin: "3px 0",
    flexShrink: 0,
  },
  colorSection: {
    marginTop: "auto",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "4px 0 2px",
    gap: "2px",
    borderTop: "1px solid #1a1a1a",
    flexShrink: 0,
  },
  colorStack: {
    position: "relative",
    width: "22px",
    height: "22px",
  },
  strokeSwatch: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "14px",
    height: "14px",
    border: "1px solid #888",
    cursor: "pointer",
    boxSizing: "border-box",
    zIndex: 1,
  },
  fillSwatch: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: "14px",
    height: "14px",
    border: "1px solid #888",
    cursor: "pointer",
    boxSizing: "border-box",
    zIndex: 2,
  },
  swatchActions: {
    display: "flex",
    gap: "2px",
  },
  smallBtn: {
    width: "10px",
    height: "10px",
    fontSize: "8px",
    color: "#c0c0c0",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    padding: 0,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  objectDrawingBtn: {
    width: "26px",
    height: "12px",
    fontSize: "8px",
    color: "#c0c0c0",
    cursor: "pointer",
    border: "1px solid transparent",
    borderRadius: "1px",
    background: "transparent",
    padding: 0,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "2px",
    flexShrink: 0,
  },
  objectDrawingBtnActive: {
    background: "#4a7a4a",
    border: "1px solid #5a9a5a",
    color: "#aaffaa",
  },
  noColorBtn: {
    width: "10px",
    height: "10px",
    position: "relative",
    cursor: "pointer",
    border: "1px solid #666",
    background: "#fff",
    flexShrink: 0,
  },
};

/** Returns a CSS background value for a Fill (null = white fallback). */
function fillToCssBg(fill: Fill | null): string {
  if (!fill) return "#ffffff";
  if (fill.type === "solid") {
    const { r, g, b, a } = fill.color;
    return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }
  if (fill.type === "linear-gradient") {
    if (fill.stops.length === 0) return "transparent";
    const sorted = [...fill.stops].sort((a, b) => a.ratio - b.ratio);
    const parts = sorted.map((s) => {
      const pct = Math.round((s.ratio / 255) * 100);
      return `rgba(${s.color.r},${s.color.g},${s.color.b},${s.color.a / 255}) ${pct}%`;
    });
    return `linear-gradient(${fill.angle}deg, ${parts.join(", ")})`;
  }
  if (fill.type === "radial-gradient") {
    if (fill.stops.length === 0) return "transparent";
    const sorted = [...fill.stops].sort((a, b) => a.ratio - b.ratio);
    const parts = sorted.map((s) => {
      const pct = Math.round((s.ratio / 255) * 100);
      return `rgba(${s.color.r},${s.color.g},${s.color.b},${s.color.a / 255}) ${pct}%`;
    });
    return `radial-gradient(circle, ${parts.join(", ")})`;
  }
  if (fill.type === "bitmap") {
    // Show a checkerboard pattern to indicate a bitmap fill is active
    return "repeating-conic-gradient(#888 0% 25%, #aaa 0% 50%) 0 0 / 8px 8px";
  }
  return "#ffffff";
}

// Render an "X" (No Color) indicator inside a swatch
function NoColorX(): React.ReactElement {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      style={{ display: "block" }}
    >
      <line x1="1" y1="1" x2="11" y2="11" stroke="#f00" strokeWidth="1.5" />
      <line x1="11" y1="1" x2="1" y2="11" stroke="#f00" strokeWidth="1.5" />
    </svg>
  );
}

const BRUSH_SIZES = [2, 4, 8, 16, 32];
const ERASER_SIZES = [8, 16, 24, 32, 48];

export function ToolsPanel({
  toolState,
  onToolChange,
  onStrokeColorChange,
  onFillColorChange,
  onObjectDrawingToggle,
  onPencilModeChange,
  onBrushSizeChange,
  onEraserSizeChange,
  onFreeTransformModeChange,
  onLassoPolygonModeChange,
  onLassoMagicWandChange,
  onMagicWandThresholdChange,
  onMagicWandSmoothingChange,
  onPolyStarOptionsChange,
}: ToolsPanelProps): React.ReactElement {
  const strokeInputRef = useRef<HTMLInputElement>(null);
  const fillInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        (target as HTMLElement).isContentEditable
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      // Object drawing toggle
      if (key === "j") {
        if (OBJECT_DRAWING_TOOLS.has(toolState.activeTool)) {
          onObjectDrawingToggle();
        }
        return;
      }
      const toolId = SHORTCUT_MAP[key];
      if (toolId) {
        onToolChange(toolId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toolState.activeTool, onToolChange, onObjectDrawingToggle]);

  const showObjectDrawing = OBJECT_DRAWING_TOOLS.has(toolState.activeTool);

  return (
    <div style={styles.panel}>
      {/* Tool grid */}
      <div style={styles.toolGrid}>
        {TOOL_ROWS.map((row) =>
          row.map((tool) => {
            const isActive = toolState.activeTool === tool.id;
            return (
              <button
                key={tool.id}
                style={{
                  ...styles.toolBtn,
                  ...(isActive ? styles.toolBtnActive : {}),
                }}
                onClick={() => onToolChange(tool.id)}
                title={tool.title}
                type="button"
              >
                <tool.icon />
              </button>
            );
          })
        )}
      </div>

      {/* Object Drawing toggle — only shown for applicable tools */}
      {showObjectDrawing ? (
        <button
          type="button"
          style={{
            ...styles.objectDrawingBtn,
            ...(toolState.objectDrawing ? styles.objectDrawingBtnActive : {}),
          }}
          onClick={onObjectDrawingToggle}
          title="Object Drawing (J)"
        >
          OD
        </button>
      ) : (
        <div style={{ height: "14px" }} />
      )}

      <div style={styles.divider} />

      {/* Tool options area */}
      {toolState.activeTool === "pencil" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "2px 0", width: "100%" }}>
          {(["straighten", "smooth", "ink"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              style={{
                width: "26px",
                height: "10px",
                fontSize: "7px",
                color: (toolState.pencilMode ?? "ink") === mode ? "#fff" : "#aaa",
                background: (toolState.pencilMode ?? "ink") === mode ? "#5a5a5a" : "transparent",
                border: (toolState.pencilMode ?? "ink") === mode ? "1px solid #888" : "1px solid transparent",
                borderRadius: "1px",
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                textTransform: "capitalize",
              }}
              onClick={() => onPencilModeChange?.(mode)}
              title={`Pencil mode: ${mode}`}
            >
              {mode.slice(0, 3)}
            </button>
          ))}
        </div>
      )}

      {toolState.activeTool === "brush" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "2px 0" }}>
          {BRUSH_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              style={{
                width: Math.min(size, 26) + "px",
                height: Math.min(size, 10) + "px",
                background: (toolState.brushSize ?? 8) === size ? "#aaa" : "#555",
                border: (toolState.brushSize ?? 8) === size ? "1px solid #ccc" : "1px solid #333",
                borderRadius: "50%",
                cursor: "pointer",
                padding: 0,
                margin: "1px auto",
                display: "block",
              }}
              onClick={() => onBrushSizeChange?.(size)}
              title={`Brush size: ${size}px`}
            />
          ))}
        </div>
      )}

      {toolState.activeTool === "eraser" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "2px 0" }}>
          {ERASER_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              style={{
                width: Math.min(size / 2, 26) + "px",
                height: Math.min(size / 2, 10) + "px",
                background: (toolState.eraserSize ?? 16) === size ? "#aaa" : "#555",
                border: (toolState.eraserSize ?? 16) === size ? "1px solid #ccc" : "1px solid #333",
                cursor: "pointer",
                padding: 0,
                margin: "1px auto",
                display: "block",
                borderRadius: "1px",
              }}
              onClick={() => onEraserSizeChange?.(size)}
              title={`Eraser size: ${size}px`}
            />
          ))}
        </div>
      )}

      {/* Free Transform options */}
      {toolState.activeTool === "free-transform" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "2px 0", width: "100%" }}>
          {(["rotate-scale", "distort", "envelope"] as const).map((mode) => {
            const label = mode === "rotate-scale" ? "Rot" : mode === "distort" ? "Dst" : "Env";
            const fullLabel = mode === "rotate-scale" ? "Rotate & Scale" : mode === "distort" ? "Distort" : "Envelope";
            const active = (toolState.freeTransformMode ?? "rotate-scale") === mode;
            return (
              <button
                key={mode}
                type="button"
                style={{
                  width: "26px",
                  height: "10px",
                  fontSize: "7px",
                  color: active ? "#fff" : "#aaa",
                  background: active ? "#5a5a5a" : "transparent",
                  border: active ? "1px solid #888" : "1px solid transparent",
                  borderRadius: "1px",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                }}
                onClick={() => onFreeTransformModeChange?.(mode)}
                title={fullLabel}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Lasso options */}
      {toolState.activeTool === "lasso" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "2px 0", width: "100%" }}>
          {/* Freehand / Polygon sub-modes (only shown when not in magic wand mode) */}
          {!(toolState.lassoMagicWand ?? false) && ([false, true] as const).map((polyMode) => {
            const label = polyMode ? "Poly" : "Free";
            const active = (toolState.lassoPolygonMode ?? false) === polyMode;
            return (
              <button
                key={String(polyMode)}
                type="button"
                style={{
                  width: "26px",
                  height: "10px",
                  fontSize: "7px",
                  color: active ? "#fff" : "#aaa",
                  background: active ? "#5a5a5a" : "transparent",
                  border: active ? "1px solid #888" : "1px solid transparent",
                  borderRadius: "1px",
                  cursor: "pointer",
                  padding: 0,
                  lineHeight: 1,
                }}
                onClick={() => { onLassoPolygonModeChange?.(polyMode); onLassoMagicWandChange?.(false); }}
                title={polyMode ? "Polygon Mode" : "Freehand Mode"}
              >
                {label}
              </button>
            );
          })}
          {/* Magic Wand sub-mode button */}
          <button
            type="button"
            style={{
              width: "26px",
              height: "10px",
              fontSize: "7px",
              color: (toolState.lassoMagicWand ?? false) ? "#fff" : "#aaa",
              background: (toolState.lassoMagicWand ?? false) ? "#5a5a5a" : "transparent",
              border: (toolState.lassoMagicWand ?? false) ? "1px solid #888" : "1px solid transparent",
              borderRadius: "1px",
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
            onClick={() => onLassoMagicWandChange?.(!(toolState.lassoMagicWand ?? false))}
            title="Magic Wand — select by color"
          >
            Wand
          </button>
        </div>
      )}

      {/* Magic Wand options (Threshold + Smoothing) */}
      {toolState.activeTool === "lasso" && (toolState.lassoMagicWand ?? false) && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "2px 0", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <span style={{ fontSize: "6px", color: "#aaa" }}>Thr</span>
            <input
              type="number"
              min={1}
              max={200}
              value={toolState.magicWandThreshold ?? 20}
              onChange={(e) => onMagicWandThresholdChange?.(Math.min(200, Math.max(1, parseInt(e.target.value) || 20)))}
              title="Threshold (1–200)"
              style={{
                width: "28px",
                height: "12px",
                fontSize: "7px",
                background: "#222",
                color: "#ccc",
                border: "1px solid #555",
                borderRadius: "1px",
                padding: "0 1px",
                textAlign: "center",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <span style={{ fontSize: "6px", color: "#aaa" }}>Smo</span>
            <select
              value={toolState.magicWandSmoothing ?? "pixels"}
              onChange={(e) => onMagicWandSmoothingChange?.(e.target.value as "pixels" | "rough" | "normal" | "smooth")}
              title="Smoothing"
              style={{
                height: "12px",
                fontSize: "6px",
                background: "#222",
                color: "#ccc",
                border: "1px solid #555",
                borderRadius: "1px",
                padding: "0 1px",
              }}
            >
              <option value="pixels">Pixels</option>
              <option value="rough">Rough</option>
              <option value="normal">Normal</option>
              <option value="smooth">Smooth</option>
            </select>
          </div>
        </div>
      )}

      {/* PolyStar options */}
      {toolState.activeTool === "polystar" && (() => {
        const opts = toolState.polyStarOptions ?? { shapeType: "polygon", sides: 5, pointSize: 0.5 };
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "2px 0", width: "100%" }}>
            {(["polygon", "star"] as const).map((type) => {
              const active = opts.shapeType === type;
              return (
                <button
                  key={type}
                  type="button"
                  style={{
                    width: "26px",
                    height: "10px",
                    fontSize: "7px",
                    color: active ? "#fff" : "#aaa",
                    background: active ? "#5a5a5a" : "transparent",
                    border: active ? "1px solid #888" : "1px solid transparent",
                    borderRadius: "1px",
                    cursor: "pointer",
                    padding: 0,
                    lineHeight: 1,
                    textTransform: "capitalize",
                  }}
                  onClick={() => onPolyStarOptionsChange?.({ shapeType: type })}
                  title={type === "polygon" ? "Polygon" : "Star"}
                >
                  {type === "polygon" ? "Poly" : "Star"}
                </button>
              );
            })}
            <div style={{ display: "flex", alignItems: "center", gap: "2px", marginTop: "1px" }}>
              <span style={{ fontSize: "6px", color: "#aaa" }}>Sides</span>
              <input
                type="number"
                min={3}
                max={32}
                value={opts.sides}
                onChange={(e) => onPolyStarOptionsChange?.({ sides: Math.min(32, Math.max(3, parseInt(e.target.value) || 5)) })}
                style={{
                  width: "22px",
                  height: "12px",
                  fontSize: "7px",
                  background: "#222",
                  color: "#ccc",
                  border: "1px solid #555",
                  borderRadius: "1px",
                  padding: "0 1px",
                  textAlign: "center",
                }}
              />
            </div>
            {opts.shapeType === "star" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1px" }}>
                <span style={{ fontSize: "6px", color: "#aaa" }}>Depth</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opts.pointSize * 100)}
                  onChange={(e) => onPolyStarOptionsChange?.({ pointSize: parseInt(e.target.value) / 100 })}
                  style={{ width: "26px", height: "10px", cursor: "pointer" }}
                />
              </div>
            )}
          </div>
        );
      })()}

      <div style={styles.divider} />

      {/* Color section */}
      <div style={styles.colorSection}>
        {/* Hidden color inputs */}
        <input
          ref={strokeInputRef}
          type="color"
          value={toolState.strokeColor}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
          onChange={(e) => onStrokeColorChange(e.target.value)}
        />
        <input
          ref={fillInputRef}
          type="color"
          value={toolState.fillColor ?? "#ffffff"}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
          onChange={(e) => onFillColorChange(e.target.value)}
        />

        {/* Stacked stroke/fill swatches (Flash 8 layout: stroke top-left, fill bottom-right) */}
        <div style={styles.colorStack}>
          {/* Stroke swatch (top-left, behind) */}
          <div
            style={{
              ...styles.strokeSwatch,
              background: toolState.strokeColor,
            }}
            title={`Stroke: ${toolState.strokeColor} (click to change)`}
            onClick={() => strokeInputRef.current?.click()}
          />
          {/* Fill swatch (bottom-right, on top) */}
          <div
            style={{
              ...styles.fillSwatch,
              background: toolState.fill !== undefined ? fillToCssBg(toolState.fill) : (toolState.fillColor ?? "#ffffff"),
            }}
            title={
              toolState.fill !== null
                ? `Fill: ${toolState.fill?.type ?? toolState.fillColor} (click to change)`
                : "Fill: None (click to change)"
            }
            onClick={() => {
              if (toolState.fillColor !== null) {
                fillInputRef.current?.click();
              } else {
                // Clicking No Color fill restores white
                onFillColorChange("#ffffff");
              }
            }}
          >
            {toolState.fill === null && <NoColorX />}
          </div>
        </div>

        {/* Swap and No Color buttons */}
        <div style={styles.swatchActions}>
          {/* Swap colors */}
          <button
            type="button"
            style={styles.smallBtn}
            title="Swap stroke and fill"
            onClick={() => {
              const prev = toolState.strokeColor;
              onStrokeColorChange(toolState.fillColor ?? "#ffffff");
              onFillColorChange(prev);
            }}
          >
            ⇅
          </button>
          {/* Black & white reset */}
          <button
            type="button"
            style={styles.smallBtn}
            title="Reset to black stroke / white fill"
            onClick={() => {
              onStrokeColorChange("#000000");
              onFillColorChange("#ffffff");
            }}
          >
            ■
          </button>
          {/* No Color */}
          <button
            type="button"
            style={{
              ...styles.smallBtn,
              color: toolState.fillColor === null ? "#ff6666" : "#c0c0c0",
            }}
            title="No fill color"
            onClick={() => onFillColorChange(null)}
          >
            ∅
          </button>
        </div>
      </div>
    </div>
  );
}
