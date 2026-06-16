import { useCallback, type MutableRefObject } from "react";
import {
  addLibraryItem,
  addDisplayObject,
  createSymbolInLibrary,
  removeLibraryItem,
  createLibraryFolder,
  type FlashDocument,
  type Timeline as TimelineModel,
  type Library,
  type DocumentProperties,
  type BitmapDisplayObject,
  type BitmapItem,
  type SymbolType,
  type Symbol,
  type CanvasRenderer,
} from "@flash/core";
import { useFileActions } from "./useFileActions.js";
import { nextBitmapId } from "../idgen.js";
import type { SymbolPropertiesData } from "../SymbolPropertiesDialog";
import type { UiStoreApi, EditContext } from "../store/index.js";

export interface LibraryHandlersDeps {
  uiStore: UiStoreApi;
  library: Library;
  timeline: TimelineModel;
  docProperties: DocumentProperties;
  editContext: EditContext;
  activeSceneIndex: number;
  safeActiveLayerIndex: number;
  currentFrame: number;
  bitmapPropsItem: BitmapItem | null;
  pushDoc: (doc: FlashDocument) => void;
  withLibrary: (updater: (lib: Library) => Library) => FlashDocument;
  rendererRef: MutableRefObject<CanvasRenderer | null>;
}

/**
 * Library + import handlers: import image/sound/video, create/rename/duplicate/
 * delete items, folders, linkage, symbol/bitmap properties, edit-in-place.
 * Extracted out of Shell verbatim; behaviour-preserving.
 */
export function useLibraryHandlers(deps: LibraryHandlersDeps) {
  const {
    uiStore, library, timeline, docProperties, editContext, activeSceneIndex,
    safeActiveLayerIndex, currentFrame, bitmapPropsItem, pushDoc, withLibrary, rendererRef,
  } = deps;
  const setSelectedLibraryItemId = uiStore.getState().setSelectedLibraryItemId;
  const setInstances = uiStore.getState().setInstances;
  const setBitmapPropsItem = uiStore.getState().setBitmapPropsItem;
  const setEditContext = uiStore.getState().setEditContext;
  const setEditPath = uiStore.getState().setEditPath;
  const setCurrentFrame = uiStore.getState().setCurrentFrame;
  const setActiveLayerIndex = uiStore.getState().setActiveLayerIndex;
  const { importToLibrary, importSoundToLibrary, importVideoToLibrary } = useFileActions();

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

  const handleImportToStage = useCallback(async () => {
    const result = await importToLibrary();
    if (!result) return;
    const { item, dataUri } = result;
    // Pre-load image into renderer cache
    if (rendererRef.current) {
      rendererRef.current.loadImage(item.id, dataUri);
    }
    // Add to library and place on stage
    const layerId = timeline.layers[safeActiveLayerIndex]?.id;
    if (!layerId) {
      pushDoc(withLibrary((lib) => addLibraryItem(lib, item)));
      return;
    }
    const stageW = docProperties.width;
    const stageH = docProperties.height;
    const bmpW = item.originalWidth || 100;
    const bmpH = item.originalHeight || 100;
    const bmpObj: BitmapDisplayObject = {
      type: "bitmap",
      id: nextBitmapId(),
      libraryItemId: item.id,
      x: Math.round(stageW / 2 - bmpW / 2),
      y: Math.round(stageH / 2 - bmpH / 2),
      width: bmpW,
      height: bmpH,
      scaleX: 1,
      scaleY: 1,
    };
    const newDoc = withLibrary((lib) => addLibraryItem(lib, item));
    pushDoc({
      ...newDoc,
      ...(editContext.mode === "symbol" && editContext.symbolId
        ? {
            library: {
              ...newDoc.library,
              items: newDoc.library.items.map((libItem) => {
                if (libItem.id === editContext.symbolId && libItem.itemType === "symbol") {
                  return {
                    ...libItem,
                    timeline: addDisplayObject(libItem.timeline, layerId, currentFrame, bmpObj),
                  };
                }
                return libItem;
              }),
            },
          }
        : (() => {
            const idx = Math.min(activeSceneIndex, newDoc.scenes.length - 1);
            const t = addDisplayObject(newDoc.scenes[idx].timeline, layerId, currentFrame, bmpObj);
            return {
              scenes: newDoc.scenes.map((s, i) => i === idx ? { ...s, timeline: t } : s),
            };
          })()),
    });
  }, [importToLibrary, pushDoc, withLibrary, timeline, safeActiveLayerIndex, docProperties, editContext, activeSceneIndex, currentFrame]);

  const handleImportSound = useCallback(async () => {
    const result = await importSoundToLibrary();
    if (!result) return;
    const { item } = result;
    pushDoc(withLibrary((lib) => addLibraryItem(lib, item)));
  }, [importSoundToLibrary, pushDoc, withLibrary]);

  const handleImportVideo = useCallback(async () => {
    const result = await importVideoToLibrary();
    if (!result) return;
    const { item } = result;
    pushDoc(withLibrary((lib) => addLibraryItem(lib, item)));
  }, [importVideoToLibrary, pushDoc, withLibrary]);

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

  const handleUpdateFolder = useCallback((folderId: string, folderCollapsed: boolean) => {
    pushDoc(withLibrary((lib) => ({
      ...lib,
      folders: lib.folders.map((f) =>
        f.id === folderId ? { ...f, collapsed: folderCollapsed } : f
      ),
    })));
  }, [pushDoc, withLibrary]);

  const handleSetLinkage = useCallback((id: string, linkage: import("@flash/core").SymbolLinkage) => {
    pushDoc(withLibrary((lib) => ({
      ...lib,
      items: lib.items.map((item) =>
        item.id === id && item.itemType === "symbol" ? { ...item, linkage } : item
      ),
    })));
  }, [pushDoc, withLibrary]);

  const handleSetSymbolProperties = useCallback((id: string, data: SymbolPropertiesData) => {
    pushDoc(withLibrary((lib) => ({
      ...lib,
      items: lib.items.map((item) =>
        item.id === id && item.itemType === "symbol"
          ? { ...item, name: data.name, symbolType: data.symbolType, scale9Grid: data.scale9Grid }
          : item
      ),
    })));
  }, [pushDoc, withLibrary]);

  /** Save changes from the Bitmap Properties dialog back into the library. */
  const handleBitmapPropsSave = useCallback((changes: Partial<BitmapItem>) => {
    if (!bitmapPropsItem) return;
    const id = bitmapPropsItem.id;
    pushDoc(withLibrary((lib) => ({
      ...lib,
      items: lib.items.map((item) =>
        item.id === id && item.itemType === "bitmap"
          ? { ...item, ...changes }
          : item
      ),
    })));
    setBitmapPropsItem(null);
  }, [bitmapPropsItem, pushDoc, withLibrary]);

  const handleEditInPlace = useCallback((itemId: string, instanceId?: string) => {
    const item = library.items.find((i) => i.id === itemId);
    if (!item) return;
    const symType = item.itemType === "symbol" ? (item as Symbol).symbolType : undefined;
    setEditContext({ mode: "symbol", symbolId: itemId, symbolName: item.name, symbolType: symType });
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


  return {
    handleImportToLibrary,
    handleImportToStage,
    handleImportSound,
    handleImportVideo,
    handleCreateSymbol,
    handleDeleteLibraryItem,
    handleRenameLibraryItem,
    handleDuplicateLibraryItem,
    handleAddFolder,
    handleMoveItemToFolder,
    handleUpdateFolder,
    handleSetLinkage,
    handleSetSymbolProperties,
    handleBitmapPropsSave,
    handleEditInPlace,
    handleExitEditInPlace,
  };
}
