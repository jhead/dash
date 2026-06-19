/**
 * Unit tests for engine/libraryplace.ts — placeLibraryItem function.
 */

import { describe, it, expect } from "vitest";
import { placeLibraryItem } from "../libraryplace.js";
import { createDocument } from "../../model/document.js";
import { createSymbol, createBitmap, createSound, createComponent } from "../../model/library.js";
import { getComponentDef } from "../../model/components.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { BitmapDisplayObject, DisplayObject, SymbolInstance } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal doc with one layer containing a single keyframe at index 0. */
function makeDoc(
  libraryItems: FlashDocument["library"]["items"] = []
): FlashDocument {
  const frame = createFrame(0, { isKeyframe: true, isEmpty: true });
  const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
  const doc = createDocument();
  return {
    ...doc,
    library: { items: libraryItems, folders: [] },
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: [layer] }),
      },
    ],
  };
}

/** Extract display objects from scene 0 / layer 0 / frame 0. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  const kf = doc.scenes[0].timeline.layers[0].frames.find(
    (f) => f.isKeyframe && f.index === 0
  );
  return kf?.displayObjects ?? [];
}

// ---------------------------------------------------------------------------
// 1. Creates a SymbolInstance for a Symbol library item
// ---------------------------------------------------------------------------

describe("placeLibraryItem — symbol", () => {
  it("creates a SymbolInstance in the frame", () => {
    const symbol = createSymbol("MySymbol", "movieclip");
    const doc = makeDoc([symbol]);

    const result = placeLibraryItem(doc, 0, 0, 0, symbol.id, 100, 200);

    const objects = getObjects(result);
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("instance");
  });

  it("created instance has the correct symbolId", () => {
    const symbol = createSymbol("MySymbol", "movieclip");
    const doc = makeDoc([symbol]);

    const result = placeLibraryItem(doc, 0, 0, 0, symbol.id, 100, 200);

    const instance = getObjects(result)[0] as SymbolInstance;
    expect(instance.symbolId).toBe(symbol.id);
  });

  it("created instance is positioned at (x, y)", () => {
    const symbol = createSymbol("Positioned", "movieclip");
    const doc = makeDoc([symbol]);

    const result = placeLibraryItem(doc, 0, 0, 0, symbol.id, 150, 300);

    const instance = getObjects(result)[0] as SymbolInstance;
    expect(instance.x).toBe(150);
    expect(instance.y).toBe(300);
  });

  it("created instance has a unique id", () => {
    const symbol = createSymbol("Unique", "movieclip");
    const doc = makeDoc([symbol]);

    const result = placeLibraryItem(doc, 0, 0, 0, symbol.id, 0, 0);

    const instance = getObjects(result)[0] as SymbolInstance;
    expect(typeof instance.id).toBe("string");
    expect(instance.id.length).toBeGreaterThan(0);
    expect(instance.id).not.toBe(symbol.id);
  });
});

// ---------------------------------------------------------------------------
// 2. Returns doc unchanged for non-existent library item
// ---------------------------------------------------------------------------

describe("placeLibraryItem — non-existent item", () => {
  it("returns doc unchanged for non-existent library item", () => {
    const doc = makeDoc([]);

    const result = placeLibraryItem(doc, 0, 0, 0, "nonexistent-id", 0, 0);

    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// 3. Returns doc unchanged for non-placeable items (SoundItem, etc.)
// ---------------------------------------------------------------------------

describe("placeLibraryItem — non-placeable items", () => {
  it("returns doc unchanged for SoundItem", () => {
    const sound = createSound("MySoundEffect");
    const doc = makeDoc([sound]);

    const result = placeLibraryItem(doc, 0, 0, 0, sound.id, 0, 0);

    expect(result).toBe(doc);
  });

  it("no display objects added for SoundItem", () => {
    const sound = createSound("AnotherSound");
    const doc = makeDoc([sound]);

    const result = placeLibraryItem(doc, 0, 0, 0, sound.id, 50, 50);

    expect(getObjects(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. BitmapItem creates a BitmapDisplayObject
// ---------------------------------------------------------------------------

describe("placeLibraryItem — bitmap", () => {
  it("creates a BitmapDisplayObject for a BitmapItem", () => {
    const bitmap = createBitmap("MyBitmap", {
      dataUri: "data:image/png;base64,abc",
      originalWidth: 64,
      originalHeight: 32,
    });
    const doc = makeDoc([bitmap]);

    const result = placeLibraryItem(doc, 0, 0, 0, bitmap.id, 10, 20);

    const objects = getObjects(result);
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("bitmap");
  });

  it("bitmap display object references correct libraryItemId", () => {
    const bitmap = createBitmap("RefBitmap", {
      originalWidth: 100,
      originalHeight: 80,
    });
    const doc = makeDoc([bitmap]);

    const result = placeLibraryItem(doc, 0, 0, 0, bitmap.id, 0, 0);

    const bitmapObj = getObjects(result)[0] as BitmapDisplayObject;
    expect(bitmapObj.libraryItemId).toBe(bitmap.id);
  });

  it("bitmap display object is positioned at (x, y)", () => {
    const bitmap = createBitmap("PosBitmap", {
      originalWidth: 50,
      originalHeight: 50,
    });
    const doc = makeDoc([bitmap]);

    const result = placeLibraryItem(doc, 0, 0, 0, bitmap.id, 75, 125);

    const bitmapObj = getObjects(result)[0] as BitmapDisplayObject;
    expect(bitmapObj.x).toBe(75);
    expect(bitmapObj.y).toBe(125);
  });
});

// ---------------------------------------------------------------------------
// 5. Immutability — original doc is not mutated
// ---------------------------------------------------------------------------

describe("placeLibraryItem — immutability", () => {
  it("returns a new document, not the original", () => {
    const symbol = createSymbol("ImmutableTest", "movieclip");
    const doc = makeDoc([symbol]);

    const result = placeLibraryItem(doc, 0, 0, 0, symbol.id, 0, 0);

    expect(result).not.toBe(doc);
  });

  it("original doc's display objects are unchanged", () => {
    const symbol = createSymbol("NoSideEffect", "movieclip");
    const doc = makeDoc([symbol]);
    const originalObjects = getObjects(doc);

    placeLibraryItem(doc, 0, 0, 0, symbol.id, 0, 0);

    // Original should still have 0 objects
    expect(getObjects(doc)).toHaveLength(0);
    expect(getObjects(doc)).toBe(originalObjects);
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple calls add multiple instances
// ---------------------------------------------------------------------------

describe("placeLibraryItem — multiple instances", () => {
  it("two consecutive calls add two instances to the frame", () => {
    const symbol = createSymbol("MultiTest", "movieclip");
    const doc = makeDoc([symbol]);

    const after1 = placeLibraryItem(doc, 0, 0, 0, symbol.id, 10, 20);
    const after2 = placeLibraryItem(after1, 0, 0, 0, symbol.id, 30, 40);

    const objects = getObjects(after2);
    expect(objects).toHaveLength(2);
  });

  it("each added instance has a unique id", () => {
    const symbol = createSymbol("UniqueIds", "movieclip");
    const doc = makeDoc([symbol]);

    const after1 = placeLibraryItem(doc, 0, 0, 0, symbol.id, 0, 0);
    const after2 = placeLibraryItem(after1, 0, 0, 0, symbol.id, 10, 10);

    const objects = getObjects(after2) as SymbolInstance[];
    expect(objects[0].id).not.toBe(objects[1].id);
  });

  it("multiple instances each have correct (x, y)", () => {
    const symbol = createSymbol("MultiPositions", "movieclip");
    const doc = makeDoc([symbol]);

    const after1 = placeLibraryItem(doc, 0, 0, 0, symbol.id, 50, 60);
    const after2 = placeLibraryItem(after1, 0, 0, 0, symbol.id, 70, 80);

    const objects = getObjects(after2) as SymbolInstance[];
    expect(objects[0].x).toBe(50);
    expect(objects[0].y).toBe(60);
    expect(objects[1].x).toBe(70);
    expect(objects[1].y).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Component placement (task 1222): a ComponentItem becomes a SymbolInstance
// referencing the component, carrying the component's default parameters.
// ---------------------------------------------------------------------------

describe("placeLibraryItem — component", () => {
  it("creates a SymbolInstance referencing the component item", () => {
    const comp = createComponent("Button", "Button", "mx.controls");
    const doc = makeDoc([comp]);

    const result = placeLibraryItem(doc, 0, 0, 0, comp.id, 30, 40);
    const objects = getObjects(result);
    expect(objects).toHaveLength(1);
    const inst = objects[0] as SymbolInstance;
    expect(inst.type).toBe("instance");
    expect(inst.symbolId).toBe(comp.id);
    expect(inst.x).toBe(30);
    expect(inst.y).toBe(40);
  });

  it("seeds default component parameters from the catalog", () => {
    const comp = createComponent("Button", "Button", "mx.controls");
    const doc = makeDoc([comp]);

    const result = placeLibraryItem(doc, 0, 0, 0, comp.id, 0, 0);
    const inst = getObjects(result)[0] as SymbolInstance;
    const def = getComponentDef("Button")!;
    expect(inst.componentParameters).toBeDefined();
    expect(inst.componentParameters!.label).toBe("Button");
    expect(Object.keys(inst.componentParameters!).length).toBe(def.parameters.length);
    // natural size comes from the catalog's default size
    expect(inst.naturalWidth).toBe(def.defaultWidth);
    expect(inst.naturalHeight).toBe(def.defaultHeight);
  });

  it("falls back to an empty parameter map for an unknown component", () => {
    const comp = createComponent("Frobnicator", "Frobnicator", "custom.pkg");
    const doc = makeDoc([comp]);

    const result = placeLibraryItem(doc, 0, 0, 0, comp.id, 0, 0);
    const inst = getObjects(result)[0] as SymbolInstance;
    expect(inst.componentParameters).toEqual({});
  });
});
