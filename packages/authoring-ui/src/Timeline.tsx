import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Layer, LayerType, Timeline as TimelineModel } from "@flash/core";
import {
  addLayer,
  clearTween,
  deleteLayer,
  insertBlankKeyframe,
  insertFrame,
  insertKeyframe,
  layerFrameCount,
  moveLayer,
  removeFrame,
  clearKeyframe,
  renameLayer,
  setLayerLocked,
  setLayerType,
  setLayerVisible,
  setMotionTween,
  setShapeTween,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAYER_COL_WIDTH = 130;
const FRAME_W = 7;
const FRAME_H = 20;
const RULER_H = 16;
const PLAYBACK_BAR_H = 24;
const MIN_VISIBLE_FRAMES = 48;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TimelineProps {
  timeline: TimelineModel;
  currentFrame: number;
  isPlaying: boolean;
  frameRate?: number;
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
  onionBefore?: number;
  onionAfter?: number;
  onToggleOnionSkin?: () => void;
  onOnionRangeChange?: (before: number, after: number) => void;
  // Frame clipboard props
  onCopyFrames?: (startFrame: number, endFrame: number) => void;
  onCutFrames?: (startFrame: number, endFrame: number) => void;
  onPasteFrames?: (atFrame: number) => void;
  hasFrameClipboard?: boolean;
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


function totalFrameCount(timeline: TimelineModel): number {
  const max = timeline.layers.reduce(
    (m, l) => Math.max(m, layerFrameCount(l)),
    1
  );
  return Math.max(max, MIN_VISIBLE_FRAMES);
}

// ---------------------------------------------------------------------------
// Frame cell rendering
// ---------------------------------------------------------------------------

function FrameCell({
  state,
  tweenState,
  isPlayhead,
  isFirstInTweenSpan,
  label,
  onClick,
  onContextMenu,
}: {
  state: FrameState;
  tweenState: TweenState;
  isPlayhead: boolean;
  /** True for the start keyframe of a tween so we can render the arrow */
  isFirstInTweenSpan?: boolean;
  label?: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  // Background color logic: tween state overrides normal span color
  let bg: string;
  if (isPlayhead) {
    bg = "rgba(255,40,40,0.55)";
  } else if (tweenState === "motion-tween") {
    bg = "#3a4a70";  // blue-purple band for motion tween
  } else if (tweenState === "broken-tween") {
    bg = "#5a4a20";  // orange/yellow-ish for broken motion tween
  } else if (tweenState === "shape-tween") {
    bg = "#1e4a1e";  // green band for shape tween
  } else if (tweenState === "broken-shape-tween") {
    bg = "#3a3010";  // dark orange/brown for broken shape tween
  } else if (state === "span") {
    bg = "#4a6080";
  } else if (state === "keyframe" || state === "blank-keyframe") {
    bg = "#3a3a3a";
  } else {
    bg = "#383838";
  }

  const border = isPlayhead
    ? "1px solid #cc0000"
    : "1px solid #252525";

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        position: "relative",
        width: FRAME_W,
        height: FRAME_H,
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
      {/* Keyframe dot */}
      {(state === "keyframe" || state === "blank-keyframe") && (
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: state === "keyframe" ? "#222" : "transparent",
            border: "1px solid #222",
            flexShrink: 0,
            zIndex: 1,
          }}
        />
      )}
      {/* Frame label tag */}
      {label && (
        <div
          style={{
            position: "absolute",
            top: 1,
            left: 1,
            fontSize: 7,
            color: "#f0c040",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 2,
            lineHeight: 1,
          }}
        >
          {label}
        </div>
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
            color: "#8ab4e8",
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
            color: "#6ecf6e",
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
            backgroundImage:
              "repeating-linear-gradient(90deg,#c08020 0,#c08020 2px,transparent 2px,transparent 4px)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}
      {/* Broken shape tween dashed underline indicator (green dashes) */}
      {tweenState === "broken-shape-tween" && (
        <div
          style={{
            position: "absolute",
            bottom: 2,
            left: 0,
            right: 0,
            height: 2,
            backgroundImage:
              "repeating-linear-gradient(90deg,#5aaa30 0,#5aaa30 2px,transparent 2px,transparent 4px)",
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
            background: "#6080a0",
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playhead marker (sits in the ruler row)
// ---------------------------------------------------------------------------

function PlayheadMarker({ frame }: { frame: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: frame * FRAME_W,
        top: 0,
        width: FRAME_W,
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
          borderTop: "7px solid #ff3030",
          position: "absolute",
          left: FRAME_W / 2 - 4,
          top: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: Math.floor(FRAME_W / 2),
          top: 9,
          width: 1,
          height: RULER_H - 9,
          background: "#ff3030",
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
}: {
  frame: number;
  color: string;
  label: string;
  /** Called with integer frame delta when dragged */
  onDrag: (frameDelta: number) => void;
  framesScrollRef: React.RefObject<HTMLDivElement | null>;
  frameCount: number;
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
        const frameDelta = Math.round(dx / FRAME_W);
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
    [frame, onDrag, framesScrollRef]
  );

  const clampedFrame = Math.max(0, Math.min(frameCount - 1, frame));

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: "absolute",
        left: clampedFrame * FRAME_W,
        top: 0,
        width: FRAME_W,
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
// Main Timeline component
// ---------------------------------------------------------------------------

export function Timeline({
  timeline,
  currentFrame,
  isPlaying,
  frameRate = 12,
  activeLayerIndex = 0,
  onActiveLayerChange,
  onTimelineChange,
  onFrameChange,
  onPlayingChange,
  onKeyframeEaseChange,
  onSetShapeTween,
  onSetShapeTweenEase,
  onionSkinEnabled = false,
  onionBefore = 2,
  onionAfter = 2,
  onToggleOnionSkin,
  onOnionRangeChange,
  onCopyFrames,
  onCutFrames,
  onPasteFrames,
  hasFrameClipboard = false,
}: TimelineProps): React.ReactElement {
  const [loop, setLoop] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [layerContextMenu, setLayerContextMenu] = useState<LayerContextMenu | null>(null);
  // Track selected keyframe for ease editing
  const [selectedKeyframe, setSelectedKeyframe] = useState<{
    layerId: string;
    frameIndex: number;
  } | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const frameCount = totalFrameCount(timeline);
  const panelRef = useRef<HTMLDivElement>(null);
  const framesScrollRef = useRef<HTMLDivElement>(null);
  const layerScrollRef = useRef<HTMLDivElement>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;
  const loopRef = useRef(loop);
  loopRef.current = loop;
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

  // Playback is driven by the parent Shell via requestAnimationFrame.
  // Timeline receives currentFrame updates via onFrameChange calls from Shell.

  // Auto-scroll playhead into view
  useEffect(() => {
    if (framesScrollRef.current) {
      const x = currentFrame * FRAME_W;
      const el = framesScrollRef.current;
      if (x < el.scrollLeft || x + FRAME_W > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
      }
    }
  }, [currentFrame]);

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

      if (e.key === "F5") {
        e.preventDefault();
        onTimelineChange(insertFrame(timeline, selectedLayerId, currentFrame));
      } else if (e.key === "F6") {
        e.preventDefault();
        onTimelineChange(insertKeyframe(timeline, selectedLayerId, currentFrame));
      } else if (e.key === "F7") {
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
    onTimelineChange,
    onFrameChange,
    onPlayingChange,
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
        case "remove-frame":
          onTimelineChange(removeFrame(timeline, _layerId, frameIndex));
          break;
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
        case "copy-frames":
          onCopyFrames?.(frameIndex, frameIndex);
          break;
        case "cut-frames":
          onCutFrames?.(frameIndex, frameIndex);
          break;
        case "paste-frames":
          onPasteFrames?.(frameIndex);
          break;
      }
    },
    [contextMenu, timeline, onTimelineChange, onSetShapeTween, onCopyFrames, onCutFrames, onPasteFrames]
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
      style={{
        display: "flex",
        flexDirection: "column",
        height: 180,
        flexShrink: 0,
        background: "#2d2d2d",
        borderTop: "1px solid #1a1a1a",
        outline: "none",
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: 22,
          background: "#3a3a3a",
          borderBottom: "1px solid #1a1a1a",
          padding: "0 6px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "#c0c0c0",
            fontWeight: "bold",
            flex: 1,
          }}
        >
          Timeline
        </span>
      </div>

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
            width: LAYER_COL_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid #1a1a1a",
            display: "flex",
            flexDirection: "column",
            background: "#2d2d2d",
          }}
        >
          {/* Layer header spacer (aligns with ruler) */}
          <div
            style={{
              height: RULER_H,
              background: "#333",
              borderBottom: "1px solid #1a1a1a",
              flexShrink: 0,
            }}
          />
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
            {timeline.layers.map((layer, idx) => (
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
                  borderBottom: "1px solid #1a1a1a",
                  fontSize: 10,
                  color: "#c0c0c0",
                  cursor: "grab",
                  gap: 2,
                  background:
                    dragOverIndex === idx
                      ? "#3a5080"
                      : idx === activeLayerIndex
                      ? "#2a4060"
                      : "transparent",
                  boxSizing: "border-box",
                }}
              >
                {/* Eye icon */}
                <button
                  title={layer.visible ? "Hide layer" : "Show layer"}
                  onClick={() =>
                    onTimelineChange(
                      setLayerVisible(timeline, layer.id, !layer.visible)
                    )
                  }
                  style={iconButtonStyle}
                >
                  {layer.visible ? "●" : "○"}
                </button>
                {/* Lock icon */}
                <button
                  title={layer.locked ? "Unlock layer" : "Lock layer"}
                  onClick={() =>
                    onTimelineChange(
                      setLayerLocked(timeline, layer.id, !layer.locked)
                    )
                  }
                  style={iconButtonStyle}
                >
                  {layer.locked ? "L" : "U"}
                </button>
                {/* Layer type indicator (non-normal types) */}
                {layer.type !== "normal" && (
                  <span
                    title={`Layer type: ${layer.type}`}
                    style={{
                      fontSize: 8,
                      color:
                        layer.type === "guide" || layer.type === "guided"
                          ? "#70a0ff"
                          : layer.type === "mask" || layer.type === "masked"
                          ? "#ff7070"
                          : "#aaa",
                      flexShrink: 0,
                      lineHeight: 1,
                    }}
                  >
                    {layer.type === "guide" ? "G"
                      : layer.type === "guided" ? "gd"
                      : layer.type === "mask" ? "M"
                      : layer.type === "masked" ? "mk"
                      : layer.type === "folder" ? "F"
                      : ""}
                  </span>
                )}
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
                      fontSize: 10,
                      background: "#1a1a1a",
                      color: "#ffffff",
                      border: "1px solid #5050ff",
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
                    }}
                  >
                    {layer.name}
                  </span>
                )}
                {/* Delete button */}
                <button
                  title="Delete layer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (timeline.layers.length <= 1) return;
                    const hasContent = layer.frames.some(
                      (f) => f.isKeyframe && !f.isEmpty && f.displayObjects.length > 0
                    );
                    if (hasContent && !window.confirm("Delete layer with content?")) return;
                    onTimelineChange(deleteLayer(timeline, layer.id));
                    onActiveLayerChange?.(Math.max(0, idx - 1));
                  }}
                  style={{ ...iconButtonStyle, color: "#c04040" }}
                >
                  X
                </button>
              </div>
            ))}
          </div>
          {/* Add / Delete Layer buttons */}
          <div
            style={{
              height: 22,
              flexShrink: 0,
              borderTop: "1px solid #1a1a1a",
              display: "flex",
              alignItems: "center",
              padding: "0 4px",
              gap: 3,
            }}
          >
            <button
              title="Add layer above active layer"
              onClick={handleAddLayer}
              style={{
                fontSize: 12,
                background: "#444",
                color: "#c0c0c0",
                border: "1px solid #555",
                borderRadius: 2,
                padding: "0 5px",
                cursor: "pointer",
                lineHeight: "18px",
                minWidth: 20,
              }}
            >
              +
            </button>
            <button
              title="Delete active layer"
              onClick={handleDeleteActiveLayer}
              disabled={timeline.layers.length <= 1}
              style={{
                fontSize: 12,
                background: "#444",
                color: timeline.layers.length <= 1 ? "#666" : "#c0c0c0",
                border: "1px solid #555",
                borderRadius: 2,
                padding: "0 5px",
                cursor: timeline.layers.length <= 1 ? "default" : "pointer",
                lineHeight: "18px",
                minWidth: 20,
              }}
            >
              −
            </button>
          </div>
        </div>

        {/* Frame area */}
        <div
          ref={framesScrollRef}
          onScroll={(e) => {
            const el = e.target as HTMLElement;
            syncScroll("frames", el.scrollTop);
          }}
          style={{
            flex: 1,
            overflow: "auto",
            position: "relative",
          }}
        >
          <div
            style={{
              width: frameCount * FRAME_W,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Ruler */}
            <div
              onMouseDown={handleRulerMouseDown}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "row",
                height: RULER_H,
                background: "#3a3a3a",
                borderBottom: "1px solid #1a1a1a",
                flexShrink: 0,
                cursor: "col-resize",
              }}
            >
              {Array.from({ length: frameCount }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: FRAME_W,
                    height: RULER_H,
                    flexShrink: 0,
                    borderRight:
                      (i + 1) % 5 === 0
                        ? "1px solid #555"
                        : "1px solid #2a2a2a",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "flex-end",
                    paddingBottom: 1,
                    paddingLeft: 1,
                  }}
                >
                  {i % 5 === 0 && (
                    <span
                      style={{
                        fontSize: 7,
                        color: "#888",
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
              <PlayheadMarker frame={currentFrame} />
              {/* Onion skin range markers */}
              {onionSkinEnabled && (
                <>
                  <OnionRangeMarker
                    frame={Math.max(0, currentFrame - onionBefore)}
                    color="#4466cc"
                    label="["
                    onDrag={(delta) => {
                      const newBefore = Math.max(0, onionBefore - delta);
                      onOnionRangeChange?.(newBefore, onionAfter);
                    }}
                    framesScrollRef={framesScrollRef}
                    frameCount={frameCount}
                  />
                  <OnionRangeMarker
                    frame={Math.min(frameCount - 1, currentFrame + onionAfter)}
                    color="#44aa55"
                    label="]"
                    onDrag={(delta) => {
                      const newAfter = Math.max(0, onionAfter + delta);
                      onOnionRangeChange?.(onionBefore, newAfter);
                    }}
                    framesScrollRef={framesScrollRef}
                    frameCount={frameCount}
                  />
                </>
              )}
            </div>

            {/* Layer frame rows */}
            {timeline.layers.map((layer, idx) => (
              <div
                key={layer.id}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  height: FRAME_H,
                  position: "relative",
                  background: idx === activeLayerIndex ? "rgba(42,64,96,0.35)" : "transparent",
                }}
              >
                {Array.from({ length: frameCount }, (_, fi) => {
                  const state = getFrameState(layer, fi);
                  const tweenSt = getTweenState(layer, fi);
                  const kf = layer.frames.find((f) => f.index === fi && f.isKeyframe);
                  // isFirstInTweenSpan: this is the start keyframe of a motion or shape tween
                  const isFirstInTweenSpan =
                    (tweenSt === "motion-tween" && kf?.tweenType === "motion") ||
                    (tweenSt === "shape-tween" && kf?.tweenType === "shape");
                  return (
                    <FrameCell
                      key={fi}
                      state={state}
                      tweenState={tweenSt}
                      isPlayhead={fi === currentFrame}
                      isFirstInTweenSpan={isFirstInTweenSpan}
                      label={kf?.label || undefined}
                      onClick={() => {
                        onFrameChange(fi);
                        // Select keyframe for ease editing if it's a tween keyframe
                        if (kf?.tweenType === "motion" || kf?.tweenType === "shape") {
                          setSelectedKeyframe({ layerId: layer.id, frameIndex: fi });
                        } else {
                          setSelectedKeyframe(null);
                        }
                      }}
                      onContextMenu={(e) => openContextMenu(e, layer.id, fi)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Playback controls */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          height: PLAYBACK_BAR_H,
          background: "#333",
          borderTop: "1px solid #1a1a1a",
          flexShrink: 0,
          padding: "0 6px",
          gap: 4,
        }}
      >
        {/* Go to first */}
        <PlayBtn
          title="Go to first frame"
          onClick={() => { onFrameChange(0); }}
        >
          |&lt;
        </PlayBtn>
        {/* Step back */}
        <PlayBtn
          title="Step back one frame"
          onClick={() => onFrameChange(Math.max(0, currentFrame - 1))}
        >
          &lt;
        </PlayBtn>
        {/* Play/Stop */}
        <PlayBtn
          title={isPlaying ? "Stop" : "Play"}
          onClick={() => onPlayingChange(!isPlaying)}
          active={isPlaying}
        >
          {isPlaying ? "||" : ">"}
        </PlayBtn>
        {/* Step forward */}
        <PlayBtn
          title="Step forward one frame"
          onClick={() =>
            onFrameChange(Math.min(frameCount - 1, currentFrame + 1))
          }
        >
          &gt;
        </PlayBtn>
        {/* Go to last */}
        <PlayBtn
          title="Go to last frame"
          onClick={() => onFrameChange(frameCount - 1)}
        >
          &gt;|
        </PlayBtn>

        <div style={{ width: 8 }} />

        {/* Loop */}
        <PlayBtn
          title={loop ? "Loop: on" : "Loop: off"}
          onClick={() => setLoop((l) => !l)}
          active={loop}
        >
          Loop
        </PlayBtn>

        <div style={{ width: 8 }} />

        {/* Onion Skin toggle */}
        <PlayBtn
          title={onionSkinEnabled ? "Onion Skin: on" : "Onion Skin: off"}
          onClick={() => onToggleOnionSkin?.()}
          active={onionSkinEnabled}
        >
          OS
        </PlayBtn>

        <div style={{ flex: 1 }} />

        {/* Frame counter input */}
        <FrameCounterInput
          currentFrame={currentFrame}
          frameCount={frameCount}
          onFrameChange={onFrameChange}
        />

        {/* FPS display */}
        <span
          style={{
            fontSize: 10,
            color: "#888",
            marginLeft: 6,
            whiteSpace: "nowrap",
          }}
        >
          {frameRate} fps
        </span>
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
              background: "#333",
              borderTop: "1px solid #1a1a1a",
              flexShrink: 0,
              padding: "0 8px",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 10, color: "#aaa" }}>Ease:</span>
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
                fontSize: 10,
                background: "#1a1a1a",
                color: "#ffffff",
                border: "1px solid #555",
                padding: "1px 4px",
                borderRadius: 2,
                outline: "none",
              }}
            />
            <span style={{ fontSize: 9, color: "#777" }}>(-100 to 100)</span>
            {/* Blend mode selector — only for shape tweens */}
            {isShape && (
              <>
                <span style={{ fontSize: 10, color: "#aaa", marginLeft: 8 }}>Blend:</span>
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
                    fontSize: 10,
                    background: "#1a1a1a",
                    color: "#ffffff",
                    border: "1px solid #555",
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
  color: "#888",
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

function FrameCounterInput({
  currentFrame,
  frameCount,
  onFrameChange,
}: {
  currentFrame: number;
  frameCount: number;
  onFrameChange: (frame: number) => void;
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
          width: 36,
          fontSize: 10,
          background: "#1a1a1a",
          color: "#ffffff",
          border: "1px solid #5050ff",
          padding: "1px 3px",
          borderRadius: 2,
          outline: "none",
          textAlign: "right",
        }}
      />
    );
  }

  return (
    <span
      title="Click to jump to frame"
      onClick={() => { setEditing(true); setInputValue(String(display)); }}
      style={{
        fontSize: 10,
        color: "#aaa",
        minWidth: 40,
        textAlign: "right",
        cursor: "text",
        userSelect: "none",
      }}
    >
      {display} / {frameCount}
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
        background: active ? "#5050aa" : "#444",
        border: `1px solid ${active ? "#7070cc" : "#555"}`,
        color: "#ddd",
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

function ContextMenuPopup({
  x,
  y,
  onAction,
  timeline,
  layerId,
  frameIndex,
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
  hasFrameClipboard?: boolean;
  canCopyFrames?: boolean;
  canCutFrames?: boolean;
  canPasteFrames?: boolean;
}) {
  // Determine if the target is a keyframe and its tween state
  const layer = timeline.layers.find((l) => l.id === layerId);
  const kf = layer?.frames.find((f) => f.index === frameIndex && f.isKeyframe);
  const hasTween = kf?.tweenType === "motion" || kf?.tweenType === "shape";

  const items: { label: string; action: string; shortcut?: string; separator?: boolean; disabled?: boolean }[] = [
    { label: "Insert Frame", action: "insert-frame", shortcut: "F5" },
    { label: "Insert Keyframe", action: "insert-keyframe", shortcut: "F6" },
    {
      label: "Insert Blank Keyframe",
      action: "insert-blank-keyframe",
      shortcut: "F7",
    },
    { label: "Clear Keyframe", action: "clear-keyframe", shortcut: "⇧F6" },
    { label: "Remove Frame", action: "remove-frame", shortcut: "⇧F5" },
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
  ];

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: x,
        top: y,
        background: "#2e2e2e",
        border: "1px solid #555",
        borderRadius: 3,
        zIndex: 9999,
        minWidth: 180,
        boxShadow: "2px 4px 12px rgba(0,0,0,0.5)",
        padding: "3px 0",
      }}
    >
      {items.map((item) => {
        if (item.separator) {
          return (
            <div
              key={item.action + Math.random()}
              style={{
                height: 1,
                background: "#444",
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
              color: isDisabled ? "#666" : "#ddd",
              cursor: isDisabled ? "default" : "pointer",
              gap: 16,
            }}
            onMouseEnter={(e) => {
              if (!isDisabled)
                (e.currentTarget as HTMLElement).style.background = "#4060a0";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 10, color: "#888" }}>{item.shortcut}</span>
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
  onClose,
}: {
  x: number;
  y: number;
  currentType: LayerType;
  onSetType: (type: LayerType) => void;
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
        background: "#2e2e2e",
        border: "1px solid #555",
        borderRadius: 3,
        zIndex: 9999,
        minWidth: 140,
        boxShadow: "2px 4px 12px rgba(0,0,0,0.5)",
        padding: "3px 0",
      }}
    >
      <div
        style={{
          padding: "3px 12px 4px",
          fontSize: 10,
          color: "#888",
          borderBottom: "1px solid #444",
          marginBottom: 3,
        }}
      >
        Layer Type
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
            color: currentType === type ? "#8ab4e8" : "#ddd",
            cursor: "pointer",
            gap: 8,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "#4060a0";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <span>{label}</span>
          {currentType === type && (
            <span style={{ fontSize: 10, color: "#8ab4e8" }}>*</span>
          )}
        </div>
      ))}
    </div>
  );
}
