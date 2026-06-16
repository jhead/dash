import { useCallback } from "react";
import {
  getUnionBounds,
  createSymbolInLibrary,
  breakApart,
  type FlashDocument,
  type Timeline as TimelineModel,
  type DisplayObject,
  type SymbolInstance,
  type ShapeDisplayObject,
  type DrawingObject,
  type SymbolType,
} from "@flash/core";
import type { RegistrationPoint } from "../ConvertToSymbolDialog";
import { nextGroupName } from "../idgen.js";
import type { UiStoreApi, EditContext } from "../store/index.js";

export interface ShapeModifyHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  timeline: TimelineModel;
  editContext: EditContext;
  activeSceneIndex: number;
  safeActiveLayerIndex: number;
  currentFrame: number;
  selectedShapeId: string | null;
  pushDoc: (doc: FlashDocument) => void;
  withTimeline: (updater: (t: TimelineModel) => TimelineModel) => FlashDocument;
  setSelectedShapeId: (id: string | null) => void;
}

/**
 * Modify-menu shape operations: Convert to Symbol, Arrange (z-order), Group,
 * Ungroup, Break Apart. Extracted out of Shell verbatim; behaviour-preserving.
 */
export function useShapeModifyHandlers(deps: ShapeModifyHandlersDeps) {
  const {
    uiStore, doc, timeline, editContext, activeSceneIndex, safeActiveLayerIndex,
    currentFrame, selectedShapeId, pushDoc, withTimeline, setSelectedShapeId,
  } = deps;
  const setConvertToSymbolOpen = uiStore.getState().setConvertToSymbolOpen;

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
  const handleConvertToSymbolConfirm = useCallback((name: string, symbolType: SymbolType, registration: RegistrationPoint = "center") => {
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

    // Compute the true visual bounding box of the selection
    const selectionBounds = getUnionBounds(objectsToConvert as DisplayObject[]);
    const bx = selectionBounds?.x ?? 0;
    const by = selectionBounds?.y ?? 0;
    const bw = selectionBounds?.width ?? 0;
    const bh = selectionBounds?.height ?? 0;

    // Derive registration origin from the chosen anchor position
    const originX = registration.includes("right")
      ? bx + bw
      : registration.includes("left")
        ? bx
        : bx + bw / 2;
    const originY = registration.includes("bottom")
      ? by + bh
      : registration.includes("top")
        ? by
        : by + bh / 2;

    // Objects repositioned relative to the symbol's origin
    const symbolObjects = objectsToConvert.map((o) => ({
      ...o,
      x: o.x - originX,
      y: o.y - originY,
    }));

    // Pre-compute instId so we can select the new instance after pushDoc
    const instId = `inst-${Date.now().toString(36)}`;

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

      // Compute natural size from the symbol's local objects
      const symbolUnionBounds = getUnionBounds([...symbolObjects]);
      const symNatW = symbolUnionBounds?.width ?? 0;
      const symNatH = symbolUnionBounds?.height ?? 0;

      // Create the SymbolInstance to replace the selection on the timeline
      const instance: SymbolInstance = {
        type: "instance",
        id: instId,
        symbolId: newSymbol.id,
        x: originX,
        y: originY,
        ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
        ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
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

    setSelectedShapeId(instId);
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
      const groupUnionBounds = getUnionBounds([...symbolObjects]);
      const groupNatW = groupUnionBounds?.width ?? 0;
      const groupNatH = groupUnionBounds?.height ?? 0;
      const instance: SymbolInstance = {
        type: "instance",
        id: instId,
        symbolId: newSymbol.id,
        x: centerX,
        y: centerY,
        ...(groupNatW > 0 ? { naturalWidth: groupNatW } : {}),
        ...(groupNatH > 0 ? { naturalHeight: groupNatH } : {}),
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
  // Break Apart
  // ---------------------------------------------------------------------------

  const handleBreakApart = useCallback(() => {
    if (!selectedShapeId) return;
    if (editContext.mode === "symbol" && editContext.symbolId) {
      // Symbol editing context: use withTimeline to update the symbol's timeline
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= currentFrame)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return;
      const selected = kf.displayObjects.find((o) => o.id === selectedShapeId);
      if (!selected) return;

      // DrawingObject in symbol editing context: convert to plain ShapeDisplayObject
      if (selected.type === "drawing-object") {
        const drawObj = selected as DrawingObject;
        const asShape: ShapeDisplayObject = {
          type: "shape",
          id: drawObj.id,
          shape: drawObj.shape,
          x: drawObj.x,
          y: drawObj.y,
        };
        const layerId = layer.id;
        pushDoc(withTimeline((t) => ({
          ...t,
          layers: t.layers.map((l) => {
            if (l.id !== layerId) return l;
            return {
              ...l,
              frames: l.frames.map((f) => {
                if (!f.isKeyframe || f.index !== kf.index) return f;
                return {
                  ...f,
                  displayObjects: f.displayObjects.map((o) => o.id === drawObj.id ? asShape : o),
                };
              }),
            };
          }),
        })));
        // Keep the same ID selected (now it's a shape)
        return;
      }

      if (selected.type !== "instance") return;
      const inst = selected as SymbolInstance;
      const symbol = doc.library.items.find(
        (i) => i.id === inst.symbolId && i.itemType === "symbol"
      );
      if (!symbol || symbol.itemType !== "symbol") return;
      const symLayer = symbol.timeline.layers[0];
      if (!symLayer) return;
      const symKf = [...symLayer.frames]
        .filter((f) => f.isKeyframe)
        .sort((a, b) => a.index - b.index)[0];
      if (!symKf) return;
      const extracted: DisplayObject[] = symKf.displayObjects.map((o) => ({
        ...o,
        id: `breakapart-${o.id}-${Date.now().toString(36)}`,
        x: o.x + inst.x,
        y: o.y + inst.y,
      }));
      const layerId = layer.id;
      pushDoc(withTimeline((t) => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter((o) => o.id !== inst.id);
              return { ...f, displayObjects: [...remaining, ...extracted] };
            }),
          };
        }),
      })));
      setSelectedShapeId(extracted.length > 0 ? extracted[extracted.length - 1].id : null);
    } else {
      // Document (scene) context: delegate to core breakApart
      const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
      const newDoc = breakApart(doc, sceneIdx, safeActiveLayerIndex, currentFrame, selectedShapeId);
      if (newDoc !== doc) {
        pushDoc(newDoc);
        // For drawing-object→shape conversion the ID is preserved; keep it selected.
        // For instance→children extraction the instance is gone; clear selection.
        const wasDrawingObject = ((): boolean => {
          const layer = timeline.layers[safeActiveLayerIndex];
          if (!layer) return false;
          const kf = [...layer.frames]
            .filter((f) => f.isKeyframe && f.index <= currentFrame)
            .sort((a, b) => b.index - a.index)[0];
          if (!kf) return false;
          return kf.displayObjects.find((o) => o.id === selectedShapeId)?.type === "drawing-object";
        })();
        if (!wasDrawingObject) setSelectedShapeId(null);
      }
    }
  }, [selectedShapeId, editContext, timeline, safeActiveLayerIndex, currentFrame, doc, pushDoc, withTimeline, activeSceneIndex]);


  return {
    handleConvertToSymbol,
    handleConvertToSymbolConfirm,
    handleArrange,
    handleGroup,
    handleUngroup,
    handleBreakApart,
  };
}
