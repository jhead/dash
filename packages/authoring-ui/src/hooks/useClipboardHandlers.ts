import { useCallback, useRef } from "react";
import {
  commitShapeToTimeline,
  getGoverningKeyframe,
  copyFrames,
  removeFrame,
  pasteFrames,
  reverseFrames,
  type FlashDocument,
  type Timeline as TimelineModel,
  type DisplayObject,
  type Frame,
} from "@flash/core";
import { clipboard } from "../clipboardState.js";
import type { UiStoreApi, EditContext, SelectedFrameRange } from "../store/index.js";

export interface ClipboardHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  timeline: TimelineModel;
  editContext: EditContext;
  activeSceneIndex: number;
  safeActiveLayerIndex: number;
  currentFrame: number;
  selectedShapeIds: string[];
  selectedFrameRange: SelectedFrameRange | null;
  pushDoc: (doc: FlashDocument) => void;
  withTimeline: (updater: (t: TimelineModel) => TimelineModel) => FlashDocument;
  handleDeleteSelected: () => void;
}

/**
 * Clipboard operations: object copy/cut/paste/duplicate, Copy/Paste Motion, and
 * Timeline frame copy/cut/remove/paste/reverse. Object + motion clipboards live
 * in clipboardState; the frame clipboard is a hook-local ref. Verbatim.
 */
export function useClipboardHandlers(deps: ClipboardHandlersDeps) {
  const {
    uiStore, doc, timeline, editContext, activeSceneIndex, safeActiveLayerIndex,
    currentFrame, selectedShapeIds, selectedFrameRange, pushDoc, withTimeline, handleDeleteSelected,
  } = deps;
  const setSelectedShapeIds = uiStore.getState().setSelectedShapeIds;
  const setHasMotionClipboard = uiStore.getState().setHasMotionClipboard;
  const setHasFrameClipboard = uiStore.getState().setHasFrameClipboard;

  const handleCopy = useCallback(() => {
    if (selectedShapeIds.length === 0) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index <= currentFrame)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) return;
    const objs = kf.displayObjects.filter((o) => selectedShapeIds.includes(o.id));
    if (objs.length > 0) clipboard.items = objs;
  }, [selectedShapeIds, timeline, safeActiveLayerIndex, currentFrame]);

  /** Cut: copy then delete the selected display object(s). */
  const handleCut = useCallback(() => {
    if (selectedShapeIds.length === 0) return;
    handleCopy();
    handleDeleteSelected();
  }, [selectedShapeIds, handleCopy, handleDeleteSelected]);

  /** Paste: add clipboard items to the active keyframe with an optional +10/+10 offset. */
  const handlePaste = useCallback((inPlace = false) => {
    if (clipboard.items.length === 0) return;
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) return;
    const pastedIds: string[] = [];
    let newDoc = doc;
    for (const item of clipboard.items) {
      const newId = `paste-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const pasted: DisplayObject = {
        ...item,
        id: newId,
        ...(inPlace ? {} : { x: (item.x ?? 0) + 10, y: (item.y ?? 0) + 10 }),
      };
      // Apply the timeline mutation to accumulate multi-item pastes. Route
      // through the SHARED merge-on-commit helper (docs/36-vector-merge-model.md)
      // so a pasted merge-mode shape (type:"shape") folds into the layer's planar
      // arrangement identically to the interactive draw path (union / cut /
      // line-split); pasted non-shapes (symbol instances, drawing-objects, text,
      // bitmaps) append as-is — commitShapeToTimeline plain-appends any
      // non-"shape" type.
      if (editContext.mode === "symbol" && editContext.symbolId) {
        const symId = editContext.symbolId;
        const items = newDoc.library.items.map((libItem) => {
          if (libItem.id === symId && libItem.itemType === "symbol") {
            return { ...libItem, timeline: commitShapeToTimeline(libItem.timeline, layerId, currentFrame, pasted) };
          }
          return libItem;
        });
        newDoc = { ...newDoc, library: { ...newDoc.library, items } };
      } else {
        const sceneIdx = Math.min(activeSceneIndex, newDoc.scenes.length - 1);
        const t = commitShapeToTimeline(newDoc.scenes[sceneIdx].timeline, layerId, currentFrame, pasted);
        newDoc = { ...newDoc, scenes: newDoc.scenes.map((s, i) => i === sceneIdx ? { ...s, timeline: t } : s) };
      }
      pastedIds.push(newId);
    }
    pushDoc(newDoc);
    if (pastedIds.length > 0) setSelectedShapeIds(pastedIds);
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

  // ---------------------------------------------------------------------------
  // Motion clipboard — Copy Motion / Paste Motion
  // ---------------------------------------------------------------------------

  /**
   * Copy Motion: snapshot the tween parameters of the governing keyframe at
   * the current frame into the module-level motion clipboard.
   */
  const handleCopyMotion = useCallback(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = getGoverningKeyframe(layer, currentFrame);
    if (!kf) return;
    clipboard.motion = {
      tweenType: kf.tweenType,
      motionEase: kf.motionEase,
      motionEaseCurve: kf.motionEaseCurve ?? null,
      motionRotate: kf.motionRotate,
      motionRotateCount: kf.motionRotateCount,
      motionOrientToPath: kf.motionOrientToPath,
      motionSync: kf.motionSync,
      motionScale: kf.motionScale,
      shapeEase: kf.shapeEase,
      shapeBlend: kf.shapeBlend,
    };
    setHasMotionClipboard(true);
  }, [timeline, safeActiveLayerIndex, currentFrame]);

  /**
   * Paste Motion: apply the motion clipboard's tween parameters to the
   * governing keyframe at the current frame.  Only tween parameters are
   * updated — display objects are left untouched.
   */
  const handlePasteMotion = useCallback(() => {
    if (!clipboard.motion) return;
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const kf = getGoverningKeyframe(layer, currentFrame);
    if (!kf) return;
    const mc = clipboard.motion;
    const newTimeline = {
      ...timeline,
      layers: timeline.layers.map((l) => {
        if (l.id !== layer.id) return l;
        return {
          ...l,
          frames: l.frames.map((f) => {
            if (f.index !== kf.index || !f.isKeyframe) return f;
            return {
              ...f,
              tweenType: mc.tweenType,
              motionEase: mc.motionEase,
              motionEaseCurve: mc.motionEaseCurve,
              motionRotate: mc.motionRotate,
              motionRotateCount: mc.motionRotateCount,
              motionOrientToPath: mc.motionOrientToPath,
              motionSync: mc.motionSync,
              motionScale: mc.motionScale,
              shapeEase: mc.shapeEase,
              shapeBlend: mc.shapeBlend,
            };
          }),
        };
      }),
    };
    pushDoc(withTimeline(() => newTimeline));
  }, [timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]);

  // ---------------------------------------------------------------------------
  // Frame clipboard — copy/paste frames in the Timeline
  // (selectedFrameRange + hasFrameClipboard live in uiStore)
  // ---------------------------------------------------------------------------

  /** Module-level frame clipboard so it survives re-renders without state churn. */
  const frameClipboardRef = useRef<{
    frames: readonly Frame[];
  } | null>(null);

  /**
   * Called by Timeline's onCopyFrames (context-menu or Cmd+C).
   * Copies [startFrame, endFrame] from the active layer.
   */
  const handleCopyFrames = useCallback(
    (startFrame: number, endFrame: number) => {
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const copied = copyFrames(layer, startFrame, endFrame);
      frameClipboardRef.current = { frames: copied };
      setHasFrameClipboard(true);
    },
    [timeline, safeActiveLayerIndex],
  );

  /**
   * Called by Timeline's onCutFrames (context-menu or Cmd+X).
   * Copies [startFrame, endFrame] then removes those frames from the layer.
   */
  const handleCutFrames = useCallback(
    (startFrame: number, endFrame: number) => {
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const copied = copyFrames(layer, startFrame, endFrame);
      frameClipboardRef.current = { frames: copied };
      setHasFrameClipboard(true);
      // Remove the cut frames from the layer
      const layerId = layer.id;
      const count = endFrame - startFrame + 1;
      let updatedTimeline = timeline;
      for (let i = 0; i < count; i++) {
        updatedTimeline = removeFrame(updatedTimeline, layerId, startFrame);
      }
      pushDoc(withTimeline(() => updatedTimeline));
    },
    [timeline, safeActiveLayerIndex, pushDoc, withTimeline],
  );

  /**
   * Called by Timeline's onRemoveFrames (Delete/Backspace key).
   * Removes [startFrame, endFrame] from the active layer, iterating from end
   * to start to avoid index shifting.
   */
  const handleRemoveFrames = useCallback(
    (startFrame: number, endFrame: number) => {
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const layerId = layer.id;
      let updatedTimeline = timeline;
      for (let i = endFrame; i >= startFrame; i--) {
        updatedTimeline = removeFrame(updatedTimeline, layerId, i);
      }
      pushDoc(withTimeline(() => updatedTimeline));
    },
    [timeline, safeActiveLayerIndex, pushDoc, withTimeline],
  );

  /**
   * Called by Timeline's onPasteFrames (context-menu or Cmd+V).
   * Inserts clipboard frames starting at atFrame in the active layer.
   */
  const handlePasteFrames = useCallback(
    (atFrame: number) => {
      if (!frameClipboardRef.current) return;
      const layer = timeline.layers[safeActiveLayerIndex];
      if (!layer) return;
      const updatedLayer = pasteFrames(layer, frameClipboardRef.current.frames, atFrame);
      const layerId = layer.id;
      pushDoc(
        withTimeline((t) => ({
          ...t,
          layers: t.layers.map((l) => (l.id === layerId ? updatedLayer : l)),
        })),
      );
    },
    [timeline, safeActiveLayerIndex, pushDoc, withTimeline],
  );

  /**
   * Called by Modify > Timeline > Reverse Frames.
   * Reverses the selected frame range on the active layer.
   * Falls back to the current frame (single frame) if no range is selected.
   */
  const handleReverseFrames = useCallback(() => {
    const layer = timeline.layers[safeActiveLayerIndex];
    if (!layer) return;
    const layerId = layer.id;
    const rangeStart = selectedFrameRange?.layerId === layerId ? selectedFrameRange.start : currentFrame;
    const rangeEnd = selectedFrameRange?.layerId === layerId ? selectedFrameRange.end : currentFrame;
    pushDoc(withTimeline((t) => reverseFrames(t, layerId, rangeStart, rangeEnd)));
  }, [timeline, safeActiveLayerIndex, selectedFrameRange, currentFrame, pushDoc, withTimeline]);


  return {
    handleCopy, handleCut, handlePaste, handlePasteInPlace, handleDuplicate,
    handleCopyMotion, handlePasteMotion, handleCopyFrames, handleCutFrames,
    handleRemoveFrames, handlePasteFrames, handleReverseFrames,
  };
}
