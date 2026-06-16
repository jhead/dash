import { useCallback } from "react";
import type React from "react";
import {
  getGoverningKeyframe,
  clearTween,
  setMotionTween,
  setShapeTween,
  updateMotionTweenProps,
  type FlashDocument,
  type DocumentProperties,
  type Timeline as TimelineModel,
  type Frame,
} from "@flash/core";
import { loadFlaFromBytes } from "./useFileActions.js";
import type { UiStoreApi } from "../store/index.js";

export interface DocumentHandlersDeps {
  uiStore: UiStoreApi;
  timeline: TimelineModel;
  pushDoc: (doc: FlashDocument) => void;
  withProperties: (updater: (p: DocumentProperties) => DocumentProperties) => FlashDocument;
  withTimeline: (updater: (t: TimelineModel) => TimelineModel) => FlashDocument;
  replaceDoc: (doc: FlashDocument) => void;
  clearHistory: () => void;
  setSelectedShapeId: (id: string | null) => void;
}

/**
 * Document properties, frame-property edits, File-menu (open/new replaces the
 * doc and wipes history), and drag-and-drop .fla loading. Verbatim.
 */
export function useDocumentHandlers(deps: DocumentHandlersDeps) {
  const {
    uiStore, timeline, pushDoc, withProperties, withTimeline, replaceDoc, clearHistory, setSelectedShapeId,
  } = deps;
  const setDocPropsOpen = uiStore.getState().setDocPropsOpen;
  const setFilePath = uiStore.getState().setFilePath;
  const setCurrentFrame = uiStore.getState().setCurrentFrame;
  const setInstances = uiStore.getState().setInstances;
  const setSelectedInstanceId = uiStore.getState().setSelectedInstanceId;
  const setIsDragOver = uiStore.getState().setIsDragOver;

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


  return {
    handleDocPropsConfirm, handleUpdateDocProperties, handleFrameUpdate,
    handleDocumentChange, handleFilePathChange, handleDragOver, handleDragLeave, handleDrop,
  };
}
