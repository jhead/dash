import { useCallback } from "react";
import {
  addScene,
  removeScene,
  renameScene,
  reorderScenes,
  duplicateScene,
  type FlashDocument,
} from "@flash/core";
import type { UiStoreApi } from "../store/index.js";

export interface SceneHandlersDeps {
  uiStore: UiStoreApi;
  doc: FlashDocument;
  pushDoc: (doc: FlashDocument) => void;
}

/** Scene CRUD/navigation handlers (Window > Scene). Behaviour-preserving. */
export function useSceneHandlers(deps: SceneHandlersDeps) {
  const { uiStore, doc, pushDoc } = deps;
  const setActiveSceneIndex = uiStore.getState().setActiveSceneIndex;
  const setCurrentFrame = uiStore.getState().setCurrentFrame;
  const setActiveLayerIndex = uiStore.getState().setActiveLayerIndex;

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

  const handleDuplicateScene = useCallback((index: number) => {
    const scene = doc.scenes[index];
    if (!scene) return;
    pushDoc(duplicateScene(doc, scene.id));
    // Navigate to the duplicate (inserted right after the source)
    setActiveSceneIndex(index + 1);
  }, [doc, pushDoc]);

  const handleSelectScene = useCallback((index: number) => {
    setActiveSceneIndex(index);
    setCurrentFrame(0);
    setActiveLayerIndex(0);
  }, []);


  return {
    handleAddScene, handleRemoveScene, handleRenameScene,
    handleReorderScene, handleDuplicateScene, handleSelectScene,
  };
}
