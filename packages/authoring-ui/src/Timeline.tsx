import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EaseCurve, Layer, LayerType, SymbolType, Timeline as TimelineModel } from "@flash/core";
import {
  addLayer,
  addLayerFolder,
  clearTween,
  convertToKeyframes,
  createLayer,
  deleteLayer,
  getLayerDepth,
  insertBlankKeyframe,
  insertFrame,
  insertKeyframe,
  layerFrameCount,
  moveLayer,
  removeFrame,
  clearKeyframe,
  renameLayer,
  reverseFrames,
  setFolderCollapsed,
  setLayerLocked,
  setLayerOutlineMode,
  setLayerType,
  setLayerVisible,
  setMotionTween,
  updateMotionTweenProps,
  setShapeTween,
} from "@flash/core";
import { EaseCurveDialog } from "./EaseCurveDialog";
import { chrome, content, halo, chromeFont } from "./theme/flash8Theme.js";
import {
  EyeIcon,
  LockClosedIcon,
  FolderIcon,
  TrashIcon,
} from "./uiGlyphIcons.js";

// ---------------------------------------------------------------------------
// Flash 8 light-theme conversion
// ---------------------------------------------------------------------------
// REFERENCE CONVERSION: Shell.tsx. Every value comes from theme/flash8Theme.ts
// tokens (no hardcoded hex). Flash 8's Timeline is a LIGHT panel:
//   - panel / layer column chrome → chrome.panelBg (#ECECEC), gutters / ruler
//     header / footers → chrome.insetFieldStrip (#D4D4D4)
//   - 1px separators / gridlines  → chrome.separator (#999999)
//   - chrome text (Tahoma 11px)   → chrome.textDefault / textDisabled
//   - Flash-drawn frame pixels (content.*): empty frame #FFFFFF, gridline
//     #EBE9ED, keyframe filled #000000 / hollow #FFFFFF, motion tween #CCCCFF,
//     shape tween #CCFFCC, selected #335EA8, playhead #CC0000.
// Colours previously chosen to read on the DARK panel are re-picked to read on
// the LIGHT timeline.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYER_COL_WIDTH = 130;
/**
 * Min/max for the (now draggable) layers-column width. MUST match
 * `PANE_BOUNDS.layerColumnWidth` in editorLayout.ts — the Shell's `useResize`
 * clamps to those bounds; these mirror them so a directly-rendered Timeline (no
 * Shell) clamps identically.
 */
const LAYER_COL_MIN_WIDTH = 90;
const LAYER_COL_MAX_WIDTH = 400;
/**
 * Base metrics are the raw Flash-8-measured sizes (uiScale = 1). The component
 * multiplies the frame-cell geometry by the `uiScale` preference; chrome that
 * carries text (ruler, status bar, layer column) stays at a fixed size so it
 * remains legible at small scales.
 */
/** Frame cell pitch at scale 1: 15px cell + 1px right gridline (measured = 16). */
const BASE_FRAME_W = 16;
/** Width of each button-state column in button-symbol editing mode */
const BUTTON_STATE_W = 60;
/** Row height (inside borders) at scale 1 — applies to frame AND layer rows. */
const BASE_FRAME_H = 38;
const RULER_H = 16;
/** Timeline status bar height (onion/EMF toggles, readouts, H-scrollbar). */
const STATUS_BAR_H = 24;
const MIN_VISIBLE_FRAMES = 48;
// Keyframe dot geometry at scale 1 (measured from Flash 8): a 10px circle that
// sits low in the cell — 24px from the top, 4px from the bottom.
const BASE_DOT_SIZE = 10;
const BASE_DOT_BOTTOM = 4;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TimelineProps {
  timeline: TimelineModel;
  currentFrame: number;
  isPlaying: boolean;
  frameRate?: number;
  /**
   * Timeline UI scale factor (default 1). Scales frame-cell geometry (cell
   * width, row height, keyframe dot). On a 2× Retina display, 0.5 makes the
   * timeline render at the same physical size Flash 8 had on a 1× display.
   */
  uiScale?: number;
  activeLayerIndex?: number;
  onActiveLayerChange?: (index: number) => void;
  onTimelineChange: (t: TimelineModel) => void;
  onFrameChange: (frame: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onKeyframeEaseChange?: (layerId: string, frameIndex: number, ease: number) => void;
  onSetShapeTween?: (layerId: string, frameIndex: number) => void;
  onSetShapeTweenEase?: (layerId: string, frameIndex: number, ease: number, blend: "distributive" | "angular") => void;
  // Onion skin props
  onionSkinEnabled?: boolean;
  /** When true, ghost frames are rendered as stroke outlines only (no fill). */
  onionSkinOutlines?: boolean;
  onionBefore?: number;
  onionAfter?: number;
  onToggleOnionSkin?: () => void;
  onToggleOnionSkinOutlines?: () => void;
  onOnionRangeChange?: (before: number, after: number) => void;
  // Edit Multiple Frames
  editMultipleFrames?: boolean;
  onToggleEditMultipleFrames?: () => void;
  // Frame clipboard props
  onCopyFrames?: (startFrame: number, endFrame: number) => void;
  onCutFrames?: (startFrame: number, endFrame: number) => void;
  onPasteFrames?: (atFrame: number) => void;
  hasFrameClipboard?: boolean;
  // Frame delete
  onRemoveFrames?: (startFrame: number, endFrame: number) => void;
  /** When editing a symbol, its type — used to switch to button-state view */
  symbolType?: SymbolType;
  /** Called when the user double-clicks a keyframe cell */
  onFrameDoubleClick?: (layerIndex: number, frameIndex: number) => void;
  /** Called whenever the frame selection range changes (for Shell to track) */
  onSelectedFrameRangeChange?: (range: { layerId: string; start: number; end: number } | null) => void;
  /**
   * Width (px) of the LAYERS column (left of the frames grid). Controlled by the
   * Shell so it can be persisted across reloads via editorLayout (task 1366).
   * Defaults to the historical fixed 130px when not supplied.
   */
  layerColumnWidth?: number;
  /**
   * Pointer-down handler for the draggable divider between the layers column and
   * the frames grid. Supplied by the Shell's shared `useResize` hook so this
   * divider behaves exactly like the other editor dividers (col-resize cursor,
   * pointer-capture drag, min/max clamp, persist-on-release). When omitted the
   * divider is a static separator (e.g. in tests that render Timeline directly).
   */
  onLayerColumnResizePointerDown?: (e: React.PointerEvent) => void;
  /**
   * Keyboard handler for the layers/frames divider (ArrowLeft/Right to resize),
   * mirroring an accessible separator. Supplied by the Shell.
   */
  onLayerColumnResizeKeyDown?: (e: React.KeyboardEvent) => void;
}

// ---------------------------------------------------------------------------
// Context-menu state
// ---------------------------------------------------------------------------

interface ContextMenu {
  x: number;
  y: number;
  layerId: string;
  frameIndex: number;
}

interface LayerContextMenu {
  x: number;
  y: number;
  layerId: string;
  layerIndex: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * For a given layer and display frame index (0-based), determine the visual state:
 * - "keyframe": filled keyframe with content
 * - "blank-keyframe": hollow keyframe (empty)
 * - "span": extends a prior keyframe
 * - "empty": beyond any keyframe
 */
type FrameState = "keyframe" | "blank-keyframe" | "span" | "empty";

function getFrameState(layer: Layer, frameIndex: number): FrameState {
  // Check for exact keyframe
  const exact = layer.frames.find((f) => f.index === frameIndex);
  if (exact && exact.isKeyframe) {
    return exact.isEmpty ? "blank-keyframe" : "keyframe";
  }
  // Check if there's a keyframe before this frame and after the last keyframe gap
  const prevKeyframes = layer.frames
    .filter((f) => f.isKeyframe && f.index <= frameIndex)
    .sort((a, b) => a.index - b.index);
  if (prevKeyframes.length === 0) return "empty";
  const lastKf = prevKeyframes[prevKeyframes.length - 1];
  // Find the next keyframe after lastKf
  const nextKf = layer.frames
    .filter((f) => f.isKeyframe && f.index > lastKf.index)
    .sort((a, b) => a.index - b.index)[0];
  // If we're within the span of lastKf
  const spanEnd = nextKf ? nextKf.index : Infinity;
  if (frameIndex < spanEnd) return "span";
  return "empty";
}

/**
 * For a given layer and frame index, return the tween state of that frame's span:
 * - "motion-tween":       valid motion tween (start kf has tweenType=motion + following kf)
 * - "broken-tween":       start kf has tweenType=motion but no following keyframe
 * - "shape-tween":        valid shape tween (start kf has tweenType=shape + following kf)
 * - "broken-shape-tween": start kf has tweenType=shape but no following keyframe
 * - null:                 not a tween span
 */
type TweenState =
  | "motion-tween"
  | "broken-tween"
  | "shape-tween"
  | "broken-shape-tween"
  | null;

function getTweenState(layer: Layer, frameIndex: number): TweenState {
  // Find the governing keyframe at or before frameIndex
  const prevKeyframes = layer.frames
    .filter((f) => f.isKeyframe && f.index <= frameIndex)
    .sort((a, b) => a.index - b.index);
  if (prevKeyframes.length === 0) return null;
  const govKf = prevKeyframes[prevKeyframes.length - 1];
  if (govKf.tweenType !== "motion" && govKf.tweenType !== "shape") return null;

  // Find the next keyframe after govKf
  const nextKf = layer.frames
    .filter((f) => f.isKeyframe && f.index > govKf.index)
    .sort((a, b) => a.index - b.index)[0];

  if (govKf.tweenType === "motion") {
    if (!nextKf) return "broken-tween";
    if (frameIndex < nextKf.index) return "motion-tween";
    return null;
  } else {
    // shape tween
    if (!nextKf) return "broken-shape-tween";
    if (frameIndex < nextKf.index) return "shape-tween";
    return null;
  }
}


export function contentFrameCount(timeline: TimelineModel): number {
  return timeline.layers.reduce(
    (m, l) => Math.max(m, layerFrameCount(l)),
    1
  );
}

function totalFrameCount(timeline: TimelineModel): number {
  return Math.max(contentFrameCount(timeline), MIN_VISIBLE_FRAMES);
}

// ---------------------------------------------------------------------------
// Frame cell rendering
// ---------------------------------------------------------------------------

function FrameCell({
  state,
  tweenState,
  isPlayhead,
  isSelected,
  isFirstInTweenSpan,
  label,
  labelType,
  hasScript,
  hasSound,
  frameW,
  frameH,
  dotSize,
  dotBottom,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  state: FrameState;
  tweenState: TweenState;
  isPlayhead: boolean;
  /** Scaled frame-cell geometry (driven by the uiScale preference). */
  frameW: number;
  frameH: number;
  dotSize: number;
  dotBottom: number;
  /** True if this frame is within the shift-selected range */
  isSelected?: boolean;
  /** True for the start keyframe of a tween so we can render the arrow */
  isFirstInTweenSpan?: boolean;
  label?: string;
  /** Label type — controls the visual indicator shown when a label is present */
  labelType?: "name" | "anchor" | "comment";
  /** True if this keyframe has a non-empty script attached */
  hasScript?: boolean;
  /** True if this keyframe has a sound attached */
  hasSound?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  // Background color logic: tween state overrides normal span color.
  // Flash 8 paints the timeline LIGHT: empty frames are white, spans pick up
  // their content tint (motion #CCCCFF, shape #CCFFCC), the selection is the
  // #335EA8 highlight, and the playhead column is a faint red wash.
  let bg: string;
  if (isPlayhead) {
    bg = "rgba(204,0,0,0.18)";  // faint wash of content.playhead (#CC0000)
  } else if (isSelected) {
    bg = content.selectedFrame;  // #335EA8 — Flash 8 selected-frame highlight
  } else if (tweenState === "motion-tween") {
    bg = content.motionTween;  // #CCCCFF motion-tween span
  } else if (tweenState === "broken-tween") {
    bg = "#FFE0B0";  // pale orange wash for a broken motion tween (light theme)
  } else if (tweenState === "shape-tween") {
    bg = content.shapeTween;  // #CCFFCC shape-tween span
  } else if (tweenState === "broken-shape-tween") {
    bg = "#E6F5C8";  // pale yellow-green wash for a broken shape tween
  } else if (state === "span") {
    bg = "#E8E8E8";  // light-gray frame span (extends a keyframe)
  } else if (state === "keyframe" || state === "blank-keyframe") {
    bg = content.emptyFrame;  // #FFFFFF — keyframe cell ground
  } else {
    bg = content.emptyFrame;  // #FFFFFF — empty frame cell
  }

  const border = isPlayhead
    ? `1px solid ${content.playhead}`
    : `1px solid ${content.timelineGridline}`;  // #EBE9ED vertical gridline

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{
        position: "relative",
        width: frameW,
        height: frameH,
        flexShrink: 0,
        background: bg,
        borderRight: border,
        boxSizing: "border-box",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
      }}
    >
      {/* Keyframe dot — 10px circle sitting low in the cell (24px from top,
          4px from bottom), per the Flash 8 measured geometry. */}
      {(state === "keyframe" || state === "blank-keyframe") && (
        <div
          style={{
            position: "absolute",
            bottom: dotBottom,
            left: "50%",
            transform: "translateX(-50%)",
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            // Filled keyframe = solid black dot; blank keyframe = hollow white
            // circle (both outlined in black), per Flash 8 content tokens.
            background:
              state === "keyframe"
                ? content.keyframeFilled
                : content.keyframeHollow,
            border: `1px solid ${content.keyframeFilled}`,
            boxSizing: "border-box",
            flexShrink: 0,
            zIndex: 1,
          }}
        />
      )}
      {/* Label type indicator (shown when a label is present) */}
      {label && labelType === "name" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            borderLeft: `5px solid ${content.playhead}`,
            borderBottom: "5px solid transparent",
            pointerEvents: "none",
            zIndex: 3,
          }}
        />
      )}
      {label && labelType === "anchor" && (
        <span
          style={{
            position: "absolute",
            top: 0,
            left: 1,
            fontSize: 6,
            color: halo.haloBlue,
            pointerEvents: "none",
            zIndex: 3,
            lineHeight: 1,
          }}
          title="Anchor"
        >
          #
        </span>
      )}
      {/* Frame label tag */}
      {label && (
        <div
          style={{
            position: "absolute",
            top: 1,
            left: 1,
            fontSize: 7,
            // Flash 8 frame label text: green-ish comment, blue anchor, red name.
            // Re-picked to read on the LIGHT timeline.
            color: labelType === "comment" ? "#0A7A0A" : labelType === "anchor" ? halo.haloBlue : content.playhead,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 2,
            lineHeight: 1,
          }}
        >
          {label}
        </div>
      )}
      {/* Script indicator — lowercase 'a' on keyframes with AS2 scripts */}
      {hasScript && (state === "keyframe" || state === "blank-keyframe") && (
        <span
          style={{
            fontSize: 8,
            color: chrome.textDefault,
            position: "absolute",
            bottom: 0,
            left: 2,
            lineHeight: 1,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          a
        </span>
      )}
      {/* Sound indicator — musical note on keyframes with attached sound */}
      {hasSound && (state === "keyframe" || state === "blank-keyframe") && (
        <span
          style={{
            fontSize: 7,
            color: "#1A6FB0",
            position: "absolute",
            bottom: 0,
            right: 1,
            lineHeight: 1,
            pointerEvents: "none",
            zIndex: 2,
          }}
          title="Sound attached"
        >
          ♪
        </span>
      )}
      {/* Motion tween arrow — only on first cell of tween span */}
      {tweenState === "motion-tween" && isFirstInTweenSpan && (
        <div
          style={{
            position: "absolute",
            right: 1,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 8,
            color: content.keyframeFilled,  // black centerline arrow over #CCCCFF span
            pointerEvents: "none",
            zIndex: 2,
            lineHeight: 1,
          }}
        >
          →
        </div>
      )}
      {/* Shape tween arrow — only on first cell of shape tween span */}
      {tweenState === "shape-tween" && isFirstInTweenSpan && (
        <div
          style={{
            position: "absolute",
            right: 1,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 8,
            color: content.keyframeFilled,  // black centerline arrow over #CCFFCC span
            pointerEvents: "none",
            zIndex: 2,
            lineHeight: 1,
          }}
        >
          →
        </div>
      )}
      {/* Broken motion tween dashed underline indicator */}
      {tweenState === "broken-tween" && (
        <div
          style={{
            position: "absolute",
            bottom: 2,
            left: 0,
            right: 0,
            height: 2,
            // Broken tween: dashed line (content.brokenTween). Dark dashes read
            // on the pale broken-tween wash.
            backgroundImage:
              "repeating-linear-gradient(90deg,#000000 0,#000000 2px,transparent 2px,transparent 4px)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}
      {/* Broken shape tween dashed underline indicator (dashed line) */}
      {tweenState === "broken-shape-tween" && (
        <div
          style={{
            position: "absolute",
            bottom: 2,
            left: 0,
            right: 0,
            height: 2,
            backgroundImage:
              "repeating-linear-gradient(90deg,#000000 0,#000000 2px,transparent 2px,transparent 4px)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}
      {/* Span end tick */}
      {state === "span" && tweenState === null && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "20%",
            bottom: "20%",
            width: 1,
            background: chrome.separator,
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playhead marker (sits in the ruler row)
// ---------------------------------------------------------------------------

function PlayheadMarker({ frame, colWidth = BASE_FRAME_W }: { frame: number; colWidth?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: frame * colWidth,
        top: 0,
        width: colWidth,
        height: RULER_H,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {/* Downward triangle */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: "4px solid transparent",
          borderRight: "4px solid transparent",
          borderTop: `7px solid ${content.playhead}`,
          position: "absolute",
          left: Math.floor(colWidth / 2) - 4,
          top: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: Math.floor(colWidth / 2),
          top: 9,
          width: 1,
          height: RULER_H - 9,
          background: content.playhead,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onion skin range marker (draggable bracket on ruler)
// ---------------------------------------------------------------------------

function OnionRangeMarker({
  frame,
  color,
  label,
  onDrag,
  framesScrollRef,
  frameCount,
  colWidth,
}: {
  frame: number;
  color: string;
  label: string;
  /** Called with integer frame delta when dragged */
  onDrag: (frameDelta: number) => void;
  framesScrollRef: React.RefObject<HTMLDivElement | null>;
  frameCount: number;
  /** Scaled frame-cell width (uiScale-driven). */
  colWidth: number;
}) {
  const dragRef = React.useRef<{ startX: number; startFrame: number } | null>(null);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { startX: e.clientX, startFrame: frame };

      const onMove = (me: MouseEvent) => {
        if (!dragRef.current) return;
        const scrollLeft = framesScrollRef.current?.scrollLeft ?? 0;
        void scrollLeft;
        const dx = me.clientX - dragRef.current.startX;
        const frameDelta = Math.round(dx / colWidth);
        if (frameDelta !== 0) {
          onDrag(frameDelta);
          // Reset so next drag is incremental
          dragRef.current = { startX: me.clientX, startFrame: frame };
        }
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [frame, onDrag, framesScrollRef, colWidth]
  );

  const clampedFrame = Math.max(0, Math.min(frameCount - 1, frame));

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: "absolute",
        left: clampedFrame * colWidth,
        top: 0,
        width: colWidth,
        height: RULER_H,
        zIndex: 9,
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title={`Onion skin range (drag to adjust)`}
    >
      <span
        style={{
          fontSize: 10,
          color,
          fontWeight: "bold",
          lineHeight: 1,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button-state metadata
// ---------------------------------------------------------------------------

/** Flash 8 button state definitions — indices match the frame indices (0-3). */
const BUTTON_STATES: Array<{ label: string; color: string; titleColor: string }> = [
  { label: "Up",   color: "#d0e8f8", titleColor: "#1a5080" }, // light blue
  { label: "Over", color: "#d4f0d4", titleColor: "#1a6020" }, // light green
  { label: "Down", color: "#f0e0a0", titleColor: "#806010" }, // light orange/yellow
  { label: "Hit",  color: "#f0ccc8", titleColor: "#802010" }, // light pink/red
];

// ---------------------------------------------------------------------------
// Main Timeline component
// ---------------------------------------------------------------------------

export function Timeline({
  timeline,
  currentFrame,
  isPlaying,
  frameRate = 12,
  uiScale = 1,
  activeLayerIndex = 0,
  onActiveLayerChange,
  onTimelineChange,
  onFrameChange,
  onPlayingChange,
  onKeyframeEaseChange,
  onSetShapeTween,
  onSetShapeTweenEase,
  onionSkinEnabled = false,
  onionSkinOutlines = false,
  onionBefore = 2,
  onionAfter = 2,
  onToggleOnionSkin,
  onToggleOnionSkinOutlines,
  onOnionRangeChange,
  editMultipleFrames = false,
  onToggleEditMultipleFrames,
  onCopyFrames,
  onCutFrames,
  onPasteFrames,
  hasFrameClipboard = false,
  onRemoveFrames,
  symbolType,
  onFrameDoubleClick,
  onSelectedFrameRangeChange,
  layerColumnWidth,
  onLayerColumnResizePointerDown,
  onLayerColumnResizeKeyDown,
}: TimelineProps): React.ReactElement {
  // The layers-column width is controlled by the Shell (persisted via
  // editorLayout). Fall back to the historical fixed width + clamp defensively
  // so a bad value can never break the layout when Timeline is rendered directly.
  const layerColW = Math.max(
    LAYER_COL_MIN_WIDTH,
    Math.min(LAYER_COL_MAX_WIDTH, layerColumnWidth ?? LAYER_COL_WIDTH)
  );
  // Scaled frame-cell geometry. The chrome (ruler, layer column, status bar)
  // stays fixed so text remains legible; only the cell grid scales.
  const scale = uiScale > 0 ? uiScale : 1;
  const FRAME_W = Math.max(3, Math.round(BASE_FRAME_W * scale));
  const FRAME_H = Math.max(12, Math.round(BASE_FRAME_H * scale));
  const DOT_SIZE = Math.max(3, Math.round(BASE_DOT_SIZE * scale));
  const DOT_BOTTOM = Math.max(1, Math.round(BASE_DOT_BOTTOM * scale));

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [layerContextMenu, setLayerContextMenu] = useState<LayerContextMenu | null>(null);
  // Track selected keyframe for ease editing
  const [selectedKeyframe, setSelectedKeyframe] = useState<{
    layerId: string;
    frameIndex: number;
  } | null>(null);
  // Custom ease curve dialog
  const [easeCurveDialogOpen, setEaseCurveDialogOpen] = useState(false);
  // Track shift-selected frame range for bulk operations
  const [selectedFrameRange, setSelectedFrameRange] = useState<{
    layerId: string;
    start: number;
    end: number;
  } | null>(null);
  // Anchor frame for shift-click range selection (the frame first clicked without shift)
  const anchorFrameRef = useRef<{ layerId: string; frame: number } | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Modify Onion Markers dropdown (status bar)
  const [onionMenuOpen, setOnionMenuOpen] = useState(false);
  // Horizontal scroll tracking for the status-bar scrollbar (mirrors the
  // frame grid's scrollLeft / scrollWidth / clientWidth).
  const [hScroll, setHScroll] = useState({ left: 0, scrollWidth: 1, clientWidth: 1 });

  // In button-symbol editing mode we lock the frame area to exactly 4 columns
  const isButtonMode = symbolType === "button";
  const frameCount = isButtonMode ? 4 : totalFrameCount(timeline);
  // Unpadded content frame count — used for the "current / total" display only.
  // frameCount is padded to MIN_VISIBLE_FRAMES for grid rendering; this value
  // shows the actual longest layer frame count (e.g. 2, not 48).
  const displayFrameCount = isButtonMode ? 4 : contentFrameCount(timeline);

  const panelRef = useRef<HTMLDivElement>(null);
  const framesScrollRef = useRef<HTMLDivElement>(null);
  const layerScrollRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;
  const frameCountRef = useRef(frameCount);
  frameCountRef.current = frameCount;

  // Sync scroll between layer list and frames area
  const syncScroll = useCallback(
    (source: "layers" | "frames", scrollTop: number) => {
      if (source === "layers" && framesScrollRef.current) {
        framesScrollRef.current.scrollTop = scrollTop;
      } else if (source === "frames" && layerScrollRef.current) {
        layerScrollRef.current.scrollTop = scrollTop;
      }
    },
    []
  );

  // Mirror the frame grid's horizontal scroll metrics into state so the
  // status-bar scrollbar can render and drive them.
  const refreshHScroll = useCallback(() => {
    const el = framesScrollRef.current;
    if (!el) return;
    setHScroll({
      left: el.scrollLeft,
      scrollWidth: Math.max(1, el.scrollWidth),
      clientWidth: Math.max(1, el.clientWidth),
    });
  }, []);

  // Keep hScroll metrics fresh as the frame count changes, and whenever the
  // frame grid is resized (e.g. the timeline dock is dragged taller/shorter).
  useEffect(() => {
    refreshHScroll();
    const el = framesScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => refreshHScroll());
    ro.observe(el);
    return () => ro.disconnect();
  }, [refreshHScroll, frameCount, isButtonMode]);

  // Center the playhead horizontally in the frame grid.
  const centerPlayhead = useCallback(() => {
    const el = framesScrollRef.current;
    if (!el) return;
    const colW = isButtonMode ? BUTTON_STATE_W : FRAME_W;
    el.scrollLeft = Math.max(0, currentFrame * colW - el.clientWidth / 2);
    refreshHScroll();
  }, [currentFrame, isButtonMode, refreshHScroll]);


  // Playback is driven by the parent Shell via requestAnimationFrame.
  // Timeline receives currentFrame updates via onFrameChange calls from Shell.

  // Auto-scroll playhead into view
  useEffect(() => {
    if (framesScrollRef.current) {
      const colW = isButtonMode ? BUTTON_STATE_W : FRAME_W;
      const x = currentFrame * colW;
      const el = framesScrollRef.current;
      if (x < el.scrollLeft || x + colW > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
      }
    }
    refreshHScroll();
  }, [currentFrame, isButtonMode, refreshHScroll]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // Close layer context menu on outside click
  useEffect(() => {
    if (!layerContextMenu) return;
    const handler = () => setLayerContextMenu(null);
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [layerContextMenu]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.tagName === "INPUT" ||
        (e.target as HTMLElement)?.tagName === "TEXTAREA"
      )
        return;
      if (!panelRef.current?.contains(document.activeElement) &&
          document.activeElement !== panelRef.current) {
        // Only handle if timeline panel is focused or has focus
        return;
      }
      const activeIdx = Math.min(activeLayerIndex, Math.max(0, timeline.layers.length - 1));
      const selectedLayerId = timeline.layers[activeIdx]?.id;
      if (!selectedLayerId) return;

      if (!isButtonMode && e.key === "F5") {
        e.preventDefault();
        onTimelineChange(insertFrame(timeline, selectedLayerId, currentFrame));
      } else if (!isButtonMode && e.key === "F6") {
        e.preventDefault();
        onTimelineChange(insertKeyframe(timeline, selectedLayerId, currentFrame));
      } else if (!isButtonMode && e.key === "F7") {
        e.preventDefault();
        onTimelineChange(insertBlankKeyframe(timeline, selectedLayerId, currentFrame));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onFrameChange(Math.max(0, currentFrame - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onFrameChange(Math.min(frameCount - 1, currentFrame + 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onPlayingChange(!isPlaying);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "c" && onCopyFrames) {
        // Cmd/Ctrl+C: copy selected frame range (or current frame)
        e.preventDefault();
        const rangeStart = selectedFrameRange?.layerId === selectedLayerId
          ? selectedFrameRange.start
          : currentFrame;
        const rangeEnd = selectedFrameRange?.layerId === selectedLayerId
          ? selectedFrameRange.end
          : currentFrame;
        onCopyFrames(rangeStart, rangeEnd);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "x" && onCutFrames) {
        // Cmd/Ctrl+X: cut selected frame range (or current frame)
        e.preventDefault();
        const rangeStart = selectedFrameRange?.layerId === selectedLayerId
          ? selectedFrameRange.start
          : currentFrame;
        const rangeEnd = selectedFrameRange?.layerId === selectedLayerId
          ? selectedFrameRange.end
          : currentFrame;
        onCutFrames(rangeStart, rangeEnd);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "v" && onPasteFrames) {
        // Cmd/Ctrl+V: paste clipboard frames at current frame position
        e.preventDefault();
        onPasteFrames(currentFrame);
      } else if ((e.key === "Delete" || e.key === "Backspace") && onRemoveFrames) {
        // Delete/Backspace: remove selected frame range (or single current frame)
        e.preventDefault();
        const rangeStart = selectedFrameRange?.layerId === selectedLayerId
          ? selectedFrameRange.start
          : currentFrame;
        const rangeEnd = selectedFrameRange?.layerId === selectedLayerId
          ? selectedFrameRange.end
          : currentFrame;
        onRemoveFrames(rangeStart, rangeEnd);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    timeline,
    currentFrame,
    isPlaying,
    frameCount,
    activeLayerIndex,
    selectedFrameRange,
    onTimelineChange,
    onFrameChange,
    onPlayingChange,
    onCopyFrames,
    onCutFrames,
    onPasteFrames,
    onRemoveFrames,
  ]);

  // Ruler scrubbing
  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const scrollLeft = framesScrollRef.current?.scrollLeft ?? 0;
      const getFrame = (clientX: number) => {
        const x = clientX - rect.left + scrollLeft;
        return Math.max(0, Math.min(frameCount - 1, Math.floor(x / FRAME_W)));
      };
      onFrameChange(getFrame(e.clientX));
      const onMove = (me: MouseEvent) => onFrameChange(getFrame(me.clientX));
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [frameCount, onFrameChange]
  );

  // Layer drag reorder
  const handleLayerDragStart = useCallback(
    (layerId: string) => {
      setDragLayerId(layerId);
    },
    []
  );

  const handleLayerDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      setDragOverIndex(index);
    },
    []
  );

  const handleLayerDrop = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (dragLayerId != null) {
        onTimelineChange(moveLayer(timeline, dragLayerId, index));
      }
      setDragLayerId(null);
      setDragOverIndex(null);
    },
    [dragLayerId, timeline, onTimelineChange]
  );

  const handleLayerDragEnd = useCallback(() => {
    setDragLayerId(null);
    setDragOverIndex(null);
  }, []);

  // Add a new layer above the active layer
  const handleAddLayer = useCallback(() => {
    const newName = `Layer ${timeline.layers.length + 1}`;
    onTimelineChange(addLayer(timeline, newName));
    onActiveLayerChange?.(0); // newly added layer is at index 0 (top)
  }, [timeline, onTimelineChange, onActiveLayerChange]);

  // Add a new folder layer above the active layer
  const handleAddLayerFolder = useCallback(() => {
    const folderCount = timeline.layers.filter((l) => l.type === "folder").length;
    const newName = `Folder ${folderCount + 1}`;
    onTimelineChange(addLayerFolder(timeline, newName));
    onActiveLayerChange?.(0); // newly added folder is at index 0 (top)
  }, [timeline, onTimelineChange, onActiveLayerChange]);

  // Toggle collapse/expand on a folder layer
  const handleToggleFolderCollapsed = useCallback(
    (folderId: string, collapsed: boolean) => {
      onTimelineChange(setFolderCollapsed(timeline, folderId, collapsed));
    },
    [timeline, onTimelineChange]
  );

  // Compute visible layers: skip children of collapsed folders
  const visibleLayers = React.useMemo(() => {
    const collapsedFolderIds = new Set(
      timeline.layers
        .filter((l) => l.type === "folder" && l.collapsed)
        .map((l) => l.id)
    );
    return timeline.layers.filter((layer) => {
      if (layer.parentFolderId === null) return true;
      return !collapsedFolderIds.has(layer.parentFolderId);
    });
  }, [timeline.layers]);

  // Delete the active layer (with content confirmation)
  const handleDeleteActiveLayer = useCallback(() => {
    if (timeline.layers.length <= 1) return; // can't delete last layer
    const safeIdx = Math.min(activeLayerIndex, Math.max(0, timeline.layers.length - 1));
    const activeLayer = timeline.layers[safeIdx];
    if (!activeLayer) return;
    const hasContent = activeLayer.frames.some(
      (f) => f.isKeyframe && !f.isEmpty && f.displayObjects.length > 0
    );
    if (hasContent && !window.confirm("Delete layer with content?")) return;
    onTimelineChange(deleteLayer(timeline, activeLayer.id));
    onActiveLayerChange?.(Math.max(0, safeIdx - 1));
  }, [timeline, activeLayerIndex, onTimelineChange, onActiveLayerChange]);

  // Open layer type context menu on right-click of layer header
  const openLayerContextMenu = useCallback(
    (e: React.MouseEvent, layerId: string, layerIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      setLayerContextMenu({ x: e.clientX, y: e.clientY, layerId, layerIndex });
    },
    []
  );

  const handleSetLayerType = useCallback(
    (layerId: string, type: LayerType) => {
      onTimelineChange(setLayerType(timeline, layerId, type));
      setLayerContextMenu(null);
    },
    [timeline, onTimelineChange]
  );

  const handleAddMotionGuide = useCallback(
    (_layerId: string, layerIndex: number) => {
      // Insert a new guide layer directly above the current layer (at layerIndex),
      // then mark the current layer as "guided".
      const currentLayer = timeline.layers[layerIndex];
      const guideName = `Guide: ${currentLayer?.name ?? "Layer"}`;
      const guideLayer = createLayer(guideName, "guide");
      const newLayers = [...timeline.layers];
      newLayers.splice(layerIndex, 0, guideLayer);
      // Mark the original layer (now at layerIndex + 1) as "guided"
      newLayers[layerIndex + 1] = { ...newLayers[layerIndex + 1]!, type: "guided" };
      onTimelineChange({ ...timeline, layers: newLayers });
      setLayerContextMenu(null);
    },
    [timeline, onTimelineChange]
  );

  // Context menu actions
  const openContextMenu = useCallback(
    (e: React.MouseEvent, layerId: string, frameIndex: number) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, layerId, frameIndex });
    },
    []
  );

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { layerId: _layerId, frameIndex } = contextMenu;
      setContextMenu(null);
      switch (action) {
        case "insert-frame":
          onTimelineChange(insertFrame(timeline, _layerId, frameIndex));
          break;
        case "insert-keyframe":
          onTimelineChange(insertKeyframe(timeline, _layerId, frameIndex));
          break;
        case "insert-blank-keyframe":
          onTimelineChange(insertBlankKeyframe(timeline, _layerId, frameIndex));
          break;
        case "clear-keyframe":
          onTimelineChange(clearKeyframe(timeline, _layerId, frameIndex));
          break;
        case "remove-frame": {
          const rangeStart = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.start : frameIndex;
          const rangeEnd = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.end : frameIndex;
          // Remove frames from the right-clicked layer (not the active layer).
          // Iterate from end to start to avoid index-shifting issues.
          let updatedTl = timeline;
          for (let i = rangeEnd; i >= rangeStart; i--) {
            updatedTl = removeFrame(updatedTl, _layerId, i);
          }
          onTimelineChange(updatedTl);
          break;
        }
        case "create-motion-tween":
          onTimelineChange(setMotionTween(timeline, _layerId, frameIndex));
          setSelectedKeyframe({ layerId: _layerId, frameIndex });
          break;
        case "create-shape-tween":
          onTimelineChange(setShapeTween(timeline, _layerId, frameIndex));
          setSelectedKeyframe({ layerId: _layerId, frameIndex });
          onSetShapeTween?.(_layerId, frameIndex);
          break;
        case "remove-tween":
          onTimelineChange(clearTween(timeline, _layerId, frameIndex));
          setSelectedKeyframe(null);
          break;
        case "copy-frames": {
          const rangeStart = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.start : frameIndex;
          const rangeEnd = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.end : frameIndex;
          onCopyFrames?.(rangeStart, rangeEnd);
          break;
        }
        case "cut-frames": {
          const rangeStart = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.start : frameIndex;
          const rangeEnd = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.end : frameIndex;
          onCutFrames?.(rangeStart, rangeEnd);
          break;
        }
        case "paste-frames":
          onPasteFrames?.(frameIndex);
          break;
        case "convert-to-keyframes": {
          const rangeStart = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.start : frameIndex;
          const rangeEnd = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.end : frameIndex;
          onTimelineChange(convertToKeyframes(timeline, _layerId, rangeStart, rangeEnd));
          break;
        }
        case "reverse-frames": {
          const rangeStart = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.start : frameIndex;
          const rangeEnd = selectedFrameRange?.layerId === _layerId ? selectedFrameRange.end : frameIndex;
          onTimelineChange(reverseFrames(timeline, _layerId, rangeStart, rangeEnd));
          break;
        }
      }
    },
    [contextMenu, timeline, onTimelineChange, onSetShapeTween, onCopyFrames, onCutFrames, onPasteFrames, selectedFrameRange]
  );

  // Layer rename
  const startRename = useCallback((layer: Layer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  }, []);

  const commitRename = useCallback(() => {
    if (editingLayerId) {
      onTimelineChange(
        renameLayer(timeline, editingLayerId, editingName.trim() || "Layer")
      );
      setEditingLayerId(null);
    }
  }, [editingLayerId, editingName, timeline, onTimelineChange]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      data-timeline-panel="true"
      onMouseDown={(e) => {
        // Explicitly grab keyboard focus when the user clicks anywhere in the
        // Timeline panel, so Delete / arrow-key shortcuts work immediately.
        // Skip when the target is itself a focusable element (button / input)
        // so those elements can still receive their own native focus.
        const t = e.target as HTMLElement;
        if (t.tagName !== "BUTTON" && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") {
          panelRef.current?.focus();
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        flex: 1,
        background: chrome.panelBg,
        borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
        outline: "none",
        userSelect: "none",
        position: "relative",
        ...chromeFont(),
      }}
    >
      {/* No internal title bar — the Shell's docking tab already labels this
          panel "Timeline", matching Flash 8's single timeline title. */}

      {/* Body: layer list + frame area */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Layer list */}
        <div
          style={{
            width: layerColW,
            flexShrink: 0,
            // The visual edge is now drawn by the draggable divider that
            // follows this column (see below), so no borderRight here.
            display: "flex",
            flexDirection: "column",
            background: chrome.panelBg,
          }}
        >
          {/* Layer column headers (aligns with ruler): show / lock / outline.
              The three icons line up over the per-row toggle columns. */}
          <div
            style={{
              height: RULER_H,
              background: chrome.insetFieldStrip,
              borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
              flexShrink: 0,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingRight: 4,
              gap: 2,
            }}
          >
            {/* Show / Hide all */}
            <button
              title="Show/Hide all layers"
              onClick={() => {
                const anyVisible = timeline.layers.some((l) => l.visible);
                let t = timeline;
                for (const l of timeline.layers) t = setLayerVisible(t, l.id, !anyVisible);
                onTimelineChange(t);
              }}
              style={{ ...iconButtonStyle, color: chrome.textDefault, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <EyeIcon size={12} />
            </button>
            {/* Lock all */}
            <button
              title="Lock/Unlock all layers"
              onClick={() => {
                const anyUnlocked = timeline.layers.some((l) => !l.locked);
                let t = timeline;
                for (const l of timeline.layers) t = setLayerLocked(t, l.id, anyUnlocked);
                onTimelineChange(t);
              }}
              style={{ ...iconButtonStyle, color: chrome.textDefault, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <LockClosedIcon size={12} />
            </button>
            {/* Show all as outlines */}
            <button
              title="Show all layers as outlines"
              onClick={() => {
                const anyOff = timeline.layers.some((l) => !l.outlineMode);
                let t = timeline;
                for (const l of timeline.layers) t = setLayerOutlineMode(t, l.id, anyOff);
                onTimelineChange(t);
              }}
              style={{
                ...iconButtonStyle,
                width: 11,
                height: 11,
                minWidth: 11,
                border: `1px solid ${chrome.separator}`,
                background: "transparent",
                borderRadius: 0,
              }}
            />
          </div>
          {/* Layer rows */}
          <div
            ref={layerScrollRef}
            onScroll={(e) =>
              syncScroll("layers", (e.target as HTMLElement).scrollTop)
            }
            style={{
              flex: 1,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {visibleLayers.map((layer) => {
              const idx = timeline.layers.indexOf(layer);
              const folderDepth = getLayerDepth(timeline, layer.id);
              // Masked layers are indented one level below their mask parent,
              // similar to how guide/guided pairs display in Flash 8.
              const maskDepth = layer.type === "masked" ? 1 : 0;
              const depth = folderDepth + maskDepth;
              const indentPx = depth * 12;
              return (
              <div
                key={layer.id}
                draggable
                onDragStart={() => handleLayerDragStart(layer.id)}
                onDragOver={(e) => handleLayerDragOver(e, idx)}
                onDrop={(e) => handleLayerDrop(e, idx)}
                onDragEnd={handleLayerDragEnd}
                onClick={() => onActiveLayerChange?.(idx)}
                onContextMenu={(e) => openLayerContextMenu(e, layer.id, idx)}
                style={{
                  height: FRAME_H,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 4px",
                  paddingLeft: 4 + indentPx,
                  borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
                  fontSize: 11,
                  color: chrome.textDefault,
                  cursor: "grab",
                  gap: 2,
                  background:
                    dragOverIndex === idx
                      ? halo.rollOverColor
                      : idx === activeLayerIndex
                      ? halo.selectionColor
                      : "transparent",
                  boxSizing: "border-box",
                }}
              >
                {/* Folder collapse/expand toggle */}
                {layer.type === "folder" ? (
                  <button
                    title={layer.collapsed ? "Expand folder" : "Collapse folder"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFolderCollapsed(layer.id, !layer.collapsed);
                    }}
                    style={{
                      ...iconButtonStyle,
                      fontSize: 8,
                      color: chrome.textDefault,
                    }}
                  >
                    {layer.collapsed ? "▶" : "▼"}
                  </button>
                ) : (
                  <span style={{ width: 12, flexShrink: 0, display: "inline-block" }} />
                )}
                {/* Layer type icon (leftmost, before the name — Flash 8 order) */}
                <span
                  title={`Layer type: ${layer.type}`}
                  style={{
                    width: 12,
                    flexShrink: 0,
                    fontSize: 9,
                    lineHeight: 1,
                    textAlign: "center",
                    color:
                      layer.type === "guide" || layer.type === "guided"
                        ? "#1A5FB4"
                        : layer.type === "mask" || layer.type === "masked"
                        ? "#B02020"
                        : layer.type === "folder"
                        ? "#8A6D00"
                        : chrome.textDisabled,
                  }}
                >
                  {layer.type === "folder" ? <FolderIcon size={12} />
                    : layer.type === "guide" ? "⟂"
                    : layer.type === "guided" ? "⤳"
                    : layer.type === "mask" ? "◧"
                    : layer.type === "masked" ? "▣"
                    : "▦"}
                </span>
                {/* Layer name */}
                {editingLayerId === layer.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingLayerId(null);
                    }}
                    style={{
                      flex: 1,
                      fontSize: 11,
                      background: halo.inputBg,
                      color: halo.text,
                      border: `1px solid ${halo.haloBlue}`,
                      padding: "0 2px",
                      outline: "none",
                      minWidth: 0,
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={() => startRename(layer)}
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      opacity: layer.visible ? 1 : 0.5,
                      fontStyle: layer.type === "folder" ? "italic" : "normal",
                    }}
                  >
                    {layer.name}
                  </span>
                )}
                {/* Edit pencil — shown on the active layer (editable indicator) */}
                <span
                  style={{
                    width: 12,
                    flexShrink: 0,
                    textAlign: "center",
                    fontSize: 9,
                    lineHeight: 1,
                    color: "#8A6D00",
                    visibility: idx === activeLayerIndex ? "visible" : "hidden",
                  }}
                  title="Active layer"
                >
                  ✎
                </span>
                {/* Show / Hide column — red ✕ when hidden, dot when visible */}
                <button
                  title={layer.visible ? "Hide layer" : "Show layer"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTimelineChange(
                      setLayerVisible(timeline, layer.id, !layer.visible)
                    );
                  }}
                  style={{ ...iconButtonStyle, color: layer.visible ? chrome.textDisabled : content.playhead }}
                >
                  {layer.visible ? "•" : "✕"}
                </button>
                {/* Lock column — padlock when locked, dot when unlocked */}
                <button
                  title={layer.locked ? "Unlock layer" : "Lock layer"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTimelineChange(
                      setLayerLocked(timeline, layer.id, !layer.locked)
                    );
                  }}
                  style={{ ...iconButtonStyle, color: layer.locked ? chrome.textDefault : chrome.textDisabled, display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  {layer.locked ? <LockClosedIcon size={11} /> : "•"}
                </button>
                {/* Outline color chip (rightmost) — toggles outline view */}
                <button
                  title={layer.outlineMode ? "Exit outline mode" : "Show as outlines"}
                  onClick={(e) => {
                    e.stopPropagation();
                    const newMode = !layer.outlineMode;
                    if (e.altKey || e.ctrlKey) {
                      // Alt/Ctrl+click: toggle outline mode for all layers
                      let t = timeline;
                      for (const l of timeline.layers) {
                        t = setLayerOutlineMode(t, l.id, newMode);
                      }
                      onTimelineChange(t);
                    } else {
                      onTimelineChange(
                        setLayerOutlineMode(timeline, layer.id, newMode)
                      );
                    }
                  }}
                  style={{
                    ...iconButtonStyle,
                    padding: 0,
                    width: 11,
                    height: 11,
                    minWidth: 11,
                    flexShrink: 0,
                    border: layer.outlineMode
                      ? `2px solid ${layer.outlineColor ?? "#0000ff"}`
                      : `1px solid ${layer.outlineColor ?? "#0000ff"}`,
                    background: layer.outlineMode
                      ? "transparent"
                      : layer.outlineColor ?? "#0000ff",
                    borderRadius: 0,
                  }}
                />
              </div>
              );
            })}
          </div>
        </div>

        {/* Draggable divider between the LAYERS column and the FRAMES grid.
            Reuses the Shell's shared `useResize` hook (via the
            onLayerColumnResize* props) so it matches the editor's other
            dividers: col-resize cursor, pointer-capture drag, min/max clamp,
            persist-on-release, plus ArrowLeft/Right keyboard resize. Rendered as
            an accessible separator. When no handler is supplied (e.g. a direct
            Timeline render) it is an inert hairline. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize layers column"
          aria-valuenow={Math.round(layerColW)}
          aria-valuemin={LAYER_COL_MIN_WIDTH}
          aria-valuemax={LAYER_COL_MAX_WIDTH}
          tabIndex={onLayerColumnResizePointerDown ? 0 : -1}
          data-testid="timeline-layers-resizer"
          onPointerDown={onLayerColumnResizePointerDown}
          onKeyDown={onLayerColumnResizeKeyDown}
          title="Drag to resize the layers column"
          style={{
            width: 5,
            flexShrink: 0,
            alignSelf: "stretch",
            cursor: onLayerColumnResizePointerDown ? "col-resize" : "default",
            // Sit the visible hairline at the column edge; the 5px hit area
            // straddles it so it's easy to grab (like the Shell dividers).
            background: chrome.separator,
            outline: "none",
            touchAction: "none",
          }}
        />

        {/* Frame area */}
        <div
          ref={framesScrollRef}
          onScroll={(e) => {
            const el = e.target as HTMLElement;
            syncScroll("frames", el.scrollTop);
            refreshHScroll();
          }}
          style={{
            flex: 1,
            overflowX: "hidden",
            overflowY: "auto",
            position: "relative",
          }}
        >
          <div
            style={{
              width: isButtonMode ? frameCount * BUTTON_STATE_W : frameCount * FRAME_W,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Ruler */}
            <div
              onMouseDown={isButtonMode ? undefined : handleRulerMouseDown}
              style={{
                position: "sticky",
                top: 0,
                zIndex: 5,
                display: "flex",
                flexDirection: "row",
                height: RULER_H,
                // Frame ruler header: ~23px light gray with a darker bottom
                // border (Flash 8). RULER_H is fixed chrome here.
                background: chrome.insetFieldStrip,
                borderBottom: `${chrome.borderThin}px solid ${chrome.separator}`,
                flexShrink: 0,
                cursor: isButtonMode ? "default" : "col-resize",
              }}
            >
              {isButtonMode
                ? BUTTON_STATES.map((state, i) => (
                    <div
                      key={i}
                      onClick={() => onFrameChange(i)}
                      style={{
                        width: BUTTON_STATE_W,
                        height: RULER_H,
                        flexShrink: 0,
                        borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
                        boxSizing: "border-box",
                        background: i === currentFrame
                          ? state.color
                          : `${state.color}88`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: "bold",
                          color: state.titleColor,
                          lineHeight: 1,
                          pointerEvents: "none",
                          userSelect: "none",
                        }}
                      >
                        {state.label}
                      </span>
                    </div>
                  ))
                : Array.from({ length: frameCount }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        width: FRAME_W,
                        height: RULER_H,
                        flexShrink: 0,
                        // Every 5th frame line is the darker separator; the
                        // in-between ticks are the faint timeline gridline.
                        borderRight:
                          (i + 1) % 5 === 0
                            ? `1px solid ${chrome.separator}`
                            : `1px solid ${content.timelineGridline}`,
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "flex-end",
                        paddingBottom: 1,
                        paddingLeft: 1,
                      }}
                    >
                      {/* Label frame 1, then every 5th frame (5, 10, 15, …) */}
                      {(i === 0 || (i + 1) % 5 === 0) && (
                        <span
                          style={{
                            fontSize: 7,
                            color: chrome.textDefault,
                            lineHeight: 1,
                            pointerEvents: "none",
                          }}
                        >
                          {i + 1}
                        </span>
                      )}
                    </div>
                  ))}
              {/* Playhead marker on ruler */}
              <PlayheadMarker frame={currentFrame} colWidth={isButtonMode ? BUTTON_STATE_W : FRAME_W} />
              {/* Onion skin range markers (suppressed in button-symbol mode) */}
              {!isButtonMode && onionSkinEnabled && (
                <>
                  <OnionRangeMarker
                    frame={Math.max(0, currentFrame - onionBefore)}
                    color="#1A5FB4"
                    label="["
                    onDrag={(delta) => {
                      const newBefore = Math.max(0, onionBefore - delta);
                      onOnionRangeChange?.(newBefore, onionAfter);
                    }}
                    framesScrollRef={framesScrollRef}
                    frameCount={frameCount}
                    colWidth={FRAME_W}
                  />
                  <OnionRangeMarker
                    frame={Math.min(frameCount - 1, currentFrame + onionAfter)}
                    color="#0A7A0A"
                    label="]"
                    onDrag={(delta) => {
                      const newAfter = Math.max(0, onionAfter + delta);
                      onOnionRangeChange?.(onionBefore, newAfter);
                    }}
                    framesScrollRef={framesScrollRef}
                    frameCount={frameCount}
                    colWidth={FRAME_W}
                  />
                </>
              )}
            </div>

            {/* Layer frame rows */}
            {visibleLayers.map((layer) => {
              const idx = timeline.layers.indexOf(layer);
              return (
              <div
                key={layer.id}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  height: FRAME_H,
                  position: "relative",
                  // Subtle wash on the active layer's frame row (Halo selection tint).
                  background: idx === activeLayerIndex ? "rgba(127,206,255,0.30)" : "transparent",
                }}
              >
                {isButtonMode
                  ? /* Button-state columns: one wide cell per state */
                    BUTTON_STATES.map((btnState, fi) => {
                      const kf = layer.frames.find((f) => f.index === fi && f.isKeyframe);
                      const hasContent = kf && !kf.isEmpty && kf.displayObjects.length > 0;
                      const isActive = fi === currentFrame;
                      return (
                        <div
                          key={fi}
                          onClick={() => {
                            onFrameChange(fi);
                            onActiveLayerChange?.(idx);
                          }}
                          style={{
                            width: BUTTON_STATE_W,
                            height: FRAME_H,
                            flexShrink: 0,
                            borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
                            boxSizing: "border-box",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: isActive
                              ? `${btnState.color}cc`
                              : `${btnState.color}44`,
                            outline: isActive ? `2px solid ${btnState.titleColor}` : "none",
                            outlineOffset: "-2px",
                          }}
                        >
                          {/* Filled dot = content, hollow dot = empty keyframe, nothing = no keyframe */}
                          {kf && (
                            <div
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: hasContent ? btnState.titleColor : "transparent",
                                border: `1px solid ${btnState.titleColor}`,
                                flexShrink: 0,
                              }}
                            />
                          )}
                        </div>
                      );
                    })
                  : /* Normal frame cells */
                    Array.from({ length: frameCount }, (_, fi) => {
                      const state = getFrameState(layer, fi);
                      const tweenSt = getTweenState(layer, fi);
                      const kf = layer.frames.find((f) => f.index === fi && f.isKeyframe);
                      // isFirstInTweenSpan: this is the start keyframe of a motion or shape tween
                      const isFirstInTweenSpan =
                        (tweenSt === "motion-tween" && kf?.tweenType === "motion") ||
                        (tweenSt === "shape-tween" && kf?.tweenType === "shape");
                      // Determine if this frame is within the selected range
                      const isSelected =
                        selectedFrameRange !== null &&
                        selectedFrameRange.layerId === layer.id &&
                        fi >= selectedFrameRange.start &&
                        fi <= selectedFrameRange.end;
                      const hasScript = !!(kf?.script && kf.script.trim().length > 0);
                      const hasSound = !!(kf?.sound);
                      return (
                        <FrameCell
                          key={fi}
                          state={state}
                          tweenState={tweenSt}
                          isPlayhead={fi === currentFrame}
                          isSelected={isSelected}
                          isFirstInTweenSpan={isFirstInTweenSpan}
                          label={kf?.label || undefined}
                          labelType={kf?.labelType}
                          hasScript={hasScript}
                          hasSound={hasSound}
                          frameW={FRAME_W}
                          frameH={FRAME_H}
                          dotSize={DOT_SIZE}
                          dotBottom={DOT_BOTTOM}
                          onClick={(e) => {
                            onFrameChange(fi);
                            // Select keyframe for ease editing if it's a tween keyframe
                            if (kf?.tweenType === "motion" || kf?.tweenType === "shape") {
                              setSelectedKeyframe({ layerId: layer.id, frameIndex: fi });
                            } else {
                              setSelectedKeyframe(null);
                            }
                            // Shift-click: extend selection range from anchor
                            if (e.shiftKey && anchorFrameRef.current && anchorFrameRef.current.layerId === layer.id) {
                              const anchor = anchorFrameRef.current.frame;
                              const range = {
                                layerId: layer.id,
                                start: Math.min(anchor, fi),
                                end: Math.max(anchor, fi),
                              };
                              setSelectedFrameRange(range);
                              onSelectedFrameRangeChange?.(range);
                            } else {
                              // Plain click: set anchor and single-frame selection
                              anchorFrameRef.current = { layerId: layer.id, frame: fi };
                              const range = { layerId: layer.id, start: fi, end: fi };
                              setSelectedFrameRange(range);
                              onSelectedFrameRangeChange?.(range);
                            }
                          }}
                          onDoubleClick={() => onFrameDoubleClick?.(idx, fi)}
                          onContextMenu={(e) => openContextMenu(e, layer.id, fi)}
                        />
                      );
                    })}
              </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pinned bottom bar: layer tools (under the layer column) on the left,
          timeline status bar (under the frame grid) on the right — Flash 8 has
          these on a single row, aligned to their columns above. */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexShrink: 0,
          borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
        }}
      >
        {/* Layer footer: Insert Layer · Add Motion Guide · Insert Layer Folder
            (left), Delete Layer (trash) on the right. */}
        <div
          style={{
            width: layerColW,
            flexShrink: 0,
            height: STATUS_BAR_H,
            background: chrome.insetFieldStrip,
            borderRight: `${chrome.borderThin}px solid ${chrome.separator}`,
            display: "flex",
            alignItems: "center",
            padding: "0 5px",
            gap: 5,
            boxSizing: "border-box",
          }}
        >
          {!isButtonMode && (
            <>
              <button title="Insert Layer" onClick={handleAddLayer} style={layerFooterBtnStyle}>
                ⊞
              </button>
              <button
                title="Add Motion Guide"
                onClick={() => {
                  const ai = activeLayerIndex ?? 0;
                  handleAddMotionGuide(timeline.layers[ai]?.id ?? "", ai);
                }}
                style={layerFooterBtnStyle}
              >
                ⤳
              </button>
              <button title="Insert Layer Folder" onClick={handleAddLayerFolder} style={{ ...layerFooterBtnStyle, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <FolderIcon size={13} />
              </button>
              <div style={{ flex: 1 }} />
              <button
                title="Delete Layer"
                onClick={handleDeleteActiveLayer}
                disabled={timeline.layers.length <= 1}
                style={{
                  ...layerFooterBtnStyle,
                  color: timeline.layers.length <= 1 ? chrome.textDisabled : chrome.textDefault,
                  cursor: timeline.layers.length <= 1 ? "default" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <TrashIcon size={13} />
              </button>
            </>
          )}
        </div>

        {/* Status bar */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            flex: 1,
            minWidth: 0,
            height: STATUS_BAR_H,
            background: chrome.insetFieldStrip,
            padding: "0 6px",
            gap: 4,
          }}
        >
        {isButtonMode ? (
          /* In button-symbol mode show state name and arrow navigation only */
          <>
            <PlayBtn
              title="Previous state"
              onClick={() => onFrameChange(Math.max(0, currentFrame - 1))}
            >
              &lt;
            </PlayBtn>
            <PlayBtn
              title="Next state"
              onClick={() => onFrameChange(Math.min(3, currentFrame + 1))}
            >
              &gt;
            </PlayBtn>
            <div style={{ width: 8 }} />
            <span style={{ fontSize: 11, color: chrome.textDefault }}>
              Button state: <strong style={{ color: BUTTON_STATES[currentFrame]?.titleColor ?? chrome.textDefault }}>
                {BUTTON_STATES[currentFrame]?.label ?? "Up"}
              </strong>
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: chrome.textDisabled }}>
              Click a state column to edit its content
            </span>
          </>
        ) : (
          /* Normal playback controls */
          /* Flash 8 timeline status bar (no playback transport — that lived in
             the separate Controller). Left: frame-view toggles. Right: inset
             readouts + horizontal scrollbar. */
          <>
            {/* Center Frame */}
            <PlayBtn title="Center Frame" onClick={centerPlayhead}>
              ⊟
            </PlayBtn>

            {/* Onion Skin toggle */}
            <PlayBtn
              title={onionSkinEnabled ? "Onion Skin: on" : "Onion Skin: off"}
              onClick={() => onToggleOnionSkin?.()}
              active={onionSkinEnabled}
            >
              ◓
            </PlayBtn>

            {/* Onion Skin Outlines toggle */}
            <PlayBtn
              title={onionSkinOutlines ? "Onion Skin Outlines: on" : "Onion Skin Outlines: off"}
              onClick={() => onToggleOnionSkinOutlines?.()}
              active={onionSkinOutlines}
            >
              ◑
            </PlayBtn>

            {/* Edit Multiple Frames toggle */}
            <PlayBtn
              title={editMultipleFrames ? "Edit Multiple Frames: on" : "Edit Multiple Frames: off"}
              onClick={() => onToggleEditMultipleFrames?.()}
              active={editMultipleFrames}
            >
              ▥
            </PlayBtn>

            {/* Modify Onion Markers menu */}
            <div style={{ position: "relative", display: "flex" }}>
              <PlayBtn
                title="Modify Onion Markers"
                onClick={() => setOnionMenuOpen((o) => !o)}
                active={onionMenuOpen}
              >
                ⟦⟧
              </PlayBtn>
              {onionMenuOpen && (
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    bottom: STATUS_BAR_H - 2,
                    left: 0,
                    background: chrome.panelBg,
                    border: `1px solid ${chrome.separator}`,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    zIndex: 20,
                    minWidth: 130,
                    padding: "2px 0",
                  }}
                >
                  {([
                    ["Onion 2", 2, 2],
                    ["Onion 5", 5, 5],
                    ["Onion All", currentFrame, frameCount],
                  ] as const).map(([label, before, after]) => (
                    <div
                      key={label}
                      onClick={() => {
                        onOnionRangeChange?.(before, after);
                        if (!onionSkinEnabled) onToggleOnionSkin?.();
                        setOnionMenuOpen(false);
                      }}
                      style={{
                        fontSize: 11,
                        color: chrome.textDefault,
                        padding: "3px 10px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = halo.rollOverColor)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Small separator between the frame-view toggles and the readouts */}
            <div style={{ width: 6, flexShrink: 0 }} />

            {/* Current Frame (editable) */}
            <FrameCounterInput
              currentFrame={currentFrame}
              frameCount={displayFrameCount}
              onFrameChange={onFrameChange}
              width={Math.round(52 * scale)}
            />

            {/* Frame Rate (inset readout) */}
            <span style={{ ...insetReadoutStyle, width: Math.round(80 * scale) }} title="Frame rate">
              {frameRate.toFixed(1)} fps
            </span>

            {/* Elapsed Time (inset readout) */}
            <span style={{ ...insetReadoutStyle, width: Math.round(68 * scale) }} title="Elapsed time at current frame">
              {(currentFrame / Math.max(1, frameRate)).toFixed(1)}s
            </span>

            {/* Horizontal scrollbar — drives the frame grid */}
            <HScrollBar
              left={hScroll.left}
              scrollWidth={hScroll.scrollWidth}
              clientWidth={hScroll.clientWidth}
              onScrollTo={(x) => {
                if (framesScrollRef.current) framesScrollRef.current.scrollLeft = x;
                refreshHScroll();
              }}
            />
          </>
        )}
        </div>
      </div>

      {/* Ease control — shown when a tween keyframe is selected */}
      {selectedKeyframe && (() => {
        const layer = timeline.layers.find((l) => l.id === selectedKeyframe.layerId);
        const kf = layer?.frames.find(
          (f) => f.index === selectedKeyframe.frameIndex && f.isKeyframe
        );
        if (!kf || (kf.tweenType !== "motion" && kf.tweenType !== "shape")) return null;
        const isShape = kf.tweenType === "shape";
        return (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              height: 22,
              background: chrome.insetFieldStrip,
              borderTop: `${chrome.borderThin}px solid ${chrome.separator}`,
              flexShrink: 0,
              padding: "0 8px",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 11, color: chrome.textDefault }}>Ease:</span>
            <input
              type="number"
              min={-100}
              max={100}
              value={isShape ? kf.shapeEase : kf.motionEase}
              onChange={(e) => {
                const ease = Math.max(-100, Math.min(100, Number(e.target.value)));
                if (isShape) {
                  const newTimeline = setShapeTween(
                    timeline,
                    selectedKeyframe.layerId,
                    selectedKeyframe.frameIndex,
                    { ease, blend: kf.shapeBlend }
                  );
                  onTimelineChange(newTimeline);
                  onSetShapeTweenEase?.(
                    selectedKeyframe.layerId,
                    selectedKeyframe.frameIndex,
                    ease,
                    kf.shapeBlend
                  );
                } else {
                  const newTimeline = setMotionTween(
                    timeline,
                    selectedKeyframe.layerId,
                    selectedKeyframe.frameIndex,
                    ease
                  );
                  onTimelineChange(newTimeline);
                  onKeyframeEaseChange?.(
                    selectedKeyframe.layerId,
                    selectedKeyframe.frameIndex,
                    ease
                  );
                }
              }}
              style={{
                width: 56,
                fontSize: 11,
                background: halo.inputBg,
                color: halo.text,
                border: `1px solid ${halo.inputBorder}`,
                padding: "1px 4px",
                borderRadius: 2,
                outline: "none",
              }}
            />
            <span style={{ fontSize: 9, color: chrome.textDisabled }}>(-100 to 100)</span>
            {/* Custom ease button — only for motion tweens */}
            {!isShape && (
              <>
                <button
                  onClick={() => setEaseCurveDialogOpen(true)}
                  style={{
                    fontSize: 11,
                    background: kf.motionEaseCurve ? "#D6F0D6" : chrome.panelBg,
                    border: `1px solid ${kf.motionEaseCurve ? "#0A7A0A" : chrome.separator}`,
                    color: kf.motionEaseCurve ? "#0A5A0A" : chrome.textDefault,
                    cursor: "pointer",
                    padding: "1px 6px",
                    borderRadius: 2,
                    marginLeft: 4,
                  }}
                  title="Open custom ease curve editor"
                >
                  Custom…
                </button>
                {kf.motionEaseCurve && (
                  <button
                    onClick={() => {
                      const newTimeline = setMotionTween(
                        timeline,
                        selectedKeyframe.layerId,
                        selectedKeyframe.frameIndex,
                        undefined,
                        null
                      );
                      onTimelineChange(newTimeline);
                    }}
                    style={{
                      fontSize: 9,
                      background: "none",
                      border: "none",
                      color: chrome.textDisabled,
                      cursor: "pointer",
                      padding: "1px 4px",
                    }}
                    title="Clear custom ease curve"
                  >
                    ✕
                  </button>
                )}
                {/* Rotate direction */}
                <span style={{ fontSize: 11, color: chrome.textDefault, marginLeft: 8 }}>Rotate:</span>
                <select
                  value={kf.motionRotate}
                  onChange={(e) => {
                    const newTimeline = updateMotionTweenProps(
                      timeline,
                      selectedKeyframe.layerId,
                      selectedKeyframe.frameIndex,
                      { motionRotate: e.target.value as "none" | "auto" | "cw" | "ccw" }
                    );
                    onTimelineChange(newTimeline);
                  }}
                  style={{
                    fontSize: 11,
                    background: halo.inputBg,
                    color: halo.text,
                    border: `1px solid ${halo.inputBorder}`,
                    padding: "1px 2px",
                    borderRadius: 2,
                    outline: "none",
                  }}
                  title="Rotation direction during tween"
                >
                  <option value="none">None</option>
                  <option value="cw">CW</option>
                  <option value="ccw">CCW</option>
                  <option value="auto">Auto</option>
                </select>
                {/* Extra rotation turns — only visible when rotate is CW or CCW */}
                {(kf.motionRotate === "cw" || kf.motionRotate === "ccw") && (
                  <>
                    <span style={{ fontSize: 11, color: chrome.textDefault }}>×</span>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={kf.motionRotateCount}
                      onChange={(e) => {
                        const count = Math.max(0, Math.min(99, Number(e.target.value) | 0));
                        const newTimeline = updateMotionTweenProps(
                          timeline,
                          selectedKeyframe.layerId,
                          selectedKeyframe.frameIndex,
                          { motionRotateCount: count }
                        );
                        onTimelineChange(newTimeline);
                      }}
                      style={{
                        width: 36,
                        fontSize: 11,
                        background: halo.inputBg,
                        color: halo.text,
                        border: `1px solid ${halo.inputBorder}`,
                        padding: "1px 4px",
                        borderRadius: 2,
                        outline: "none",
                      }}
                      title="Extra full rotations"
                    />
                  </>
                )}
                {/* Scale checkbox */}
                <label
                  style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: chrome.textDefault, marginLeft: 8, cursor: "pointer" }}
                  title="Interpolate scale during tween"
                >
                  <input
                    type="checkbox"
                    checked={kf.motionScale}
                    onChange={(e) => {
                      const newTimeline = updateMotionTweenProps(
                        timeline,
                        selectedKeyframe.layerId,
                        selectedKeyframe.frameIndex,
                        { motionScale: e.target.checked }
                      );
                      onTimelineChange(newTimeline);
                    }}
                    style={{ margin: 0 }}
                  />
                  Scale
                </label>
                {/* Orient to path checkbox */}
                <label
                  style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: chrome.textDefault, cursor: "pointer" }}
                  title="Orient symbol to motion path direction"
                >
                  <input
                    type="checkbox"
                    checked={kf.motionOrientToPath}
                    onChange={(e) => {
                      const newTimeline = updateMotionTweenProps(
                        timeline,
                        selectedKeyframe.layerId,
                        selectedKeyframe.frameIndex,
                        { motionOrientToPath: e.target.checked }
                      );
                      onTimelineChange(newTimeline);
                    }}
                    style={{ margin: 0 }}
                  />
                  Orient
                </label>
                {/* Sync checkbox */}
                <label
                  style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: chrome.textDefault, cursor: "pointer" }}
                  title="Sync symbol animation with parent timeline"
                >
                  <input
                    type="checkbox"
                    checked={kf.motionSync}
                    onChange={(e) => {
                      const newTimeline = updateMotionTweenProps(
                        timeline,
                        selectedKeyframe.layerId,
                        selectedKeyframe.frameIndex,
                        { motionSync: e.target.checked }
                      );
                      onTimelineChange(newTimeline);
                    }}
                    style={{ margin: 0 }}
                  />
                  Sync
                </label>
                {/* Snap checkbox */}
                <label
                  style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: chrome.textDefault, cursor: "pointer" }}
                  title="Snap object registration point to motion guide path"
                >
                  <input
                    type="checkbox"
                    checked={kf.motionSnap}
                    onChange={(e) => {
                      const newTimeline = updateMotionTweenProps(
                        timeline,
                        selectedKeyframe.layerId,
                        selectedKeyframe.frameIndex,
                        { motionSnap: e.target.checked }
                      );
                      onTimelineChange(newTimeline);
                    }}
                    style={{ margin: 0 }}
                  />
                  Snap
                </label>
              </>
            )}
            {/* Blend mode selector — only for shape tweens */}
            {isShape && (
              <>
                <span style={{ fontSize: 11, color: chrome.textDefault, marginLeft: 8 }}>Blend:</span>
                <select
                  value={kf.shapeBlend}
                  onChange={(e) => {
                    const blend = e.target.value as "distributive" | "angular";
                    const ease = kf.shapeEase;
                    const newTimeline = setShapeTween(
                      timeline,
                      selectedKeyframe.layerId,
                      selectedKeyframe.frameIndex,
                      { ease, blend }
                    );
                    onTimelineChange(newTimeline);
                    onSetShapeTweenEase?.(
                      selectedKeyframe.layerId,
                      selectedKeyframe.frameIndex,
                      ease,
                      blend
                    );
                  }}
                  style={{
                    fontSize: 11,
                    background: halo.inputBg,
                    color: halo.text,
                    border: `1px solid ${halo.inputBorder}`,
                    padding: "1px 2px",
                    borderRadius: 2,
                    outline: "none",
                  }}
                >
                  <option value="distributive">Distributive</option>
                  <option value="angular">Angular</option>
                </select>
              </>
            )}
          </div>
        );
      })()}

      {/* Custom ease curve dialog */}
      {easeCurveDialogOpen && selectedKeyframe && (() => {
        const layer = timeline.layers.find((l) => l.id === selectedKeyframe.layerId);
        const kf = layer?.frames.find(
          (f) => f.index === selectedKeyframe.frameIndex && f.isKeyframe
        );
        if (!kf) return null;
        const initialCurve: EaseCurve = kf.motionEaseCurve ?? {
          x1: 0.25, y1: 0.1,
          x2: 0.25, y2: 1.0,
        };
        return (
          <EaseCurveDialog
            initialCurve={initialCurve}
            onConfirm={(curve) => {
              const newTimeline = setMotionTween(
                timeline,
                selectedKeyframe.layerId,
                selectedKeyframe.frameIndex,
                undefined,
                curve
              );
              onTimelineChange(newTimeline);
            }}
            onClose={() => setEaseCurveDialogOpen(false)}
          />
        );
      })()}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={handleContextAction}
          onClose={() => setContextMenu(null)}
          timeline={timeline}
          layerId={contextMenu.layerId}
          frameIndex={contextMenu.frameIndex}
          selectedFrameRange={selectedFrameRange}
          hasFrameClipboard={hasFrameClipboard}
          canCopyFrames={!!onCopyFrames}
          canCutFrames={!!onCutFrames}
          canPasteFrames={!!onPasteFrames}
        />
      )}

      {/* Layer type context menu */}
      {layerContextMenu && (
        <LayerTypeMenuPopup
          x={layerContextMenu.x}
          y={layerContextMenu.y}
          currentType={timeline.layers.find((l) => l.id === layerContextMenu.layerId)?.type ?? "normal"}
          onSetType={(type) => handleSetLayerType(layerContextMenu.layerId, type)}
          onAddMotionGuide={() => handleAddMotionGuide(layerContextMenu.layerId, layerContextMenu.layerIndex)}
          onClose={() => setLayerContextMenu(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const iconButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: chrome.textDisabled,
  cursor: "pointer",
  padding: 0,
  fontSize: 10,
  lineHeight: 1,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 14,
  height: 14,
};

/** Flat icon button used in the layer footer (insert layer / guide / folder / trash). */
const layerFooterBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: chrome.textDefault,
  cursor: "pointer",
  padding: "2px 3px",
  fontSize: 13,
  lineHeight: 1,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/** Inset/sunken numeric readout used in the timeline status bar. */
const insetReadoutStyle: React.CSSProperties = {
  fontSize: 9,
  color: chrome.textDefault,
  background: halo.inputBg,
  border: `1px solid ${halo.inputBorderLight}`,
  borderTopColor: halo.inputBorderDark,
  borderLeftColor: halo.inputBorderDark,
  borderRadius: 1,
  padding: "1px 0",
  lineHeight: "14px",
  whiteSpace: "nowrap",
  textAlign: "center",
  overflow: "hidden",
  boxSizing: "border-box",
  flexShrink: 0,
};

function FrameCounterInput({
  currentFrame,
  frameCount,
  onFrameChange,
  width,
}: {
  currentFrame: number;
  frameCount: number;
  onFrameChange: (frame: number) => void;
  /** Box width in px (already scaled by the uiScale preference). */
  width: number;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");

  const display = currentFrame + 1;

  const commit = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n)) {
      const clamped = Math.max(1, Math.min(frameCount, n));
      onFrameChange(clamped - 1);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={() => commit(inputValue)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(inputValue); }
          if (e.key === "Escape") { setEditing(false); }
          e.stopPropagation();
        }}
        style={{
          width,
          boxSizing: "border-box",
          fontSize: 11,
          background: halo.inputBg,
          color: halo.text,
          border: `1px solid ${halo.haloBlue}`,
          padding: "1px 3px",
          borderRadius: 2,
          outline: "none",
          textAlign: "right",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <span
      title="Current frame — click to jump"
      onClick={() => { setEditing(true); setInputValue(String(display)); }}
      style={{ ...insetReadoutStyle, width, cursor: "text", userSelect: "none" }}
    >
      {display}
    </span>
  );
}

function PlayBtn({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title?: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: active ? halo.selectionColor : chrome.panelBg,
        border: `1px solid ${active ? halo.haloBlue : chrome.separator}`,
        color: chrome.textDefault,
        cursor: "pointer",
        fontSize: 11,
        padding: "1px 5px",
        borderRadius: 2,
        lineHeight: 1.4,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Horizontal scrollbar for the frame grid, hosted in the timeline status bar.
 * Reflects the grid's scrollLeft/scrollWidth/clientWidth and drives scrollLeft
 * via `onScrollTo` when the thumb is dragged or the track is clicked.
 */
function HScrollBar({
  left,
  scrollWidth,
  clientWidth,
  onScrollTo,
}: {
  left: number;
  scrollWidth: number;
  clientWidth: number;
  onScrollTo: (scrollLeft: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const maxScroll = Math.max(0, scrollWidth - clientWidth);
  const hasOverflow = maxScroll > 1;
  const thumbPct = Math.max(8, Math.min(100, (clientWidth / scrollWidth) * 100));
  const leftPct = hasOverflow ? (left / scrollWidth) * 100 : 0;

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track || !hasOverflow) return;
    const trackW = track.clientWidth;
    const startX = e.clientX;
    const startLeft = left;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const deltaScroll = (dx / trackW) * scrollWidth;
      onScrollTo(Math.max(0, Math.min(maxScroll, startLeft + deltaScroll)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={trackRef}
      style={{
        position: "relative",
        flex: 1,
        minWidth: 40,
        height: 14,
        background: halo.inputBg,
        border: `1px solid ${chrome.separator}`,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <div
        onMouseDown={startDrag}
        style={{
          position: "absolute",
          top: 1,
          bottom: 1,
          left: `${leftPct}%`,
          width: `${thumbPct}%`,
          background: hasOverflow ? halo.borderColor : chrome.insetFieldStrip,
          border: `1px solid ${chrome.separator}`,
          borderRadius: 2,
          cursor: hasOverflow ? "grab" : "default",
        }}
      />
    </div>
  );
}

function ContextMenuPopup({
  x,
  y,
  onAction,
  timeline,
  layerId,
  frameIndex,
  selectedFrameRange = null,
  hasFrameClipboard = false,
  canCopyFrames = false,
  canCutFrames = false,
  canPasteFrames = false,
}: {
  x: number;
  y: number;
  onAction: (action: string) => void;
  onClose: () => void;
  timeline: TimelineModel;
  layerId: string;
  frameIndex: number;
  selectedFrameRange?: { layerId: string; start: number; end: number } | null;
  hasFrameClipboard?: boolean;
  canCopyFrames?: boolean;
  canCutFrames?: boolean;
  canPasteFrames?: boolean;
}) {
  // Determine if the target is a keyframe and its tween state
  const layer = timeline.layers.find((l) => l.id === layerId);
  const kf = layer?.frames.find((f) => f.index === frameIndex && f.isKeyframe);
  const hasTween = kf?.tweenType === "motion" || kf?.tweenType === "shape";

  // Determine if a multi-frame range is selected on this layer
  const isMultiFrameRange =
    selectedFrameRange?.layerId === layerId &&
    selectedFrameRange.end > selectedFrameRange.start;

  const items: { label: string; action: string; shortcut?: string; separator?: boolean; disabled?: boolean }[] = [
    { label: "Insert Frame", action: "insert-frame", shortcut: "F5" },
    { label: "Insert Keyframe", action: "insert-keyframe", shortcut: "F6" },
    {
      label: "Insert Blank Keyframe",
      action: "insert-blank-keyframe",
      shortcut: "F7",
    },
    { label: "Clear Keyframe", action: "clear-keyframe", shortcut: "⇧F6" },
    { label: isMultiFrameRange ? "Remove Frames" : "Remove Frame", action: "remove-frame", shortcut: "⇧F5" },
    // Separator + tween items
    ...(kf
      ? [
          { label: "---", action: "---", separator: true },
          ...(!hasTween
            ? [
                { label: "Create Motion Tween", action: "create-motion-tween" },
                { label: "Create Shape Tween", action: "create-shape-tween" },
              ]
            : []),
          ...(hasTween
            ? [{ label: "Remove Tween", action: "remove-tween" }]
            : []),
        ]
      : []),
    // Separator + clipboard items (shown when callbacks are wired)
    ...((canCopyFrames || canCutFrames || canPasteFrames)
      ? [
          { label: "---", action: "---clipboard", separator: true },
          ...(canCopyFrames
            ? [{ label: "Copy Frames", action: "copy-frames" }]
            : []),
          ...(canCutFrames
            ? [{ label: "Cut Frames", action: "cut-frames" }]
            : []),
          ...(canPasteFrames
            ? [{ label: "Paste Frames", action: "paste-frames", disabled: !hasFrameClipboard }]
            : []),
        ]
      : []),
    // Separator + frame conversion items (always shown)
    { label: "---", action: "---convert", separator: true },
    { label: "Convert to Keyframes", action: "convert-to-keyframes" },
    ...(isMultiFrameRange
      ? [{ label: "Reverse Frames", action: "reverse-frames" }]
      : []),
  ];

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: chrome.panelBg,
        border: `1px solid ${chrome.separator}`,
        borderRadius: 3,
        zIndex: 9999,
        minWidth: 180,
        boxShadow: "2px 4px 12px rgba(0,0,0,0.3)",
        padding: "3px 0",
        ...chromeFont(),
      }}
    >
      {items.map((item) => {
        if (item.separator) {
          return (
            <div
              key={item.action + Math.random()}
              style={{
                height: 1,
                background: chrome.separator,
                margin: "3px 0",
              }}
            />
          );
        }
        const isDisabled = !!item.disabled;
        return (
          <div
            key={item.action}
            onClick={() => { if (!isDisabled) onAction(item.action); }}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "4px 12px",
              fontSize: 11,
              color: isDisabled ? chrome.textDisabled : chrome.textDefault,
              cursor: isDisabled ? "default" : "pointer",
              gap: 16,
            }}
            onMouseEnter={(e) => {
              if (!isDisabled) {
                (e.currentTarget as HTMLElement).style.background = halo.haloBlue;
                (e.currentTarget as HTMLElement).style.color = halo.inputBg;
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
              (e.currentTarget as HTMLElement).style.color = isDisabled ? chrome.textDisabled : chrome.textDefault;
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 10, color: chrome.textDisabled }}>{item.shortcut}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer Type context menu popup
// ---------------------------------------------------------------------------

function LayerTypeMenuPopup({
  x,
  y,
  currentType,
  onSetType,
  onAddMotionGuide,
  onClose,
}: {
  x: number;
  y: number;
  currentType: LayerType;
  onSetType: (type: LayerType) => void;
  onAddMotionGuide: () => void;
  onClose: () => void;
}) {
  const types: { type: LayerType; label: string }[] = [
    { type: "normal", label: "Normal" },
    { type: "guide", label: "Guide" },
    { type: "guided", label: "Guided" },
    { type: "mask", label: "Mask" },
    { type: "masked", label: "Masked" },
  ];

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: chrome.panelBg,
        border: `1px solid ${chrome.separator}`,
        borderRadius: 3,
        zIndex: 9999,
        minWidth: 160,
        boxShadow: "2px 4px 12px rgba(0,0,0,0.3)",
        padding: "3px 0",
        ...chromeFont(),
      }}
    >
      <div
        style={{
          padding: "3px 12px 4px",
          fontSize: 10,
          color: chrome.textDisabled,
          borderBottom: `1px solid ${chrome.separator}`,
          marginBottom: 3,
        }}
      >
        Layer Type
      </div>
      {/* Add Motion Guide action */}
      <div
        onClick={() => { onAddMotionGuide(); onClose(); }}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 12px",
          fontSize: 11,
          color: chrome.textDefault,
          cursor: "pointer",
          gap: 8,
          borderBottom: `1px solid ${chrome.separator}`,
          marginBottom: 3,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = halo.haloBlue;
          (e.currentTarget as HTMLElement).style.color = halo.inputBg;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = chrome.textDefault;
        }}
      >
        <span>Add Motion Guide</span>
      </div>
      {types.map(({ type, label }) => (
        <div
          key={type}
          onClick={() => { onSetType(type); onClose(); }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 12px",
            fontSize: 11,
            color: currentType === type ? halo.haloBlue : chrome.textDefault,
            cursor: "pointer",
            gap: 8,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = halo.haloBlue;
            (e.currentTarget as HTMLElement).style.color = halo.inputBg;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = currentType === type ? halo.haloBlue : chrome.textDefault;
          }}
        >
          <span>{label}</span>
          {currentType === type && (
            <span style={{ fontSize: 10, color: halo.haloBlue }}>*</span>
          )}
        </div>
      ))}
    </div>
  );
}
