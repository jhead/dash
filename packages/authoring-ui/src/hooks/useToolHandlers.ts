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
import type { FreeTransformMode, PolyStarOptions, ToolId } from "../tools/types";
import type { UiStoreApi } from "../store/uiStore.js";

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

  const handleEraserSizeChange = useCallback((size: number) => {
    setToolState((prev) => ({ ...prev, eraserSize: size }));
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
    handleEraserSizeChange,
    handleFreeTransformModeChange,
    handleLassoPolygonModeChange,
    handleLassoMagicWandChange,
    handleMagicWandThresholdChange,
    handleMagicWandSmoothingChange,
    handlePolyStarOptionsChange,
  };
}
