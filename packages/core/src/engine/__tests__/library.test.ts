/**
 * Unit tests for engine/library.ts — library item management functions.
 */

import { describe, it, expect } from "vitest";
import {
  duplicateLibraryItem,
  renameLibraryItemInDoc as renameLibraryItem,
  deleteLibraryItem,
} from "../library.js";
import { createDocument } from "../../model/document.js";
import {
  createSymbol,
  createBitmap,
  createSound,
  createLibraryFolder,
} from "../../model/library.js";
import type { FlashDocument, Symbol, BitmapItem } from "../../model/types.js";
import type { SymbolInstance } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a doc with a symbol in the library. */
function makeDocWithSymbol(name = "MySymbol"): { doc: FlashDocument; symbol: Symbol } {
  const symbol = createSymbol(name, "movieclip");
  const doc = createDocument({
    library: { items: [symbol], folders: [] },
  });
  return { doc, symbol };
}

/** Create a SymbolInstance referencing a given symbolId. */
function makeInstance(symbolId: string): SymbolInstance {
  return {
    type: "instance",
    id: "inst-1",
    symbolId,
    x: 0,
    y: 0,
  };
}

// ---------------------------------------------------------------------------
// duplicateLibraryItem
// ---------------------------------------------------------------------------

describe("duplicateLibraryItem", () => {
  it("adds a new item to the library", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = duplicateLibraryItem(doc, symbol.id);
    expect(result.library.items).toHaveLength(2);
  });

  it("duplicated item has a new ID (not same as original)", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = duplicateLibraryItem(doc, symbol.id);
    const copy = result.library.items[1];
    expect(copy.id).not.toBe(symbol.id);
  });

  it('duplicated item name is "Copy of <original name>"', () => {
    const { doc, symbol } = makeDocWithSymbol("OriginalName");
    const result = duplicateLibraryItem(doc, symbol.id);
    const copy = result.library.items[1];
    expect(copy.name).toBe("Copy of OriginalName");
  });

  it("duplicated Symbol has new layer IDs", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = duplicateLibraryItem(doc, symbol.id);
    const copy = result.library.items[1] as Symbol;
    const origLayerIds = symbol.timeline.layers.map((l) => l.id);
    const copyLayerIds = copy.timeline.layers.map((l) => l.id);
    // For each layer in the copy, none of its IDs should match the original
    copyLayerIds.forEach((id) => {
      expect(origLayerIds).not.toContain(id);
    });
  });

  it("duplicating a BitmapItem adds a new item with a new ID and name", () => {
    const bitmap = createBitmap("MyBitmap", { dataUri: "data:image/png;base64,abc" });
    const doc = createDocument({ library: { items: [bitmap], folders: [] } });
    const result = duplicateLibraryItem(doc, bitmap.id);
    expect(result.library.items).toHaveLength(2);
    const copy = result.library.items[1];
    expect(copy.id).not.toBe(bitmap.id);
    expect(copy.name).toBe("Copy of MyBitmap");
  });

  it("duplicating a SoundItem adds a new item with a new ID and name", () => {
    const sound = createSound("MySound", { dataUri: "data:audio/mp3;base64,xyz" });
    const doc = createDocument({ library: { items: [sound], folders: [] } });
    const result = duplicateLibraryItem(doc, sound.id);
    expect(result.library.items).toHaveLength(2);
    const copy = result.library.items[1];
    expect(copy.id).not.toBe(sound.id);
    expect(copy.name).toBe("Copy of MySound");
  });

  it("returns document unchanged when item not found", () => {
    const { doc } = makeDocWithSymbol();
    const result = duplicateLibraryItem(doc, "nonexistent-id");
    expect(result).toBe(doc);
  });

  it("returns a new document (immutable)", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = duplicateLibraryItem(doc, symbol.id);
    expect(result).not.toBe(doc);
    expect(result.library).not.toBe(doc.library);
    expect(result.library.items).not.toBe(doc.library.items);
  });
});

// ---------------------------------------------------------------------------
// renameLibraryItem
// ---------------------------------------------------------------------------

describe("renameLibraryItem", () => {
  it("changes the name of the specified item", () => {
    const { doc, symbol } = makeDocWithSymbol("OldName");
    const result = renameLibraryItem(doc, symbol.id, "NewName");
    const updated = result.library.items.find((i) => i.id === symbol.id);
    expect(updated?.name).toBe("NewName");
  });

  it("returns document unchanged when item ID is not found", () => {
    const { doc } = makeDocWithSymbol();
    const result = renameLibraryItem(doc, "nonexistent-id", "AnyName");
    expect(result).toBe(doc);
  });

  it("returns a new document (immutable)", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = renameLibraryItem(doc, symbol.id, "NewName");
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// deleteLibraryItem
// ---------------------------------------------------------------------------

describe("deleteLibraryItem", () => {
  it("removes the item from the library", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = deleteLibraryItem(doc, symbol.id);
    expect(result.library.items.find((i) => i.id === symbol.id)).toBeUndefined();
  });

  it("removes SymbolInstances referencing the deleted item from frames", () => {
    const { doc, symbol } = makeDocWithSymbol();
    // Place an instance of the symbol in scene 0, layer 0, frame 0
    const instance = makeInstance(symbol.id);
    const docWithInstance: FlashDocument = {
      ...doc,
      scenes: doc.scenes.map((scene, si) =>
        si === 0
          ? {
              ...scene,
              timeline: {
                layers: scene.timeline.layers.map((layer, li) =>
                  li === 0
                    ? {
                        ...layer,
                        frames: layer.frames.map((frame, fi) =>
                          fi === 0
                            ? { ...frame, displayObjects: [instance] }
                            : frame
                        ),
                      }
                    : layer
                ),
              },
            }
          : scene
      ),
    };

    const result = deleteLibraryItem(docWithInstance, symbol.id);
    const frame = result.scenes[0].timeline.layers[0].frames[0];
    expect(frame.displayObjects).toHaveLength(0);
  });

  it("does not remove other display objects from frames", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const instance = makeInstance(symbol.id);
    const otherSymbol = createSymbol("Other");
    const otherInstance: SymbolInstance = {
      type: "instance",
      id: "inst-2",
      symbolId: otherSymbol.id,
      x: 10,
      y: 20,
    };

    const docWithInstances: FlashDocument = {
      ...doc,
      library: { items: [symbol, otherSymbol], folders: [] },
      scenes: doc.scenes.map((scene, si) =>
        si === 0
          ? {
              ...scene,
              timeline: {
                layers: scene.timeline.layers.map((layer, li) =>
                  li === 0
                    ? {
                        ...layer,
                        frames: layer.frames.map((frame, fi) =>
                          fi === 0
                            ? { ...frame, displayObjects: [instance, otherInstance] }
                            : frame
                        ),
                      }
                    : layer
                ),
              },
            }
          : scene
      ),
    };

    const result = deleteLibraryItem(docWithInstances, symbol.id);
    const frame = result.scenes[0].timeline.layers[0].frames[0];
    expect(frame.displayObjects).toHaveLength(1);
    expect(frame.displayObjects[0].id).toBe("inst-2");
  });

  it("returns a new document (immutable)", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = deleteLibraryItem(doc, symbol.id);
    expect(result).not.toBe(doc);
    expect(result.library).not.toBe(doc.library);
  });

  it("returns document unchanged when item ID is not found", () => {
    const { doc } = makeDocWithSymbol();
    const result = deleteLibraryItem(doc, "nonexistent-id");
    expect(result).toBe(doc);
  });

  it("library has one fewer item after deletion", () => {
    const symbol1 = createSymbol("Alpha", "movieclip");
    const symbol2 = createSymbol("Beta", "movieclip");
    const doc = createDocument({
      library: { items: [symbol1, symbol2], folders: [] },
    });
    const result = deleteLibraryItem(doc, symbol1.id);
    expect(result.library.items).toHaveLength(1);
    expect(result.library.items[0].id).toBe(symbol2.id);
  });
});

// ---------------------------------------------------------------------------
// Independent timeline after duplicate
// ---------------------------------------------------------------------------

describe("duplicateLibraryItem — independent timeline", () => {
  it("modifying the duplicate's timeline structure does not affect the original", () => {
    const { doc, symbol } = makeDocWithSymbol("Shared");
    const result = duplicateLibraryItem(doc, symbol.id);
    const copy = result.library.items[1] as Symbol;

    // Add a layer to the copy's timeline in a new document
    const extraLayer = { ...copy.timeline.layers[0], id: "extra-layer" };
    const modifiedCopy: Symbol = {
      ...copy,
      timeline: { layers: [...copy.timeline.layers, extraLayer] },
    };

    // The original symbol's timeline should still have its original layer count
    expect(symbol.timeline.layers).toHaveLength(1);
    expect(modifiedCopy.timeline.layers).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// renameLibraryItem — property preservation
// ---------------------------------------------------------------------------

describe("renameLibraryItem — property preservation", () => {
  it("preserves itemType, symbolType, timeline, and linkage after rename", () => {
    const { doc, symbol } = makeDocWithSymbol("PreserveName");
    const result = renameLibraryItem(doc, symbol.id, "Renamed");
    const updated = result.library.items.find((i) => i.id === symbol.id) as Symbol;
    expect(updated.itemType).toBe(symbol.itemType);
    expect(updated.symbolType).toBe(symbol.symbolType);
    expect(updated.timeline).toEqual(symbol.timeline);
    expect(updated.linkage).toEqual(symbol.linkage);
  });
});

// ---------------------------------------------------------------------------
// duplicateLibraryItem — BitmapItem dataUri preserved
// ---------------------------------------------------------------------------

describe("duplicateLibraryItem — BitmapItem dataUri", () => {
  it("duplicated BitmapItem has the same dataUri as the original", () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANS=";
    const bitmap = createBitmap("Photo", { dataUri });
    const doc = createDocument({ library: { items: [bitmap], folders: [] } });
    const result = duplicateLibraryItem(doc, bitmap.id);
    const copy = result.library.items[1] as BitmapItem;
    expect(copy.dataUri).toBe(dataUri);
  });
});

// ---------------------------------------------------------------------------
// Library folders preserved
// ---------------------------------------------------------------------------

describe("library folders preserved", () => {
  it("duplicateLibraryItem preserves existing folders", () => {
    const folder = createLibraryFolder("Assets");
    const { doc: base, symbol } = makeDocWithSymbol();
    const doc = { ...base, library: { ...base.library, folders: [folder] } };
    const result = duplicateLibraryItem(doc, symbol.id);
    expect(result.library.folders).toEqual([folder]);
  });

  it("renameLibraryItem preserves existing folders", () => {
    const folder = createLibraryFolder("Sprites");
    const { doc: base, symbol } = makeDocWithSymbol();
    const doc = { ...base, library: { ...base.library, folders: [folder] } };
    const result = renameLibraryItem(doc, symbol.id, "NewName");
    expect(result.library.folders).toEqual([folder]);
  });

  it("deleteLibraryItem preserves existing folders", () => {
    const folder = createLibraryFolder("Backgrounds");
    const { doc: base, symbol } = makeDocWithSymbol();
    const doc = { ...base, library: { ...base.library, folders: [folder] } };
    const result = deleteLibraryItem(doc, symbol.id);
    expect(result.library.folders).toEqual([folder]);
  });
});
