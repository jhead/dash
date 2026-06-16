import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocument,
  addDisplayObject,
  removeDisplayObject,
  updateDisplayObject,
  setFrameScript,
  setFrameBehaviors,
  setSoundOnFrame,
  hexToColor,
  createOvalShape,
  createRectShape,
  createLineShape,
  getTweenedFrame,
  getGoverningKeyframe,
  CanvasRenderer,
  transformedShapeBounds,
  shapeBounds,
  getUnionBounds,
  setMotionTween,
  setShapeTween,
  clearTween,
  updateMotionTweenProps,
  saveFla,
  loadFla,
} from "@flash/core";
import { useCommandKeyboard } from "./dispatch/keyboard.js";
import { TransformHandles } from "./TransformHandles";
import type {
  BitmapDisplayObject,
  BitmapItem,
  ButtonAction,
  ButtonHandler,
  ClipAction,
  DisplayObject,
  DocumentProperties,
  DrawingObject,
  Fill,
  FlashDocument,
  FlashFilter,
  Frame,
  Library,
  SceneGraph,
  Shape,
  ShapeDisplayObject,
  ShapeHint,
  SolidStroke,
  SoundEnvelopePoint,
  SoundItem,
  SoundLinkage,
  Symbol,
  SymbolInstance,
  TextDisplayObject,
  Timeline as TimelineModel,
  VideoDisplayObject,
  VideoItem,
} from "@flash/core";
import { runJsfl, buildJsflContext, registerClearOutputCallback } from "./jsfl/index.js";
import { MenuBar } from "./MenuBar";
import { EditBar } from "./EditBar";
import { ToolsPanel } from "./ToolsPanel";
import { StageArea } from "./StageArea";
import type { ViewMode, OnionFrame } from "./StageArea";
import { Rulers } from "./Rulers";
import { Timeline } from "./Timeline";
import { usePreferences } from "./preferences";
import { PropertiesPanel } from "./PropertiesPanel";
import type { PlacedInstance } from "./PropertiesPanel";
import { LibraryPanel } from "./LibraryPanel";
import { StatusBar } from "./StatusBar";
import type { ToolId } from "./tools/types";
import { usePublish } from "./hooks/usePublish";
import { loadFlaFromBytes } from "./hooks/useFileActions";
import { useStore } from "zustand";
import {
  createStores,
  StoreProvider,
  type Stores,
  type BottomTab,
  selectDoc,
  selectCanUndo,
  selectCanRedo,
  selectUndoDepth,
  selectRedoDepth,
} from "./store/index.js";
import { ShellDialogs } from "./layout/ShellDialogs.js";
import { ShellPanels } from "./layout/ShellPanels.js";
import { ManageCommandsDialog } from "./layout/ManageCommandsDialog.js";
import { ShellOverlays } from "./layout/ShellOverlays.js";
import { useToolHandlers } from "./hooks/useToolHandlers.js";
import { useTimelineEffectHandlers } from "./hooks/useTimelineEffectHandlers.js";
import { nextInstanceId, nextBitmapId, nextVideoId } from "./idgen.js";
import { useShapeModifyHandlers } from "./hooks/useShapeModifyHandlers.js";
import { useLibraryHandlers } from "./hooks/useLibraryHandlers.js";
import { useSceneHandlers } from "./hooks/useSceneHandlers.js";
import { useTextHandlers } from "./hooks/useTextHandlers.js";
import { useShapeOpHandlers } from "./hooks/useShapeOpHandlers.js";
import { useClipboardHandlers } from "./hooks/useClipboardHandlers.js";
import { useExportHandlers } from "./hooks/useExportHandlers.js";
import {
  instanceNamesOf,
  shapeDisplayObjectsAt,
  textDisplayObjectsAt,
  bitmapDisplayObjectsAt,
  symbolInstancesAt,
  bitmapLibraryItems as bitmapLibraryItemsOf,
  soundLibraryItems as soundLibraryItemsOf,
} from "./selectors/index.js";
import {
  createPopulatedRegistry,
  type CommandContext,
  type CommandRegistry,
} from "./commands/index.js";
import { ActionsPanel } from "./ActionsPanel";
import { OutputPanel } from "./OutputPanel";
import { SoundPanel } from "./SoundPanel";
import {
  SoundEnvelopeEditDialog,
  defaultEnvelope,
} from "./SoundEnvelopeEditDialog";
import { TransformPanel } from "./TransformPanel";
import type { TransformUpdates } from "./TransformPanel";
import { InstancePanel } from "./InstancePanel";
import { AlignPanel } from "./AlignPanel";
import { SceneSwitcher } from "./SceneSwitcher";
import { DEFAULT_SWATCHES } from "./SwatchesPanel";
import { DEFAULT_HTML_OPTIONS } from "./PublishSettingsDialog";
import { generateHtmlWrapper, analyzeFrameSizes } from "@flash/swf";
import { PanelGroup } from "./PanelGroup";
import type { DocumentAccessibility } from "@flash/core";
import type { ObjectAccessibility } from "@flash/core";
import { startAgentBridge, stopAgentBridge } from "./agent/bridge.js";
import { setAgentCallbacks, clearAgentCallbacks, bumpRev } from "./agent/registry.js";
import { loadCommands, saveCommand, deleteCommand } from "./savedCommands.js";

// ---------------------------------------------------------------------------
// Shape hint overlay
// ---------------------------------------------------------------------------

/**
 * Renders draggable labeled circles for shape hints on the stage.
 * Yellow circles = start keyframe; green circles = end keyframe (Flash 8 convention).
 * Drag to reposition; calls onHintMove(id, x, y) on mouse-up.
 */
function ShapeHintOverlay({
  hints,
  isEndKeyframe = false,
  onHintMove,
}: {
  hints: readonly ShapeHint[];
  isEndKeyframe?: boolean;
  onHintMove?: (id: string, x: number, y: number) => void;
}): React.ReactElement {
  const RADIUS = 8;
  const fillColor = isEndKeyframe ? "#00cc44" : "#ffcc00";
  const textColor = isEndKeyframe ? "#004400" : "#664400";

  const [dragging, setDragging] = React.useState<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [overrides, setOverrides] = React.useState<Record<string, { x: number; y: number }>>({});

  // When hints change from outside (e.g. after a move commits), reset overrides
  React.useEffect(() => {
    setOverrides({});
  }, [hints]);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent<SVGCircleElement>, hint: ShapeHint) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging({
        id: hint.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: overrides[hint.id]?.x ?? hint.x,
        origY: overrides[hint.id]?.y ?? hint.y,
      });
    },
    [overrides]
  );

  React.useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      setOverrides((prev) => ({
        ...prev,
        [dragging.id]: { x: dragging.origX + dx, y: dragging.origY + dy },
      }));
    };
    const onMouseUp = (e: MouseEvent) => {
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      const newX = Math.round(dragging.origX + dx);
      const newY = Math.round(dragging.origY + dy);
      onHintMove?.(dragging.id, newX, newY);
      setDragging(null);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragging, onHintMove]);

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      {hints.map((hint) => {
        const pos = overrides[hint.id] ?? { x: hint.x, y: hint.y };
        return (
          <g key={hint.id} transform={`translate(${pos.x}, ${pos.y})`}>
            <circle
              r={RADIUS}
              fill={fillColor}
              stroke="#333"
              strokeWidth={1.5}
              style={{ pointerEvents: "all", cursor: "move" }}
              onMouseDown={(e) => handleMouseDown(e, hint)}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={9}
              fontFamily="sans-serif"
              fontWeight="bold"
              fill={textColor}
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {hint.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Edit context
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Info panel bounds helper
// ---------------------------------------------------------------------------

/**
 * Returns the pixel width and height of any display object type.
 * For shapes/drawing-objects: uses the shape's path geometry (AABB, with scale applied).
 * For symbol instances: resolves to the symbol's first keyframe and sums all object bounds.
 * For text: uses the stored width/height fields.
 * For bitmaps: uses width * scaleX / height * scaleY.
 * For groups: returns the bounding box of all children.
 * Returns null when the size cannot be determined.
 */
function getDisplayObjectPixelSize(
  obj: DisplayObject,
  library: Library
): { w: number; h: number } | null {
  switch (obj.type) {
    case "shape": {
      const b = shapeBounds(obj.shape, 0, 0);
      const scaleX = (obj as ShapeDisplayObject).scaleX ?? 1;
      const scaleY = (obj as ShapeDisplayObject).scaleY ?? 1;
      return { w: Math.round(b.width * Math.abs(scaleX)), h: Math.round(b.height * Math.abs(scaleY)) };
    }
    case "drawing-object": {
      const b = shapeBounds((obj as DrawingObject).shape, 0, 0);
      return { w: Math.round(b.width), h: Math.round(b.height) };
    }
    case "text": {
      return { w: Math.round(obj.width ?? 0), h: Math.round(obj.height ?? 0) };
    }
    case "bitmap": {
      const scaleX = (obj as BitmapDisplayObject).scaleX ?? 1;
      const scaleY = (obj as BitmapDisplayObject).scaleY ?? 1;
      return {
        w: Math.round((obj.width ?? 0) * Math.abs(scaleX)),
        h: Math.round((obj.height ?? 0) * Math.abs(scaleY)),
      };
    }
    case "instance": {
      const inst = obj as SymbolInstance;
      const sym = library.items.find(
        (i) => i.id === inst.symbolId && i.itemType === "symbol"
      ) as Symbol | undefined;
      if (!sym) return null;
      // Gather all objects from the first keyframe of the symbol
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const layer of sym.timeline.layers) {
        const kf = layer.frames.find((f) => f.isKeyframe && !f.isEmpty);
        if (!kf) continue;
        for (const child of kf.displayObjects) {
          const childSize = getDisplayObjectPixelSize(child, library);
          if (!childSize) continue;
          const cx = child.x ?? 0;
          const cy = child.y ?? 0;
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          const rx = cx + childSize.w;
          const ry = cy + childSize.h;
          if (rx > maxX) maxX = rx;
          if (ry > maxY) maxY = ry;
        }
      }
      if (!isFinite(minX)) return null;
      const rawW = maxX - minX;
      const rawH = maxY - minY;
      const scaleX = inst.scaleX ?? 1;
      const scaleY = inst.scaleY ?? 1;
      return { w: Math.round(rawW * Math.abs(scaleX)), h: Math.round(rawH * Math.abs(scaleY)) };
    }
    case "group": {
      // Compute bounding box of all children
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const child of obj.children) {
        const childSize = getDisplayObjectPixelSize(child, library);
        if (!childSize) continue;
        const cx = child.x ?? 0;
        const cy = child.y ?? 0;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        const rx = cx + childSize.w;
        const ry = cy + childSize.h;
        if (rx > maxX) maxX = rx;
        if (ry > maxY) maxY = ry;
      }
      if (!isFinite(minX)) return null;
      return { w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    background: "#3c3c3c",
    overflow: "hidden",
    position: "relative",
  },
  dropOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 120, 215, 0.18)",
    color: "#ffffff",
    fontSize: "20px",
    fontWeight: "bold",
    pointerEvents: "none",
    letterSpacing: "0.02em",
  },
  centerRegion: {
    display: "flex",
    flexDirection: "row",
    flex: 1,
    overflow: "hidden",
  },
  mainColumn: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
  },
  stageAndTimeline: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
  },
  rightPanel: {
    display: "flex",
    flexDirection: "column",
    width: "240px",
    flexShrink: 0,
    background: "#2d2d2d",
    borderLeft: "1px solid #1a1a1a",
    overflow: "hidden",
  },
  rightPanelTabs: {
    display: "flex",
    flexDirection: "row",
    height: "22px",
    background: "#333",
    borderBottom: "1px solid #1a1a1a",
    flexShrink: 0,
  },
  // Vertical drag handle (resizes a left/right pane along the X axis)
  vResizeHandle: {
    width: "4px",
    flexShrink: 0,
    cursor: "col-resize",
    background: "#1a1a1a",
  },
  // Horizontal drag handle (resizes a top/bottom pane along the Y axis)
  hResizeHandle: {
    height: "4px",
    flexShrink: 0,
    cursor: "row-resize",
    background: "#1a1a1a",
  },
  bottomPanel: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    background: "#1e1e1e",
    overflow: "hidden",
  },
  bottomTabs: {
    display: "flex",
    flexDirection: "row",
    height: "24px",
    background: "#2d2d2d",
    borderTop: "1px solid #1a1a1a",
    borderBottom: "1px solid #1a1a1a",
    flexShrink: 0,
    alignItems: "stretch",
  },
  bottomContent: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
};

const BOTTOM_TABS: Array<{ id: BottomTab; label: string }> = [
  { id: "actions", label: "Actions" },
  { id: "sound", label: "Sound" },
  { id: "properties", label: "Properties" },
  { id: "output", label: "Output" },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _initialDoc = createDocument();

// ---------------------------------------------------------------------------
// Resizable pane hook — drag a handle to set a pixel size, clamped to [min,max].
// `axis: "x"` resizes a right-docked panel (drag left = grow, so we use
// startX - clientX). `axis: "y"` resizes a bottom-docked panel (drag up = grow,
// so we use startY - clientY).
// ---------------------------------------------------------------------------

function useResize(
  initial: number,
  min: number,
  max: number,
  axis: "x" | "y",
  /**
   * When false (default) the panel is docked toward the far edge (right/bottom)
   * so dragging the handle toward the origin grows it. When true the panel is
   * docked toward the near edge (top) so dragging away from the origin grows it.
   */
  invert = false
): { size: number; setSize: (n: number) => void; onMouseDown: (e: React.MouseEvent) => void } {
  const [size, setSize] = useState(initial);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = axis === "x" ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      const onMove = (ev: MouseEvent) => {
        const cur = axis === "x" ? ev.clientX : ev.clientY;
        const delta = invert ? cur - start : start - cur;
        setSize(Math.max(min, Math.min(max, startSize + delta)));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [axis, min, max, invert]
  );

  return { size, setSize, onMouseDown };
}

// ---------------------------------------------------------------------------
// Export utilities (pure, exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Generates a zero-padded filename for a frame in an exported PNG sequence.
 * @param frameIndex - 0-based frame index
 * @param format - file extension ("png" | "jpeg")
 * @returns e.g. "frame_0001.png" for frameIndex=0
 */
export { frameFilename } from "./frameFilename.js";

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Shell(): React.ReactElement {
  // ---------------------------------------------------------------------------
  // Single document owner — the per-instance Zustand documentStore owns the
  // undo/redo HistoryState. Created once; non-React callers (agent/JSFL/test
  // bridges) read the live doc via documentStore.getState(), which replaces the
  // old latestDocRef stale-closure workaround.
  // ---------------------------------------------------------------------------
  const storesRef = useRef<Stores | null>(null);
  if (!storesRef.current) {
    // Inject the UI defaults that depend on view-module *values* so the store
    // module keeps only type-level imports from view components.
    storesRef.current = createStores(_initialDoc, {
      swatches: [...DEFAULT_SWATCHES],
      savedCommands: loadCommands(),
      publishSettings: {
        filename: "movie.swf",
        jpegQuality: 80,
        audioStreamFormat: "mp3",
        audioEventFormat: "mp3",
        compress: true,
        protect: false,
        debuggingPermitted: false,
        debugPassword: "",
        html: DEFAULT_HTML_OPTIONS,
      },
    });
  }
  const stores = storesRef.current;
  const { documentStore, uiStore } = stores;

  // Subscribe to the slices Shell renders from. Each re-renders only when its
  // slice changes (Object.is), mirroring the old useReducer behaviour.
  const doc = useStore(documentStore, selectDoc);
  const canUndo = useStore(documentStore, selectCanUndo);
  const canRedo = useStore(documentStore, selectCanRedo);
  const undoDepth = useStore(documentStore, selectUndoDepth);
  const redoDepth = useStore(documentStore, selectRedoDepth);
  const historyPast = useStore(documentStore, (s) => s.history.past);

  // Store actions are stable; wrap as stable callbacks for prop/dep-array use.
  const replaceDoc = useCallback(
    (nextDoc: FlashDocument) => documentStore.getState().replaceDoc(nextDoc),
    [documentStore]
  );
  const commitDrag = useCallback(
    (preDragDoc: FlashDocument, finalDoc: FlashDocument) =>
      documentStore.getState().commitDrag(preDragDoc, finalDoc),
    [documentStore]
  );
  const undo = useCallback(() => documentStore.getState().undo(), [documentStore]);
  const redo = useCallback(() => documentStore.getState().redo(), [documentStore]);
  const clearHistory = useCallback(() => documentStore.getState().clearHistory(), [documentStore]);
  // Wrap push so we bump the agent rev counter on every document mutation.
  const pushDoc = useCallback(
    (nextDoc: FlashDocument) => {
      bumpRev();
      documentStore.getState().pushDoc(nextDoc);
    },
    [documentStore]
  );

  // Convenience: library, docProperties
  const library = doc.library;
  const docProperties = doc.properties;
  const guides = docProperties.guides;

  // ---------------------------------------------------------------------------
  // Ephemeral UI state — owned by the per-instance uiStore (Phase 2). A single
  // whole-store subscription re-renders Shell on any UI change, matching the
  // prior behaviour where any of these setters re-rendered Shell. Section
  // components subscribe to narrow slices in Phase 6. Setters keep React's
  // `value | (prev => next)` signature, so every existing call site is unchanged.
  // ---------------------------------------------------------------------------
  const {
    filePath, setFilePath,
    editContext,
    editPath,
    activeSceneIndex, setActiveSceneIndex,
    activeLayerIndex, setActiveLayerIndex,
    currentFrame, setCurrentFrame,
    isPlaying, setIsPlaying,
    onionSkinEnabled, setOnionSkinEnabled,
    onionSkinOutlines, setOnionSkinOutlines,
    onionBefore, setOnionBefore,
    onionAfter, setOnionAfter,
    editMultipleFrames, setEditMultipleFrames,
    hasMotionClipboard,
    selectedLibraryItemId, setSelectedLibraryItemId,
    rightTab, setRightTab,
    bottomTab, setBottomTab,
    timelineCollapsed, setTimelineCollapsed,
    setPreferencesOpen,
    instances, setInstances,
    selectedInstanceId, setSelectedInstanceId,
    selectedShapeIds, setSelectedShapeIds,
    zoom, setZoom,
    panX, setPanX,
    panY, setPanY,
    cursorPos, setCursorPos,
    snapToPixels,
    viewMode, setViewMode,
    showRulers,
    toolState, setToolState,
    textFormat,
    editingTextId,
    setColorPanelVisible,
    colorMixerVisible, setColorMixerVisible,
    setFiltersPanelVisible,
    alignPanelVisible, setAlignPanelVisible,
    scenePanelVisible, setScenePanelVisible,
    swatchesPanelVisible, setSwatchesPanelVisible,
    behaviorsPanelVisible, setBehaviorsPanelVisible,
    movieExplorerVisible, setMovieExplorerVisible,
    historyPanelVisible, setHistoryPanelVisible,
    savedCommands, setSavedCommands,
    setManageCommandsOpen,
    accessibilityPanelVisible, setAccessibilityPanelVisible,
    showScenes, setShowScenes,
    playerOpen,
    outputMessages, setOutputMessages,
    setDocPropsOpen,
    setFindReplaceVisible,
    setEditGridOpen,
    envelopeDialogOpen, setEnvelopeDialogOpen,
    envelopeDialogTarget, setEnvelopeDialogTarget,
    setPublishSettingsOpen,
    publishSettings,
    bitmapPropsItem, setBitmapPropsItem,
    setSwapBitmapDialogOpen,
    swapBitmapTargetId, setSwapBitmapTargetId,
    setBandwidthProfilerVisible,
    setBandwidthProfilerReport,
    simpleButtonsEnabled, setSimpleButtonsEnabled,
    selectedFrameRange, setSelectedFrameRange,
    hasFrameClipboard,
    isDragOver, setIsDragOver,
  } = useStore(uiStore);

  // ---------------------------------------------------------------------------
  // Helpers to mutate the document through history
  // ---------------------------------------------------------------------------

  /** Produce a new document by updating the active scene's timeline. */
  const withSceneTimeline = useCallback(
    (updater: (t: TimelineModel) => TimelineModel): FlashDocument => {
      const idx = Math.min(activeSceneIndex, doc.scenes.length - 1);
      const scene = doc.scenes[idx];
      const t = updater(scene.timeline);
      const newScenes = doc.scenes.map((s, i) => i === idx ? { ...s, timeline: t } : s);
      return {
        ...doc,
        scenes: newScenes,
      };
    },
    [doc, activeSceneIndex]
  );

  /**
   * Produce a new document by updating the symbol timeline of the symbol
   * currently being edited in-place (editContext.symbolId).
   */
  const withSymbolTimeline = useCallback(
    (symbolId: string, updater: (t: TimelineModel) => TimelineModel): FlashDocument => {
      const items = doc.library.items.map((item) => {
        if (item.id === symbolId && item.itemType === "symbol") {
          return { ...item, timeline: updater(item.timeline) };
        }
        return item;
      });
      return {
        ...doc,
        library: { ...doc.library, items },
      };
    },
    [doc]
  );

  /**
   * Context-aware timeline updater: targets the scene timeline when in document
   * mode, or the active symbol's timeline when editing in-place.
   */
  const withTimeline = useCallback(
    (updater: (t: TimelineModel) => TimelineModel): FlashDocument => {
      if (editContext.mode === "symbol" && editContext.symbolId) {
        return withSymbolTimeline(editContext.symbolId, updater);
      }
      return withSceneTimeline(updater);
    },
    [editContext, withSceneTimeline, withSymbolTimeline]
  );

  /** Produce a new document by updating the library. */
  const withLibrary = useCallback(
    (updater: (lib: Library) => Library): FlashDocument => ({
      ...doc,
      library: updater(doc.library),
    }),
    [doc]
  );

  /** Produce a new document by updating docProperties. */
  const withProperties = useCallback(
    (updater: (p: DocumentProperties) => DocumentProperties): FlashDocument => ({
      ...doc,
      properties: updater(doc.properties),
    }),
    [doc]
  );

  // ---------------------------------------------------------------------------
  // Active timeline — either the scene timeline or the symbol being edited.
  // All stage mutations go through withTimeline() which is context-aware.
  // editPath drives multi-level nesting; for now we use the top of the stack.
  // ---------------------------------------------------------------------------
  const timeline: TimelineModel = useMemo(() => {
    // Use editPath to resolve the active symbol timeline (supports future multi-level nesting).
    if (editPath.length > 0) {
      const topEntry = editPath[editPath.length - 1];
      const sym = doc.library.items.find(
        (i) => i.id === topEntry.symbolId && i.itemType === "symbol"
      );
      if (sym && sym.itemType === "symbol") return sym.timeline;
    }
    if (editContext.mode === "symbol" && editContext.symbolId) {
      const sym = doc.library.items.find((i) => i.id === editContext.symbolId && i.itemType === "symbol");
      if (sym && sym.itemType === "symbol") return sym.timeline;
    }
    const idx = Math.min(activeSceneIndex, doc.scenes.length - 1);
    return doc.scenes[idx].timeline;
  }, [editPath, editContext, doc, activeSceneIndex]);

  // ---------------------------------------------------------------------------
  // Frame / playback (state lives in uiStore; refs are component-local)
  // ---------------------------------------------------------------------------
  // RAF playback refs
  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  // Always-current fps ref so the tick closure reads the live value
  const frameRateRef = useRef(doc.properties.frameRate);
  useEffect(() => {
    frameRateRef.current = doc.properties.frameRate;
  }, [doc.properties.frameRate]);

  // Active layer index clamped to valid range whenever layers change.
  const safeActiveLayerIndex = Math.min(activeLayerIndex, Math.max(0, timeline.layers.length - 1));

  // Remember the last expanded bottom tab so re-expanding restores it.
  const lastBottomTabRef = useRef<BottomTab>("properties");

  // Resizable panes: right panel width, top timeline height, bottom dock height.
  const rightResize = useResize(240, 160, 600, "x");
  // Fits several scaled Flash-8 rows + status bar chrome; user-resizable.
  const timelineResize = useResize(210, 100, 760, "y", true);
  const bottomResize = useResize(180, 80, 600, "y");

  // Application preferences (UI scale, …) persisted to localStorage.
  const { preferences, updatePreferences, resetPreferences } = usePreferences();

  /**
   * Click a bottom tab. Clicking the active (expanded) tab collapses the dock;
   * clicking any other tab (or a tab while collapsed) expands to that tab.
   */
  const handleBottomTabClick = useCallback((tab: BottomTab) => {
    setBottomTab((prev) => {
      if (prev === tab) return null; // collapse
      lastBottomTabRef.current = tab;
      return tab;
    });
  }, []);

  // Backward-compat single-selection: the selected id when exactly one object is selected, else null
  const selectedShapeId = selectedShapeIds.length === 1 ? selectedShapeIds[0] : null;

  /** Replace the entire selection set. */
  const setSelectedShapeId = useCallback((id: string | null) => {
    setSelectedShapeIds(id ? [id] : []);
  }, []);

  /** Handle a shape-select event from StageArea (supports shift+click for multi-select). */
  const handleShapeSelectFromStage = useCallback((id: string | null, shiftKey?: boolean) => {
    if (id === null) {
      setSelectedShapeIds([]);
    } else if (shiftKey) {
      // Toggle id in the selection set
      setSelectedShapeIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setSelectedShapeIds([id]);
    }
  }, []);

  /** Handle a multi-shape-select event from StageArea (marquee result). */
  const handleShapeSelectMultiple = useCallback((ids: string[], replace: boolean) => {
    if (replace) {
      setSelectedShapeIds(ids);
    } else {
      // Union with existing selection
      setSelectedShapeIds((prev) => {
        const merged = new Set([...prev, ...ids]);
        return Array.from(merged);
      });
    }
  }, []);

  // Grid settings are derived from doc.properties.grid (persisted in document state)
  const showGrid = docProperties.grid.showGrid;
  const gridWidth = docProperties.grid.gridWidth;
  const gridHeight = docProperties.grid.gridHeight;
  const gridColor = docProperties.grid.gridColor;

  // Renderer ref (for loadImage calls)
  const rendererRef = useRef<import("@flash/core").CanvasRenderer | null>(null);

  // Guide id counter (guides are stored in doc.properties.guides)
  const guideCounterRef = React.useRef(0);

  // Counter for auto-naming effect symbols ("Transform 1", "Transform 2", …)
  const timelineEffectCounterRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Handlers — timeline / frame
  // ---------------------------------------------------------------------------

  const handleToggleSimpleButtons = useCallback(() => {
    setSimpleButtonsEnabled((v) => !v);
  }, []);

  const handleToggleOnionSkin = useCallback(() => {
    setOnionSkinEnabled((v) => !v);
  }, []);

  const handleToggleOnionSkinOutlines = useCallback(() => {
    setOnionSkinOutlines((v) => !v);
  }, []);

  const handleOnionRangeChange = useCallback((before: number, after: number) => {
    setOnionBefore(Math.max(0, before));
    setOnionAfter(Math.max(0, after));
  }, []);

  const handleToggleEditMultipleFrames = useCallback(() => {
    setEditMultipleFrames((v) => !v);
  }, []);

  const handleTimelineChange = useCallback((t: TimelineModel) => {
    pushDoc(withTimeline(() => t));
  }, [pushDoc, withTimeline]);

  const handleFrameChange = useCallback((frame: number) => {
    setCurrentFrame(frame);
  }, []);

  /**
   * Called when the user double-clicks a keyframe cell in the Timeline.
   * Navigates to that frame/layer and opens the Actions panel.
   */
  const handleFrameDoubleClick = useCallback((layerIndex: number, frameIndex: number) => {
    setActiveLayerIndex(layerIndex);
    setCurrentFrame(frameIndex);
    setBottomTab("actions");
    lastBottomTabRef.current = "actions";
  }, []);

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsPlaying(true);
    let lastTime = performance.now();

    const tick = (now: number) => {
      if (!isPlayingRef.current) return;
      // Read fps from ref so changes made while playing take effect immediately
      const frameInterval = 1000 / Math.max(0.01, frameRateRef.current);
      const elapsed = now - lastTime;
      if (elapsed >= frameInterval) {
        lastTime = now - (elapsed % frameInterval);
        setCurrentFrame((prev) => {
          const maxFrame = Math.max(...timeline.layers.map((l) => {
            // count frames: last keyframe index + 1, or layerFrameCount equivalent
            if (l.frames.length === 0) return 1;
            const lastKf = [...l.frames].sort((a, b) => b.index - a.index)[0];
            return lastKf.index + 1;
          }), 1);
          return prev >= maxFrame - 1 ? 0 : prev + 1;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [timeline.layers]);

  // ---------------------------------------------------------------------------
  // Command registry — the single source of truth for editor operations. Menu,
  // keyboard, agent, and JSFL all dispatch by id (agent/keyboard fully unified
  // in Phase 5). Commands read live state from the stores and invoke
  // component-coupled behaviour (playback, publish) via services.
  // ---------------------------------------------------------------------------
  const registryRef = useRef<CommandRegistry | null>(null);
  if (!registryRef.current) registryRef.current = createPopulatedRegistry();
  const registry = registryRef.current;

  // The command context's `services.editor` wraps Shell handlers defined further
  // down, so the context is populated late (see `commandCtxRef.current = …` just
  // before the keyboard hook). `dispatch` is stable and reads the live context
  // at call time — every render refreshes it with current handler refs.
  const commandCtxRef = useRef<CommandContext | null>(null);
  if (!commandCtxRef.current) {
    commandCtxRef.current = { doc: documentStore, ui: uiStore, services: { pushDoc, startPlayback, stopPlayback } };
  }

  /** Run a command by id with the live editor context. */
  const dispatch = useCallback(
    (id: string, args?: unknown) => {
      if (commandCtxRef.current) return registry.dispatch(id, commandCtxRef.current, args);
    },
    [registry]
  );

  const handlePlayToggle = useCallback(() => {
    dispatch("playback.toggle");
  }, [dispatch]);

  const handlePlayingChange = useCallback((playing: boolean) => {
    if (playing) {
      startPlayback();
    } else {
      stopPlayback();
    }
  }, [startPlayback, stopPlayback]);

  // Stop playback when switching edit context or frame changes externally
  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers — zoom / pan
  // ---------------------------------------------------------------------------

  const handleZoomChange = (newZoom: number) => {
    if (newZoom === 0) {
      setZoom(1.0);
    } else {
      setZoom(newZoom / 100);
    }
  };

  const handleZoomChangeDirect = (newZoom: number) => {
    setZoom(newZoom);
  };

  const handlePanChange = (x: number, y: number) => {
    setPanX(x);
    setPanY(y);
  };

  const handleCursorMove = useCallback((x: number, y: number) => {
    setCursorPos({ x, y });
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers — rulers & guides
  // ---------------------------------------------------------------------------

  const handleRulersToggle = useCallback(() => dispatch("view.toggleRulers"), [dispatch]);
  const handleToggleShowGrid = useCallback(() => dispatch("view.toggleGrid"), [dispatch]);
  const handleToggleSnapToGrid = useCallback(() => dispatch("view.toggleSnapToGrid"), [dispatch]);
  const handleToggleSnapToObjects = useCallback(() => dispatch("view.toggleSnapToObjects"), [dispatch]);
  const handleToggleSnapToGuides = useCallback(() => dispatch("view.toggleSnapToGuides"), [dispatch]);

  const handleToggleSnapToPixels = useCallback(() => dispatch("view.toggleSnapToPixels"), [dispatch]);

  const handleViewModeChange = useCallback((mode: "normal" | "outlines" | "fast" | "antialias") => {
    setViewMode(mode as ViewMode);
  }, []);

  const handleEditGridConfirm = useCallback((updatedGrid: import("@flash/core").GridSettings) => {
    pushDoc(withProperties((p) => ({
      ...p,
      grid: updatedGrid,
    })));
    setEditGridOpen(false);
  }, [pushDoc, withProperties]);

  const handleGuideCreate = useCallback((orientation: "horizontal" | "vertical", position: number) => {
    guideCounterRef.current += 1;
    const id = `guide-${guideCounterRef.current}`;
    pushDoc(withProperties((p) => ({
      ...p,
      guides: [...p.guides, { id, orientation, position }],
    })));
  }, [pushDoc, withProperties]);

  const handleGuideMove = useCallback((id: string, newPosition: number) => {
    pushDoc(withProperties((p) => ({
      ...p,
      guides: p.guides.map((g) => (g.id === id ? { ...g, position: newPosition } : g)),
    })));
  }, [pushDoc, withProperties]);

  const handleGuideDelete = useCallback((id: string) => {
    pushDoc(withProperties((p) => ({
      ...p,
      guides: p.guides.filter((g) => g.id !== id),
    })));
  }, [pushDoc, withProperties]);

  // ---------------------------------------------------------------------------
  // Handlers — tools
  // ---------------------------------------------------------------------------

  // Tool / colour / swatch handlers (see hooks/useToolHandlers).
  const {
    handleToolChange, handleStrokeColorChange, handleFillColorChange, handleFillChange,
    handleStrokeChangeFromPanel, handleMixerFillColorChange, handleSelectSwatch, handleAddSwatch,
    handleRemoveSwatch, handleSwatchesLoad, handleMixerStrokeColorChange, handleObjectDrawingToggle,
    handlePencilModeChange, handleBrushSizeChange, handleEraserSizeChange, handleFreeTransformModeChange,
    handleLassoPolygonModeChange, handleLassoMagicWandChange, handleMagicWandThresholdChange,
    handleMagicWandSmoothingChange, handlePolyStarOptionsChange,
  } = useToolHandlers({ uiStore, pushDoc, withTimeline, timeline, safeActiveLayerIndex, currentFrame, selectedShapeId });

  // ---------------------------------------------------------------------------
  // Handlers — shape drawing
  // ---------------------------------------------------------------------------

  const handleShapeCreated = useCallback(
    (shape: Shape, x: number, y: number) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      // Re-create shape with tool colors applied
      const { strokeColor, strokeWidth, strokeAlpha, activeTool } = toolState;
      const fill: Fill | null = toolState.fill ?? null;
      // Stroke None: alpha 0 or width 0 means no stroke
      const stroke: SolidStroke | null = (strokeColor && strokeAlpha > 0 && strokeWidth > 0)
        ? {
            type: "solid",
            color: hexToColor(strokeColor, Math.round((strokeAlpha / 100) * 255)),
            width: strokeWidth,
            caps: "round",
            joints: "round",
            miterLimit: 3,
          }
        : null;

      // Re-create the shape with correct colors using the path coords from the passed shape
      // The shape arg was created with placeholder colors in StageArea; rebuild with tool colors
      let coloredShape: Shape;
      if (activeTool === "oval" && shape.paths[0]) {
        const p = shape.paths[0];
        const xs = [p.start.x, ...p.segments.map((s) => s.to.x)];
        const ys = [p.start.y, ...p.segments.map((s) => s.to.y)];
        const x1 = Math.min(...xs), y1 = Math.min(...ys);
        const x2 = Math.max(...xs), y2 = Math.max(...ys);
        coloredShape = createOvalShape(x1, y1, x2, y2, fill, stroke);
      } else if (activeTool === "rect" && shape.paths[0]) {
        const p = shape.paths[0];
        const xs = [p.start.x, ...p.segments.map((s) => s.to.x)];
        const ys = [p.start.y, ...p.segments.map((s) => s.to.y)];
        const x1 = Math.min(...xs), y1 = Math.min(...ys);
        const x2 = Math.max(...xs), y2 = Math.max(...ys);
        coloredShape = createRectShape(x1, y1, x2, y2, fill, stroke);
      } else if (activeTool === "line" && shape.paths[0]) {
        const p = shape.paths[0];
        const lineStroke: SolidStroke = stroke ?? {
          type: "solid",
          color: { r: 0, g: 0, b: 0, a: 255 },
          width: strokeWidth,
          caps: "round",
          joints: "round",
          miterLimit: 3,
        };
        coloredShape = createLineShape(
          p.start.x,
          p.start.y,
          p.segments[0]?.to.x ?? p.start.x,
          p.segments[0]?.to.y ?? p.start.y,
          lineStroke
        );
      } else if (activeTool === "pen" && shape.paths[0]) {
        // Pen tool: keep existing path geometry, just apply current fill/stroke
        const coloredPaths = shape.paths.map((p) => ({
          ...p,
          ...(fill ? { fill } : {}),
          ...(stroke ? { stroke } : {}),
        }));
        coloredShape = { ...shape, paths: coloredPaths };
      } else if (activeTool === "pencil" || activeTool === "brush") {
        // Pencil/brush: shape already has correct colors applied in StageArea
        coloredShape = shape;
      } else if (activeTool === "polystar" && shape.paths[0]) {
        // PolyStar: shape has geometry from StageArea; apply current fill/stroke colors
        const coloredPaths = shape.paths.map((p) => ({
          ...p,
          ...(fill ? { fill } : {}),
          ...(stroke ? { stroke } : {}),
        }));
        coloredShape = { ...shape, paths: coloredPaths };
      } else {
        coloredShape = shape;
      }

      const obj: ShapeDisplayObject | DrawingObject = toolState.objectDrawing
        ? {
            type: "drawing-object",
            id: coloredShape.id,
            shape: coloredShape,
            x,
            y,
          }
        : {
            type: "shape",
            id: coloredShape.id,
            shape: coloredShape,
            x,
            y,
          };
      pushDoc(withTimeline((t) => addDisplayObject(t, layerId, currentFrame, obj)));
    },
    [timeline, currentFrame, activeLayerIndex, toolState, pushDoc, withTimeline]
  );

  const handleShapeUpdate = useCallback(
    (id: string, newShape: Shape) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) => updateDisplayObject(t, layerId, currentFrame, id, { shape: newShape })));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  // During a drag gesture, use `replaceDoc` (no history entry).
  // When the gesture ends, commit with `pushDoc` via handleShapeMoveEnd.
  // We track the pre-drag document snapshot so the final push captures the full move.
  const dragStartDocRef = useRef<FlashDocument | null>(null);

  const handleShapeMove = useCallback(
    (id: string, dx: number, dy: number) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      // Record pre-drag snapshot on the first move event in this gesture
      if (dragStartDocRef.current === null) {
        dragStartDocRef.current = doc;
      }
      // Determine which IDs to move: if dragged id is selected, move all selected;
      // otherwise just move the dragged id alone.
      const idsToMove = selectedShapeIds.includes(id) ? selectedShapeIds : [id];
      replaceDoc(withTimeline((prev) => {
        const layer = prev.layers.find((l) => l.id === layerId);
        if (!layer) return prev;
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= currentFrame)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) return prev;
        let result = prev;
        for (const moveId of idsToMove) {
          const obj = kf.displayObjects.find((o) => o.id === moveId);
          if (!obj) continue;
          result = updateDisplayObject(result, layerId, currentFrame, moveId, {
            x: obj.x + dx,
            y: obj.y + dy,
          });
        }
        return result;
      }));
    },
    [selectedShapeIds, timeline, currentFrame, activeLayerIndex, doc, replaceDoc, withTimeline]
  );

  /** Called by StageArea on mouse-up after a drag gesture. Commits to history. */
  const handleShapeMoveEnd = useCallback(() => {
    if (dragStartDocRef.current !== null) {
      // Commit: record the pre-drag snapshot as the undo entry, final position as present.
      commitDrag(dragStartDocRef.current, doc);
      dragStartDocRef.current = null;
    }
  }, [doc, commitDrag]);

  const handleShapeDelete = useCallback(
    (id: string) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) => removeDisplayObject(t, layerId, currentFrame, id)));
      setSelectedShapeIds((prev) => prev.filter((x) => x !== id));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  /** Delete all currently selected display objects in one undo step. */
  const handleDeleteSelected = useCallback(() => {
    if (selectedShapeIds.length === 0) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) => {
      let result = t;
      for (const id of selectedShapeIds) {
        result = removeDisplayObject(result, layerId, currentFrame, id);
      }
      return result;
    }));
    setSelectedShapeIds([]);
  }, [selectedShapeIds, timeline, currentFrame, safeActiveLayerIndex, pushDoc, withTimeline]);

  // ---------------------------------------------------------------------------
  // Clipboard handlers
  // ---------------------------------------------------------------------------

  /** Copy: snapshot the selected display object(s) into the module-level clipboard. */
  // Clipboard handlers (object/motion/frame) — see hooks/useClipboardHandlers.
  const {
    handleCopy, handleCut, handlePaste, handlePasteInPlace, handleDuplicate,
    handleCopyMotion, handlePasteMotion, handleCopyFrames, handleCutFrames,
    handleRemoveFrames, handlePasteFrames, handleReverseFrames,
  } = useClipboardHandlers({
    uiStore, doc, timeline, editContext, activeSceneIndex, safeActiveLayerIndex,
    currentFrame, selectedShapeIds, selectedFrameRange, pushDoc, withTimeline, handleDeleteSelected,
  });

  const handleShapeResize = useCallback(
    (id: string, newX: number, newY: number, scaleX: number, scaleY: number) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, { x: newX, y: newY, scaleX, scaleY })
      ));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  const handleShapeRotate = useCallback(
    (id: string, rotation: number) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, { rotation })
      ));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  // ---------------------------------------------------------------------------
  // Transform panel — selected display object and transform handler
  // ---------------------------------------------------------------------------

  /** The active layer's governing keyframe's display object matching the selection. */
  const selectedDisplayObject = useMemo<DisplayObject | null>(() => {
    const id = selectedShapeId;
    if (!id) return null;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return null;
    const kf = getGoverningKeyframe(layer, currentFrame);
    return kf?.displayObjects.find((o) => o.id === id) ?? null;
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame]);

  /**
   * Bounding box (stage coords) of the selected display object, used by TransformHandles overlay.
   * Only available for ShapeDisplayObjects since transformedShapeBounds requires shape geometry.
   */
  const selectedBounds = useMemo(() => {
    if (!selectedDisplayObject) return null;
    if (selectedDisplayObject.type === "shape") {
      const shapeObj = selectedDisplayObject as ShapeDisplayObject;
      const b = transformedShapeBounds(shapeObj);
      return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: shapeObj.rotation ?? 0 };
    }
    if (selectedDisplayObject.type === "drawing-object") {
      const drawObj = selectedDisplayObject as DrawingObject;
      const b = transformedShapeBounds(drawObj);
      return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: 0 };
    }
    return null;
  }, [selectedDisplayObject]);

  /** Handle scale from TransformHandles overlay. Applies relative scale to the selected object. */
  const handleFreeTransformScale = useCallback(
    (scaleX: number, scaleY: number, _originX: number, _originY: number) => {
      if (!selectedShapeId || !selectedDisplayObject || selectedDisplayObject.type !== "shape") return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const obj = selectedDisplayObject;
      const newScaleX = (obj.scaleX ?? 1) * scaleX;
      const newScaleY = (obj.scaleY ?? 1) * scaleY;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
          scaleX: newScaleX,
          scaleY: newScaleY,
        })
      ));
    },
    [selectedShapeId, selectedDisplayObject, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  /** Handle rotation from TransformHandles overlay. */
  const handleFreeTransformRotate = useCallback(
    (deltaAngle: number, _originX: number, _originY: number) => {
      if (!selectedShapeId || !selectedDisplayObject) return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const origRotation = (selectedDisplayObject as { rotation?: number }).rotation ?? 0;
      const newRotation = origRotation + deltaAngle;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedShapeId, { rotation: newRotation })
      ));
    },
    [selectedShapeId, selectedDisplayObject, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  /** Handle move from TransformHandles bounding box drag. */
  const handleFreeTransformMove = useCallback(
    (dx: number, dy: number) => {
      if (!selectedShapeId || !selectedDisplayObject) return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const kf = getGoverningKeyframe(layer, currentFrame);
      if (!kf) return;
      replaceDoc(withTimeline((t) => {
        let result = t;
        for (const id of selectedShapeIds) {
          const obj = kf.displayObjects.find((o) => o.id === id);
          if (!obj) continue;
          result = updateDisplayObject(result, layerId, currentFrame, id, {
            x: obj.x + dx,
            y: obj.y + dy,
          });
        }
        return result;
      }));
    },
    [selectedShapeId, selectedShapeIds, selectedDisplayObject, timeline, safeActiveLayerIndex, currentFrame, replaceDoc, withTimeline]
  );

  /** Arrow-key nudge: move the selected object(s) by dx/dy pixels (1px plain, 8px with Shift). */
  const handleNudge = useCallback(
    (dx: number, dy: number) => {
      if (selectedShapeIds.length === 0) return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      // Skip nudge when the user is actively editing text in a text field
      if (editingTextId !== null) return;
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const kf = getGoverningKeyframe(layer, currentFrame);
      if (!kf) return;
      pushDoc(withTimeline((t) => {
        let result = t;
        for (const id of selectedShapeIds) {
          const obj = kf.displayObjects.find((o) => o.id === id);
          if (!obj) continue;
          result = updateDisplayObject(result, layerId, currentFrame, id, {
            x: obj.x + dx,
            y: obj.y + dy,
          });
        }
        return result;
      }));
    },
    [selectedShapeIds, editingTextId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  const handleTransformObject = useCallback(
    (id: string, updates: TransformUpdates) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;

      // Build partial update for updateDisplayObject (omit width/height — not a real field)
      const { width: _w, height: _h, ...rest } = updates;
      void _w; void _h;

      // For shapes, W/H edits translate to scaleX/scaleY which are already
      // resolved in TransformPanel before calling onTransform.
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, rest)
      ));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  /** Update a SymbolInstance's instance-level properties (name, colorEffect, loopMode, etc.). */
  const handleUpdateInstance = useCallback(
    (id: string, updates: Partial<SymbolInstance>) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, updates)
      ));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  /**
   * Returns the currently selected SymbolInstance if it references a movieclip symbol,
   * otherwise null. Used by ActionsPanel for "Actions - Movie Clip" mode.
   */
  const selectedMovieClipInstance = useMemo<SymbolInstance | null>(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "instance") return null;
    const inst = selectedDisplayObject as SymbolInstance;
    const libItem = doc.library.items.find(
      (i) => i.id === inst.symbolId && i.itemType === "symbol"
    );
    if (!libItem || libItem.itemType !== "symbol" || libItem.symbolType !== "movieclip") return null;
    return inst;
  }, [selectedDisplayObject, doc.library.items]);

  /** Update clipActions on the currently selected movieclip instance. */
  const handleClipActionsChange = useCallback(
    (clipActions: readonly ClipAction[]) => {
      if (!selectedMovieClipInstance) return;
      handleUpdateInstance(selectedMovieClipInstance.id, { clipActions });
    },
    [selectedMovieClipInstance, handleUpdateInstance]
  );

  /**
   * Returns the Symbol (from library) if the currently selected display object is a
   * button instance, otherwise null. Used by ActionsPanel for "Actions - Button" mode.
   */
  const selectedButtonSymbol = useMemo<Symbol | null>(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "instance") return null;
    const inst = selectedDisplayObject as SymbolInstance;
    const libItem = doc.library.items.find(
      (i) => i.id === inst.symbolId && i.itemType === "symbol"
    );
    if (!libItem || libItem.itemType !== "symbol" || libItem.symbolType !== "button") return null;
    return libItem;
  }, [selectedDisplayObject, doc.library.items]);

  /**
   * Returns the currently selected SymbolInstance if it references a button symbol,
   * otherwise null. Used by ActionsPanel for "Actions - Button" (instance) mode, which
   * surfaces the instance's on() handlers (`buttonHandlers`) — the handlers imported
   * from a Flash 8 FLA's on(release){...} blocks on a placed button instance.
   */
  const selectedButtonInstance = useMemo<SymbolInstance | null>(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "instance") return null;
    const inst = selectedDisplayObject as SymbolInstance;
    const libItem = doc.library.items.find(
      (i) => i.id === inst.symbolId && i.itemType === "symbol"
    );
    if (!libItem || libItem.itemType !== "symbol" || libItem.symbolType !== "button") return null;
    return inst;
  }, [selectedDisplayObject, doc.library.items]);

  /** Update buttonHandlers on the currently selected button instance (stage-level on() handlers). */
  const handleButtonHandlersChange = useCallback(
    (buttonHandlers: readonly ButtonHandler[]) => {
      if (!selectedButtonInstance) return;
      handleUpdateInstance(selectedButtonInstance.id, { buttonHandlers });
    },
    [selectedButtonInstance, handleUpdateInstance]
  );

  /** Update buttonActions on the currently selected button symbol (library-level). */
  const handleButtonActionsChange = useCallback(
    (actions: readonly ButtonAction[]) => {
      if (!selectedButtonSymbol) return;
      const symId = selectedButtonSymbol.id;
      pushDoc({
        ...doc,
        library: {
          ...doc.library,
          items: doc.library.items.map((item) =>
            item.id === symId && item.itemType === "symbol"
              ? { ...item, buttonActions: actions }
              : item
          ),
        },
      });
    },
    [selectedButtonSymbol, doc, pushDoc]
  );

  /** Generic display object updater used by PropertiesPanel. */
  const handleUpdateObject = useCallback(
    (id: string, changes: Partial<DisplayObject>) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, changes)
      ));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  /** Open the Swap Bitmap dialog for the given BitmapDisplayObject id. */
  const handleSwapBitmap = useCallback((id: string) => {
    setSwapBitmapTargetId(id);
    setSwapBitmapDialogOpen(true);
  }, []);

  /** Called when the user confirms a bitmap swap from the dialog. */
  const handleSwapBitmapConfirm = useCallback((newLibraryItemId: string) => {
    setSwapBitmapDialogOpen(false);
    if (!swapBitmapTargetId) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) =>
      updateDisplayObject(t, layerId, currentFrame, swapBitmapTargetId, {
        libraryItemId: newLibraryItemId,
      } as Partial<BitmapDisplayObject>)
    ));
    setSwapBitmapTargetId(null);
  }, [swapBitmapTargetId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  /** Single-element array of the currently selected display object (for PropertiesPanel). */
  const selectedObjects = useMemo<DisplayObject[]>(
    () => (selectedDisplayObject ? [selectedDisplayObject] : []),
    [selectedDisplayObject]
  );

  /** Governing keyframe at the active layer cursor position (for PropertiesPanel frame view). */
  const currentGoverningFrame = useMemo<Frame | null>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return null;
    return getGoverningKeyframe(layer, currentFrame) ?? null;
  }, [timeline, safeActiveLayerIndex, currentFrame]);

  /**
   * Shape hints from the governing keyframe of the active layer at the current
   * frame. Non-empty only on shape-tween keyframes that have hints added.
   * Used to render the hint overlay on the stage.
   */
  const activeShapeHints = useMemo<readonly ShapeHint[]>(() => {
    return currentGoverningFrame?.shapeHints ?? [];
  }, [currentGoverningFrame]);

  // ---------------------------------------------------------------------------
  // Handlers — Align panel
  // ---------------------------------------------------------------------------

  /** All display objects in the active layer's governing keyframe (for AlignPanel). */
  const activeKeyframeObjects = useMemo<readonly DisplayObject[]>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return [];
    const kf = getGoverningKeyframe(layer, currentFrame);
    return kf?.displayObjects ?? [];
  }, [timeline, safeActiveLayerIndex, currentFrame]);

  const handleAlignObjects = useCallback(
    (movedObjects: { id: string; x: number; y: number }[]) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      let newDoc = doc;
      for (const { id, x, y } of movedObjects) {
        if (editContext.mode === "symbol" && editContext.symbolId) {
          const symId = editContext.symbolId;
          const items = newDoc.library.items.map((libItem) => {
            if (libItem.id === symId && libItem.itemType === "symbol") {
              return { ...libItem, timeline: updateDisplayObject(libItem.timeline, layerId, currentFrame, id, { x, y }) };
            }
            return libItem;
          });
          newDoc = { ...newDoc, library: { ...newDoc.library, items } };
        } else {
          const sceneIdx = Math.min(activeSceneIndex, newDoc.scenes.length - 1);
          const t = updateDisplayObject(newDoc.scenes[sceneIdx].timeline, layerId, currentFrame, id, { x, y });
          newDoc = { ...newDoc, scenes: newDoc.scenes.map((s, i) => i === sceneIdx ? { ...s, timeline: t } : s) };
        }
      }
      pushDoc(newDoc);
    },
    [doc, timeline, safeActiveLayerIndex, currentFrame, editContext, pushDoc, activeSceneIndex]
  );

  const handleMatchSizeObjects = useCallback(
    (resizedObjects: { id: string; scaleX: number; scaleY: number }[]) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      let newDoc = doc;
      for (const { id, scaleX, scaleY } of resizedObjects) {
        if (editContext.mode === "symbol" && editContext.symbolId) {
          const symId = editContext.symbolId;
          const items = newDoc.library.items.map((libItem) => {
            if (libItem.id === symId && libItem.itemType === "symbol") {
              return { ...libItem, timeline: updateDisplayObject(libItem.timeline, layerId, currentFrame, id, { scaleX, scaleY }) };
            }
            return libItem;
          });
          newDoc = { ...newDoc, library: { ...newDoc.library, items } };
        } else {
          const sceneIdx = Math.min(activeSceneIndex, newDoc.scenes.length - 1);
          const t = updateDisplayObject(newDoc.scenes[sceneIdx].timeline, layerId, currentFrame, id, { scaleX, scaleY });
          newDoc = { ...newDoc, scenes: newDoc.scenes.map((s, i) => i === sceneIdx ? { ...s, timeline: t } : s) };
        }
      }
      pushDoc(newDoc);
    },
    [doc, timeline, safeActiveLayerIndex, currentFrame, editContext, pushDoc, activeSceneIndex]
  );

  // ---------------------------------------------------------------------------
  // Handlers — scenes
  // ---------------------------------------------------------------------------

  // Scene handlers — see hooks/useSceneHandlers.
  const {
    handleAddScene, handleRemoveScene, handleRenameScene,
    handleReorderScene, handleDuplicateScene, handleSelectScene,
  } = useSceneHandlers({ uiStore, doc, pushDoc });

  // ---------------------------------------------------------------------------
  // Handlers — text tool
  // ---------------------------------------------------------------------------

  // Text tool + Text-menu handlers — see hooks/useTextHandlers.
  const {
    handleTextCreated, handleTextPlace, handleTextEdit, handleTextEditEnd,
    handleTextFormatChange, handleTextBold, handleTextItalic, handleTextUnderline,
    handleTextAlignLeft, handleTextAlignCenter, handleTextAlignRight, handleTextAlignJustify,
    handleTextTrackingIncrease, handleTextTrackingDecrease, handleTextTrackingReset,
    handleTextScrollable,
  } = useTextHandlers({
    uiStore, timeline, safeActiveLayerIndex, activeLayerIndex, currentFrame,
    pushDoc, withTimeline, selectedDisplayObject,
  });

  // ---------------------------------------------------------------------------
  // Handlers — library
  // ---------------------------------------------------------------------------

  // Library + import handlers — see hooks/useLibraryHandlers.
  const {
    handleImportToLibrary, handleImportToStage, handleImportSound, handleImportVideo,
    handleCreateSymbol, handleDeleteLibraryItem, handleRenameLibraryItem, handleDuplicateLibraryItem,
    handleAddFolder, handleMoveItemToFolder, handleUpdateFolder, handleSetLinkage,
    handleSetSymbolProperties, handleBitmapPropsSave, handleEditInPlace, handleExitEditInPlace,
  } = useLibraryHandlers({
    uiStore, library, timeline, docProperties, editContext, activeSceneIndex,
    safeActiveLayerIndex, currentFrame, bitmapPropsItem, pushDoc, withLibrary, rendererRef,
  });

  // ---------------------------------------------------------------------------
  // Convert to Symbol (F8)
  // ---------------------------------------------------------------------------

  /**
   * Open the Convert to Symbol dialog if there is something to convert.
   * The actual conversion is performed in handleConvertToSymbolConfirm.
   */
  // Modify-menu shape ops (convert/arrange/group/ungroup/break-apart) — see hooks/useShapeModifyHandlers.
  const {
    handleConvertToSymbol, handleConvertToSymbolConfirm, handleArrange,
    handleGroup, handleUngroup, handleBreakApart,
  } = useShapeModifyHandlers({
    uiStore, doc, timeline, editContext, activeSceneIndex, safeActiveLayerIndex,
    currentFrame, selectedShapeId, pushDoc, withTimeline, setSelectedShapeId,
  });

  // ---------------------------------------------------------------------------
  // Timeline Effects (Insert > Timeline Effects > Transform / Transition)
  // ---------------------------------------------------------------------------

  /**
   * Open the Timeline Effects dialog for the given effect type.
   * A selection (or at least one object on the active keyframe) is required.
   */
  // Timeline Effects (Insert > Timeline Effects) — see hooks/useTimelineEffectHandlers.
  const { handleOpenTimelineEffect, handleApplyTimelineEffect } = useTimelineEffectHandlers({
    uiStore, doc, timeline, editContext, activeSceneIndex, safeActiveLayerIndex,
    currentFrame, selectedShapeId, pushDoc, setSelectedShapeId, timelineEffectCounterRef,
  });

  // ---------------------------------------------------------------------------
  // Trace Bitmap
  // ---------------------------------------------------------------------------

  /**
   * Open the Trace Bitmap dialog if the selected display object is a BitmapDisplayObject.
   */
  // Shape ops (trace/smooth/optimize/hints/flip-rotate/swap/distribute) — see hooks/useShapeOpHandlers.
  const {
    handleTraceBitmapOpen, handleTraceBitmapConfirm, handleSmooth, handleOptimize,
    handleAddShapeHint, handleUpdateShapeHint, handleFlipHorizontal, handleFlipVertical,
    handleRotate90CW, handleRotate90CCW, handleRotate180, handleSwapSymbol,
    handleSwapSymbolConfirm, handleDistributeToLayers,
  } = useShapeOpHandlers({
    uiStore, doc, docProperties, timeline, safeActiveLayerIndex, currentFrame,
    selectedShapeId, pushDoc, withTimeline, setSelectedShapeId,
  });

  // ---------------------------------------------------------------------------
  // Handlers — stage drop
  // ---------------------------------------------------------------------------

  const handleStageDrop = useCallback(
    (libraryItemId: string, x: number, y: number) => {
      // Check if the dropped item is a BitmapItem
      const libItem = library.items.find((i) => i.id === libraryItemId);
      if (libItem && libItem.itemType === "bitmap") {
        const bitmapItem = libItem as BitmapItem;
        const layerId = timeline.layers[safeActiveLayerIndex]?.id;
        if (!layerId) return;

        // Use original dimensions if available, otherwise default to 100x100
        // and load the real dimensions from the image asynchronously
        const defaultW = bitmapItem.originalWidth > 0 ? bitmapItem.originalWidth : 100;
        const defaultH = bitmapItem.originalHeight > 0 ? bitmapItem.originalHeight : 100;

        const createBitmapObj = (w: number, h: number) => {
          const obj: BitmapDisplayObject = {
            type: "bitmap",
            id: nextBitmapId(),
            libraryItemId,
            x: x - w / 2,
            y: y - h / 2,
            width: w,
            height: h,
          };
          pushDoc(withTimeline((t) => addDisplayObject(t, layerId, currentFrame, obj)));
        };

        if (bitmapItem.dataUri && (bitmapItem.originalWidth === 0 || bitmapItem.originalHeight === 0)) {
          // Load image to get real dimensions
          const img = new Image();
          img.onload = () => {
            const w = img.naturalWidth || defaultW;
            const h = img.naturalHeight || defaultH;
            // Pre-load into renderer
            rendererRef.current?.loadImage(libraryItemId, bitmapItem.dataUri);
            createBitmapObj(w, h);
          };
          img.onerror = () => createBitmapObj(defaultW, defaultH);
          img.src = bitmapItem.dataUri;
        } else {
          rendererRef.current?.loadImage(libraryItemId, bitmapItem.dataUri);
          createBitmapObj(defaultW, defaultH);
        }
        return;
      }

      // VideoItem: place a VideoDisplayObject at the video's native dimensions
      // (falling back to a default box when the item carries no size).
      if (libItem && libItem.itemType === "video") {
        const videoItem = libItem as VideoItem;
        const layerId = timeline.layers[safeActiveLayerIndex]?.id;
        if (!layerId) return;
        const w = videoItem.width > 0 ? videoItem.width : 320;
        const h = videoItem.height > 0 ? videoItem.height : 240;
        const obj: VideoDisplayObject = {
          type: "video",
          id: nextVideoId(),
          videoItemId: libraryItemId,
          x: x - w / 2,
          y: y - h / 2,
          width: w,
          height: h,
        };
        pushDoc(withTimeline((t) => addDisplayObject(t, layerId, currentFrame, obj)));
        return;
      }

      // Non-bitmap items (symbols): place a SymbolInstance in the timeline
      // AND keep a PlacedInstance for selection/properties UI
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (layerId) {
        const instId = nextInstanceId();
        // Compute natural size from the symbol's first-frame objects (if available)
        const symLibItem = library.items.find((i) => i.id === libraryItemId && i.itemType === "symbol");
        const symFirstFrameObjs: DisplayObject[] = symLibItem && symLibItem.itemType === "symbol"
          ? symLibItem.timeline.layers.flatMap((l) =>
              l.frames.length > 0 ? [...l.frames[0].displayObjects] : []
            )
          : [];
        const symBounds = getUnionBounds(symFirstFrameObjs);
        const symNatW = symBounds?.width ?? 0;
        const symNatH = symBounds?.height ?? 0;
        const symbolInst: SymbolInstance = {
          type: "instance",
          id: instId,
          symbolId: libraryItemId,
          x,
          y,
          ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
          ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
        };
        pushDoc(withTimeline((t) => addDisplayObject(t, layerId, currentFrame, symbolInst)));

        const inst: PlacedInstance = {
          id: instId,
          libraryItemId,
          instanceName: "",
          x,
          y,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          alpha: 1,
        };
        setInstances((prev) => [...prev, inst]);
        setSelectedInstanceId(inst.id);
        setRightTab("properties");
      }
    },
    [library, timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  const handleInstanceSelect = useCallback((id: string | null) => {
    setSelectedInstanceId(id);
    if (id !== null) setRightTab("properties");
  }, []);

  // Edit Multiple Frames: jump to the ghost frame that was clicked
  const handleEditMultipleFrameClick = useCallback((frameIndex: number) => {
    setCurrentFrame(frameIndex);
  }, []);

  const handleInstanceDoubleClick = useCallback((instanceId: string) => {
    // Find the PlacedInstance to get its libraryItemId, then enter edit-in-place
    const inst = instances.find((i) => i.id === instanceId);
    if (inst) {
      handleEditInPlace(inst.libraryItemId);
    }
  }, [instances, handleEditInPlace]);

  /**
   * Called when the user double-clicks a SymbolInstance display object on stage
   * (rendered via CanvasRenderer) with the selection tool.
   */
  const handleSymbolInstanceDoubleClick = useCallback(
    (instanceId: string, symbolId: string) => {
      handleEditInPlace(symbolId, instanceId);
    },
    [handleEditInPlace]
  );

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  // Build a map: libraryItemId -> name
  const instanceNames = instanceNamesOf(library);

  // Per-frame display-object collections for the active layer (interaction/hit-testing).
  // Bodies live in selectors/derived.ts; memoize at the call site.
  const shapeDisplayObjects = useMemo<ShapeDisplayObject[]>(
    () => shapeDisplayObjectsAt(timeline, safeActiveLayerIndex, currentFrame),
    [timeline, currentFrame, safeActiveLayerIndex]
  );
  const textDisplayObjects = useMemo<TextDisplayObject[]>(
    () => textDisplayObjectsAt(timeline, safeActiveLayerIndex, currentFrame),
    [timeline, currentFrame, safeActiveLayerIndex]
  );
  const bitmapDisplayObjects = useMemo<BitmapDisplayObject[]>(
    () => bitmapDisplayObjectsAt(timeline, safeActiveLayerIndex, currentFrame),
    [timeline, currentFrame, safeActiveLayerIndex]
  );
  const symbolInstanceDisplayObjects = useMemo<SymbolInstance[]>(
    () => symbolInstancesAt(timeline, safeActiveLayerIndex, currentFrame),
    [timeline, currentFrame, safeActiveLayerIndex]
  );
  const bitmapLibraryItems = useMemo<BitmapItem[]>(() => bitmapLibraryItemsOf(library), [library]);
  const soundLibraryItems = useMemo<SoundItem[]>(() => soundLibraryItemsOf(library), [library]);

  // Build the full multi-layer SceneGraph for rendering in StageArea.
  // Each layer's objects are resolved at the current frame, with tween interpolation
  // applied when the frame falls within a motion or shape tween span.
  // Index 0 = topmost (Flash convention); renderer draws last index first.
  const fullSceneGraph = useMemo<SceneGraph>(() => {
    const layers = timeline.layers.map((layer) => {
      const frame = getTweenedFrame(layer, currentFrame);
      const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        outlineMode: layer.outlineMode,
        outlineColor: layer.outlineColor,
        objects,
      };
    });
    return { layers };
  }, [timeline, currentFrame]);

  // When in symbol edit mode, build a SceneGraph from the main scene to render dimmed behind
  // the symbol's contents, giving visual context to the editor.
  const parentSceneGraph = useMemo<SceneGraph | undefined>(() => {
    if (editContext.mode !== "symbol") return undefined;
    const idx = Math.min(activeSceneIndex, doc.scenes.length - 1);
    const sceneTimeline = doc.scenes[idx].timeline;
    const layers = sceneTimeline.layers.map((layer) => {
      const frame = getTweenedFrame(layer, currentFrame);
      const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        outlineMode: layer.outlineMode,
        outlineColor: layer.outlineColor,
        objects,
      };
    });
    return { layers };
  }, [editContext, doc, activeSceneIndex, currentFrame]);

  // Compute onion skin ghost frames (also used by Edit Multiple Frames mode)
  const onionFrames = useMemo<OnionFrame[]>(() => {
    if (!onionSkinEnabled && !editMultipleFrames) return [];
    const frames: OnionFrame[] = [];
    const maxFrame = Math.max(...timeline.layers.map((l) => {
      if (l.frames.length === 0) return 1;
      const lastKf = [...l.frames].sort((a, b) => b.index - a.index)[0];
      return lastKf.index + 1;
    }), 1);

    // Helper: build SceneGraph for a given frame index
    const buildSceneGraph = (fi: number): SceneGraph => {
      const layers = timeline.layers.map((layer) => {
        const frame = getTweenedFrame(layer, fi);
        const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
        return {
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          outlineMode: layer.outlineMode,
          outlineColor: layer.outlineColor,
          objects,
        };
      });
      return { layers };
    };

    // In Edit Multiple Frames mode, all range frames are shown at high opacity (0.6).
    // In normal onion-skin mode, use the graduated opacity.
    const beforeOpacity = (i: number) =>
      editMultipleFrames ? 0.6 : 0.2 + (0.2 * (onionBefore - i) / Math.max(onionBefore, 1));
    const afterOpacity = (i: number) =>
      editMultipleFrames ? 0.6 : 0.2 + (0.2 * (onionAfter - i) / Math.max(onionAfter, 1));

    // Before frames (closer = higher opacity)
    for (let i = 1; i <= onionBefore; i++) {
      const fi = currentFrame - i;
      if (fi < 0) continue;
      frames.push({ frameIndex: fi, opacity: beforeOpacity(i), tint: "before", sceneGraph: buildSceneGraph(fi), outlineMode: onionSkinOutlines });
    }
    // After frames (closer = higher opacity)
    for (let i = 1; i <= onionAfter; i++) {
      const fi = currentFrame + i;
      if (fi >= maxFrame) continue;
      frames.push({ frameIndex: fi, opacity: afterOpacity(i), tint: "after", sceneGraph: buildSceneGraph(fi), outlineMode: onionSkinOutlines });
    }
    return frames;
  }, [onionSkinEnabled, onionSkinOutlines, editMultipleFrames, onionBefore, onionAfter, currentFrame, timeline, doc.library]);

  // Derive selected keyframe frame object (from active layer, governing keyframe at currentFrame)
  const selectedKeyframeFrame = useMemo<Frame | null>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return null;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    return kf ?? null;
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  // Derived layer index of the active layer (for sound panel)
  const selectedLayerIndex = safeActiveLayerIndex;

  const handleEyedropperSample = useCallback(
    (shapeId: string) => {
      const shape = shapeDisplayObjects.find((s) => s.id === shapeId);
      if (!shape) return;
      const firstPath = shape.shape.paths[0];
      if (!firstPath) return;
      setToolState((prev) => {
        const newFill = firstPath.fill ?? prev.fill;
        let newFillColor = prev.fillColor;
        if (newFill?.type === "solid") {
          const { r, g, b } = newFill.color;
          newFillColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        }
        const newStroke = firstPath.stroke;
        let newStrokeColor = prev.strokeColor;
        if (newStroke) {
          const { r, g, b } = newStroke.color;
          newStrokeColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        }
        // Auto-switch tool: sampled fill → paint bucket; sampled stroke only → ink bottle
        const nextTool: ToolId = firstPath.fill ? "fill" : "ink-bottle";
        return {
          ...prev,
          fill: newFill,
          fillColor: newFillColor,
          strokeColor: newStrokeColor,
          strokeWidth: newStroke?.width ?? prev.strokeWidth,
          activeTool: nextTool,
        };
      });
    },
    [shapeDisplayObjects]
  );

  // Filters for the currently selected display object (works for shapes, instances, text, drawing-objects)
  const selectedShapeFilters = useMemo<FlashFilter[]>(() => {
    if (!selectedDisplayObject) return [];
    const obj = selectedDisplayObject as { filters?: readonly FlashFilter[] };
    return obj.filters ? [...obj.filters] : [];
  }, [selectedDisplayObject]);

  const handleFiltersChange = useCallback(
    (filters: FlashFilter[]) => {
      if (!selectedShapeId) return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedShapeId, { filters })
      ));
    },
    [selectedShapeId, timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  // Derive current script from the governing keyframe of the active layer
  const currentScript = useMemo<string>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return "";
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    return kf?.script ?? "";
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  /** The governing keyframe of the active layer at the current frame position. */
  const currentKeyframe = useMemo<Frame | null>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return null;
    return [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0] ?? null;
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  const handleScriptChange = useCallback(
    (script: string) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) => setFrameScript(t, layerId, currentFrame, script)));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  const handleBehaviorsChange = useCallback(
    (behaviors: ReadonlyArray<import("@flash/core").AttachedBehavior>) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) => setFrameBehaviors(t, layerId, currentFrame, behaviors)));
    },
    [timeline, currentFrame, safeActiveLayerIndex, pushDoc, withTimeline]
  );

  const handleSoundChange = useCallback(
    (frameIdx: number, layerIdx: number, sound: SoundLinkage | null) => {
      pushDoc(withTimeline((t) => setSoundOnFrame(t, layerIdx, frameIdx, sound)));
    },
    [pushDoc, withTimeline]
  );

  const previewSound = useCallback((dataUri: string) => {
    const audio = new Audio(dataUri);
    audio.play().catch(() => {});
  }, []);

  const handleEditEnvelope = useCallback(
    (frameIdx: number, layerIdx: number) => {
      setEnvelopeDialogTarget({ frameIdx, layerIdx });
      setEnvelopeDialogOpen(true);
    },
    [],
  );

  const handleEnvelopeConfirm = useCallback(
    (result: { inPoint: number; outPoint: number; customEnvelope: SoundEnvelopePoint[] }) => {
      if (!envelopeDialogTarget) return;
      const { frameIdx, layerIdx } = envelopeDialogTarget;
      pushDoc(
        withTimeline((t) => {
          const layer = t.layers[layerIdx];
          if (!layer) return t;
          const kf = getGoverningKeyframe(layer, frameIdx);
          if (!kf || !kf.sound) return t;
          const updatedSound: SoundLinkage = {
            ...kf.sound,
            inPoint: result.inPoint,
            outPoint: result.outPoint > 0 ? result.outPoint : undefined,
            customEnvelope: result.customEnvelope,
          };
          return setSoundOnFrame(t, layerIdx, kf.index, updatedSound);
        }),
      );
    },
    [envelopeDialogTarget, pushDoc, withTimeline],
  );

  // ---------------------------------------------------------------------------
  // Keyboard shortcut handlers
  // ---------------------------------------------------------------------------

  // edit.selectAll/deselectAll and timeline.insert*/remove/clear are dispatched
  // directly via the keyboard (dispatch/keyboard.ts) and the command registry.

  // Populate the command context now that all editor handlers are defined. The
  // editor actions delegate the not-yet-migrated operations; their command ids
  // are dispatched by both the keyboard (below) and the menu.
  commandCtxRef.current = {
    doc: documentStore,
    ui: uiStore,
    services: {
      pushDoc,
      startPlayback,
      stopPlayback,
      editor: {
        copy: handleCopy,
        cut: handleCut,
        paste: () => handlePaste(false),
        pasteInPlace: handlePasteInPlace,
        deleteSelected: handleDeleteSelected,
        duplicate: handleDuplicate,
        group: handleGroup,
        ungroup: handleUngroup,
        breakApart: handleBreakApart,
        bringToFront: () => handleArrange("front"),
        sendToBack: () => handleArrange("back"),
        textBold: handleTextBold,
        textItalic: handleTextItalic,
        textUnderline: handleTextUnderline,
        textAlignLeft: handleTextAlignLeft,
        textAlignCenter: handleTextAlignCenter,
        textAlignRight: handleTextAlignRight,
        textAlignJustify: handleTextAlignJustify,
        textTrackingIncrease: handleTextTrackingIncrease,
        textTrackingDecrease: handleTextTrackingDecrease,
        textTrackingReset: handleTextTrackingReset,
        addShapeHint: handleAddShapeHint,
        toggleFindReplace: () => setFindReplaceVisible((v) => !v),
      },
    },
  };

  // Keyboard shortcuts dispatch command ids through the shared registry.
  useCommandKeyboard({ dispatch, onNudge: handleNudge });

  // ---------------------------------------------------------------------------
  // Document properties handlers
  // ---------------------------------------------------------------------------

  const handleDocPropsConfirm = useCallback((updated: DocumentProperties) => {
    pushDoc(withProperties(() => updated));
    setDocPropsOpen(false);
  }, [pushDoc, withProperties]);

  /** Partial update of document properties (used by bottom PropertiesPanel). */
  const handleUpdateDocProperties = useCallback((partial: Partial<DocumentProperties>) => {
    pushDoc(withProperties((p) => ({ ...p, ...partial })));
  }, [pushDoc, withProperties]);

  /**
   * Update frame properties from the PropertiesPanel frame view.
   * Handles label, labelType, tweenType, motionEase, motionRotate, motionRotateCount.
   */
  const handleFrameUpdate = useCallback(
    (layerIndex: number, frameIndex: number, updates: Partial<Frame>) => {
      const layer = timeline.layers[layerIndex];
      if (!layer) return;
      const kf = getGoverningKeyframe(layer, frameIndex);
      if (!kf || !kf.isKeyframe) return;
      const kfIndex = kf.index;
      const layerId = layer.id;

      pushDoc(
        withTimeline((t) => {
          let updated = t;

          // Handle label/labelType updates
          if (updates.label !== undefined || updates.labelType !== undefined) {
            updated = {
              ...updated,
              layers: updated.layers.map((l) => {
                if (l.id !== layerId) return l;
                return {
                  ...l,
                  frames: l.frames.map((f) => {
                    if (f.index !== kfIndex || !f.isKeyframe) return f;
                    return {
                      ...f,
                      ...(updates.label !== undefined ? { label: updates.label } : {}),
                      ...(updates.labelType !== undefined ? { labelType: updates.labelType } : {}),
                    };
                  }),
                };
              }),
            };
          }

          // Handle tweenType changes
          if (updates.tweenType !== undefined) {
            if (updates.tweenType === "none") {
              updated = clearTween(updated, layerId, kfIndex);
            } else if (updates.tweenType === "motion") {
              updated = setMotionTween(updated, layerId, kfIndex);
            } else if (updates.tweenType === "shape") {
              updated = setShapeTween(updated, layerId, kfIndex);
            }
          }

          // Handle motion ease update
          if (updates.motionEase !== undefined) {
            updated = setMotionTween(updated, layerId, kfIndex, updates.motionEase);
          }

          // Handle motion rotate/rotateCount via updateMotionTweenProps
          const motionProps: { motionRotate?: "none" | "auto" | "cw" | "ccw"; motionRotateCount?: number } = {};
          if (updates.motionRotate !== undefined) motionProps.motionRotate = updates.motionRotate;
          if (updates.motionRotateCount !== undefined) motionProps.motionRotateCount = updates.motionRotateCount;
          if (Object.keys(motionProps).length > 0) {
            updated = updateMotionTweenProps(updated, layerId, kfIndex, motionProps);
          }

          return updated;
        }),
      );
    },
    [timeline, pushDoc, withTimeline],
  );

  // ---------------------------------------------------------------------------
  // File menu handlers
  // ---------------------------------------------------------------------------

  const handleDocumentChange = useCallback((newDoc: FlashDocument, newPath?: string) => {
    // Replace present with the new document, then wipe history so that
    // undo/redo cannot cross the open/new boundary.
    replaceDoc(newDoc);
    clearHistory();
    setFilePath(newPath);
    setCurrentFrame(0);
    setInstances([]);
    setSelectedInstanceId(null);
    setSelectedShapeId(null);
  }, [replaceDoc, clearHistory]);

  const handleFilePathChange = useCallback((newPath: string) => {
    setFilePath(newPath);
  }, []);

  // ---------------------------------------------------------------------------
  // Drag-and-drop — open .fla files dropped onto the editor window
  // (isDragOver lives in uiStore)
  // ---------------------------------------------------------------------------

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only highlight when at least one dragged item looks like a file
    const hasFile = Array.from(e.dataTransfer.types).includes("Files");
    if (hasFile) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when leaving the shell entirely (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.name.toLowerCase().endsWith(".fla")
    );
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const newDoc = await loadFlaFromBytes(new Uint8Array(buffer), file.name);
    if (newDoc) {
      handleDocumentChange(newDoc, undefined);
    }
  }, [handleDocumentChange]);

  // ---------------------------------------------------------------------------
  // Publish handlers
  // ---------------------------------------------------------------------------

  const { publishToBytes, testMovie } = usePublish(doc, {
    compress: publishSettings.compress,
    protect: publishSettings.protect,
    debugPassword: publishSettings.debuggingPermitted && publishSettings.debugPassword
      ? publishSettings.debugPassword
      : undefined,
  });

  const handlePublish = useCallback(() => {
    void (async () => {
      const bytes = await publishToBytes();
      const swfFilename = publishSettings.filename || "movie.swf";

      // Download the SWF
      const swfBlob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/x-shockwave-flash" });
      const swfUrl = URL.createObjectURL(swfBlob);
      const swfLink = document.createElement("a");
      swfLink.href = swfUrl;
      swfLink.download = swfFilename;
      swfLink.click();
      URL.revokeObjectURL(swfUrl);

      // Download the HTML wrapper when enabled
      if (publishSettings.html?.publishHtml !== false) {
        const htmlOpts = publishSettings.html ?? DEFAULT_HTML_OPTIONS;
        const htmlStr = generateHtmlWrapper({
          title: swfFilename.replace(/\.swf$/i, ""),
          width: doc.properties.width,
          height: doc.properties.height,
          bgcolor: doc.properties.backgroundColor,
          quality: htmlOpts.quality,
          loop: htmlOpts.loop,
          menu: htmlOpts.menu,
          scale: htmlOpts.scale,
          wmode: htmlOpts.wmode,
          swfFilename,
          flashVersion: 8,
        });
        const htmlFilename = swfFilename.replace(/\.swf$/i, "") + ".html";
        const htmlBlob = new Blob([htmlStr], { type: "text/html" });
        const htmlUrl = URL.createObjectURL(htmlBlob);
        const htmlLink = document.createElement("a");
        htmlLink.href = htmlUrl;
        htmlLink.download = htmlFilename;
        htmlLink.click();
        URL.revokeObjectURL(htmlUrl);
      }
    })();
  }, [publishToBytes, publishSettings, doc.properties]);

  const handleBandwidthProfiler = useCallback(() => {
    void (async () => {
      const bytes = await publishToBytes();
      const report = analyzeFrameSizes(bytes);
      setBandwidthProfilerReport(report);
      setBandwidthProfilerVisible(true);
    })();
  }, [publishToBytes]);

  // ---------------------------------------------------------------------------
  // Accessibility panel handlers
  // ---------------------------------------------------------------------------

  const handleDocAccessibilityChange = useCallback(
    (a: DocumentAccessibility) => {
      pushDoc({ ...doc, accessibility: a });
    },
    [doc, pushDoc]
  );

  const handleObjectAccessibilityChange = useCallback(
    (id: string, a: ObjectAccessibility) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, id, { accessibility: a })
      ));
    },
    [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  // ---------------------------------------------------------------------------
  // History panel — jump to a specific step
  // ---------------------------------------------------------------------------

  /**
   * Jump to an arbitrary step in the history list.
   * Index 0 = Initial State, index 1..past.length = past steps,
   * index past.length = current state (no-op).
   * Calls undo() or redo() as many times as needed.
   */
  const handleJumpToHistory = useCallback(
    (targetIndex: number) => {
      const currentIndex = historyPast.length;
      if (targetIndex === currentIndex) return; // already there
      if (targetIndex < currentIndex) {
        // Need to undo (currentIndex - targetIndex) times
        const steps = currentIndex - targetIndex;
        for (let i = 0; i < steps; i++) {
          undo();
        }
      } else {
        // Need to redo (targetIndex - currentIndex) times
        const steps = targetIndex - currentIndex;
        for (let i = 0; i < steps; i++) {
          redo();
        }
      }
    },
    [historyPast.length, undo, redo]
  );

  // ---------------------------------------------------------------------------
  // Commands menu — Save as Command, Run Command, Delete Command
  // ---------------------------------------------------------------------------

  /**
   * Save selected past steps (or all past steps) as a named command.
   * Called from HistoryPanel's "Save as Command..." button.
   * @param name - user-supplied name
   * @param stepIndices - 1-based past-step indices to save; empty = save all past steps
   */
  const handleSaveAsCommand = useCallback(
    (name: string, stepIndices: number[]) => {
      // Determine which snapshots to capture.
      // historyPast[i] is the doc that was present BEFORE step i+1 was applied,
      // so to replay step i+1 we push historyPast[i+1] (or doc for the current step).
      // For simplicity, we store the "result" snapshots that follow each selected step.
      // If stepIndices is empty we capture all past steps.
      const indicesToUse =
        stepIndices.length > 0 ? stepIndices : Array.from({ length: historyPast.length }, (_, i) => i + 1);

      const steps = indicesToUse.map((idx) => {
        // idx is 1-based; historyPast[idx-1] is the doc snapshot BEFORE that step.
        // The result of applying step idx is historyPast[idx] if it exists, else doc (current).
        return historyPast[idx] ?? doc;
      });

      setSavedCommands((prev) => saveCommand(name, steps, prev));
    },
    [historyPast, doc]
  );

  /**
   * Replay a saved command by pushing each stored doc snapshot onto the history stack.
   */
  const handleRunCommand = useCallback(
    (id: string) => {
      const cmd = savedCommands.find((c) => c.id === id);
      if (!cmd) return;
      for (const step of cmd.steps) {
        pushDoc(step);
      }
    },
    [savedCommands, pushDoc]
  );

  /**
   * Delete a saved command by id.
   */
  const handleDeleteCommand = useCallback(
    (id: string) => {
      setSavedCommands((prev) => deleteCommand(id, prev));
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Export Image / Export Movie
  // ---------------------------------------------------------------------------

  // Export + Test Movie handlers — see hooks/useExportHandlers.
  const {
    handleExportImage, handleExportMovie, handleExportGifConfirm,
    handleTestMovie, handlePlayerClose, handlePlayerError, handleTrace,
  } = useExportHandlers({ uiStore, doc, docProperties, timeline, currentFrame, testMovie });

  // Wire fl.outputPanel.clear() in the JSFL runtime to the React state setter.
  // setOutputMessages is a stable identity from useState so no deps are needed.
  useEffect(() => {
    registerClearOutputCallback(() => setOutputMessages([]));
    return () => registerClearOutputCallback(null);
  }, []);

  // Ref to playerOpen so keyboard handler can read latest value without being
  // re-registered on every open/close toggle.
  const playerOpenRef = useRef(playerOpen);
  useEffect(() => { playerOpenRef.current = playerOpen; }, [playerOpen]);

  // Global keyboard: Ctrl/Cmd+Enter → Test Movie; Shift+F9 → Color; F9 → Actions; Ctrl+J → Doc Props; Escape → exit edit-in-place
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Do not handle keyboard shortcuts when focus is inside an iframe (test-movie player)
      // or test-movie overlay, to avoid interfering with Ruffle's own keyboard handling.
      if (playerOpenRef.current) {
        // Allow Ctrl/Cmd+Enter to re-trigger test movie even while player is open,
        // but suppress all other shortcuts so Ruffle can handle keys freely.
        if (!(e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          return;
        }
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleTestMovie();
      }
      // Escape → exit edit-in-place (when not in a text input)
      if (e.key === "Escape" && editContext.mode === "symbol") {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          handleExitEditInPlace();
          return;
        }
      }
      // Ctrl/Cmd+J → Document Properties dialog
      if (e.key === "j" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setDocPropsOpen(true);
        return;
      }
      // Ctrl/Cmd+K → Align panel
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAlignPanelVisible((v) => !v);
        return;
      }
      // Ctrl/Cmd+B → Bandwidth Profiler
      if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleBandwidthProfiler();
        return;
      }
      // Ctrl/Cmd+Shift+S → Scene panel
      if (e.key === "s" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setScenePanelVisible((v) => !v);
        return;
      }
      // Ctrl+= or Ctrl++ → zoom in (×2, capped at 400%)
      if ((e.key === "=" || e.key === "+") && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        setZoom((z) => Math.min(4, z * 2));
        return;
      }
      // Ctrl+Shift+= (i.e. Ctrl++) on some keyboards
      if (e.key === "+" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setZoom((z) => Math.min(4, z * 2));
        return;
      }
      // Ctrl+- → zoom out (÷2, floored at 25%)
      if (e.key === "-" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom((z) => Math.max(0.25, z / 2));
        return;
      }
      // Ctrl+0 → reset zoom to 100%
      if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoom(1.0);
        return;
      }
      // Ctrl+Alt+R → toggle rulers
      if ((e.key === "r" || e.key === "R") && (e.ctrlKey || e.metaKey) && e.altKey) {
        e.preventDefault();
        handleRulersToggle();
        return;
      }
      // Ctrl+' → toggle grid visibility (without shift)
      if (e.key === "'" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        handleToggleShowGrid();
        return;
      }
      // Ctrl+Shift+' → toggle snap to grid
      if (e.key === "'" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        handleToggleSnapToGrid();
        return;
      }
      // Ctrl+Alt+G → Edit Grid dialog
      if ((e.key === "g" || e.key === "G") && (e.ctrlKey || e.metaKey) && e.altKey) {
        e.preventDefault();
        setEditGridOpen(true);
        return;
      }
      // Ctrl+Alt+M → Movie Explorer
      if ((e.key === "m" || e.key === "M") && (e.ctrlKey || e.metaKey) && e.altKey) {
        e.preventDefault();
        setMovieExplorerVisible((v) => !v);
        return;
      }
      // Ctrl+Shift+/ → toggle snap to objects
      if (e.key === "/" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        handleToggleSnapToObjects();
        return;
      }
      // Ctrl+Shift+\ → toggle snap to guides
      if (e.key === "\\" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        handleToggleSnapToGuides();
        return;
      }
      // Shift+F9 toggles the Color Mixer panel
      if (e.key === "F9" && e.shiftKey) {
        e.preventDefault();
        setColorMixerVisible((v) => !v);
        return;
      }
      // Ctrl+Shift+F12 → Publish Settings dialog
      if (e.key === "F12" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setPublishSettingsOpen(true);
        return;
      }
      // F9 toggles the Actions panel (skip if focused in a text input/textarea/contenteditable)
      if (e.key === "F9" && !e.shiftKey) {
        const tag = (e.target as HTMLElement).tagName;
        const isEditable =
          tag === "INPUT" || tag === "SELECT" ||
          (e.target as HTMLElement).isContentEditable;
        // Allow F9 inside the actions panel textarea to close it
        if (!isEditable || tag === "TEXTAREA") {
          e.preventDefault();
          handleBottomTabClick("actions");
        }
      }
      // F2 toggles the Output panel
      if (e.key === "F2") {
        e.preventDefault();
        handleBottomTabClick("output");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTestMovie, handleRulersToggle, handleToggleShowGrid, handleToggleSnapToGrid, handleToggleSnapToObjects, handleToggleSnapToGuides, editContext, handleExitEditInPlace, pushDoc, withProperties]);

  // ---------------------------------------------------------------------------
  // Automation bridge (DEV / VITE_FLASH_TEST=1 only)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaEnv = (import.meta as any).env as Record<string, unknown> | undefined;
    const isTestEnv = metaEnv?.["DEV"] === true || metaEnv?.["VITE_FLASH_TEST"] === "1";
    if (!isTestEnv) return;

    const bridge = {
      getDocument: () => doc,
      getSelection: () => selectedShapeIds,
      getCurrentFrame: () => currentFrame,
      getActiveLayerIndex: () => activeLayerIndex,
      getHistoryDepth: () => documentStore.getState().history.past.length,
      getActiveTool: () => toolState.activeTool,

      selectTool: (tool: string) => handleToolChange(tool as ToolId),
      setCurrentFrame: (frame: number) => setCurrentFrame(frame),
      setActiveLayer: (i: number) => setActiveLayerIndex(i),
      triggerUndo: () => undo(),
      triggerRedo: () => redo(),
      togglePlay: () => handlePlayToggle(),

      runJSFL: (source: string) => {
        const sceneIndex = Math.min(activeSceneIndex, doc.scenes.length - 1);
        const context = buildJsflContext(doc, sceneIndex, currentFrame);
        const result = runJsfl(source, context);
        if (result.finalDocument) {
          pushDoc(result.finalDocument);
        }
        // Forward fl.trace() output to the Output Panel.
        if (result.traces.length > 0) {
          setOutputMessages((prev) => [...prev, ...result.traces]);
          setBottomTab("output");
        }
        return result;
      },

      // Serialize the current document to FLA bytes, return as base64
      saveFlaBytes: (): string => {
        const bytes = saveFla(doc);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      },

      // Deserialize FLA bytes (base64) and load the resulting document into the editor
      loadFlaBytes: (base64: string): void => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const restored = loadFla(bytes);
        pushDoc(restored);
      },

      // Load a fixture/test document into the editor
      loadDocument: (newDoc: unknown) => {
        pushDoc(newDoc as typeof doc);
      },

      // Export the current document as SWF and return it as a base64 string
      publish: async () => {
        const bytes = await publishToBytes();
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
      },

      // Render the current stage to a 1:1 off-screen canvas and return a PNG
      // data URL (without the "data:image/png;base64," prefix) for pixel-exact
      // comparison in visual oracle tests.  Always renders at DPR=1 so the
      // output dimensions equal the stage dimensions in CSS pixels.
      // If frameIndex is provided, renders that frame instead of the current one.
      screenshotStage: (frameIndex?: number): string => {
        const w = docProperties.width;
        const h = docProperties.height;
        // Build a frame-specific scene graph when a frameIndex is requested;
        // fall back to fullSceneGraph (current frame) when none is given.
        const sceneGraph: SceneGraph =
          frameIndex !== undefined
            ? {
                layers: timeline.layers.map((layer) => {
                  const frame = getTweenedFrame(layer, frameIndex);
                  const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
                  return {
                    id: layer.id,
                    name: layer.name,
                    visible: layer.visible,
                    locked: layer.locked,
                    outlineMode: layer.outlineMode,
                    outlineColor: layer.outlineColor,
                    objects,
                  };
                }),
              }
            : fullSceneGraph;
        // Render onto a transparent offscreen canvas at DPR=1.
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const renderer = new CanvasRenderer(offscreen);
        renderer.resize(w, h, 1);
        renderer.render(sceneGraph, { x: 0, y: 0, zoom: 1 }, doc.library);
        // Composite onto a background-filled canvas so transparent pixels match
        // Ruffle's SetBackgroundColor rendering.  pixelmatch blends transparent
        // against white, so without this every background pixel mismatches when
        // the document background is not white.
        const composite = document.createElement("canvas");
        composite.width = w;
        composite.height = h;
        const ctx = composite.getContext("2d")!;
        ctx.fillStyle = docProperties.backgroundColor;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(offscreen, 0, 0);
        return composite.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
      },
    };

    (window as unknown as Record<string, unknown>).__flashTest = bridge;
    return () => {
      delete (window as unknown as Record<string, unknown>).__flashTest;
    };
  }, [
    doc,
    selectedShapeIds,
    currentFrame,
    activeLayerIndex,
    activeSceneIndex,
    undoDepth,
    toolState.activeTool,
    handleToolChange,
    undo,
    redo,
    handlePlayToggle,
    pushDoc,
    publishToBytes,
    fullSceneGraph,
    docProperties,
    timeline,
  ]);

  // ---------------------------------------------------------------------------
  // Agent MCP bridge (DEV / VITE_FLASH_TEST=1 only)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaEnv = (import.meta as any).env as Record<string, unknown> | undefined;
    const isTestEnv = metaEnv?.["DEV"] === true || metaEnv?.["VITE_FLASH_TEST"] === "1";
    if (!isTestEnv) return;

    setAgentCallbacks({
      // Readers
      // Read the live document straight from the store so agent commands issued
      // immediately after pushDoc() see the update before React re-renders.
      getDoc: () => documentStore.getState().history.present,
      getSelectedIds: () => selectedShapeIds,
      getCurrentFrame: () => currentFrame,
      getActiveLayerIndex: () => activeLayerIndex,
      getActiveTool: () => toolState.activeTool,
      getEditContext: () => editContext,
      getActiveSceneIndex: () => activeSceneIndex,
      getUndoDepth: () => documentStore.getState().history.past.length,
      getRedoDepth: () => documentStore.getState().history.future.length,

      // Mutators
      pushDoc,
      undo,
      redo,

      // View / selection setters
      setCurrentFrame,
      setActiveLayerByIndex: (index: number) => setActiveLayerIndex(index),
      setActiveLayerById: (layerId: string) => {
        const idx = timeline.layers.findIndex((l) => l.id === layerId);
        if (idx >= 0) setActiveLayerIndex(idx);
      },
      setSelectedIds: (ids: string[]) => {
        setSelectedShapeIds(ids);
      },
      setZoom: handleZoomChangeDirect,
      setPan: handlePanChange,
      selectTool: (toolId: string) => handleToolChange(toolId as import("./tools/types.js").ToolId),
      startPlayback,
      stopPlayback,
      setActiveSceneIndex,

      // Escape hatches
      runJSFL: (source: string) => {
        const sceneIndex = Math.min(activeSceneIndex, doc.scenes.length - 1);
        const context = (buildJsflContext as (doc: import("@flash/core").FlashDocument, sceneIndex: number, frameIndex: number) => unknown)(doc, sceneIndex, currentFrame);
        const result = (runJsfl as (source: string, context: unknown) => { traces: string[]; returnValue?: unknown; error?: string; finalDocument?: import("@flash/core").FlashDocument })(source, context);
        if (result.finalDocument) {
          pushDoc(result.finalDocument);
        }
        // Forward fl.trace() output to the Output Panel.
        if (result.traces.length > 0) {
          setOutputMessages((prev) => [...prev, ...result.traces]);
          setBottomTab("output");
        }
        return {
          traces: result.traces,
          returnValue: result.returnValue,
          error: result.error,
          rev: 0 as import("@flash/agent-protocol").Rev,
        };
      },
      screenshotStage: (frameIndex?: number): string => {
        const w = docProperties.width;
        const h = docProperties.height;
        // Build a frame-specific scene graph when a frameIndex is requested;
        // fall back to fullSceneGraph (current frame) when none is given.
        const sceneGraph: SceneGraph =
          frameIndex !== undefined
            ? {
                layers: timeline.layers.map((layer) => {
                  const frame = getTweenedFrame(layer, frameIndex);
                  const objects: DisplayObject[] = frame ? [...frame.displayObjects] : [];
                  return {
                    id: layer.id,
                    name: layer.name,
                    visible: layer.visible,
                    locked: layer.locked,
                    outlineMode: layer.outlineMode,
                    outlineColor: layer.outlineColor,
                    objects,
                  };
                }),
              }
            : fullSceneGraph;
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const renderer = new CanvasRenderer(offscreen);
        renderer.resize(w, h, 1);
        renderer.render(sceneGraph, { x: 0, y: 0, zoom: 1 }, doc.library);
        const composite = document.createElement("canvas");
        composite.width = w;
        composite.height = h;
        const ctx = composite.getContext("2d")!;
        ctx.fillStyle = docProperties.backgroundColor;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(offscreen, 0, 0);
        return composite.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
      },
      publishToBytes,
    });

    return () => {
      clearAgentCallbacks();
    };
  }, [
    doc,
    selectedShapeIds,
    currentFrame,
    activeLayerIndex,
    toolState.activeTool,
    editContext,
    activeSceneIndex,
    undoDepth,
    redoDepth,
    pushDoc,
    undo,
    redo,
    setCurrentFrame,
    timeline,
    handleZoomChangeDirect,
    handlePanChange,
    handleToolChange,
    startPlayback,
    stopPlayback,
    setActiveSceneIndex,
    buildJsflContext,
    runJsfl,
    publishToBytes,
    fullSceneGraph,
    docProperties,
  ]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaEnv = (import.meta as any).env as Record<string, unknown> | undefined;
    const isTestEnv = metaEnv?.["DEV"] === true || metaEnv?.["VITE_FLASH_TEST"] === "1";
    if (!isTestEnv) return;

    startAgentBridge();
    return () => {
      stopAgentBridge();
    };
    // Only run once on mount — the bridge reconnects internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Tab button styles
  // ---------------------------------------------------------------------------

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    fontSize: "10px",
    fontWeight: active ? "bold" : "normal",
    background: active ? "#2d2d2d" : "#333",
    color: active ? "#e0e0e0" : "#999",
    border: "none",
    borderBottom: active ? "2px solid #1a6ea8" : "2px solid transparent",
    cursor: "pointer",
    padding: "0 4px",
    userSelect: "none",
  });

  // Tab button for the collapsible bottom dock (Timeline | Actions | Sound | Properties)
  const bottomTabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: "0 0 auto",
    minWidth: 72,
    fontSize: 11,
    fontWeight: active ? "bold" : "normal",
    background: active ? "#1e1e1e" : "#2d2d2d",
    color: active ? "#e0e0e0" : "#999",
    border: "none",
    borderRight: "1px solid #1a1a1a",
    borderTop: active ? "2px solid #1a6ea8" : "2px solid transparent",
    cursor: "pointer",
    padding: "0 12px",
    userSelect: "none",
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <StoreProvider initialDoc={_initialDoc} stores={stores}>
    <div
      style={{
        ...styles.shell,
        ...(isDragOver ? { outline: "2px dashed #0078d7", outlineOffset: "-2px" } : {}),
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => { void handleDrop(e); }}
    >
      {isDragOver && (
        <div style={styles.dropOverlay}>
          Drop .fla file to open
        </div>
      )}
      <MenuBar
        document={doc}
        filePath={filePath}
        onDocumentChange={handleDocumentChange}
        onFilePathChange={handleFilePathChange}
        onTestMovie={handleTestMovie}
        onPublish={handlePublish}
        onPublishSettings={() => setPublishSettingsOpen(true)}
        onColorPanelToggle={() => setColorPanelVisible((v) => !v)}
        onActionsToggle={() => handleBottomTabClick("actions")}
        onOutputToggle={() => handleBottomTabClick("output")}
        onFiltersPanelToggle={() => setFiltersPanelVisible((v) => !v)}
        onDocPropsOpen={() => setDocPropsOpen(true)}
        onPreferences={() => setPreferencesOpen(true)}
        onRulersToggle={handleRulersToggle}
        showRulers={showRulers}
        onToggleShowGrid={handleToggleShowGrid}
        showGrid={showGrid}
        onEditGrid={() => setEditGridOpen(true)}
        onToggleSnapToGrid={handleToggleSnapToGrid}
        snapToGrid={docProperties.grid.snapToGrid}
        onToggleSnapToObjects={handleToggleSnapToObjects}
        snapToObjects={docProperties.snapToObjects}
        onToggleSnapToGuides={handleToggleSnapToGuides}
        snapToGuides={docProperties.snapToGuides}
        onImportToLibrary={() => { void handleImportToLibrary(); }}
        onImportToStage={() => { void handleImportToStage(); }}
        onImportSound={() => { void handleImportSound(); }}
        onImportVideo={() => { void handleImportVideo(); }}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        snapToPixels={snapToPixels}
        onToggleSnapToPixels={handleToggleSnapToPixels}
        onExportImage={handleExportImage}
        onExportMovie={handleExportMovie}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onConvertToSymbol={handleConvertToSymbol}
        onTimelineEffectTransform={() => handleOpenTimelineEffect("transform")}
        onTimelineEffectTransition={() => handleOpenTimelineEffect("transition")}
        onTimelineEffectBlur={() => handleOpenTimelineEffect("blur")}
        onTimelineEffectDropShadow={() => handleOpenTimelineEffect("drop-shadow")}
        onTimelineEffectExpand={() => handleOpenTimelineEffect("expand")}
        onTimelineEffectExplode={() => handleOpenTimelineEffect("explode")}
        onTimelineEffectCopyToGrid={() => handleOpenTimelineEffect("copy-to-grid")}
        onTimelineEffectDistributedDuplicate={() => handleOpenTimelineEffect("distributed-duplicate")}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={() => handlePaste(false)}
        onPasteInPlace={handlePasteInPlace}
        onDuplicate={handleDuplicate}
        onCopyMotion={handleCopyMotion}
        onPasteMotion={handlePasteMotion}
        hasMotionClipboard={hasMotionClipboard}
        onArrange={handleArrange}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        onBreakApart={handleBreakApart}
        onTraceBitmap={selectedDisplayObject?.type === "bitmap" ? handleTraceBitmapOpen : undefined}
        onSmooth={handleSmooth}
        onOptimize={handleOptimize}
        onAddShapeHint={handleAddShapeHint}
        onFlipHorizontal={handleFlipHorizontal}
        onFlipVertical={handleFlipVertical}
        onRotate90CW={handleRotate90CW}
        onRotate90CCW={handleRotate90CCW}
        onRotate180={handleRotate180}
        onSwapSymbol={handleSwapSymbol}
        onDistributeToLayers={handleDistributeToLayers}
        onReverseFrames={handleReverseFrames}
        onAlignPanelToggle={() => setAlignPanelVisible((v) => !v)}
        alignPanelVisible={alignPanelVisible}
        onScenePanelToggle={() => setScenePanelVisible((v) => !v)}
        scenePanelVisible={scenePanelVisible}
        onColorMixerToggle={() => setColorMixerVisible((v) => !v)}
        colorMixerVisible={colorMixerVisible}
        onSwatchesPanelToggle={() => setSwatchesPanelVisible((v) => !v)}
        swatchesPanelVisible={swatchesPanelVisible}
        onBehaviorsPanelToggle={() => setBehaviorsPanelVisible((v) => !v)}
        behaviorsPanelVisible={behaviorsPanelVisible}
        onMovieExplorerToggle={() => setMovieExplorerVisible((v) => !v)}
        movieExplorerVisible={movieExplorerVisible}
        onHistoryPanelToggle={() => setHistoryPanelVisible((v) => !v)}
        historyPanelVisible={historyPanelVisible}
        onAccessibilityPanelToggle={() => setAccessibilityPanelVisible((v) => !v)}
        accessibilityPanelVisible={accessibilityPanelVisible}
        onBandwidthProfiler={handleBandwidthProfiler}
        onTextBold={handleTextBold}
        onTextItalic={handleTextItalic}
        onTextUnderline={handleTextUnderline}
        onTextAlignLeft={handleTextAlignLeft}
        onTextAlignCenter={handleTextAlignCenter}
        onTextAlignRight={handleTextAlignRight}
        onTextAlignJustify={handleTextAlignJustify}
        onTextTrackingIncrease={handleTextTrackingIncrease}
        onTextTrackingDecrease={handleTextTrackingDecrease}
        onTextTrackingReset={handleTextTrackingReset}
        onTextScrollable={handleTextScrollable}
        onFindReplace={() => setFindReplaceVisible((v) => !v)}
        savedCommands={savedCommands}
        onSaveAsCommand={() => {
          // Open the History panel so the user can select steps + click "Save as Command…"
          setHistoryPanelVisible(true);
        }}
        onManageCommands={() => setManageCommandsOpen(true)}
        onRunCommand={handleRunCommand}
        onToggleSimpleButtons={handleToggleSimpleButtons}
        simpleButtonsEnabled={simpleButtonsEnabled}
      />
      <EditBar
        documentName="Untitled-1"
        sceneName={doc.scenes[Math.min(activeSceneIndex, doc.scenes.length - 1)]?.name ?? "Scene 1"}
        symbolName={editContext.mode === "symbol" ? editContext.symbolName : undefined}
        onExitSymbol={editContext.mode === "symbol" ? handleExitEditInPlace : undefined}
        showTextControls={toolState.activeTool === "text" || editingTextId !== null}
        textFont={textFormat.fontFamily}
        textSize={textFormat.fontSize}
        textBold={textFormat.bold}
        textItalic={textFormat.italic}
        textAlign={textFormat.align}
        textColor={textFormat.color}
        onTextFormatChange={handleTextFormatChange}
      />
      <div style={styles.centerRegion}>
        <div style={{ width: 44, minWidth: 44, flexShrink: 0, overflow: "hidden" }}>
          <ToolsPanel
            toolState={toolState}
            onToolChange={handleToolChange}
            onStrokeColorChange={handleStrokeColorChange}
            onFillColorChange={handleFillColorChange}
            onObjectDrawingToggle={handleObjectDrawingToggle}
            onPencilModeChange={handlePencilModeChange}
            onBrushSizeChange={handleBrushSizeChange}
            onEraserSizeChange={handleEraserSizeChange}
            onFreeTransformModeChange={handleFreeTransformModeChange}
            onLassoPolygonModeChange={handleLassoPolygonModeChange}
            onLassoMagicWandChange={handleLassoMagicWandChange}
            onMagicWandThresholdChange={handleMagicWandThresholdChange}
            onMagicWandSmoothingChange={handleMagicWandSmoothingChange}
            onPolyStarOptionsChange={handlePolyStarOptionsChange}
          />
        </div>
        <div style={styles.mainColumn}>
          {/* Top dock: Timeline (resizable + collapsible) */}
          <div
            style={{
              ...styles.bottomPanel,
              height: timelineCollapsed ? "auto" : timelineResize.size,
            }}
            data-testid="timeline-panel"
          >
            <div style={{ ...styles.bottomTabs, borderTop: "none" }} role="tablist">
              <button
                role="tab"
                aria-selected={!timelineCollapsed}
                style={bottomTabBtnStyle(!timelineCollapsed)}
                onClick={() => setTimelineCollapsed((v) => !v)}
                title={timelineCollapsed ? "Expand Timeline" : "Collapse Timeline"}
              >
                Timeline
              </button>
              <div style={{ flex: 1 }} />
              <button
                style={{ ...bottomTabBtnStyle(false), flex: "0 0 auto", width: 28, fontSize: 12 }}
                onClick={() => setTimelineCollapsed((v) => !v)}
                title={timelineCollapsed ? "Expand Timeline" : "Collapse Timeline"}
              >
                {timelineCollapsed ? "▾" : "▴"}
              </button>
            </div>
            {!timelineCollapsed && (
              <div style={styles.bottomContent}>
                <Timeline
                  timeline={timeline}
                  currentFrame={currentFrame}
                  isPlaying={isPlaying}
                  frameRate={docProperties.frameRate}
                  uiScale={preferences.uiScale}
                  activeLayerIndex={safeActiveLayerIndex}
                  onActiveLayerChange={setActiveLayerIndex}
                  onTimelineChange={handleTimelineChange}
                  onFrameChange={handleFrameChange}
                  onPlayingChange={handlePlayingChange}
                  onionSkinEnabled={onionSkinEnabled}
                  onionSkinOutlines={onionSkinOutlines}
                  onionBefore={onionBefore}
                  onionAfter={onionAfter}
                  onToggleOnionSkin={handleToggleOnionSkin}
                  onToggleOnionSkinOutlines={handleToggleOnionSkinOutlines}
                  onOnionRangeChange={handleOnionRangeChange}
                  editMultipleFrames={editMultipleFrames}
                  onToggleEditMultipleFrames={handleToggleEditMultipleFrames}
                  onCopyFrames={handleCopyFrames}
                  onCutFrames={handleCutFrames}
                  onPasteFrames={handlePasteFrames}
                  hasFrameClipboard={hasFrameClipboard}
                  onRemoveFrames={handleRemoveFrames}
                  symbolType={editContext.symbolType}
                  onFrameDoubleClick={handleFrameDoubleClick}
                  onSelectedFrameRangeChange={setSelectedFrameRange}
                />
              </div>
            )}
          </div>
          {/* Resize handle between the Timeline dock and the stage */}
          {!timelineCollapsed && (
            <div
              style={styles.hResizeHandle}
              onMouseDown={timelineResize.onMouseDown}
              title="Drag to resize"
              data-testid="timeline-resize-handle"
            />
          )}
          <div style={styles.stageAndTimeline}>
            {/* Stage area with optional rulers overlay */}
            <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
              <StageArea
                stageWidth={docProperties.width}
                stageHeight={docProperties.height}
                backgroundColor={docProperties.backgroundColor}
                zoom={zoom}
                panX={panX}
                panY={panY}
                showGrid={showGrid}
                gridWidth={gridWidth}
                gridHeight={gridHeight}
                gridColor={gridColor}
                snapToPixels={snapToPixels}
                viewMode={viewMode}
                activeTool={toolState.activeTool}
                instances={instances}
                instanceNames={instanceNames}
                selectedInstanceId={selectedInstanceId}
                onZoomChange={handleZoomChangeDirect}
                onPanChange={handlePanChange}
                onCursorMove={handleCursorMove}
                onDrop={handleStageDrop}
                onInstanceSelect={handleInstanceSelect}
                currentFrame={currentFrame}
                shapeDisplayObjects={shapeDisplayObjects}
                onShapeCreated={handleShapeCreated}
                selectedShapeId={selectedShapeId}
                selectedShapeIds={selectedShapeIds}
                onShapeSelect={handleShapeSelectFromStage}
                onShapeSelectMultiple={handleShapeSelectMultiple}
                onShapeMove={handleShapeMove}
                onShapeMoveEnd={handleShapeMoveEnd}
                onShapeDelete={handleShapeDelete}
                onDeleteSelected={handleDeleteSelected}
                onShapeResize={handleShapeResize}
                onShapeRotate={handleShapeRotate}
                onShapeUpdate={handleShapeUpdate}
                onShapeGradientUpdate={handleShapeUpdate}
                guides={guides}
                showGuides={true}
                snapToGuides={docProperties.snapToGuides}
                snapToGrid={docProperties.grid.snapToGrid}
                snapToObjects={docProperties.snapToObjects}
                onGuideMove={handleGuideMove}
                onGuideDelete={handleGuideDelete}
                textDisplayObjects={textDisplayObjects}
                onTextCreated={handleTextCreated}
                onTextPlace={handleTextPlace}
                editingTextId={editingTextId}
                onTextEdit={handleTextEdit}
                onTextEditEnd={handleTextEditEnd}
                textFormat={textFormat}
                bitmapDisplayObjects={bitmapDisplayObjects}
                bitmapLibraryItems={bitmapLibraryItems}
                onRendererReady={(r) => { rendererRef.current = r; }}
                pencilMode={toolState.pencilMode}
                brushSize={toolState.brushSize}
                eraserSize={toolState.eraserSize}
                strokeColor={toolState.strokeColor}
                strokeWidth={toolState.strokeWidth}
                strokeAlpha={toolState.strokeAlpha}
                fill={toolState.fill}
                onEyedropperSample={handleEyedropperSample}
                freeTransformMode={toolState.freeTransformMode}
                lassoPolygonMode={toolState.lassoPolygonMode}
                lassoMagicWand={toolState.lassoMagicWand}
                magicWandThreshold={toolState.magicWandThreshold}
                magicWandSmoothing={toolState.magicWandSmoothing}
                polyStarOptions={toolState.polyStarOptions}
                sceneGraph={fullSceneGraph}
                library={library}
                onConvertToSymbol={handleConvertToSymbol}
                onInstanceDoubleClick={handleInstanceDoubleClick}
                symbolInstanceDisplayObjects={symbolInstanceDisplayObjects}
                onSymbolInstanceDoubleClick={handleSymbolInstanceDoubleClick}
                parentSceneGraph={parentSceneGraph}
                onExitSymbolEdit={editContext.mode === "symbol" ? handleExitEditInPlace : undefined}
                onCopy={handleCopy}
                onCut={handleCut}
                onPaste={() => handlePaste(false)}
                onPasteInPlace={handlePasteInPlace}
                onDuplicate={handleDuplicate}
                onArrange={handleArrange}
                onGroup={handleGroup}
                onUngroup={handleUngroup}
                onBreakApart={handleBreakApart}
                onPlayToggle={handlePlayToggle}
                onionFrames={onionFrames}
                editMultipleFrames={editMultipleFrames}
                onEditMultipleFrameClick={handleEditMultipleFrameClick}
                timeline={timeline}
                simpleButtonsEnabled={simpleButtonsEnabled}
                stageOverlay={
                  <>
                    {(toolState.activeTool === "free-transform" || toolState.activeTool === "selection") &&
                    selectedBounds &&
                    selectedShapeId && (
                      <TransformHandles
                        bounds={selectedBounds}
                        zoom={zoom}
                        onScale={handleFreeTransformScale}
                        onRotate={handleFreeTransformRotate}
                        onMove={handleFreeTransformMove}
                      />
                    )}
                    {activeShapeHints.length > 0 && (
                      <ShapeHintOverlay
                        hints={activeShapeHints}
                        isEndKeyframe={
                          currentGoverningFrame?.tweenType !== "shape" &&
                          (() => {
                            const layer = timeline.layers[safeActiveLayerIndex];
                            if (!layer) return false;
                            const prevKf = [...layer.frames]
                              .filter((f) => f.isKeyframe && f.index < currentFrame)
                              .sort((a, b) => b.index - a.index)[0];
                            return !!(prevKf && prevKf.tweenType === "shape");
                          })()
                        }
                        onHintMove={handleUpdateShapeHint}
                      />
                    )}
                  </>
                }
              />
              <Rulers
                stageWidth={docProperties.width}
                stageHeight={docProperties.height}
                zoom={zoom}
                panX={panX}
                panY={panY}
                visible={showRulers}
                guides={guides}
                rulerUnits={docProperties.rulerUnits}
                onGuideCreate={handleGuideCreate}
              />
            </div>
            {/* Zoom control strip — Flash 8 style, sits between stage and timeline */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                background: "#2a2a2a",
                borderTop: "1px solid #444",
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              {/* Scenes toggle button */}
              <button
                onClick={() => setShowScenes((v) => !v)}
                title="Show/hide Scenes panel"
                style={{
                  background: showScenes ? "#1a6ea8" : "#3a3a3a",
                  color: showScenes ? "#fff" : "#ccc",
                  border: "1px solid #555",
                  borderRadius: 2,
                  cursor: "pointer",
                  fontSize: 10,
                  lineHeight: 1,
                  padding: "1px 6px",
                  fontWeight: showScenes ? "bold" : "normal",
                  marginRight: 4,
                }}
              >
                Scenes
              </button>
              <button
                onClick={() => setZoom((z) => Math.max(0.25, z / 2))}
                title="Zoom Out (Ctrl+-)"
                style={{
                  background: "#3a3a3a",
                  color: "#ccc",
                  border: "1px solid #555",
                  borderRadius: 2,
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1,
                  padding: "1px 5px",
                  fontWeight: "bold",
                }}
              >
                −
              </button>
              <select
                value={[25, 50, 75, 100, 150, 200, 400].includes(Math.round(zoom * 100)) ? Math.round(zoom * 100) : "custom"}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!isNaN(val) && val > 0) setZoom(val / 100);
                }}
                title="Zoom level (Ctrl+0 to reset)"
                style={{
                  background: "#333",
                  color: "#ddd",
                  border: "1px solid #555",
                  borderRadius: 2,
                  fontSize: 11,
                  padding: "1px 4px",
                  cursor: "pointer",
                }}
              >
                {[25, 50, 75, 100, 150, 200, 400].map((z) => (
                  <option key={z} value={z}>{z}%</option>
                ))}
                {![25, 50, 75, 100, 150, 200, 400].includes(Math.round(zoom * 100)) && (
                  <option value="custom" disabled>{Math.round(zoom * 100)}%</option>
                )}
              </select>
              <button
                onClick={() => setZoom((z) => Math.min(4, z * 2))}
                title="Zoom In (Ctrl+=)"
                style={{
                  background: "#3a3a3a",
                  color: "#ccc",
                  border: "1px solid #555",
                  borderRadius: 2,
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1,
                  padding: "1px 5px",
                  fontWeight: "bold",
                }}
              >
                +
              </button>
            </div>
            {/* Inline Scene Switcher panel — shown when Scenes toggle is active */}
            {showScenes && (
              <SceneSwitcher
                doc={doc}
                currentSceneIdx={Math.min(activeSceneIndex, doc.scenes.length - 1)}
                onDocChange={pushDoc}
                onSceneChange={handleSelectScene}
              />
            )}
          </div>

          {/* Horizontal resize handle between stage and the bottom dock.
              Only draggable while the dock is expanded. */}
          {bottomTab !== null && (
            <div
              style={styles.hResizeHandle}
              onMouseDown={bottomResize.onMouseDown}
              title="Drag to resize"
              data-testid="bottom-resize-handle"
            />
          )}

          {/* Bottom dock: tabbed (Timeline | Actions | Sound | Properties), collapsible */}
          <div
            style={{
              ...styles.bottomPanel,
              height: bottomTab === null ? "auto" : bottomResize.size,
            }}
            data-testid="bottom-panel"
          >
            <div style={styles.bottomTabs} role="tablist">
              {BOTTOM_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={bottomTab === id}
                  style={bottomTabBtnStyle(bottomTab === id)}
                  onClick={() => handleBottomTabClick(id)}
                  title={bottomTab === id ? `Collapse ${label}` : label}
                >
                  {label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button
                style={{
                  ...bottomTabBtnStyle(false),
                  flex: "0 0 auto",
                  width: 28,
                  fontSize: 12,
                }}
                onClick={() =>
                  setBottomTab((prev) => (prev === null ? lastBottomTabRef.current : null))
                }
                title={bottomTab === null ? "Expand panel" : "Collapse panel"}
              >
                {bottomTab === null ? "▴" : "▾"}
              </button>
            </div>

            {bottomTab !== null && (
              <div style={styles.bottomContent}>
                {bottomTab === "actions" && (
                  <ActionsPanel
                    embedded
                    script={currentScript}
                    frameIndex={currentFrame}
                    layerName={timeline.layers[safeActiveLayerIndex]?.name ?? ""}
                    onScriptChange={handleScriptChange}
                    isVisible={true}
                    onClose={() => setBottomTab(null)}
                    selectedInstance={selectedMovieClipInstance}
                    onClipActionsChange={handleClipActionsChange}
                    selectedButtonSymbol={selectedButtonSymbol}
                    onButtonActionsChange={handleButtonActionsChange}
                    selectedButtonInstance={selectedButtonInstance}
                    onButtonHandlersChange={handleButtonHandlersChange}
                  />
                )}
                {bottomTab === "sound" && (
                  <SoundPanel
                    frame={selectedKeyframeFrame}
                    frameIndex={selectedKeyframeFrame?.index ?? currentFrame}
                    layerIndex={selectedLayerIndex}
                    sounds={soundLibraryItems}
                    onSoundChange={handleSoundChange}
                    onPreviewSound={previewSound}
                    onEditEnvelope={handleEditEnvelope}
                  />
                )}
                {bottomTab === "properties" && (
                  <PropertiesPanel
                    doc={doc}
                    selectedObjects={selectedObjects}
                    onUpdateDocProperties={handleUpdateDocProperties}
                    onUpdateObject={handleUpdateObject}
                    currentFrame={currentGoverningFrame}
                    currentLayerIndex={safeActiveLayerIndex}
                    currentFrameIndex={currentFrame}
                    onFrameUpdate={handleFrameUpdate}
                    onSwapBitmap={handleSwapBitmap}
                    sounds={soundLibraryItems}
                    onSoundChange={handleSoundChange}
                  />
                )}
                {bottomTab === "output" && (
                  <OutputPanel
                    messages={outputMessages}
                    onClear={() => setOutputMessages([])}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Vertical resize handle between the main column and the right panel */}
        <div
          style={styles.vResizeHandle}
          onMouseDown={rightResize.onMouseDown}
          title="Drag to resize"
          data-testid="right-resize-handle"
        />

        {/* Right panel: Library + Properties tabs */}
        <div style={{ ...styles.rightPanel, width: rightResize.size }}>
          <div style={styles.rightPanelTabs}>
            <button
              style={tabBtnStyle(rightTab === "library")}
              onClick={() => setRightTab("library")}
            >
              Library
            </button>
            <button
              style={tabBtnStyle(rightTab === "properties")}
              onClick={() => setRightTab("properties")}
            >
              Properties
            </button>
            {editContext.mode === "symbol" && (
              <button
                style={{
                  fontSize: "10px",
                  background: "transparent",
                  color: "#e05050",
                  border: "none",
                  cursor: "pointer",
                  padding: "0 4px",
                }}
                title="Exit Edit-in-Place"
                onClick={handleExitEditInPlace}
              >
                ✕
              </button>
            )}
          </div>

          {rightTab === "library" ? (
            <LibraryPanel
              library={library}
              doc={doc}
              documentName="Untitled-1"
              selectedItemId={selectedLibraryItemId}
              onItemSelect={setSelectedLibraryItemId}
              onCreateSymbol={handleCreateSymbol}
              onDeleteItem={handleDeleteLibraryItem}
              onEditInPlace={handleEditInPlace}
              onRenameItem={handleRenameLibraryItem}
              onDuplicateItem={handleDuplicateLibraryItem}
              onAddFolder={handleAddFolder}
              onMoveItemToFolder={handleMoveItemToFolder}
              onUpdateFolder={handleUpdateFolder}
              onSetLinkage={handleSetLinkage}
              onSetSymbolProperties={handleSetSymbolProperties}
              onBitmapDoubleClick={setBitmapPropsItem}
            />
          ) : (
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <PanelGroup title="Transform">
                <TransformPanel
                  selectedObject={selectedDisplayObject}
                  onTransform={handleTransformObject}
                />
              </PanelGroup>
              {selectedDisplayObject?.type === "instance" && (() => {
                const inst = selectedDisplayObject as SymbolInstance;
                const libItem = doc.library.items.find(
                  (i) => i.id === inst.symbolId && i.itemType === "symbol"
                );
                const symbolType = (libItem && libItem.itemType === "symbol")
                  ? libItem.symbolType
                  : "movieclip";
                return (
                  <PanelGroup title="Instance">
                    <InstancePanel
                      instance={inst}
                      symbolType={symbolType}
                      onChange={(updates) => handleUpdateInstance(inst.id, updates)}
                    />
                  </PanelGroup>
                );
              })()}
              <PanelGroup title="Align" defaultCollapsed>
                <AlignPanel
                  visible={true}
                  embedded={true}
                  displayObjects={activeKeyframeObjects}
                  selectedIds={selectedShapeIds}
                  stageWidth={docProperties.width}
                  stageHeight={docProperties.height}
                  onAlign={handleAlignObjects}
                  onMatchSize={handleMatchSizeObjects}
                  onClose={() => {}}
                />
              </PanelGroup>
              <PanelGroup title="Info">
                <div
                  style={{
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 11,
                    color: "#ccc",
                  }}
                >
                  {selectedDisplayObject ? (
                    <>
                      <div style={{ display: "flex", gap: 8 }}>
                        <span style={{ color: "#999", width: 16 }}>X:</span>
                        <span>{Math.round(selectedDisplayObject.x)}</span>
                        <span style={{ color: "#999", width: 16, marginLeft: 8 }}>Y:</span>
                        <span>{Math.round(selectedDisplayObject.y)}</span>
                      </div>
                      {(() => {
                        const size = getDisplayObjectPixelSize(selectedDisplayObject, library);
                        return (
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ color: "#999", width: 16 }}>W:</span>
                            <span>{size ? size.w : "—"}</span>
                            <span style={{ color: "#999", width: 16, marginLeft: 8 }}>H:</span>
                            <span>{size ? size.h : "—"}</span>
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <span style={{ color: "#666" }}>No selection</span>
                  )}
                </div>
              </PanelGroup>
            </div>
          )}
        </div>
      </div>
      <StatusBar
        zoom={Math.round(zoom * 100)}
        frameRate={docProperties.frameRate}
        currentFrame={currentFrame + 1}
        onZoomChange={handleZoomChange}
        cursorX={cursorPos?.x ?? null}
        cursorY={cursorPos?.y ?? null}
      />

      {/* Floating Window-menu panels (visibility + color/swatch state in uiStore) */}
      <ShellPanels
        doc={doc}
        docProperties={docProperties}
        selectedShapeFilters={selectedShapeFilters}
        activeKeyframeObjects={activeKeyframeObjects}
        currentScript={currentScript}
        currentKeyframe={currentKeyframe}
        bitmapLibraryItems={bitmapLibraryItems}
        onFillChange={handleFillChange}
        onStrokeChange={handleStrokeChangeFromPanel}
        onFiltersChange={handleFiltersChange}
        onAlign={handleAlignObjects}
        onMatchSize={handleMatchSizeObjects}
        onMixerFillColorChange={handleMixerFillColorChange}
        onMixerStrokeColorChange={handleMixerStrokeColorChange}
        onSelectSwatch={handleSelectSwatch}
        onAddSwatch={handleAddSwatch}
        onRemoveSwatch={handleRemoveSwatch}
        onSwatchesLoad={handleSwatchesLoad}
        onScriptChange={handleScriptChange}
        onBehaviorsChange={handleBehaviorsChange}
        onSelectScene={handleSelectScene}
        onAddScene={handleAddScene}
        onRemoveScene={handleRemoveScene}
        onRenameScene={handleRenameScene}
        onReorderScene={handleReorderScene}
        onDuplicateScene={handleDuplicateScene}
      />

      {/* Floating overlays (player, history, profiler, accessibility, export — flags in uiStore) */}
      <ShellOverlays
        doc={doc}
        docProperties={docProperties}
        selectedDisplayObject={selectedDisplayObject}
        onPlayerClose={handlePlayerClose}
        onPlayerError={handlePlayerError}
        onTrace={handleTrace}
        onJumpToHistory={handleJumpToHistory}
        onSaveAsCommand={handleSaveAsCommand}
        onDocAccessibilityChange={handleDocAccessibilityChange}
        onObjectAccessibilityChange={handleObjectAccessibilityChange}
        onExportGifConfirm={handleExportGifConfirm}
      />

      {/* Application modal dialogs (open-state + dialog-local state live in uiStore) */}
      <ShellDialogs
        doc={doc}
        docProperties={docProperties}
        library={library}
        selectedDisplayObject={selectedDisplayObject}
        preferences={preferences}
        pushDoc={pushDoc}
        updatePreferences={updatePreferences}
        resetPreferences={resetPreferences}
        onDocPropsConfirm={handleDocPropsConfirm}
        onEditGridConfirm={handleEditGridConfirm}
        onConvertToSymbolConfirm={handleConvertToSymbolConfirm}
        onApplyTimelineEffect={handleApplyTimelineEffect}
        onSwapSymbolConfirm={handleSwapSymbolConfirm}
        onBitmapPropsSave={handleBitmapPropsSave}
        onSwapBitmapConfirm={handleSwapBitmapConfirm}
        onTraceBitmapConfirm={handleTraceBitmapConfirm}
      />

      {/* Manage Saved Commands modal (open-state + list in uiStore) */}
      <ManageCommandsDialog onRun={handleRunCommand} onDelete={handleDeleteCommand} />

      {/* Sound Envelope Edit dialog */}
      {envelopeDialogOpen && envelopeDialogTarget && (() => {
        const { frameIdx, layerIdx } = envelopeDialogTarget;
        const layer = timeline.layers[layerIdx];
        const kf = layer ? getGoverningKeyframe(layer, frameIdx) : null;
        const sound = kf?.sound ?? null;
        const soundItem = sound
          ? soundLibraryItems.find((s) => s.id === sound.libraryItemId)
          : null;
        const totalSamples = soundItem
          ? Math.round(soundItem.durationSeconds * soundItem.sampleRate)
          : 44100;
        const initial = sound && (sound.inPoint !== undefined || sound.customEnvelope)
          ? {
              inPoint: sound.inPoint ?? 0,
              outPoint: sound.outPoint ?? totalSamples,
              leftNodes: sound.customEnvelope
                ? sound.customEnvelope.map((p): [number, number] => [
                    p.pos44 / totalSamples,
                    p.leftLevel / 32768,
                  ])
                : [[0, 1] as [number, number], [1, 1] as [number, number]],
              rightNodes: sound.customEnvelope
                ? sound.customEnvelope.map((p): [number, number] => [
                    p.pos44 / totalSamples,
                    p.rightLevel / 32768,
                  ])
                : [[0, 1] as [number, number], [1, 1] as [number, number]],
            }
          : defaultEnvelope(totalSamples);
        return (
          <SoundEnvelopeEditDialog
            totalSamples={totalSamples}
            initial={initial}
            onConfirm={handleEnvelopeConfirm}
            onClose={() => {
              setEnvelopeDialogOpen(false);
              setEnvelopeDialogTarget(null);
            }}
          />
        );
      })()}
    </div>
    </StoreProvider>
  );
}
