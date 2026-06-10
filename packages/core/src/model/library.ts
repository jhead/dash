import type {
  BitmapItem,
  ComponentItem,
  FontItem,
  Library,
  LibraryFolder,
  LibraryItem,
  SoundItem,
  Symbol,
  SymbolLinkage,
  SymbolType,
  VideoItem,
} from "./types.js";
import { createFrame, createLayer, createTimeline } from "./timeline.js";

let _idCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${++_idCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Default linkage
// ---------------------------------------------------------------------------

export function createSymbolLinkage(
  overrides?: Partial<SymbolLinkage>
): SymbolLinkage {
  return {
    exportForActionScript: false,
    exportInFirstFrame: false,
    linkageIdentifier: "",
    className: "",
    exportForRuntimeSharing: false,
    importForRuntimeSharing: false,
    sharedUrl: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Symbol
// ---------------------------------------------------------------------------

/**
 * Create a Library Symbol (MovieClip, Button, or Graphic).
 *
 * Button symbols automatically get a 4-frame timeline representing the
 * Up / Over / Down / Hit states (frames 0–3).
 */
export function createSymbol(
  name: string,
  symbolType: SymbolType = "movieclip",
  overrides?: Partial<Symbol>
): Symbol {
  const timeline =
    symbolType === "button"
      ? {
          layers: [
            {
              ...createLayer("Layer 1"),
              frames: [
                { ...createFrame(0), label: "Up" },
                { ...createFrame(1), label: "Over" },
                { ...createFrame(2), label: "Down" },
                { ...createFrame(3), label: "Hit" },
              ],
              frameCount: 4,
            },
          ],
        }
      : createTimeline();

  return {
    id: nextId("symbol"),
    name,
    itemType: "symbol",
    symbolType,
    timeline,
    linkage: createSymbolLinkage(),
    scale9Grid: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BitmapItem
// ---------------------------------------------------------------------------

export function createBitmap(
  name: string,
  overrides?: Partial<BitmapItem>
): BitmapItem {
  return {
    id: nextId("bitmap"),
    name,
    itemType: "bitmap",
    dataUri: "",
    originalWidth: 0,
    originalHeight: 0,
    allowSmoothing: false,
    compressionType: "photo",
    quality: 80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SoundItem
// ---------------------------------------------------------------------------

export function createSound(
  name: string,
  overrides?: Partial<SoundItem>
): SoundItem {
  return {
    id: nextId("sound"),
    name,
    itemType: "sound",
    dataUri: "",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: true,
    durationSeconds: 0,
    compressionType: "mp3",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// VideoItem
// ---------------------------------------------------------------------------

export function createVideo(
  name: string,
  overrides?: Partial<VideoItem>
): VideoItem {
  return {
    id: nextId("video"),
    name,
    itemType: "video",
    dataUri: "",
    frameCount: 0,
    frameRate: 12,
    width: 320,
    height: 240,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FontItem
// ---------------------------------------------------------------------------

export function createFont(
  name: string,
  fontName: string,
  overrides?: Partial<FontItem>
): FontItem {
  return {
    id: nextId("font"),
    name,
    itemType: "font",
    fontName,
    bold: false,
    italic: false,
    linkageIdentifier: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ComponentItem
// ---------------------------------------------------------------------------

export function createComponent(
  name: string,
  componentName: string,
  packageName: string,
  overrides?: Partial<ComponentItem>
): ComponentItem {
  return {
    id: nextId("component"),
    name,
    itemType: "component",
    componentName,
    packageName,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// LibraryFolder
// ---------------------------------------------------------------------------

export function createLibraryFolder(
  name: string,
  parentFolderId: string | null = null,
  overrides?: Partial<LibraryFolder>
): LibraryFolder {
  return {
    id: nextId("folder"),
    name,
    parentFolderId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

/**
 * Create an empty Library with no items and no folders.
 */
export function createLibrary(overrides?: Partial<Library>): Library {
  return {
    items: [],
    folders: [],
    ...overrides,
  };
}

/**
 * Add a LibraryItem to a Library. Returns a new Library (immutable).
 */
export function addLibraryItem(library: Library, item: LibraryItem): Library {
  return {
    ...library,
    items: [...library.items, item],
  };
}

/**
 * Remove a LibraryItem by id. Returns a new Library (immutable).
 */
export function removeLibraryItem(library: Library, id: string): Library {
  return {
    ...library,
    items: library.items.filter((item) => item.id !== id),
  };
}

/**
 * Find a LibraryItem by id, or undefined if not found.
 */
export function getLibraryItem(
  library: Library,
  id: string
): LibraryItem | undefined {
  return library.items.find((item) => item.id === id);
}

/**
 * Create a new Symbol and add it to the library.
 * Returns both the updated library and the new item.
 */
export function createSymbolInLibrary(
  library: Library,
  name: string,
  type: SymbolType
): { library: Library; item: Symbol } {
  const item = createSymbol(name, type);
  return {
    library: addLibraryItem(library, item),
    item,
  };
}

/**
 * Rename a LibraryItem by id. Returns a new Library (immutable).
 * If the item is not found, the library is returned unchanged.
 */
export function renameLibraryItem(
  library: Library,
  id: string,
  name: string
): Library {
  if (!library.items.some((item) => item.id === id)) return library;
  return {
    ...library,
    items: library.items.map((item) =>
      item.id === id ? { ...item, name } : item
    ),
  };
}

/**
 * Add a LibraryFolder to the library. Returns a new Library (immutable).
 */
export function addLibraryFolder(
  library: Library,
  folder: LibraryFolder
): Library {
  return {
    ...library,
    folders: [...library.folders, folder],
  };
}

/**
 * Remove a LibraryFolder by id. Returns a new Library (immutable).
 */
export function removeLibraryFolder(
  library: Library,
  folderId: string
): Library {
  return {
    ...library,
    folders: library.folders.filter((f) => f.id !== folderId),
  };
}

/**
 * Rename a LibraryFolder by id. Returns a new Library (immutable).
 * If the id is not found, the library is returned unchanged.
 */
export function renameLibraryFolder(
  library: Library,
  folderId: string,
  newName: string
): Library {
  if (!library.folders.some((f) => f.id === folderId)) return library;
  return {
    ...library,
    folders: library.folders.map((f) =>
      f.id === folderId ? { ...f, name: newName } : f
    ),
  };
}

/**
 * Return all LibraryFolders that are direct children of the given parent folder id.
 * Pass null to get top-level folders.
 */
export function getFoldersInFolder(
  library: Library,
  parentFolderId: string | null
): readonly LibraryFolder[] {
  return library.folders.filter((f) => f.parentFolderId === parentFolderId);
}

/**
 * Find a LibraryItem by id, or undefined if not found.
 * Alias of getLibraryItem for a more discoverable name.
 */
export function findLibraryItem(
  library: Library,
  id: string
): LibraryItem | undefined {
  return library.items.find((item) => item.id === id);
}

/**
 * Return all LibraryItems whose itemType matches the given type string.
 */
export function getLibraryItemsByType(
  library: Library,
  itemType: string
): LibraryItem[] {
  return library.items.filter((item) => item.itemType === itemType);
}

/**
 * Convert the symbolType of a Symbol in the library.
 * Returns a new Library (immutable). If the id is not found or does not refer
 * to a symbol item, the library is returned unchanged.
 */
export function convertSymbolType(
  library: Library,
  symbolId: string,
  newType: SymbolType
): Library {
  return {
    ...library,
    items: library.items.map((item) =>
      item.id === symbolId && item.itemType === "symbol"
        ? { ...item, symbolType: newType }
        : item
    ),
  };
}

/**
 * Duplicate a LibraryItem by id. The copy receives a new unique id and has
 * " copy" appended to its name. Returns a new Library (immutable).
 * If the id is not found, the original library is returned unchanged (same reference).
 */
export function duplicateLibraryItem(library: Library, id: string): Library {
  const source = library.items.find((item) => item.id === id);
  if (!source) return library;
  const copy: LibraryItem = {
    ...source,
    id: nextId(source.itemType),
    name: `${source.name} copy`,
  };
  return {
    ...library,
    items: [...library.items, copy],
  };
}

/**
 * Apply a mutator function to the Symbol with the given id.
 * Returns a new Library (immutable). If the id is not found or does not refer
 * to a symbol, the library is returned unchanged.
 */
export function editSymbol(
  library: Library,
  id: string,
  mutator: (symbol: Symbol) => Symbol
): Library {
  const item = library.items.find((i) => i.id === id);
  if (!item || item.itemType !== "symbol") return library;
  return {
    ...library,
    items: library.items.map((i) =>
      i.id === id && i.itemType === "symbol" ? mutator(i as Symbol) : i
    ),
  };
}

/**
 * Return the count of LibraryItems whose itemType matches the given type string.
 * For "symbol", counts items where itemType === "symbol".
 */
export function getLibraryItemCountByType(
  library: Library,
  itemType: string
): number {
  return library.items.filter((item) => item.itemType === itemType).length;
}

/**
 * Return true if the library contains an item with the given id, false otherwise.
 */
export function hasLibraryItem(library: Library, id: string): boolean {
  return library.items.some((item) => item.id === id);
}

// ---------------------------------------------------------------------------
// Symbol linkage
// ---------------------------------------------------------------------------

/**
 * Update the AS2 linkage settings for a Symbol in the library.
 *
 * Only `Symbol` items have a `linkage` property; passing the id of a non-symbol
 * item returns the library unchanged.
 *
 * The `linkageId`, `exportForActionScript`, and `exportInFirstFrame` fields
 * correspond to the Flash 8 "Linkage" dialog and to `SymbolLinkage` on the
 * model. Unspecified fields are left at their current values.
 */
export function setSymbolLinkage(
  library: Library,
  symbolId: string,
  linkageProps: {
    linkageId?: string;
    exportForActionScript?: boolean;
    exportInFirstFrame?: boolean;
  }
): Library {
  const item = library.items.find((i) => i.id === symbolId);
  if (!item || item.itemType !== "symbol") {
    // Not a symbol — return unchanged
    return library;
  }
  const sym = item as Symbol;
  const updatedLinkage: SymbolLinkage = {
    ...sym.linkage,
    ...(linkageProps.linkageId !== undefined
      ? { linkageIdentifier: linkageProps.linkageId }
      : {}),
    ...(linkageProps.exportForActionScript !== undefined
      ? { exportForActionScript: linkageProps.exportForActionScript }
      : {}),
    ...(linkageProps.exportInFirstFrame !== undefined
      ? { exportInFirstFrame: linkageProps.exportInFirstFrame }
      : {}),
  };
  const updatedSym: Symbol = { ...sym, linkage: updatedLinkage };
  return {
    ...library,
    items: library.items.map((i) => (i.id === symbolId ? updatedSym : i)),
  };
}
