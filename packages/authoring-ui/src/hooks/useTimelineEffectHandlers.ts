import { useCallback, type MutableRefObject } from "react";
import {
  getUnionBounds,
  createSymbolInLibrary,
  insertKeyframe,
  setMotionTween,
  type FlashDocument,
  type Timeline as TimelineModel,
  type SymbolInstance,
} from "@flash/core";
import type { EffectParams, TimelineEffectType } from "../TimelineEffectDialog";
import type { UiStoreApi, EditContext } from "../store/index.js";

export interface TimelineEffectHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  timeline: TimelineModel;
  editContext: EditContext;
  activeSceneIndex: number;
  safeActiveLayerIndex: number;
  currentFrame: number;
  selectedShapeId: string | null;
  pushDoc: (doc: FlashDocument) => void;
  setSelectedShapeId: (id: string | null) => void;
  timelineEffectCounterRef: MutableRefObject<number>;
}

/**
 * Timeline Effects (Insert > Timeline Effects): wrap the selection in a new
 * MovieClip and lay down the effect's keyframes/tween (transform, transition,
 * blur, drop-shadow, expand, explode, copy-to-grid, distributed-duplicate).
 * Extracted out of Shell verbatim; behaviour-preserving.
 */
export function useTimelineEffectHandlers(deps: TimelineEffectHandlersDeps) {
  const {
    uiStore, doc, timeline, editContext, activeSceneIndex, safeActiveLayerIndex,
    currentFrame, selectedShapeId, pushDoc, setSelectedShapeId, timelineEffectCounterRef,
  } = deps;
  const setTimelineEffectInitial = uiStore.getState().setTimelineEffectInitial;
  const setTimelineEffectOpen = uiStore.getState().setTimelineEffectOpen;

  const handleOpenTimelineEffect = useCallback((effectType: TimelineEffectType) => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf || kf.displayObjects.length === 0) return;
    setTimelineEffectInitial(effectType);
    setTimelineEffectOpen(true);
  }, [timeline, safeActiveLayerIndex, currentFrame, setTimelineEffectInitial, setTimelineEffectOpen]);

  const handleApplyTimelineEffect = useCallback((params: EffectParams) => {
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
    if (objectsToConvert.length === 0) return;

    // --- Build the symbol name -----------------------------------------
    timelineEffectCounterRef.current += 1;
    const effectLabelMap: Record<string, string> = {
      "transform": "Transform",
      "transition": "Transition",
      "blur": "Blur",
      "drop-shadow": "DropShadow",
      "expand": "Expand",
      "explode": "Explode",
      "copy-to-grid": "Grid",
      "distributed-duplicate": "Duplicate",
    };
    const effectLabel = effectLabelMap[params.effect] ?? params.effect;
    const symbolName = `${effectLabel} ${timelineEffectCounterRef.current}`;

    // --- Compute bounding box of the selection -------------------------
    const selectionBounds = getUnionBounds([...objectsToConvert]);
    const originX = selectionBounds ? selectionBounds.x + selectionBounds.width / 2 : 0;
    const originY = selectionBounds ? selectionBounds.y + selectionBounds.height / 2 : 0;

    // Rebase objects relative to the symbol origin (center)
    const symbolObjects = objectsToConvert.map((o) => ({
      ...o,
      x: o.x - originX,
      y: o.y - originY,
    }));

    // --- Create the symbol in the library ------------------------------
    const { library: libWithSym, item: newSymbol } = createSymbolInLibrary(
      doc.library,
      symbolName,
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
      ...libWithSym,
      items: libWithSym.items.map((i) => (i.id === newSymbol.id ? symbolWithObjects : i)),
    };

    // --- Determine instance natural size -------------------------------
    const symbolUnionBounds = getUnionBounds([...symbolObjects]);
    const symNatW = symbolUnionBounds?.width ?? 0;
    const symNatH = symbolUnionBounds?.height ?? 0;

    // ---------------------------------------------------------------------------
    // Copy to Grid — purely spatial, no tween
    // ---------------------------------------------------------------------------
    if (params.effect === "copy-to-grid") {
      const { rows, columns, rowSpacing, columnSpacing } = params;
      const convertedIds = new Set(objectsToConvert.map((o) => o.id));
      const ts = Date.now().toString(36);
      const newInstances: SymbolInstance[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const gridInstId = `effect-inst-${ts}-${r}-${c}`;
          const cellX = originX + c * ((symNatW > 0 ? symNatW : 0) + columnSpacing);
          const cellY = originY + r * ((symNatH > 0 ? symNatH : 0) + rowSpacing);
          newInstances.push({
            type: "instance",
            id: gridInstId,
            symbolId: newSymbol.id,
            x: cellX,
            y: cellY,
            ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
            ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
          });
        }
      }

      const applyGridToTimeline = (t: TimelineModel): TimelineModel => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter((o) => !convertedIds.has(o.id));
              return { ...f, displayObjects: [...remaining, ...newInstances] as readonly import("@flash/core").DisplayObject[], isEmpty: false };
            }) as readonly import("@flash/core").Frame[],
          };
        }) as readonly import("@flash/core").Layer[],
      });

      let newDocGrid: FlashDocument;
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const items = finalLib.items.map((item) => {
          if (item.id === editContext.symbolId && item.itemType === "symbol") {
            return { ...item, timeline: applyGridToTimeline(item.timeline) };
          }
          return item;
        });
        newDocGrid = { ...doc, library: { ...finalLib, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
        newDocGrid = {
          ...doc,
          scenes: doc.scenes.map((s, i) =>
            i === sceneIdx ? { ...s, timeline: applyGridToTimeline(s.timeline) } : s
          ),
          library: finalLib,
        };
      }

      pushDoc(newDocGrid);
      setSelectedShapeId(newInstances[0]?.id ?? null);
      setTimelineEffectOpen(false);
      return;
    }

    // ---------------------------------------------------------------------------
    // Distributed Duplicate — no tween, progressive offset/scale/alpha
    // ---------------------------------------------------------------------------
    if (params.effect === "distributed-duplicate") {
      const { count, offsetX, offsetY, scaleTo, alphaTo, rotateTo } = params;
      const convertedIds = new Set(objectsToConvert.map((o) => o.id));
      const ts = Date.now().toString(36);
      const newInstances: SymbolInstance[] = [];
      for (let i = 0; i < count; i++) {
        const frac = count > 1 ? i / (count - 1) : 0;
        const instIdDup = `effect-inst-${ts}-dup-${i}`;
        const cx = originX + offsetX * i;
        const cy = originY + offsetY * i;
        const sc = 1 + (scaleTo / 100 - 1) * frac;
        const al = 100 + (alphaTo - 100) * frac;
        const rot = rotateTo * frac;
        newInstances.push({
          type: "instance",
          id: instIdDup,
          symbolId: newSymbol.id,
          x: cx,
          y: cy,
          ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
          ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
          ...(sc !== 1 ? { scaleX: sc, scaleY: sc } : {}),
          ...(al !== 100 ? { colorEffect: { type: "alpha" as const, alpha: al } } : {}),
          ...(rot !== 0 ? { rotation: rot } : {}),
        });
      }

      const applyDupToTimeline = (t: TimelineModel): TimelineModel => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter((o) => !convertedIds.has(o.id));
              return { ...f, displayObjects: [...remaining, ...newInstances] as readonly import("@flash/core").DisplayObject[], isEmpty: false };
            }) as readonly import("@flash/core").Frame[],
          };
        }) as readonly import("@flash/core").Layer[],
      });

      let newDocDup: FlashDocument;
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const items = finalLib.items.map((item) => {
          if (item.id === editContext.symbolId && item.itemType === "symbol") {
            return { ...item, timeline: applyDupToTimeline(item.timeline) };
          }
          return item;
        });
        newDocDup = { ...doc, library: { ...finalLib, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
        newDocDup = {
          ...doc,
          scenes: doc.scenes.map((s, i) =>
            i === sceneIdx ? { ...s, timeline: applyDupToTimeline(s.timeline) } : s
          ),
          library: finalLib,
        };
      }

      pushDoc(newDocDup);
      setSelectedShapeId(newInstances[0]?.id ?? null);
      setTimelineEffectOpen(false);
      return;
    }

    // ---------------------------------------------------------------------------
    // Blur — blur-filter tween 0 -> max -> 0 across three keyframes.
    //
    // Unlike the other tween effects (a single start->end motion tween), Blur
    // ramps a flash.filters.BlurFilter up to its peak at the midpoint of the
    // span and back down to zero, so the object visibly blurs and re-sharpens.
    // The filter is interpolated every frame by the tween engine
    // (interpolateFilters in @flash/core) and emitted per-frame as a
    // PlaceObject3 by the SWF compiler, producing a smooth runtime blur.
    // ---------------------------------------------------------------------------
    if (params.effect === "blur") {
      const blurInstId = `effect-inst-${Date.now().toString(36)}`;
      const convertedIdsBlur = new Set(objectsToConvert.map((o) => o.id));
      const easeBlur = params.ease ?? 0;

      // Three keyframes: start (currentFrame), mid (peak blur), end.
      // For an N-frame span the midpoint is the geometric middle frame.
      const startFrame = currentFrame;
      const endFrame = currentFrame + params.duration - 1;
      const midFrame =
        params.duration >= 3
          ? currentFrame + Math.floor((params.duration - 1) / 2)
          : -1; // too short for a distinct peak — single 0->max ramp

      const makeBlurFilter = (bx: number, by: number) =>
        [{ type: "blur" as const, blurX: bx, blurY: by, quality: 1 as const, enabled: true }];

      // Base instance (shared transform; per-keyframe filters applied below).
      const baseBlurInstance: SymbolInstance = {
        type: "instance",
        id: blurInstId,
        symbolId: newSymbol.id,
        x: originX,
        y: originY,
        ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
        ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
      };

      // The start keyframe carries a zero-blur filter so the interpolator has a
      // matching blur filter at both ends of every span (filters interpolate by
      // position; a missing filter on one side disables interpolation).
      const startBlurInstance = {
        ...baseBlurInstance,
        filters: makeBlurFilter(0, 0),
      } as SymbolInstance;

      const peakBlurInstance = {
        ...baseBlurInstance,
        filters: makeBlurFilter(params.blurX, params.blurY),
      } as SymbolInstance;

      const endBlurInstance = {
        ...baseBlurInstance,
        filters: makeBlurFilter(0, 0),
      } as SymbolInstance;

      const setInstanceOnKeyframe = (
        t: TimelineModel,
        frameIndex: number,
        inst: SymbolInstance
      ): TimelineModel => ({
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) =>
              f.isKeyframe && f.index === frameIndex
                ? {
                    ...f,
                    displayObjects: f.displayObjects.map((o) =>
                      o.id === blurInstId ? inst : o
                    ),
                  }
                : f
            ) as readonly import("@flash/core").Frame[],
          };
        }) as readonly import("@flash/core").Layer[],
      });

      const applyBlurToTimeline = (t: TimelineModel): TimelineModel => {
        // 1. Replace the originals with the start (zero-blur) instance.
        let result: TimelineModel = {
          ...t,
          layers: t.layers.map((l) => {
            if (l.id !== layerId) return l;
            const frames = l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== kf.index) return f;
              const remaining = f.displayObjects.filter((o) => !convertedIdsBlur.has(o.id));
              return {
                ...f,
                displayObjects: [...remaining, startBlurInstance] as readonly import("@flash/core").DisplayObject[],
                isEmpty: false,
              };
            }) as readonly import("@flash/core").Frame[];
            return { ...l, frames };
          }) as readonly import("@flash/core").Layer[],
        };

        if (midFrame > startFrame && midFrame < endFrame) {
          // 0 -> max (peak) -> 0 across three keyframes, motion-tweened.
          result = insertKeyframe(result, layerId, midFrame);
          result = insertKeyframe(result, layerId, endFrame);
          result = setInstanceOnKeyframe(result, midFrame, peakBlurInstance);
          result = setInstanceOnKeyframe(result, endFrame, endBlurInstance);
          result = setMotionTween(result, layerId, startFrame, easeBlur);
          result = setMotionTween(result, layerId, midFrame, easeBlur);
        } else {
          // Span too short for a distinct peak: single 0 -> max ramp.
          result = insertKeyframe(result, layerId, endFrame);
          result = setInstanceOnKeyframe(result, endFrame, peakBlurInstance);
          result = setMotionTween(result, layerId, startFrame, easeBlur);
        }
        return result;
      };

      let newDocBlur: FlashDocument;
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const items = finalLib.items.map((item) => {
          if (item.id === editContext.symbolId && item.itemType === "symbol") {
            return { ...item, timeline: applyBlurToTimeline(item.timeline) };
          }
          return item;
        });
        newDocBlur = { ...doc, library: { ...finalLib, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
        newDocBlur = {
          ...doc,
          scenes: doc.scenes.map((s, i) =>
            i === sceneIdx ? { ...s, timeline: applyBlurToTimeline(s.timeline) } : s
          ),
          library: finalLib,
        };
      }

      pushDoc(newDocBlur);
      setSelectedShapeId(blurInstId);
      setTimelineEffectOpen(false);
      return;
    }

    // ---------------------------------------------------------------------------
    // Tween-based effects: Transform, Transition, Drop Shadow, Expand, Explode
    // ---------------------------------------------------------------------------

    // --- Build the START instance (frame 0 = currentFrame) ------------
    const instId = `effect-inst-${Date.now().toString(36)}`;

    // Start alpha: for Transition In, start at 0; for Transform & Transition Out, start at 1
    const startAlpha: number | undefined = (() => {
      if (params.effect === "transition" && params.direction === "in") return 0;
      return undefined; // 1 (fully opaque) by default
    })();

    const startInstance: SymbolInstance = {
      type: "instance",
      id: instId,
      symbolId: newSymbol.id,
      x: originX,
      y: originY,
      ...(symNatW > 0 ? { naturalWidth: symNatW } : {}),
      ...(symNatH > 0 ? { naturalHeight: symNatH } : {}),
      ...(startAlpha !== undefined ? { colorEffect: { type: "alpha", alpha: startAlpha * 100 } } : {}),
    };

    // --- Build the END keyframe instance properties -------------------
    const endFrameIndex = currentFrame + params.duration - 1;

    // Build as a plain object then cast — SymbolInstance is all-readonly so we
    // cannot assign to Partial<SymbolInstance> directly.
    const endUpdatesBuilder: {
      scaleX?: number;
      scaleY?: number;
      rotation?: number;
      colorEffect?: import("@flash/core").ColorEffect;
    } = {};
    if (params.effect === "transform") {
      if (params.scaleX !== 1 || params.scaleY !== 1) {
        endUpdatesBuilder.scaleX = params.scaleX;
        endUpdatesBuilder.scaleY = params.scaleY;
      }
      if (params.rotation !== 0) {
        endUpdatesBuilder.rotation = params.rotation;
      }
      if (params.alpha !== 100) {
        endUpdatesBuilder.colorEffect = { type: "alpha", alpha: params.alpha };
      }
    } else if (params.effect === "transition") {
      const endAlpha = params.direction === "out" ? 0 : 100;
      endUpdatesBuilder.colorEffect = { type: "alpha", alpha: endAlpha };
    } else if (params.effect === "drop-shadow") {
      // Drop shadow: tween alpha to the specified end alpha
      if (params.alpha !== 100) {
        endUpdatesBuilder.colorEffect = { type: "alpha", alpha: params.alpha };
      }
    } else if (params.effect === "expand") {
      // Expand: scale from 0 (contract) or to 0 (contract) depending on direction
      if (params.direction === "expand") {
        // Start small, end at natural size — set start instance to 0 scale
        // We apply endUpdates as-is (natural size = no override needed)
        // and the start instance needs scaleX=0,scaleY=0 — patch startInstance below
      } else {
        // Contract: start at natural size (default), end at scale 0
        endUpdatesBuilder.scaleX = 0;
        endUpdatesBuilder.scaleY = 0;
      }
      // Apply any position shift at end
      if (params.shiftX !== 0 || params.shiftY !== 0) {
        // shiftX/Y are stored separately; we'll apply them to the end instance via x/y override
      }
    } else if (params.effect === "explode") {
      // Explode: scale up and fade out
      endUpdatesBuilder.scaleX = 2;
      endUpdatesBuilder.scaleY = 2;
      endUpdatesBuilder.rotation = params.arcSize;
      if (params.finalAlpha !== 100) {
        endUpdatesBuilder.colorEffect = { type: "alpha", alpha: params.finalAlpha };
      }
    }
    const endInstanceUpdates = endUpdatesBuilder as Partial<SymbolInstance>;

    // For "expand" direction, we need to set start instance scale to near-0
    const expandStart = params.effect === "expand" && params.direction === "expand";
    const actualStartInstance: SymbolInstance = expandStart
      ? { ...startInstance, scaleX: 0.01, scaleY: 0.01 }
      : startInstance;

    // For "expand" with shiftX/shiftY, the end instance needs a position offset
    const expandShiftX = params.effect === "expand" ? params.shiftX : 0;
    const expandShiftY = params.effect === "expand" ? params.shiftY : 0;

    // --- Build the updated document -----------------------------------
    const convertedIds = new Set(objectsToConvert.map((o) => o.id));
    const ease = (params as { ease?: number }).ease ?? 0;

    const applyToTimeline = (t: TimelineModel): TimelineModel => {
      // 1. Replace original objects with the start instance in the current keyframe
      let result: TimelineModel = {
        ...t,
        layers: t.layers.map((l) => {
          if (l.id !== layerId) return l;
          const frames = l.frames.map((f) => {
            if (!f.isKeyframe || f.index !== kf.index) return f;
            const remaining = f.displayObjects.filter((o) => !convertedIds.has(o.id));
            return { ...f, displayObjects: [...remaining, actualStartInstance] as readonly import("@flash/core").DisplayObject[], isEmpty: false };
          }) as readonly import("@flash/core").Frame[];
          return { ...l, frames };
        }) as readonly import("@flash/core").Layer[],
      };

      // 2. Insert a keyframe at endFrameIndex (copies content from start)
      result = insertKeyframe(result, layerId, endFrameIndex);

      // 3. Update the END keyframe with the effect's end properties
      result = {
        ...result,
        layers: result.layers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            frames: l.frames.map((f) => {
              if (!f.isKeyframe || f.index !== endFrameIndex) return f;
              const newObjs: readonly import("@flash/core").DisplayObject[] = f.displayObjects.map((o) => {
                if (o.id !== instId) return o;
                const updated: import("@flash/core").DisplayObject = {
                  ...o,
                  ...endInstanceUpdates,
                  x: (o as SymbolInstance).x + expandShiftX,
                  y: (o as SymbolInstance).y + expandShiftY,
                } as import("@flash/core").DisplayObject;
                return updated;
              });
              return { ...f, displayObjects: newObjs };
            }),
          };
        }) as readonly import("@flash/core").Layer[],
      };

      // 4. Set motion tween on the START keyframe
      result = setMotionTween(result, layerId, kf.index, ease);

      return result;
    };

    // Apply to the right timeline context
    let newDoc: FlashDocument;
    if (editContext.mode === "symbol" && editContext.symbolId) {
      const items = finalLib.items.map((item) => {
        if (item.id === editContext.symbolId && item.itemType === "symbol") {
          return { ...item, timeline: applyToTimeline(item.timeline) };
        }
        return item;
      });
      newDoc = { ...doc, library: { ...finalLib, items } };
    } else {
      const sceneIdx = Math.min(activeSceneIndex, doc.scenes.length - 1);
      newDoc = {
        ...doc,
        scenes: doc.scenes.map((s, i) =>
          i === sceneIdx ? { ...s, timeline: applyToTimeline(s.timeline) } : s
        ),
        library: finalLib,
      };
    }

    pushDoc(newDoc);
    setSelectedShapeId(instId);
    setTimelineEffectOpen(false);
  }, [
    timeline, safeActiveLayerIndex, currentFrame, selectedShapeId,
    doc, editContext, activeSceneIndex, pushDoc, setSelectedShapeId,
    setTimelineEffectOpen, timelineEffectCounterRef,
  ]);

  return { handleOpenTimelineEffect, handleApplyTimelineEffect };
}
