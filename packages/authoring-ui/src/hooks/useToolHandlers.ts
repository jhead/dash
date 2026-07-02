import { useCallback } from "react";
import {
  hexToColor,
  updateDisplayObject,
  type Fill,
  type SolidStroke,
  type FlashDocument,
  type Timeline,
  type ShapeDisplayObject,
} from "@flash/core";
import type {
  BrushPaintMode,
  BrushShape,
  EraserShape,
  FreeTransformMode,
  PaintBucketGapSize,
  PenSubTool,
  PolyStarOptions,
  ToolId,
} from "../tools/types";
import type { UiStoreApi } from "../store/uiStore.js";
import { smoothShape, straightenShape } from "../tools/selectionSmooth.js";

export interface ToolHandlersDeps {
  uiStore: UiStoreApi;
  pushDoc: (doc: FlashDocument) => void;
  withTimeline: (updater: (t: Timeline) => Timeline) => FlashDocument;
  timeline: Timeline;
  safeActiveLayerIndex: number;
  currentFrame: number;
  selectedShapeId: string | null;
}

/**
 * Tool/colour/swatch state handlers. Most just mutate the `toolState` slice in
 * uiStore; `handleFillChange` additionally applies a gradient/fill change live to
 * the selected shape. Extracted out of Shell so the tool slice's controller lives
 * with the slice. Returns handlers with the same names Shell wired before.
 */
export function useToolHandlers(deps: ToolHandlersDeps) {
  const { uiStore, pushDoc, withTimeline, timeline, safeActiveLayerIndex, currentFrame, selectedShapeId } = deps;
  const setToolState = uiStore.getState().setToolState;
  const setSwatches = uiStore.getState().setSwatches;
  const setMixerFillAlpha = uiStore.getState().setMixerFillAlpha;
  const setMixerStrokeAlpha = uiStore.getState().setMixerStrokeAlpha;

  const handleToolChange = useCallback((tool: ToolId) => {
    setToolState((prev) => ({ ...prev, activeTool: tool }));
  }, [setToolState]);

  const handleStrokeColorChange = useCallback((color: string) => {
    setToolState((prev) => ({ ...prev, strokeColor: color }));
  }, [setToolState]);

  const handleFillColorChange = useCallback((color: string | null) => {
    const fill: Fill | null = color ? { type: "solid", color: hexToColor(color) } : null;
    setToolState((prev) => ({ ...prev, fillColor: color, fill }));
  }, [setToolState]);

  const handleFillChange = useCallback((newFill: Fill | null) => {
    // Derive fillColor hex from the fill for backward compat (for solid fills)
    let fillColor: string | null = null;
    if (newFill?.type === "solid") {
      const { r, g, b } = newFill.color;
      fillColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    // Always update tool state so future-drawn shapes pick up the fill.
    setToolState((prev) => ({ ...prev, fill: newFill, fillColor }));

    // If a shape is selected, also apply the new fill to every path in that shape
    // so the canvas updates immediately (gradient preview round-trip).
    if (selectedShapeId) {
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (layerId) {
        const layer = timeline.layers[safeActiveLayerIndex];
        if (layer) {
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= currentFrame)
            .sort((a, b) => b.index - a.index)[0];
          if (kf) {
            const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
            if (obj && obj.type === "shape") {
              const shapeObj = obj as ShapeDisplayObject;
              const newPaths = shapeObj.shape.paths.map((path) =>
                newFill !== null ? { ...path, fill: newFill } : { ...path, fill: undefined }
              );
              pushDoc(withTimeline((t) =>
                updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
                  shape: { ...shapeObj.shape, paths: newPaths },
                })
              ));
            }
          }
        }
      }
    }
  }, [setToolState, selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

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
  }, [setToolState]);

  const handleMixerFillColorChange = useCallback((color: string, alpha: number) => {
    setMixerFillAlpha(alpha);
    handleFillColorChange(alpha > 0 ? color : null);
  }, [setMixerFillAlpha, handleFillColorChange]);

  const handleSelectSwatch = useCallback((color: string) => {
    handleFillColorChange(color);
  }, [handleFillColorChange]);

  const handleAddSwatch = useCallback((color: string) => {
    setSwatches((prev) => [...prev, color]);
  }, [setSwatches]);

  const handleRemoveSwatch = useCallback((index: number) => {
    setSwatches((prev) => prev.filter((_, i) => i !== index));
  }, [setSwatches]);

  const handleSwatchesLoad = useCallback((loaded: string[]) => {
    setSwatches(loaded);
  }, [setSwatches]);

  const handleMixerStrokeColorChange = useCallback((color: string, alpha: number) => {
    setMixerStrokeAlpha(alpha);
    setToolState((prev) => ({ ...prev, strokeColor: color, strokeAlpha: alpha }));
  }, [setMixerStrokeAlpha, setToolState]);

  const handleObjectDrawingToggle = useCallback(() => {
    setToolState((prev) => ({ ...prev, objectDrawing: !prev.objectDrawing }));
  }, [setToolState]);

  const handlePencilModeChange = useCallback((mode: "straighten" | "smooth" | "ink") => {
    setToolState((prev) => ({ ...prev, pencilMode: mode }));
  }, [setToolState]);

  const handleBrushSizeChange = useCallback((size: number) => {
    setToolState((prev) => ({ ...prev, brushSize: size }));
  }, [setToolState]);

  const handleBrushShapeChange = useCallback((shape: BrushShape) => {
    setToolState((prev) => ({ ...prev, brushShape: shape }));
  }, [setToolState]);

  const handleBrushModeChange = useCallback((mode: BrushPaintMode) => {
    setToolState((prev) => ({ ...prev, brushMode: mode }));
  }, [setToolState]);

  const handleBrushLockFillChange = useCallback((lock: boolean) => {
    setToolState((prev) => ({ ...prev, brushLockFill: lock }));
  }, [setToolState]);

  const handleBrushPressureChange = useCallback((pressure: boolean) => {
    setToolState((prev) => ({ ...prev, brushPressure: pressure }));
  }, [setToolState]);

  const handleBrushTiltChange = useCallback((tilt: boolean) => {
    setToolState((prev) => ({ ...prev, brushTilt: tilt }));
  }, [setToolState]);

  const handleBucketGapSizeChange = useCallback((gap: PaintBucketGapSize) => {
    setToolState((prev) => ({ ...prev, bucketGapSize: gap }));
  }, [setToolState]);

  const handleBucketLockFillChange = useCallback((lock: boolean) => {
    setToolState((prev) => ({ ...prev, bucketLockFill: lock }));
  }, [setToolState]);

  const handleRectCornerRadiusChange = useCallback((radius: number) => {
    setToolState((prev) => ({ ...prev, rectCornerRadius: Math.max(0, radius) }));
  }, [setToolState]);

  const handlePenSubToolChange = useCallback((subTool: PenSubTool) => {
    setToolState((prev) => ({ ...prev, penSubTool: subTool }));
  }, [setToolState]);

  const handleEraserSizeChange = useCallback((size: number) => {
    setToolState((prev) => ({ ...prev, eraserSize: size }));
  }, [setToolState]);

  const handleEraserShapeChange = useCallback((shape: EraserShape) => {
    setToolState((prev) => ({ ...prev, eraserShape: shape }));
  }, [setToolState]);

  const handleEraserModeChange = useCallback((mode: "normal" | "fills" | "lines" | "selected" | "inside") => {
    setToolState((prev) => ({ ...prev, eraserMode: mode }));
  }, [setToolState]);

  const handleEraserFaucetChange = useCallback((faucet: boolean) => {
    setToolState((prev) => ({ ...prev, eraserFaucet: faucet }));
  }, [setToolState]);

  const handleFreeTransformModeChange = useCallback((mode: FreeTransformMode) => {
    setToolState((prev) => ({ ...prev, freeTransformMode: mode }));
  }, [setToolState]);

  const handleLassoPolygonModeChange = useCallback((polygonMode: boolean) => {
    setToolState((prev) => ({ ...prev, lassoPolygonMode: polygonMode }));
  }, [setToolState]);

  const handleLassoMagicWandChange = useCallback((magicWand: boolean) => {
    setToolState((prev) => ({ ...prev, lassoMagicWand: magicWand }));
  }, [setToolState]);

  const handleMagicWandThresholdChange = useCallback((threshold: number) => {
    setToolState((prev) => ({ ...prev, magicWandThreshold: threshold }));
  }, [setToolState]);

  const handleMagicWandSmoothingChange = useCallback((smoothing: "pixels" | "rough" | "normal" | "smooth") => {
    setToolState((prev) => ({ ...prev, magicWandSmoothing: smoothing }));
  }, [setToolState]);

  const handlePolyStarOptionsChange = useCallback((opts: Partial<PolyStarOptions>) => {
    setToolState((prev) => ({
      ...prev,
      polyStarOptions: { ...(prev.polyStarOptions ?? { shapeType: "polygon", sides: 5, pointSize: 0.5 }), ...opts },
    }));
  }, [setToolState]);

  // Selection-tool Smooth / Straighten: reshape the selected raw shape in place.
  // Shares the shape-lookup path with handleFillChange (active layer's nearest
  // preceding keyframe → the selected ShapeDisplayObject).
  const transformSelectedShape = useCallback(
    (transform: (shape: ShapeDisplayObject["shape"]) => ShapeDisplayObject["shape"]) => {
      if (!selectedShapeId) return;
      const layer = timeline.layers[safeActiveLayerIndex];
      const layerId = layer?.id;
      if (!layer || !layerId) return;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= currentFrame)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return;
      const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
      if (!obj || obj.type !== "shape") return;
      const shapeObj = obj as ShapeDisplayObject;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
          shape: transform(shapeObj.shape),
        })
      ));
    },
    [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  const handleSmoothSelection = useCallback(() => {
    transformSelectedShape((shape) => smoothShape(shape));
  }, [transformSelectedShape]);

  const handleStraightenSelection = useCallback(() => {
    transformSelectedShape((shape) => straightenShape(shape));
  }, [transformSelectedShape]);

  return {
    handleToolChange,
    handleStrokeColorChange,
    handleFillColorChange,
    handleFillChange,
    handleStrokeChangeFromPanel,
    handleMixerFillColorChange,
    handleSelectSwatch,
    handleAddSwatch,
    handleRemoveSwatch,
    handleSwatchesLoad,
    handleMixerStrokeColorChange,
    handleObjectDrawingToggle,
    handlePencilModeChange,
    handleBrushSizeChange,
    handleBrushShapeChange,
    handleBrushModeChange,
    handleBrushLockFillChange,
    handleBrushPressureChange,
    handleBrushTiltChange,
    handleEraserSizeChange,
    handleEraserShapeChange,
    handleEraserModeChange,
    handleEraserFaucetChange,
    handleBucketGapSizeChange,
    handleBucketLockFillChange,
    handleRectCornerRadiusChange,
    handlePenSubToolChange,
    handleSmoothSelection,
    handleStraightenSelection,
    handleFreeTransformModeChange,
    handleLassoPolygonModeChange,
    handleLassoMagicWandChange,
    handleMagicWandThresholdChange,
    handleMagicWandSmoothingChange,
    handlePolyStarOptionsChange,
  };
}
