import { useCallback } from "react";
import {
  traceBitmap,
  tracePathsToShape,
  removeDisplayObject,
  addDisplayObject,
  updateDisplayObject,
  smoothPath,
  simplifyPath,
  addShapeHint,
  updateShapeHint,
  createLayer,
  type FlashDocument,
  type Timeline as TimelineModel,
  type DocumentProperties,
  type DisplayObject,
  type SymbolInstance,
  type ShapeDisplayObject,
  type BitmapDisplayObject,
  type BitmapItem,
  type ShapePath,
  type Frame,
  type TraceBitmapOptions,
} from "@flash/core";
import type { UiStoreApi } from "../store/index.js";

export interface ShapeOpHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  docProperties: DocumentProperties;
  timeline: TimelineModel;
  safeActiveLayerIndex: number;
  currentFrame: number;
  selectedShapeId: string | null;
  pushDoc: (doc: FlashDocument) => void;
  withTimeline: (updater: (t: TimelineModel) => TimelineModel) => FlashDocument;
  setSelectedShapeId: (id: string | null) => void;
}

/**
 * Shape operations: Trace Bitmap, Smooth/Optimize, Shape Hints, Flip/Rotate
 * (Modify > Transform), Swap Symbol, Distribute to Layers. Extracted out of
 * Shell verbatim; behaviour-preserving.
 */
export function useShapeOpHandlers(deps: ShapeOpHandlersDeps) {
  const {
    uiStore, doc, docProperties, timeline, safeActiveLayerIndex, currentFrame,
    selectedShapeId, pushDoc, withTimeline, setSelectedShapeId,
  } = deps;
  const setTraceBitmapOpen = uiStore.getState().setTraceBitmapOpen;
  const setSwapSymbolOpen = uiStore.getState().setSwapSymbolOpen;

  const handleTraceBitmapOpen = useCallback(() => {
    if (!selectedShapeId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (!obj || obj.type !== "bitmap") return;
    setTraceBitmapOpen(true);
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame]);

  /**
   * Execute the trace: load bitmap pixel data, run the algorithm, replace the
   * BitmapDisplayObject with ShapeDisplayObjects on the active keyframe.
   */
  const handleTraceBitmapConfirm = useCallback(
    (options: TraceBitmapOptions) => {
      setTraceBitmapOpen(false);
      if (!selectedShapeId) return;

      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= currentFrame)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return;
      const bitmapObj = kf.displayObjects.find((o) => o.id === selectedShapeId);
      if (!bitmapObj || bitmapObj.type !== "bitmap") return;
      const bmpDisp = bitmapObj as BitmapDisplayObject;

      // Find the BitmapItem in the library to get the data URI
      const libItem = doc.library.items.find(
        (i) => i.id === bmpDisp.libraryItemId && i.itemType === "bitmap"
      ) as BitmapItem | undefined;
      if (!libItem || !libItem.dataUri) return;

      // Load the image into an offscreen canvas to extract pixel data
      const img = new window.Image();
      img.onload = () => {
        const w = img.naturalWidth || bmpDisp.width;
        const h = img.naturalHeight || bmpDisp.height;
        if (w === 0 || h === 0) return;

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        // Run the trace algorithm (pure, no DOM)
        const paths: ShapePath[] = traceBitmap(imageData, options);
        if (paths.length === 0) return;

        // Build ShapeDisplayObjects, one per path
        const newShapes: ShapeDisplayObject[] = paths.map((path) => {
          const shapeData = tracePathsToShape([path]);
          const shapeObj: ShapeDisplayObject = {
            type: "shape",
            id: shapeData.id,
            shape: { id: shapeData.id, paths: shapeData.paths },
            x: bmpDisp.x,
            y: bmpDisp.y,
          };
          return shapeObj;
        });

        const layerId = layer.id;
        pushDoc(
          withTimeline((t) => {
            // Remove the original bitmap display object
            let updated = removeDisplayObject(t, layerId, currentFrame, selectedShapeId);
            // Add each traced shape
            for (const shapeObj of newShapes) {
              updated = addDisplayObject(updated, layerId, currentFrame, shapeObj);
            }
            return updated;
          })
        );
        // Select the last added shape so the user can see something was done
        if (newShapes.length > 0) {
          setSelectedShapeId(newShapes[newShapes.length - 1].id);
        }
      };
      img.src = libItem.dataUri;
    },
    [
      selectedShapeId,
      timeline,
      safeActiveLayerIndex,
      currentFrame,
      doc,
      pushDoc,
      withTimeline,
    ]
  );

  // ---------------------------------------------------------------------------
  // Shape > Smooth / Optimize
  // ---------------------------------------------------------------------------

  /**
   * Extract the point sequence from a ShapePath (start + all segment endpoints).
   */
  function extractPathPoints(path: import("@flash/core").ShapePath): Array<{ x: number; y: number }> {
    const pts: Array<{ x: number; y: number }> = [path.start];
    for (const seg of path.segments) {
      pts.push(seg.to);
    }
    return pts;
  }

  /**
   * Modify > Shape > Smooth — re-fits each path in the selected ShapeDisplayObject
   * using the midpoint Catmull-Rom → quadratic Bézier pipeline.
   */
  const handleSmooth = useCallback(() => {
    if (!selectedShapeId) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (!obj || obj.type !== "shape") return;
    const shapeObj = obj as import("@flash/core").ShapeDisplayObject;
    const newPaths = shapeObj.shape.paths.map((path) => {
      const pts = extractPathPoints(path);
      if (pts.length < 2) return path;
      const smoothed = smoothPath(pts, path.closed);
      return {
        ...smoothed,
        ...(path.fill !== undefined ? { fill: path.fill } : {}),
        ...(path.stroke !== undefined ? { stroke: path.stroke } : {}),
      };
    });
    pushDoc(withTimeline((t) =>
      updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
        shape: { ...shapeObj.shape, paths: newPaths },
      })
    ));
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  /**
   * Modify > Shape > Optimize — reduces point count in each path using
   * Ramer-Douglas-Peucker (epsilon = 2.0) and rebuilds as straight-line segments.
   */
  const handleOptimize = useCallback(() => {
    if (!selectedShapeId) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (!obj || obj.type !== "shape") return;
    const shapeObj = obj as import("@flash/core").ShapeDisplayObject;
    const newPaths = shapeObj.shape.paths.map((path) => {
      const pts = extractPathPoints(path);
      if (pts.length < 2) return path;
      const simplified = simplifyPath(pts, 2.0);
      if (simplified.length < 2) return path;
      const [start, ...rest] = simplified;
      return {
        start,
        segments: rest.map((pt) => ({ type: "line" as const, to: pt })),
        closed: path.closed,
        ...(path.fill !== undefined ? { fill: path.fill } : {}),
        ...(path.stroke !== undefined ? { stroke: path.stroke } : {}),
      };
    });
    pushDoc(withTimeline((t) =>
      updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
        shape: { ...shapeObj.shape, paths: newPaths },
      })
    ));
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  // ---------------------------------------------------------------------------
  // Shape hints — Modify > Shape > Add Shape Hint (Ctrl+Shift+H)
  // ---------------------------------------------------------------------------

  /**
   * Add a shape hint to the governing keyframe at the current frame on the
   * active layer. The hint is placed at the centre of the stage by default.
   * Only meaningful on a keyframe that is part of a shape tween span.
   */
  const handleAddShapeHint = useCallback(() => {
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) =>
      addShapeHint(t, layerId, currentFrame,
        Math.round(docProperties.width / 2),
        Math.round(docProperties.height / 2))
    ));
  }, [timeline, safeActiveLayerIndex, currentFrame, docProperties, pushDoc, withTimeline]);

  /**
   * Move a shape hint to a new position (called while dragging a hint circle).
   * Commits to undo history immediately (one entry per drag-end).
   */
  const handleUpdateShapeHint = useCallback((hintId: string, x: number, y: number) => {
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    pushDoc(withTimeline((t) =>
      updateShapeHint(t, layerId, currentFrame, hintId, x, y)
    ));
  }, [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  // ---------------------------------------------------------------------------
  // Transform (Flip / Rotate) — Modify > Transform submenu
  // ---------------------------------------------------------------------------

  /**
   * Apply a scale/rotation delta to the selected display object.
   * Works for any DisplayObject type that carries scaleX/scaleY/rotation fields.
   */
  const applyTransformDelta = useCallback(
    (scaleXDelta: number, scaleYDelta: number, rotationDelta: number) => {
      if (!selectedShapeId) return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= currentFrame)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return;
      const obj = kf.displayObjects.find((o) => o.id === selectedShapeId);
      if (!obj) return;
      const currentScaleX = (obj as { scaleX?: number }).scaleX ?? 1;
      const currentScaleY = (obj as { scaleY?: number }).scaleY ?? 1;
      const currentRotation = (obj as { rotation?: number }).rotation ?? 0;
      const newRotation = ((currentRotation + rotationDelta) % 360 + 360) % 360;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedShapeId, {
          scaleX: currentScaleX * scaleXDelta,
          scaleY: currentScaleY * scaleYDelta,
          rotation: newRotation,
        })
      ));
    },
    [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  /** Modify > Transform > Flip Horizontal — negate scaleX. */
  const handleFlipHorizontal = useCallback(
    () => applyTransformDelta(-1, 1, 0),
    [applyTransformDelta]
  );

  /** Modify > Transform > Flip Vertical — negate scaleY. */
  const handleFlipVertical = useCallback(
    () => applyTransformDelta(1, -1, 0),
    [applyTransformDelta]
  );

  /** Modify > Transform > Rotate 90° CW — add 90° to rotation. */
  const handleRotate90CW = useCallback(
    () => applyTransformDelta(1, 1, 90),
    [applyTransformDelta]
  );

  /** Modify > Transform > Rotate 90° CCW — subtract 90° from rotation. */
  const handleRotate90CCW = useCallback(
    () => applyTransformDelta(1, 1, -90),
    [applyTransformDelta]
  );

  /** Modify > Transform > Rotate 180° — add 180° to rotation. */
  const handleRotate180 = useCallback(
    () => applyTransformDelta(1, 1, 180),
    [applyTransformDelta]
  );

  // ---------------------------------------------------------------------------
  // Swap Symbol
  // ---------------------------------------------------------------------------

  /**
   * Open the Swap Symbol dialog (only when a single SymbolInstance is selected).
   */
  const handleSwapSymbol = useCallback(() => {
    if (!selectedShapeId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const selected = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (!selected || selected.type !== "instance") return;
    setSwapSymbolOpen(true);
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame]);

  /**
   * Perform the swap after the dialog is confirmed.
   * Preserves position, transform, name, and all other properties — only symbolId changes.
   */
  const handleSwapSymbolConfirm = useCallback((newSymbolId: string) => {
    if (!selectedShapeId) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const selected = kf.displayObjects.find((o) => o.id === selectedShapeId);
    if (!selected || selected.type !== "instance") return;

    pushDoc(withTimeline((t) => ({
      ...t,
      layers: t.layers.map((l) => {
        if (l.id !== layer.id) return l;
        return {
          ...l,
          frames: l.frames.map((f) => {
            if (!f.isKeyframe || f.index !== kf.index) return f;
            return {
              ...f,
              displayObjects: f.displayObjects.map((o) =>
                o.id === selectedShapeId
                  ? { ...(o as SymbolInstance), symbolId: newSymbolId }
                  : o
              ),
            };
          }),
        };
      }),
    })));

    setSwapSymbolOpen(false);
  }, [selectedShapeId, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  // ---------------------------------------------------------------------------
  // Distribute to Layers
  // ---------------------------------------------------------------------------

  /**
   * Flash 8 "Distribute to Layers": each selected display object on the current
   * layer is moved to its own new layer. The first object stays on the original
   * layer; subsequent objects each get a new layer inserted immediately after.
   * Layer names are taken from the symbol name (for SymbolInstances) or "Layer N".
   */
  const handleDistributeToLayers = useCallback(() => {
    const layerIdx = safeActiveLayerIndex;
    const layer = timeline.layers[layerIdx];
    if (!layer) return;

    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;

    const objects = kf.displayObjects;
    // Need at least 2 objects to distribute
    if (objects.length < 2) return;

    // Helper: get a display name for an object
    const getObjectName = (o: DisplayObject, idx: number): string => {
      if (o.type === "instance") {
        const sym = doc.library.items.find(
          (i) => i.id === (o as SymbolInstance).symbolId && i.itemType === "symbol"
        );
        if (sym) return sym.name;
      }
      return `Layer ${idx + 1}`;
    };

    // Build a new timeline:
    // 1. The original layer keeps only the first object (objects[0]).
    // 2. For each remaining object, insert a new layer after the original layer.

    const layerId = layer.id;
    const kfIndex = kf.index;

    pushDoc(withTimeline((t) => {
      const tLayer = t.layers.find((l) => l.id === layerId);
      if (!tLayer) return t;

      // Update original layer's keyframe to hold only the first object
      const updatedOriginalLayer = {
        ...tLayer,
        frames: tLayer.frames.map((f) => {
          if (!f.isKeyframe || f.index !== kfIndex) return f;
          return { ...f, displayObjects: [objects[0]] };
        }),
      };

      // Create new layers for objects[1..n]
      const newLayers = objects.slice(1).map((obj, i) => {
        const name = getObjectName(obj, layerIdx + i + 1);
        // createLayer gives us a fresh layer with a blank keyframe
        const freshLayer = createLayer(name);
        // Replace the default frame with one that holds this object
        const frame: Frame = {
          ...freshLayer.frames[0],
          displayObjects: [obj],
          isEmpty: false,
        };
        return { ...freshLayer, frames: [frame] };
      });

      // Insert new layers right after the original layer in the layers array
      const layers = [...t.layers];
      const origIdx = layers.findIndex((l) => l.id === layerId);
      if (origIdx < 0) return t;

      layers[origIdx] = updatedOriginalLayer;
      // Insert new layers after the original layer (in order)
      layers.splice(origIdx + 1, 0, ...newLayers);

      return { ...t, layers };
    }));

    // Deselect (objects now live on different layers)
    setSelectedShapeId(null);
  }, [safeActiveLayerIndex, timeline, currentFrame, pushDoc, withTimeline, doc.library]);


  return {
    handleTraceBitmapOpen, handleTraceBitmapConfirm, handleSmooth, handleOptimize,
    handleAddShapeHint, handleUpdateShapeHint, handleFlipHorizontal, handleFlipVertical,
    handleRotate90CW, handleRotate90CCW, handleRotate180, handleSwapSymbol,
    handleSwapSymbolConfirm, handleDistributeToLayers,
  };
}
