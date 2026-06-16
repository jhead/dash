import { useCallback } from "react";
import {
  addDisplayObject,
  updateDisplayObject,
  type FlashDocument,
  type Timeline as TimelineModel,
  type DisplayObject,
  type TextDisplayObject,
} from "@flash/core";
import { nextTextId } from "../idgen.js";
import type { TextFormat } from "../EditBar";
import type { UiStoreApi } from "../store/index.js";

export interface TextHandlersDeps {
  uiStore: UiStoreApi;
  timeline: TimelineModel;
  safeActiveLayerIndex: number;
  activeLayerIndex: number;
  currentFrame: number;
  pushDoc: (doc: FlashDocument) => void;
  withTimeline: (updater: (t: TimelineModel) => TimelineModel) => FlashDocument;
  selectedDisplayObject: DisplayObject | null;
}

/** Text tool + Text-menu (style/align/tracking/scrollable) handlers. Verbatim. */
export function useTextHandlers(deps: TextHandlersDeps) {
  const {
    uiStore, timeline, safeActiveLayerIndex, activeLayerIndex, currentFrame,
    pushDoc, withTimeline, selectedDisplayObject,
  } = deps;
  const setEditingTextId = uiStore.getState().setEditingTextId;
  const setTextFormat = uiStore.getState().setTextFormat;

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

  const handleTextFormatChange = useCallback((format: Partial<TextFormat>) => {
    setTextFormat((prev) => ({ ...prev, ...format }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Handlers — Text menu (Style/Align/Tracking/Scrollable)
  // ---------------------------------------------------------------------------

  /**
   * Apply a partial update to the currently selected TextDisplayObject.
   * No-op if nothing is selected or the selection is not a text object.
   */
  const applyTextUpdate = useCallback(
    (changes: Partial<TextDisplayObject>) => {
      if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
      const layerId = timeline.layers[safeActiveLayerIndex]?.id;
      if (!layerId) return;
      pushDoc(withTimeline((t) =>
        updateDisplayObject(t, layerId, currentFrame, selectedDisplayObject.id, changes)
      ));
    },
    [selectedDisplayObject, timeline, safeActiveLayerIndex, currentFrame, pushDoc, withTimeline]
  );

  const handleTextBold = useCallback(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
    applyTextUpdate({ bold: !selectedDisplayObject.bold });
  }, [selectedDisplayObject, applyTextUpdate]);

  const handleTextItalic = useCallback(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
    applyTextUpdate({ italic: !selectedDisplayObject.italic });
  }, [selectedDisplayObject, applyTextUpdate]);

  const handleTextUnderline = useCallback(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
    applyTextUpdate({ underline: !(selectedDisplayObject.underline ?? false) });
  }, [selectedDisplayObject, applyTextUpdate]);

  const handleTextAlignLeft = useCallback(() => {
    applyTextUpdate({ align: "left" });
  }, [applyTextUpdate]);

  const handleTextAlignCenter = useCallback(() => {
    applyTextUpdate({ align: "center" });
  }, [applyTextUpdate]);

  const handleTextAlignRight = useCallback(() => {
    applyTextUpdate({ align: "right" });
  }, [applyTextUpdate]);

  const handleTextAlignJustify = useCallback(() => {
    applyTextUpdate({ align: "justify" });
  }, [applyTextUpdate]);

  const TRACKING_STEP = 2; // pixels per increment

  const handleTextTrackingIncrease = useCallback(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
    applyTextUpdate({ letterSpacing: (selectedDisplayObject.letterSpacing ?? 0) + TRACKING_STEP });
  }, [selectedDisplayObject, applyTextUpdate]);

  const handleTextTrackingDecrease = useCallback(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
    applyTextUpdate({ letterSpacing: (selectedDisplayObject.letterSpacing ?? 0) - TRACKING_STEP });
  }, [selectedDisplayObject, applyTextUpdate]);

  const handleTextTrackingReset = useCallback(() => {
    applyTextUpdate({ letterSpacing: 0 });
  }, [applyTextUpdate]);

  const handleTextScrollable = useCallback(() => {
    if (!selectedDisplayObject || selectedDisplayObject.type !== "text") return;
    applyTextUpdate({ scrollable: !(selectedDisplayObject.scrollable ?? false) });
  }, [selectedDisplayObject, applyTextUpdate]);


  return {
    handleTextCreated, handleTextPlace, handleTextEdit, handleTextEditEnd,
    handleTextFormatChange, handleTextBold, handleTextItalic, handleTextUnderline,
    handleTextAlignLeft, handleTextAlignCenter, handleTextAlignRight, handleTextAlignJustify,
    handleTextTrackingIncrease, handleTextTrackingDecrease, handleTextTrackingReset,
    handleTextScrollable,
  };
}
