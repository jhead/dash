/**
 * Library item management functions for FlashDocument.
 * All operations are immutable — they return a new FlashDocument.
 */

import type { FlashDocument, LibraryItem, Symbol, Layer, Frame } from '../model/types.js';
import type { DisplayObject, SymbolInstance } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let _counter = 0;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lib-${Date.now().toString(36)}-${++_counter}`;
}

/** Deep-clone a Frame, giving all DisplayObjects new IDs. */
function cloneFrameWithNewIds(frame: Frame): Frame {
  return {
    ...frame,
    displayObjects: frame.displayObjects.map((o: DisplayObject) => ({
      ...o,
      id: newId(),
    })),
  };
}

/** Deep-clone a Layer, giving it and its frames' display objects new IDs. */
function cloneLayerWithNewIds(layer: Layer): Layer {
  return {
    ...layer,
    id: newId(),
    frames: layer.frames.map(cloneFrameWithNewIds),
  };
}

/** Deep-clone a Symbol item with all new internal IDs. */
function cloneSymbol(item: Symbol, newItemId: string, newName: string): Symbol {
  return {
    ...item,
    id: newItemId,
    name: newName,
    timeline: {
      layers: item.timeline.layers.map(cloneLayerWithNewIds),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deep-clone a library item with a new ID and name "Copy of <original>".
 * For Symbol items, all internal layer/frame/displayObject IDs are also regenerated.
 */
export function duplicateLibraryItem(doc: FlashDocument, itemId: string): FlashDocument {
  const item = doc.library.items.find((i) => i.id === itemId);
  if (!item) return doc;

  const newId_ = newId();
  const newName = `Copy of ${item.name}`;

  let cloned: LibraryItem;
  if (item.itemType === 'symbol') {
    cloned = cloneSymbol(item as Symbol, newId_, newName);
  } else {
    // BitmapItem, SoundItem, VideoItem, FontItem, ComponentItem — shallow clone
    cloned = { ...item, id: newId_, name: newName } as LibraryItem;
  }

  return {
    ...doc,
    library: {
      ...doc.library,
      items: [...doc.library.items, cloned],
    },
  };
}

/**
 * Rename a library item in a document.
 * If the item is not found, returns the document unchanged.
 *
 * @alias renameLibraryItemInDoc — named with `InDoc` suffix to distinguish from
 * the Library-level `renameLibraryItem` in model/library.ts which takes a Library
 * rather than a FlashDocument.
 */
export function renameLibraryItemInDoc(
  doc: FlashDocument,
  itemId: string,
  newName: string
): FlashDocument {
  const found = doc.library.items.some((i) => i.id === itemId);
  if (!found) return doc;

  return {
    ...doc,
    library: {
      ...doc.library,
      items: doc.library.items.map((i) =>
        i.id === itemId ? { ...i, name: newName } : i
      ),
    },
  };
}

/**
 * Add a library item to the document's library.
 * If an item with the same ID already exists, the document is returned unchanged.
 */
export function addLibraryItem(doc: FlashDocument, item: LibraryItem): FlashDocument {
  if (doc.library.items.some((i) => i.id === item.id)) return doc;
  return {
    ...doc,
    library: {
      ...doc.library,
      items: [...doc.library.items, item],
    },
  };
}

/**
 * Remove a library item by ID without cleaning up scene references.
 * If the item is not found, returns the document unchanged.
 */
export function removeLibraryItem(doc: FlashDocument, itemId: string): FlashDocument {
  if (!doc.library.items.some((i) => i.id === itemId)) return doc;
  return {
    ...doc,
    library: {
      ...doc.library,
      items: doc.library.items.filter((i) => i.id !== itemId),
    },
  };
}

/**
 * Replace a library item (matched by id) with updatedItem.
 * If the item is not found, returns the document unchanged.
 */
export function updateLibraryItem(doc: FlashDocument, updatedItem: LibraryItem): FlashDocument {
  if (!doc.library.items.some((i) => i.id === updatedItem.id)) return doc;
  return {
    ...doc,
    library: {
      ...doc.library,
      items: doc.library.items.map((i) => (i.id === updatedItem.id ? updatedItem : i)),
    },
  };
}

/**
 * Remove a library item and clean up all SymbolInstances referencing it
 * from every frame in every scene.
 */
export function deleteLibraryItem(doc: FlashDocument, itemId: string): FlashDocument {
  // If item not found, return doc unchanged (same reference)
  if (!doc.library.items.some((i) => i.id === itemId)) return doc;

  // Remove from library
  const updatedLibrary = {
    ...doc.library,
    items: doc.library.items.filter((i) => i.id !== itemId),
  };

  // Remove SymbolInstances referencing this item from all scenes
  const updatedScenes = doc.scenes.map((scene) => ({
    ...scene,
    timeline: {
      ...scene.timeline,
      layers: scene.timeline.layers.map((layer) => ({
        ...layer,
        frames: layer.frames.map((frame) => ({
          ...frame,
          displayObjects: frame.displayObjects.filter(
            (obj: DisplayObject) =>
              !(obj.type === 'instance' && (obj as SymbolInstance).symbolId === itemId)
          ),
        })),
      })),
    },
  }));

  return {
    ...doc,
    library: updatedLibrary,
    scenes: updatedScenes,
  };
}
