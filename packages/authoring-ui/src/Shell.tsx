import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocument,
  createSymbolInLibrary,
  createLibraryFolder,
  removeLibraryItem,
  addLibraryItem,
  addDisplayObject,
  removeDisplayObject,
  updateDisplayObject,
  setFrameScript,
  setSoundOnFrame,
  hexToColor,
  createOvalShape,
  createRectShape,
  createLineShape,
  getTweenedFrame,
  getGoverningKeyframe,
  addScene,
  removeScene,
  renameScene,
  reorderScenes,
  CanvasRenderer,
  insertFrame,
  insertKeyframe,
  insertBlankKeyframe,
  transformedShapeBounds,
} from "@flash/core";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";
import { TransformHandles } from "./TransformHandles";
import type {
  BitmapDisplayObject,
  BitmapItem,
  ClipAction,
  DisplayObject,
  DocumentProperties,
  Fill,
  FlashDocument,
  FlashFilter,
  Frame,
  Library,
  SceneGraph,
  Shape,
  ShapeDisplayObject,
  SolidStroke,
  SoundItem,
  SoundLinkage,
  SymbolInstance,
  SymbolType,
  TextAlign,
  TextDisplayObject,
  Timeline as TimelineModel,
} from "@flash/core";
import { runJsfl, buildJsflContext } from "./jsfl/index.js";
import { ColorPanel } from "./ColorPanel";
import { PlayerWindow } from "@flash/player";
import { MenuBar } from "./MenuBar";
import { EditBar } from "./EditBar";
import type { TextFormat } from "./EditBar";
import { ToolsPanel } from "./ToolsPanel";
import { StageArea } from "./StageArea";
import type { ViewMode, OnionFrame } from "./StageArea";
import { Rulers } from "./Rulers";
import { Timeline } from "./Timeline";
import { PropertiesPanel } from "./PropertiesPanel";
import type { PlacedInstance } from "./PropertiesPanel";
import { LibraryPanel } from "./LibraryPanel";
import { StatusBar } from "./StatusBar";
import type { FreeTransformMode, PolyStarOptions, ToolId, ToolState } from "./tools/types";
import { usePublish } from "./hooks/usePublish";
import { useFileActions } from "./hooks/useFileActions";
import { useHistory } from "./hooks/useHistory";
import { ActionsPanel } from "./ActionsPanel";
import { DocumentPropertiesDialog } from "./DocumentPropertiesDialog";
import { FiltersPanel } from "./FiltersPanel";
import { SoundPanel } from "./SoundPanel";
import { TransformPanel } from "./TransformPanel";
import type { TransformUpdates } from "./TransformPanel";
import { InstancePanel } from "./InstancePanel";
import { AlignPanel } from "./AlignPanel";
import { ScenePanel } from "./ScenePanel";
import { SceneSwitcher } from "./SceneSwitcher";
import { ColorMixerPanel } from "./ColorMixerPanel";
import { ConvertToSymbolDialog } from "./ConvertToSymbolDialog";
import { PublishSettingsDialog } from "./PublishSettingsDialog";
import type { PublishSettings } from "./PublishSettingsDialog";
import { PanelGroup } from "./PanelGroup";
import { startAgentBridge, stopAgentBridge } from "./agent/bridge.js";
import { setAgentCallbacks, clearAgentCallbacks, bumpRev } from "./agent/registry.js";

// ---------------------------------------------------------------------------
// Edit context
// ---------------------------------------------------------------------------

interface EditContext {
  mode: "document" | "symbol";
  symbolId?: string;
  symbolName?: string;
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
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _initialDoc = createDocument();

const DEFAULT_TOOL_STATE: ToolState = {
  activeTool: "selection",
  objectDrawing: false,
  strokeColor: "#000000",
  fill: { type: "solid", color: { r: 255, g: 255, b: 255, a: 255 } },
  fillColor: "#ffffff",
  strokeWidth: 1,
  strokeAlpha: 100,
  pencilMode: "ink",
  brushSize: 8,
  eraserSize: 16,
  freeTransformMode: "rotate-scale",
  lassoPolygonMode: false,
  polyStarOptions: { shapeType: "polygon", sides: 5, pointSize: 0.5 },
};

let _instanceCounter = 0;
function nextInstanceId() {
  return `inst-${++_instanceCounter}-${Date.now().toString(36)}`;
}

let _groupCounter = 0;
function nextGroupName() {
  return `Group ${++_groupCounter}`;
}

// ---------------------------------------------------------------------------
// Module-level clipboard (avoids async navigator.clipboard complexity)
// ---------------------------------------------------------------------------
let _clipboardItems: DisplayObject[] = [];

let _textObjCounter = 0;
function nextTextId() {
  return `text-${++_textObjCounter}-${Date.now().toString(36)}`;
}

let _bitmapObjCounter = 0;
function nextBitmapId() {
  return `bmp-${++_bitmapObjCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Shell(): React.ReactElement {
  // ---------------------------------------------------------------------------
  // Single document owner — replaces scattered useState for timeline/library/etc.
  // ---------------------------------------------------------------------------
  const history = useHistory(_initialDoc);
  const { doc, push: _rawPushDoc, replace: replaceDoc, commitDrag, undo, redo, canUndo, canRedo } = history;
  // Wrap push so we bump the agent rev counter on every document mutation.
  const pushDoc = useCallback(
    (nextDoc: Parameters<typeof _rawPushDoc>[0]) => {
      bumpRev();
      _rawPushDoc(nextDoc);
    },
    [_rawPushDoc]
  );

  // Convenience: library, docProperties
  const library = doc.library;
  const docProperties = doc.properties;
  const guides = docProperties.guides;

  // Current file path (for Save vs Save As)
  const [filePath, setFilePath] = useState<string | undefined>(undefined);

  // Edit context — declared early so helpers can use it
  const [editContext, setEditContext] = useState<EditContext>({ mode: "document" });

  // Edit path stack: each entry = { symbolId, instanceId }
  // Empty = editing main timeline. Kept in sync with editContext for multi-level support.
  const [editPath, setEditPath] = useState<Array<{ symbolId: string; instanceId: string }>>([]);

  // Active scene index — declared early so helpers can use it
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);

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
  // Frame / playback state (these are UI-only, not persisted to document)
  // ---------------------------------------------------------------------------
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Onion skin state
  const [onionSkinEnabled, setOnionSkinEnabled] = useState(false);
  const [onionBefore, setOnionBefore] = useState(2);
  const [onionAfter, setOnionAfter] = useState(2);

  // RAF playback refs
  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  // Always-current fps ref so the tick closure reads the live value
  const frameRateRef = useRef(doc.properties.frameRate);
  useEffect(() => {
    frameRateRef.current = doc.properties.frameRate;
  }, [doc.properties.frameRate]);

  // Active layer index (0 = topmost layer in Flash convention)
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);

  // Clamped to valid range whenever layers change
  const safeActiveLayerIndex = Math.min(activeLayerIndex, Math.max(0, timeline.layers.length - 1));

  // Selected library item
  const [selectedLibraryItemId, setSelectedLibraryItemId] = useState<string | null>(null);

  // Right panel tab: "library" | "properties"
  const [rightTab, setRightTab] = useState<"library" | "properties">("library");

  // Placed instances on stage
  const [instances, setInstances] = useState<PlacedInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  // Selected shape (draw tool)
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);

  // Stage / view
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  // Grid settings are derived from doc.properties.grid (persisted in document state)
  const showGrid = docProperties.grid.showGrid;
  const gridWidth = docProperties.grid.gridWidth;
  const gridHeight = docProperties.grid.gridHeight;
  const gridColor = docProperties.grid.gridColor;
  const [snapToPixels] = useState(false);
  const [viewMode] = useState<ViewMode>("normal");

  // Renderer ref (for loadImage calls)
  const rendererRef = useRef<import("@flash/core").CanvasRenderer | null>(null);

  // Rulers visibility (guides are stored in doc.properties.guides)
  const [showRulers, setShowRulers] = useState(false);
  const guideCounterRef = React.useRef(0);

  // Tool state
  const [toolState, setToolState] = useState<ToolState>(DEFAULT_TOOL_STATE);

  // Text format state (used by text tool)
  const [textFormat, setTextFormat] = useState<TextFormat>({
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left" as TextAlign,
    color: "#000000",
  });
  // Currently editing text id (for text edit mode in selection tool)
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  // Color panel
  const [colorPanelVisible, setColorPanelVisible] = useState(false);

  // Color Mixer panel (Shift+F9)
  const [colorMixerVisible, setColorMixerVisible] = useState(false);
  // Fill/stroke alpha for Color Mixer (separate from toolState which tracks stroke alpha)
  const [mixerFillAlpha, setMixerFillAlpha] = useState(100);
  const [mixerStrokeAlpha, setMixerStrokeAlpha] = useState(100);

  // Actions panel (F9)
  const [actionsPanelVisible, setActionsPanelVisible] = useState(false);

  // Filters panel
  const [filtersPanelVisible, setFiltersPanelVisible] = useState(false);

  // Align panel (Window > Align, Ctrl+K)
  const [alignPanelVisible, setAlignPanelVisible] = useState(false);

  // Scene panel (Window > Scene, Ctrl+Shift+S)
  const [scenePanelVisible, setScenePanelVisible] = useState(false);

  // Scene switcher inline panel (toggle near Timeline header)
  const [showScenes, setShowScenes] = useState(false);

  // Test Movie player state
  const [playerOpen, setPlayerOpen] = useState(false);
  const [swfBytes, setSwfBytes] = useState<Uint8Array | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Document properties dialog
  const [docPropsOpen, setDocPropsOpen] = useState(false);

  // Convert to Symbol dialog
  const [convertToSymbolOpen, setConvertToSymbolOpen] = useState(false);

  // Publish Settings dialog
  const [publishSettingsOpen, setPublishSettingsOpen] = useState(false);
  const [publishSettings, setPublishSettings] = useState<PublishSettings>({
    filename: "movie.swf",
    jpegQuality: 80,
    audioStreamFormat: "mp3",
    audioEventFormat: "mp3",
  });

  // ---------------------------------------------------------------------------
  // Handlers — timeline / frame
  // ---------------------------------------------------------------------------

  const handleToggleOnionSkin = useCallback(() => {
    setOnionSkinEnabled((v) => !v);
  }, []);

  const handleOnionRangeChange = useCallback((before: number, after: number) => {
    setOnionBefore(Math.max(0, before));
    setOnionAfter(Math.max(0, after));
  }, []);

  const handleTimelineChange = useCallback((t: TimelineModel) => {
    pushDoc(withTimeline(() => t));
  }, [pushDoc, withTimeline]);

  const handleFrameChange = useCallback((frame: number) => {
    setCurrentFrame(frame);
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

  const handlePlayToggle = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [startPlayback, stopPlayback]);

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

  // ---------------------------------------------------------------------------
  // Handlers — rulers & guides
  // ---------------------------------------------------------------------------

  const handleRulersToggle = useCallback(() => {
    setShowRulers((v) => !v);
  }, []);

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

  const handleToolChange = useCallback((tool: ToolId) => {
    setToolState((prev) => ({ ...prev, activeTool: tool }));
  }, []);

  const handleStrokeColorChange = useCallback((color: string) => {
    setToolState((prev) => ({ ...prev, strokeColor: color }));
  }, []);

  const handleFillColorChange = useCallback((color: string | null) => {
    const fill: Fill | null = color
      ? { type: "solid", color: hexToColor(color) }
      : null;
    setToolState((prev) => ({ ...prev, fillColor: color, fill }));
  }, []);

  const handleFillChange = useCallback((newFill: Fill | null) => {
    // Derive fillColor hex from the fill for backward compat (for solid fills)
    let fillColor: string | null = null;
    if (newFill?.type === "solid") {
      const { r, g, b } = newFill.color;
      fillColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    setToolState((prev) => ({ ...prev, fill: newFill, fillColor }));
  }, []);

  const handleStrokeChangeFromPanel = useCallback((stroke: SolidStroke | null) => {
    if (stroke) {
      const { r, g, b, a } = stroke.color;
      const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
      setToolState((prev) => ({
        ...prev,
        strokeColor: hex,
        strokeWidth: stroke.width,
        strokeAlpha: Math.round((a / 255) * 100),
      }));
    } else {
      setToolState((prev) => ({ ...prev, strokeColor: "#000000", strokeAlpha: 0 }));
    }
  }, []);

  // Color Mixer panel handlers
  const handleMixerFillColorChange = useCallback((color: string, alpha: number) => {
    setMixerFillAlpha(alpha);
    handleFillColorChange(alpha > 0 ? color : null);
  }, [handleFillColorChange]);

  const handleMixerStrokeColorChange = useCallback((color: string, alpha: number) => {
    setMixerStrokeAlpha(alpha);
    setToolState((prev) => ({
      ...prev,
      strokeColor: color,
      strokeAlpha: alpha,
    }));
  }, []);

  const handleObjectDrawingToggle = useCallback(() => {
    setToolState((prev) => ({ ...prev, objectDrawing: !prev.objectDrawing }));
  }, []);

  const handlePencilModeChange = useCallback((mode: "straighten" | "smooth" | "ink") => {
    setToolState((prev) => ({ ...prev, pencilMode: mode }));
  }, []);

  const handleBrushSizeChange = useCallback((size: number) => {
    setToolState((prev) => ({ ...prev, brushSize: size }));
  }, []);

  const handleEraserSizeChange = useCallback((size: number) => {
    setToolState((prev) => ({ ...prev, eraserSize: size }));
  }, []);

  const handleFreeTransformModeChange = useCallback((mode: FreeTransformMode) => {
    setToolState((prev) => ({ ...prev, freeTransformMode: mode }));
  }, []);

  const handleLassoPolygonModeChange = useCallback((polygonMode: boolean) => {
    setToolState((prev) => ({ ...prev, lassoPolygonMode: polygonMode }));
  }, []);

  const handlePolyStarOptionsChange = useCallback((opts: Partial<PolyStarOptions>) => {
    setToolState((prev) => ({
      ...prev,
      polyStarOptions: { ...(prev.polyStarOptions ?? { shapeType: "polygon", sides: 5, pointSize: 0.5 }), ...opts },
    }));
  }, []);

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

      const obj: ShapeDisplayObject = {
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
      replaceDoc(withTimeline((prev) => {
        const layer = prev.layers.find((l) => l.id === layerId);
        if (!layer) return prev;
        const kf = [...layer.frames]
          .filter((f) => f.isKeyframe && f.index <= currentFrame)
          .sort((a, b) => b.index - a.index)[0];
        if (!kf) return prev;
        const obj = kf.displayObjects.find((o) => o.id === id) as ShapeDisplayObject | undefined;
        if (!obj) return prev;
        return updateDisplayObject(prev, layerId, currentFrame, id, {
          x: obj.x + dx,
          y: obj.y + dy,
        });
      }));
    },
    [timeline, currentFrame, activeLayerIndex, doc, replaceDoc, withTimeline]
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
      setSelectedShapeId(null);
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  // ---------------------------------------------------------------------------
  // Clipboard handlers
  // ---------------------------------------------------------------------------

  /** Copy: snapshot the selected display object into the module-level clipboard. */
  const handleCopy = useCallback(() => {
    if (!selectedShapeId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (obj) _clipboardItems = [obj];
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame]);

  /** Cut: copy then delete the selected display object. */
  const handleCut = useCallback(() => {
    if (!selectedShapeId) return;
    handleCopy();
    handleShapeDelete(selectedShapeId);
  }, [selectedShapeId, handleCopy, handleShapeDelete]);

  /** Paste: add clipboard items to the active keyframe with an optional +10/+10 offset. */
  const handlePaste = useCallback((inPlace = false) => {
    if (_clipboardItems.length === 0) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    let lastId: string | null = null;
    let newDoc = doc;
    for (const item of _clipboardItems) {
      const newId = `paste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const pasted: DisplayObject = {
        ...item,
        id: newId,
        ...(inPlace ? {} : { x: (item.x ?? 0) + 10, y: (item.y ?? 0) + 10 }),
      };
      // Apply the timeline mutation to accumulate multi-item pastes
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const symId = editContext.symbolId;
        const items = newDoc.library.items.map((libItem) => {
          if (libItem.id === symId && libItem.itemType === "symbol") {
            return { ...libItem, timeline: addDisplayObject(libItem.timeline, layerId, currentFrame, pasted) };
          }
          return libItem;
        });
        newDoc = { ...newDoc, library: { ...newDoc.library, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, newDoc.scenes.length - 1);
        const t = addDisplayObject(newDoc.scenes[sceneIdx].timeline, layerId, currentFrame, pasted);
        newDoc = { ...newDoc, scenes: newDoc.scenes.map((s, i) => i === sceneIdx ? { ...s, timeline: t } : s) };
      }
      lastId = newId;
    }
    pushDoc(newDoc);
    if (lastId) setSelectedShapeId(lastId);
  }, [doc, timeline, safeActiveLayerIndex, currentFrame, editContext, pushDoc, activeSceneIndex]);

  /** Paste in Place: paste at the exact same coordinates as the source. */
  const handlePasteInPlace = useCallback(() => {
    handlePaste(true);
  }, [handlePaste]);

  /** Duplicate: copy + paste offset in one operation. */
  const handleDuplicate = useCallback(() => {
    handleCopy();
    handlePaste(false);
  }, [handleCopy, handlePaste]);

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
    if (!selectedDisplayObject || selectedDisplayObject.type !== "shape") return null;
    const shapeObj = selectedDisplayObject as ShapeDisplayObject;
    const b = transformedShapeBounds(shapeObj);
    return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: shapeObj.rotation ?? 0 };
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
      replaceDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
          x: selectedDisplayObject.x + dx,
          y: selectedDisplayObject.y + dy,
        })
      ));
    },
    [selectedShapeId, selectedDisplayObject, timeline, safeActiveLayerIndex, currentFrame, replaceDoc, withTimeline]
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

  /** Single-element array of the currently selected display object (for PropertiesPanel). */
  const selectedObjects = useMemo<DisplayObject[]>(
    () => (selectedDisplayObject ? [selectedDisplayObject] : []),
    [selectedDisplayObject]
  );

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

  const handleAddScene = useCallback(() => {
    pushDoc(addScene(doc));
  }, [doc, pushDoc]);

  const handleRemoveScene = useCallback((index: number) => {
    const scene = doc.scenes[index];
    if (!scene) return;
    pushDoc(removeScene(doc, scene.id));
    setActiveSceneIndex((prev) => Math.min(prev, doc.scenes.length - 2));
  }, [doc, pushDoc]);

  const handleRenameScene = useCallback((index: number, name: string) => {
    const scene = doc.scenes[index];
    if (!scene) return;
    pushDoc(renameScene(doc, scene.id, name));
  }, [doc, pushDoc]);

  const handleReorderScene = useCallback((fromIndex: number, toIndex: number) => {
    pushDoc(reorderScenes(doc, fromIndex, toIndex));
    // Keep activeSceneIndex pointing to the same scene after reorder
    setActiveSceneIndex((prev) => {
      if (prev === fromIndex) return toIndex;
      if (fromIndex < toIndex) {
        if (prev > fromIndex && prev <= toIndex) return prev - 1;
      } else {
        if (prev >= toIndex && prev < fromIndex) return prev + 1;
      }
      return prev;
    });
  }, [doc, pushDoc]);

  const handleSelectScene = useCallback((index: number) => {
    setActiveSceneIndex(index);
    setCurrentFrame(0);
    setActiveLayerIndex(0);
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers — text tool
  // ---------------------------------------------------------------------------

  const handleTextCreated = useCallback(
    (textObj: Omit<TextDisplayObject, "id">) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const obj: TextDisplayObject = { ...textObj, id: nextTextId() };
      pushDoc(withTimeline((t) => addDisplayObject(t, layerId, currentFrame, obj)));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  /**
   * Called by the text tool when clicking on empty stage: immediately creates a
   * TextDisplayObject in the document (with default text "Text"), then notifies
   * StageArea via the `onPlaced` callback so it can open the inline textarea for
   * that specific object.
   */
  const handleTextPlace = useCallback(
    (textObj: Omit<TextDisplayObject, "id">, onPlaced: (id: string) => void) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const id = nextTextId();
      const obj: TextDisplayObject = { ...textObj, id };
      pushDoc(withTimeline((t) => addDisplayObject(t, layerId, currentFrame, obj)));
      setEditingTextId(id);
      onPlaced(id);
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  const handleTextEdit = useCallback(
    (id: string, newText: string) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) => updateDisplayObject(t, layerId, currentFrame, id, { text: newText })));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
  );

  const handleTextEditEnd = useCallback(() => {
    setEditingTextId(null);
  }, []);

  const handleTextFormatChange = useCallback((format: Partial<typeof textFormat>) => {
    setTextFormat((prev) => ({ ...prev, ...format }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers — library
  // ---------------------------------------------------------------------------

  const { importToLibrary, importSoundToLibrary } = useFileActions();

  const handleImportToLibrary = useCallback(async () => {
    const result = await importToLibrary();
    if (!result) return;
    const { item, dataUri } = result;
    pushDoc(withLibrary((lib) => addLibraryItem(lib, item)));
    // Pre-load image into renderer cache
    if (rendererRef.current) {
      rendererRef.current.loadImage(item.id, dataUri);
    }
  }, [importToLibrary, pushDoc, withLibrary]);

  const handleImportSound = useCallback(async () => {
    const result = await importSoundToLibrary();
    if (!result) return;
    const { item } = result;
    pushDoc(withLibrary((lib) => addLibraryItem(lib, item)));
  }, [importSoundToLibrary, pushDoc, withLibrary]);

  const handleCreateSymbol = useCallback((name: string, type: SymbolType) => {
    pushDoc(withLibrary((lib) => {
      const { library: updated } = createSymbolInLibrary(lib, name, type);
      return updated;
    }));
  }, [pushDoc, withLibrary]);

  const handleDeleteLibraryItem = useCallback((id: string) => {
    pushDoc(withLibrary((lib) => removeLibraryItem(lib, id)));
    setSelectedLibraryItemId((prev) => (prev === id ? null : prev));
    // Also remove instances that reference this item
    setInstances((prev) => prev.filter((inst) => inst.libraryItemId !== id));
  }, [pushDoc, withLibrary]);

  const handleRenameLibraryItem = useCallback((id: string, newName: string) => {
    pushDoc(withLibrary((lib) => ({
      ...lib,
      items: lib.items.map((item) =>
        item.id === id ? { ...item, name: newName } : item
      ),
    })));
  }, [pushDoc, withLibrary]);

  const handleDuplicateLibraryItem = useCallback((id: string) => {
    pushDoc(withLibrary((lib) => {
      const source = lib.items.find((i) => i.id === id);
      if (!source) return lib;
      const newId = `${source.itemType}-dup-${Date.now().toString(36)}`;
      const baseName = source.name.replace(/ copy(\s+\d+)?$/, "");
      // Find next available copy name
      const existingNames = new Set(lib.items.map((i) => i.name));
      let newName = `${baseName} copy`;
      let n = 2;
      while (existingNames.has(newName)) {
        newName = `${baseName} copy ${n++}`;
      }
      const duplicate = { ...source, id: newId, name: newName } as typeof source;
      return { ...lib, items: [...lib.items, duplicate] };
    }));
  }, [pushDoc, withLibrary]);

  const handleAddFolder = useCallback((name: string) => {
    pushDoc(withLibrary((lib) => ({
      ...lib,
      folders: [...lib.folders, createLibraryFolder(name)],
    })));
  }, [pushDoc, withLibrary]);

  const handleMoveItemToFolder = useCallback((itemId: string, folderId: string | null) => {
    pushDoc(withLibrary((lib) => ({
      ...lib,
      items: lib.items.map((item) =>
        item.id === itemId ? { ...item, folderId } : item
      ),
    })));
  }, [pushDoc, withLibrary]);

  const handleEditInPlace = useCallback((itemId: string, instanceId?: string) => {
    const item = library.items.find((i) => i.id === itemId);
    if (!item) return;
    setEditContext({ mode: "symbol", symbolId: itemId, symbolName: item.name });
    setEditPath((prev) => [...prev, { symbolId: itemId, instanceId: instanceId ?? itemId }]);
    setCurrentFrame(0);
    setActiveLayerIndex(0);
  }, [library]);

  const handleExitEditInPlace = useCallback(() => {
    setEditContext({ mode: "document" });
    setEditPath([]);
    setCurrentFrame(0);
    setActiveLayerIndex(0);
  }, []);

  // ---------------------------------------------------------------------------
  // Convert to Symbol (F8)
  // ---------------------------------------------------------------------------

  /**
   * Open the Convert to Symbol dialog if there is something to convert.
   * The actual conversion is performed in handleConvertToSymbolConfirm.
   */
  const handleConvertToSymbol = useCallback(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;

    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;

    const objectsToConvert = selectedShapeId
      ? kf.displayObjects.filter((o) => o.id === selectedShapeId)
      : kf.displayObjects;

    if (objectsToConvert.length === 0) return;

    setConvertToSymbolOpen(true);
  }, [timeline, safeActiveLayerIndex, currentFrame, selectedShapeId]);

  /**
   * Perform the actual conversion after the dialog is confirmed.
   */
  const handleConvertToSymbolConfirm = useCallback((name: string, symbolType: SymbolType) => {
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;

    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;

    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;

    const objectsToConvert = selectedShapeId
      ? kf.displayObjects.filter((o) => o.id === selectedShapeId)
      : kf.displayObjects;

    if (objectsToConvert.length === 0) {
      setConvertToSymbolOpen(false);
      return;
    }

    // Compute average position of the objects
    const avgX = objectsToConvert.reduce((sum, o) => sum + o.x, 0) / objectsToConvert.length;
    const avgY = objectsToConvert.reduce((sum, o) => sum + o.y, 0) / objectsToConvert.length;

    // Objects repositioned relative to the symbol's origin
    const symbolObjects = objectsToConvert.map((o) => ({
      ...o,
      x: o.x - avgX,
      y: o.y - avgY,
    }));

    pushDoc((() => {
      const { library: updatedLib, item: newSymbol } = createSymbolInLibrary(
        doc.library,
        name,
        symbolType
      );

      // Put the objects into the symbol's first keyframe
      const symbolWithObjects = {
        ...newSymbol,
        timeline: {
          layers: [
            {
              ...newSymbol.timeline.layers[0],
              frames: [
                {
                  ...newSymbol.timeline.layers[0].frames[0],
                  displayObjects: symbolObjects,
                  isEmpty: false,
                },
              ],
            },
          ],
        },
      };

      const finalLib = {
        ...updatedLib,
        items: updatedLib.items.map((i) => (i.id === newSymbol.id ? symbolWithObjects : i)),
      };

      // Create the SymbolInstance to replace the selection on the timeline
      const instId = `inst-${Date.now().toString(36)}`;
      const instance: SymbolInstance = {
        type: "instance",
        id: instId,
        symbolId: newSymbol.id,
        x: avgX,
        y: avgY,
      };

      const convertedObjectIds = new Set(objectsToConvert.map((o) => o.id));
      const updatedTimelineFn = (t: TimelineModel): TimelineModel => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter((o) => !convertedObjectIds.has(o.id));
              return { ...f, displayObjects: [...remaining, instance] };
            }),
          };
        }),
      });

      // Apply to the right timeline (scene or symbol edit-in-place)
      let newDoc: FlashDocument;
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const items = finalLib.items.map((item) => {
          if (item.id === editContext.symbolId && item.itemType === "symbol") {
            return { ...item, timeline: updatedTimelineFn(item.timeline) };
          }
          return item;
        });
        newDoc = { ...doc, library: { ...finalLib, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
        const newSceneTimeline = updatedTimelineFn(doc.scenes[sceneIdx].timeline);
        newDoc = {
          ...doc,
          scenes: doc.scenes.map((s, i) => i === sceneIdx ? { ...s, timeline: newSceneTimeline } : s),
          library: finalLib,
        };
      }

      return newDoc;
    })());

    setSelectedShapeId(null);
    setConvertToSymbolOpen(false);
  }, [timeline, safeActiveLayerIndex, currentFrame, selectedShapeId, pushDoc, doc, editContext, activeSceneIndex]);

  // ---------------------------------------------------------------------------
  // Arrange (z-order)
  // ---------------------------------------------------------------------------

  const handleArrange = useCallback(
    (direction: "front" | "back" | "forward" | "backward") => {
      if (!selectedShapeId) return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= currentFrame)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return;
      const objs = [...kf.displayObjects];
      const idx = objs.findIndex((o) => o.id === selectedShapeId);
      if (idx < 0) return;

      let newObjs: DisplayObject[];
      if (direction === "front") {
        const [obj] = objs.splice(idx, 1);
        newObjs = [...objs, obj];
      } else if (direction === "back") {
        const [obj] = objs.splice(idx, 1);
        newObjs = [obj, ...objs];
      } else if (direction === "forward") {
        if (idx >= objs.length - 1) return; // already at top
        [objs[idx], objs[idx + 1]] = [objs[idx + 1], objs[idx]];
        newObjs = objs;
      } else {
        // backward
        if (idx <= 0) return; // already at bottom
        [objs[idx], objs[idx - 1]] = [objs[idx - 1], objs[idx]];
        newObjs = objs;
      }

      pushDoc(withTimeline((t) => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              return { ...f, displayObjects: newObjs };
            }),
          };
        }),
      })));
    },
    [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  // ---------------------------------------------------------------------------
  // Group / Ungroup
  // ---------------------------------------------------------------------------

  const handleGroup = useCallback(() => {
    if (!selectedShapeId) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;

    // Group selected object (or all objects if none selected)
    const objectsToGroup = kf.displayObjects.filter((o) => o.id === selectedShapeId);
    if (objectsToGroup.length === 0) return;

    // Compute collective center (average of object x/y positions)
    const centerX = objectsToGroup.reduce((sum, o) => sum + o.x, 0) / objectsToGroup.length;
    const centerY = objectsToGroup.reduce((sum, o) => sum + o.y, 0) / objectsToGroup.length;

    // Create symbol objects relative to center
    const symbolObjects = objectsToGroup.map((o) => ({
      ...o,
      x: o.x - centerX,
      y: o.y - centerY,
    }));

    const groupName = nextGroupName();

    pushDoc((() => {
      const { library: updatedLib, item: newSymbol } = createSymbolInLibrary(
        doc.library,
        groupName,
        "movieclip"
      );

      const symbolWithObjects = {
        ...newSymbol,
        timeline: {
          layers: [
            {
              ...newSymbol.timeline.layers[0],
              frames: [
                {
                  ...newSymbol.timeline.layers[0].frames[0],
                  displayObjects: symbolObjects,
                  isEmpty: false,
                },
              ],
            },
          ],
        },
      };

      const finalLib = {
        ...updatedLib,
        items: updatedLib.items.map((i) => (i.id === newSymbol.id ? symbolWithObjects : i)),
      };

      const instId = `group-inst-${Date.now().toString(36)}`;
      const instance: SymbolInstance = {
        type: "instance",
        id: instId,
        symbolId: newSymbol.id,
        x: centerX,
        y: centerY,
      };

      const groupedIds = new Set(objectsToGroup.map((o) => o.id));
      const updatedTimelineFn = (t: TimelineModel): TimelineModel => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter((o) => !groupedIds.has(o.id));
              return { ...f, displayObjects: [...remaining, instance] };
            }),
          };
        }),
      });

      let newDoc: FlashDocument;
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const items = finalLib.items.map((item) => {
          if (item.id === editContext.symbolId && item.itemType === "symbol") {
            return { ...item, timeline: updatedTimelineFn(item.timeline) };
          }
          return item;
        });
        newDoc = { ...doc, library: { ...finalLib, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
        newDoc = {
          ...doc,
          scenes: doc.scenes.map((s, i) => i === sceneIdx ? { ...s, timeline: updatedTimelineFn(s.timeline) } : s),
          library: finalLib,
        };
      }
      return newDoc;
    })());

    setSelectedShapeId(null);
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, doc, editContext, withTimeline, activeSceneIndex]);

  const handleUngroup = useCallback(() => {
    if (!selectedShapeId) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;

    // Find the selected object — must be a SymbolInstance
    const selected = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (!selected || selected.type !== "instance") return;
    const inst = selected as SymbolInstance;

    // Resolve the symbol
    const symbol = doc.library.items.find(
      (i) => i.id === inst.symbolId && i.itemType === "symbol"
    );
    if (!symbol || symbol.itemType !== "symbol") return;

    // Get the objects from the symbol's first keyframe of layer 0
    const symLayer = symbol.timeline.layers[0];
    if (!symLayer) return;
    const symKf = [...symLayer.frames]
      .filter((f) => f.isKeyframe)
      .sort((a, b) => a.index - b.index)[0];
    if (!symKf) return;

    // Apply the instance's transform (position) to each object's position
    const ungrouped: DisplayObject[] = symKf.displayObjects.map((o) => ({
      ...o,
      id: `ungroup-${o.id}-${Date.now().toString(36)}`,
      x: o.x + inst.x,
      y: o.y + inst.y,
    }));

    const selectedIds: string[] = ungrouped.map((o) => o.id);

    pushDoc(withTimeline((t) => ({
      ...t,
      layers: t.layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          frames: l.frames.map((f) => {
            if (!f.isKeyframe || f.index !== kf.index) return f;
            const remaining = f.displayObjects.filter((o) => o.id !== inst.id);
            return { ...f, displayObjects: [...remaining, ...ungrouped] };
          }),
        };
      }),
    })));

    // Select the last ungrouped object (or first if only one)
    if (selectedIds.length > 0) {
      setSelectedShapeId(selectedIds[selectedIds.length - 1]);
    } else {
      setSelectedShapeId(null);
    }
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, doc, withTimeline]);

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

      // Non-bitmap items (symbols): place a SymbolInstance in the timeline
      // AND keep a PlacedInstance for selection/properties UI
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (layerId) {
        const instId = nextInstanceId();
        const symbolInst = {
          type: "instance" as const,
          id: instId,
          symbolId: libraryItemId,
          x,
          y,
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
  const instanceNames: Record<string, string> = {};
  for (const item of library.items) {
    instanceNames[item.id] = item.name;
  }

  // Derive shape display objects for the current frame (from active layer only — for interaction)
  const shapeDisplayObjects = useMemo<ShapeDisplayObject[]>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer || !layer.visible || layer.locked) return [];
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return [];
    return kf.displayObjects.filter((o): o is ShapeDisplayObject => o.type === "shape");
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  // Derive text display objects for the current frame (from active layer only — for interaction)
  const textDisplayObjects = useMemo<TextDisplayObject[]>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer || !layer.visible || layer.locked) return [];
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return [];
    return kf.displayObjects.filter((o): o is TextDisplayObject => o.type === "text");
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  // Derive bitmap display objects for the current frame (from active layer only — for interaction)
  const bitmapDisplayObjects = useMemo<BitmapDisplayObject[]>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer || !layer.visible || layer.locked) return [];
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return [];
    return kf.displayObjects.filter((o): o is BitmapDisplayObject => o.type === "bitmap");
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  // Derive SymbolInstance display objects for the current frame (from active layer — for hit-testing)
  const symbolInstanceDisplayObjects = useMemo<SymbolInstance[]>(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer || !layer.visible || layer.locked) return [];
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return [];
    return kf.displayObjects.filter((o): o is SymbolInstance => o.type === "instance");
  }, [timeline, currentFrame, safeActiveLayerIndex]);

  // Derive BitmapItems from library for image loading in renderer
  const bitmapLibraryItems = useMemo<BitmapItem[]>(() => {
    return library.items.filter((i): i is BitmapItem => i.itemType === "bitmap");
  }, [library]);

  // Derive SoundItems from library
  const soundLibraryItems = useMemo<SoundItem[]>(() => {
    return library.items.filter((i): i is SoundItem => i.itemType === "sound");
  }, [library]);

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
        objects,
      };
    });
    return { layers };
  }, [editContext, doc, activeSceneIndex, currentFrame]);

  // Compute onion skin ghost frames
  const onionFrames = useMemo<OnionFrame[]>(() => {
    if (!onionSkinEnabled) return [];
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
          objects,
        };
      });
      return { layers };
    };

    // Before frames (closer = higher opacity)
    for (let i = 1; i <= onionBefore; i++) {
      const fi = currentFrame - i;
      if (fi < 0) continue;
      const opacity = 0.2 + (0.2 * (onionBefore - i) / Math.max(onionBefore, 1));
      frames.push({ frameIndex: fi, opacity, tint: "before", sceneGraph: buildSceneGraph(fi) });
    }
    // After frames (closer = higher opacity)
    for (let i = 1; i <= onionAfter; i++) {
      const fi = currentFrame + i;
      if (fi >= maxFrame) continue;
      const opacity = 0.2 + (0.2 * (onionAfter - i) / Math.max(onionAfter, 1));
      frames.push({ frameIndex: fi, opacity, tint: "after", sceneGraph: buildSceneGraph(fi) });
    }
    return frames;
  }, [onionSkinEnabled, onionBefore, onionAfter, currentFrame, timeline, doc.library]);

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

  // Filters for the currently selected shape (read from displayObject.filters)
  const selectedShapeFilters = useMemo<FlashFilter[]>(() => {
    if (!selectedShapeId) return [];
    const obj = shapeDisplayObjects.find((s) => s.id === selectedShapeId);
    return obj?.filters ? [...obj.filters] : [];
  }, [selectedShapeId, shapeDisplayObjects]);

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

  const handleScriptChange = useCallback(
    (script: string) => {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) => setFrameScript(t, layerId, currentFrame, script)));
    },
    [timeline, currentFrame, activeLayerIndex, pushDoc, withTimeline]
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

  // ---------------------------------------------------------------------------
  // Keyboard shortcut handlers
  // ---------------------------------------------------------------------------

  const handleSelectAll = useCallback(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = getGoverningKeyframe(layer, currentFrame);
    if (!kf || kf.displayObjects.length === 0) return;
    // Select the last object (multi-select is not yet supported; select any for now)
    const last = kf.displayObjects[kf.displayObjects.length - 1];
    setSelectedShapeId(last.id);
  }, [timeline, safeActiveLayerIndex, currentFrame]);

  const handleDeselect = useCallback(() => {
    setSelectedShapeId(null);
  }, []);

  const handleInsertFrame = useCallback(() => {
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) => insertFrame(t, layerId, currentFrame)));
  }, [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  const handleInsertKeyframe = useCallback(() => {
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) => insertKeyframe(t, layerId, currentFrame)));
  }, [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  const handleInsertBlankKeyframe = useCallback(() => {
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) => insertBlankKeyframe(t, layerId, currentFrame)));
  }, [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  useKeyboardShortcuts({
    onUndo: undo,
    onRedo: redo,
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: () => handlePaste(false),
    onPasteInPlace: handlePasteInPlace,
    onDelete: selectedShapeId ? () => handleShapeDelete(selectedShapeId) : undefined,
    onSelectAll: handleSelectAll,
    onDeselect: handleDeselect,
    onGroup: handleGroup,
    onUngroup: handleUngroup,
    onBringToFront: () => handleArrange("front"),
    onSendToBack: () => handleArrange("back"),
    onInsertFrame: handleInsertFrame,
    onInsertKeyframe: handleInsertKeyframe,
    onInsertBlankKeyframe: handleInsertBlankKeyframe,
    onPlay: handlePlayToggle,
  });

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

  // ---------------------------------------------------------------------------
  // File menu handlers
  // ---------------------------------------------------------------------------

  const handleDocumentChange = useCallback((newDoc: FlashDocument, newPath?: string) => {
    pushDoc(newDoc);
    setFilePath(newPath);
    setCurrentFrame(0);
    setInstances([]);
    setSelectedInstanceId(null);
    setSelectedShapeId(null);
  }, [pushDoc]);

  const handleFilePathChange = useCallback((newPath: string) => {
    setFilePath(newPath);
  }, []);

  // ---------------------------------------------------------------------------
  // Publish handlers
  // ---------------------------------------------------------------------------

  const { publishToBytes, testMovie } = usePublish(doc);

  const handlePublish = useCallback(() => {
    const bytes = publishToBytes();
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/x-shockwave-flash" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = publishSettings.filename || "movie.swf";
    a.click();
    URL.revokeObjectURL(url);
  }, [publishToBytes, publishSettings.filename]);

  const handleTestMovie = useCallback(() => {
    void (async () => {
      const bytes = await testMovie();
      setSwfBytes(bytes);
      setPlayerOpen(true);
    })();
  }, [testMovie]);

  // Stable callbacks for PlayerWindow — memoized so RufflePlayer does not
  // reload when Shell re-renders (e.g., on tool-shortcut keypresses).
  const handlePlayerClose = useCallback(() => {
    setPlayerOpen(false);
    setPlayerError(null);
  }, []);

  const handlePlayerError = useCallback((msg: string) => {
    setPlayerError(msg);
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
      // Ctrl+' → toggle grid visibility
      if (e.key === "'" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pushDoc(withProperties((p) => ({
          ...p,
          grid: { ...p.grid, showGrid: !p.grid.showGrid },
        })));
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
          setActionsPanelVisible((v) => !v);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTestMovie, handleRulersToggle, editContext, handleExitEditInPlace, pushDoc, withProperties]);

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
      getSelection: () => (selectedShapeId ? [selectedShapeId] : []),
      getCurrentFrame: () => currentFrame,
      getActiveLayerIndex: () => activeLayerIndex,
      getHistoryDepth: () => history.undoDepth,
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
        return result;
      },

      // Load a fixture/test document into the editor
      loadDocument: (newDoc: unknown) => {
        pushDoc(newDoc as typeof doc);
      },

      // Export the current document as SWF and return it as a base64 string
      publish: () => {
        const bytes = publishToBytes();
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
      screenshotStage: (): string => {
        const w = docProperties.width;
        const h = docProperties.height;
        // Render onto a transparent offscreen canvas at DPR=1.
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const renderer = new CanvasRenderer(offscreen);
        renderer.resize(w, h, 1);
        renderer.render(fullSceneGraph, { x: 0, y: 0, zoom: 1 }, doc.library);
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
    selectedShapeId,
    currentFrame,
    activeLayerIndex,
    activeSceneIndex,
    history.undoDepth,
    toolState.activeTool,
    handleToolChange,
    undo,
    redo,
    handlePlayToggle,
    pushDoc,
    publishToBytes,
    fullSceneGraph,
    docProperties,
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
      getDoc: () => doc,
      getSelectedIds: () => (selectedShapeId ? [selectedShapeId] : []),
      getCurrentFrame: () => currentFrame,
      getActiveLayerIndex: () => activeLayerIndex,
      getActiveTool: () => toolState.activeTool,
      getEditContext: () => editContext,
      getActiveSceneIndex: () => activeSceneIndex,
      getUndoDepth: () => history.undoDepth,
      getRedoDepth: () => history.redoDepth,

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
        setSelectedShapeId(ids.length === 1 ? ids[0] : null);
      },
      setZoom: handleZoomChangeDirect,
      setPan: handlePanChange,
      selectTool: (toolId: string) => handleToolChange(toolId as import("./tools/types.js").ToolId),
      startPlayback,
      stopPlayback,

      // Escape hatches
      runJSFL: (source: string) => {
        const sceneIndex = Math.min(activeSceneIndex, doc.scenes.length - 1);
        const context = (buildJsflContext as (doc: import("@flash/core").FlashDocument, sceneIndex: number, frameIndex: number) => unknown)(doc, sceneIndex, currentFrame);
        const result = (runJsfl as (source: string, context: unknown) => { traces: string[]; returnValue?: unknown; error?: string; finalDocument?: import("@flash/core").FlashDocument })(source, context);
        if (result.finalDocument) {
          pushDoc(result.finalDocument);
        }
        return {
          traces: result.traces,
          returnValue: result.returnValue,
          error: result.error,
          rev: 0 as import("@flash/agent-protocol").Rev,
        };
      },
      screenshotStage: (_frameIndex?: number): string => {
        const w = docProperties.width;
        const h = docProperties.height;
        const offscreen = document.createElement("canvas");
        offscreen.width = w;
        offscreen.height = h;
        const renderer = new CanvasRenderer(offscreen);
        renderer.resize(w, h, 1);
        renderer.render(fullSceneGraph, { x: 0, y: 0, zoom: 1 }, doc.library);
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
    selectedShapeId,
    currentFrame,
    activeLayerIndex,
    toolState.activeTool,
    editContext,
    activeSceneIndex,
    history.undoDepth,
    history.redoDepth,
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.shell}>
      <MenuBar
        document={doc}
        filePath={filePath}
        onDocumentChange={handleDocumentChange}
        onFilePathChange={handleFilePathChange}
        onTestMovie={handleTestMovie}
        onPublish={handlePublish}
        onPublishSettings={() => setPublishSettingsOpen(true)}
        onColorPanelToggle={() => setColorPanelVisible((v) => !v)}
        onActionsToggle={() => setActionsPanelVisible((v) => !v)}
        onFiltersPanelToggle={() => setFiltersPanelVisible((v) => !v)}
        onDocPropsOpen={() => setDocPropsOpen(true)}
        onRulersToggle={handleRulersToggle}
        showRulers={showRulers}
        onImportToLibrary={() => { void handleImportToLibrary(); }}
        onImportSound={() => { void handleImportSound(); }}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onConvertToSymbol={handleConvertToSymbol}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={() => handlePaste(false)}
        onPasteInPlace={handlePasteInPlace}
        onDuplicate={handleDuplicate}
        onArrange={handleArrange}
        onGroup={handleGroup}
        onUngroup={handleUngroup}
        onAlignPanelToggle={() => setAlignPanelVisible((v) => !v)}
        alignPanelVisible={alignPanelVisible}
        onScenePanelToggle={() => setScenePanelVisible((v) => !v)}
        scenePanelVisible={scenePanelVisible}
        onColorMixerToggle={() => setColorMixerVisible((v) => !v)}
        colorMixerVisible={colorMixerVisible}
      />
      <EditBar
        documentName="Untitled-1"
        sceneName={doc.scenes[Math.min(activeSceneIndex, doc.scenes.length - 1)]?.name ?? "Scene 1"}
        symbolName={editContext.mode === "symbol" ? editContext.symbolName : undefined}
        onExitSymbol={editContext.mode === "symbol" ? handleExitEditInPlace : undefined}
        showTextControls={toolState.activeTool === "text"}
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
            onPolyStarOptionsChange={handlePolyStarOptionsChange}
          />
        </div>
        <div style={styles.mainColumn}>
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
                onDrop={handleStageDrop}
                onInstanceSelect={handleInstanceSelect}
                currentFrame={currentFrame}
                shapeDisplayObjects={shapeDisplayObjects}
                onShapeCreated={handleShapeCreated}
                selectedShapeId={selectedShapeId}
                onShapeSelect={setSelectedShapeId}
                onShapeMove={handleShapeMove}
                onShapeMoveEnd={handleShapeMoveEnd}
                onShapeDelete={handleShapeDelete}
                onShapeResize={handleShapeResize}
                onShapeRotate={handleShapeRotate}
                onShapeUpdate={handleShapeUpdate}
                onShapeGradientUpdate={handleShapeUpdate}
                guides={guides}
                showGuides={true}
                snapToGuides={docProperties.snapToGuides}
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
                onPlayToggle={handlePlayToggle}
                onionFrames={onionFrames}
                timeline={timeline}
                stageOverlay={
                  (toolState.activeTool === "free-transform" || toolState.activeTool === "selection") &&
                  selectedBounds &&
                  selectedShapeId ? (
                    <TransformHandles
                      bounds={selectedBounds}
                      zoom={zoom}
                      onScale={handleFreeTransformScale}
                      onRotate={handleFreeTransformRotate}
                      onMove={handleFreeTransformMove}
                    />
                  ) : undefined
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
            <Timeline
              timeline={timeline}
              currentFrame={currentFrame}
              isPlaying={isPlaying}
              frameRate={docProperties.frameRate}
              activeLayerIndex={safeActiveLayerIndex}
              onActiveLayerChange={setActiveLayerIndex}
              onTimelineChange={handleTimelineChange}
              onFrameChange={handleFrameChange}
              onPlayingChange={handlePlayingChange}
              onionSkinEnabled={onionSkinEnabled}
              onionBefore={onionBefore}
              onionAfter={onionAfter}
              onToggleOnionSkin={handleToggleOnionSkin}
              onOnionRangeChange={handleOnionRangeChange}
            />
            <SoundPanel
              frame={selectedKeyframeFrame}
              frameIndex={selectedKeyframeFrame?.index ?? currentFrame}
              layerIndex={selectedLayerIndex}
              sounds={soundLibraryItems}
              onSoundChange={handleSoundChange}
              onPreviewSound={previewSound}
            />
            {/* Bottom dock: context-sensitive Properties panel (Flash 8 style) */}
            <PropertiesPanel
              doc={doc}
              selectedObjects={selectedObjects}
              onUpdateDocProperties={handleUpdateDocProperties}
              onUpdateObject={handleUpdateObject}
            />
          </div>
        </div>

        {/* Right panel: Library + Properties tabs */}
        <div style={styles.rightPanel}>
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
                  selectedIds={selectedShapeId ? [selectedShapeId] : []}
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
                      <div style={{ display: "flex", gap: 8 }}>
                        <span style={{ color: "#999", width: 16 }}>W:</span>
                        <span>
                          {selectedDisplayObject.type === "bitmap"
                            ? Math.round((selectedDisplayObject.width ?? 0) * (selectedDisplayObject.scaleX ?? 1))
                            : "—"}
                        </span>
                        <span style={{ color: "#999", width: 16, marginLeft: 8 }}>H:</span>
                        <span>
                          {selectedDisplayObject.type === "bitmap"
                            ? Math.round((selectedDisplayObject.height ?? 0) * (selectedDisplayObject.scaleY ?? 1))
                            : "—"}
                        </span>
                      </div>
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
      />

      {/* Color panel overlay */}
      <ColorPanel
        fill={toolState.fill}
        stroke={
          toolState.strokeColor
            ? {
                type: "solid",
                color: hexToColor(toolState.strokeColor, Math.round((toolState.strokeAlpha / 100) * 255)),
                width: toolState.strokeWidth,
                caps: "round",
                joints: "round",
                miterLimit: 3,
              }
            : null
        }
        onFillChange={handleFillChange}
        onStrokeChange={handleStrokeChangeFromPanel}
        isVisible={colorPanelVisible}
        onClose={() => setColorPanelVisible(false)}
      />

      {/* Actions panel (F9) — frame script mode OR "Actions - Movie Clip" mode */}
      <ActionsPanel
        script={currentScript}
        frameIndex={currentFrame}
        layerName={timeline.layers[safeActiveLayerIndex]?.name ?? ""}
        onScriptChange={handleScriptChange}
        isVisible={actionsPanelVisible}
        onClose={() => setActionsPanelVisible(false)}
        selectedInstance={selectedMovieClipInstance}
        onClipActionsChange={handleClipActionsChange}
      />

      {/* Filters panel (Window > Filters) */}
      <FiltersPanel
        filters={selectedShapeFilters}
        onFiltersChange={handleFiltersChange}
        isVisible={filtersPanelVisible}
        onClose={() => setFiltersPanelVisible(false)}
      />

      {/* Align panel (Window > Align, Ctrl+K) */}
      <AlignPanel
        visible={alignPanelVisible}
        displayObjects={activeKeyframeObjects}
        selectedIds={selectedShapeId ? [selectedShapeId] : []}
        stageWidth={docProperties.width}
        stageHeight={docProperties.height}
        onAlign={handleAlignObjects}
        onMatchSize={handleMatchSizeObjects}
        onClose={() => setAlignPanelVisible(false)}
      />

      {/* Color Mixer panel (Window > Color Mixer, Shift+F9) */}
      {colorMixerVisible && (
        <ColorMixerPanel
          fillColor={toolState.fillColor ?? "#000000"}
          strokeColor={toolState.strokeColor}
          fillAlpha={mixerFillAlpha}
          strokeAlpha={mixerStrokeAlpha}
          fill={toolState.fill}
          onFillColorChange={handleMixerFillColorChange}
          onStrokeColorChange={handleMixerStrokeColorChange}
          onFillChange={handleFillChange}
          onClose={() => setColorMixerVisible(false)}
        />
      )}

      {/* Scene panel (Window > Scene, Ctrl+Shift+S) */}
      {scenePanelVisible && (
        <ScenePanel
          scenes={doc.scenes}
          activeSceneIndex={Math.min(activeSceneIndex, doc.scenes.length - 1)}
          onSelectScene={handleSelectScene}
          onAddScene={handleAddScene}
          onRemoveScene={handleRemoveScene}
          onRenameScene={handleRenameScene}
          onReorderScene={handleReorderScene}
          onClose={() => setScenePanelVisible(false)}
        />
      )}

      {/* Test Movie player error overlay */}
      {playerError && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#b22222",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "system-ui, sans-serif",
            zIndex: 10000,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            maxWidth: 480,
            textAlign: "center",
            cursor: "pointer",
          }}
          onClick={() => setPlayerError(null)}
          title="Click to dismiss"
        >
          <strong>Test Movie failed:</strong> {playerError}
        </div>
      )}

      {/* Test Movie player overlay */}
      <PlayerWindow
        swfBytes={swfBytes}
        stageWidth={docProperties.width}
        stageHeight={docProperties.height}
        isOpen={playerOpen}
        onClose={handlePlayerClose}
        onError={handlePlayerError}
      />

      {/* Document Properties dialog (Modify > Document, Ctrl+J) */}
      <DocumentPropertiesDialog
        properties={docProperties}
        isOpen={docPropsOpen}
        onConfirm={handleDocPropsConfirm}
        onCancel={() => setDocPropsOpen(false)}
      />

      {/* Convert to Symbol dialog (Insert/Modify > Convert to Symbol, F8) */}
      <ConvertToSymbolDialog
        open={convertToSymbolOpen}
        onConfirm={handleConvertToSymbolConfirm}
        onClose={() => setConvertToSymbolOpen(false)}
      />

      {/* Publish Settings dialog (File > Publish Settings, Ctrl+Shift+F12) */}
      <PublishSettingsDialog
        open={publishSettingsOpen}
        doc={doc}
        pushDoc={pushDoc}
        settings={publishSettings}
        onSave={setPublishSettings}
        onClose={() => setPublishSettingsOpen(false)}
      />
    </div>
  );
}
