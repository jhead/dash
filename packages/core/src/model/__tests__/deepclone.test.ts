/**
 * Tests for deep-clone behavior of model types.
 *
 * All model types are plain TS interfaces, so `structuredClone` is the natural
 * primitive for deep duplication. These tests also cover `duplicateLibraryItem`
 * and `editSymbol` in library.ts.
 */

import { describe, it, expect } from "vitest";
import {
  createSymbol,
  createLibrary,
  addLibraryItem,
  duplicateLibraryItem,
  editSymbol,
} from "../library.js";
import { createDocument } from "../document.js";
import { createScene } from "../scene.js";
import { createTimeline } from "../timeline.js";
import type { Symbol, Library, FlashDocument } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSymbol(name = "TestSymbol"): Symbol {
  return createSymbol(name, "movieclip");
}

function makeButtonSymbol(name = "TestButton"): Symbol {
  return createSymbol(name, "button");
}

function makeLibraryWithSymbol(name = "Hero"): { library: Library; symbol: Symbol } {
  const symbol = makeSymbol(name);
  const library = addLibraryItem(createLibrary(), symbol);
  return { library, symbol };
}

// ---------------------------------------------------------------------------
// 1. structuredClone of a Symbol preserves all fields
// ---------------------------------------------------------------------------

describe("structuredClone — Symbol field preservation", () => {
  it("preserves id, name, itemType, symbolType", () => {
    const original = makeSymbol("MySymbol");
    const clone = structuredClone(original);
    expect(clone.id).toBe(original.id);
    expect(clone.name).toBe(original.name);
    expect(clone.itemType).toBe(original.itemType);
    expect(clone.symbolType).toBe(original.symbolType);
  });

  it("preserves timeline layers and frames", () => {
    const original = makeSymbol();
    const clone = structuredClone(original);
    expect(clone.timeline.layers).toHaveLength(original.timeline.layers.length);
    const origLayer = original.timeline.layers[0]!;
    const cloneLayer = clone.timeline.layers[0]!;
    expect(cloneLayer.id).toBe(origLayer.id);
    expect(cloneLayer.name).toBe(origLayer.name);
    expect(cloneLayer.frames).toHaveLength(origLayer.frames.length);
  });

  it("preserves linkage fields", () => {
    const original = makeSymbol();
    const clone = structuredClone(original);
    expect(clone.linkage).toEqual(original.linkage);
  });

  it("preserves scale9Grid (null)", () => {
    const original = makeSymbol();
    const clone = structuredClone(original);
    expect(clone.scale9Grid).toBeNull();
  });

  it("preserves scale9Grid when set", () => {
    const original = createSymbol("GridSym", "movieclip", {
      scale9Grid: { x: 10, y: 20, width: 100, height: 80 },
    });
    const clone = structuredClone(original);
    expect(clone.scale9Grid).toEqual(original.scale9Grid);
  });

  it("preserves buttonActions on button symbols", () => {
    const original = makeButtonSymbol();
    const withActions: Symbol = {
      ...original,
      buttonActions: [
        { event: "press", script: "trace('pressed');" },
        { event: "release", script: "gotoAndPlay(2);" },
      ],
    };
    const clone = structuredClone(withActions);
    expect(clone.buttonActions).toEqual(withActions.buttonActions);
    expect(clone.buttonActions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Mutating cloned symbol's timeline doesn't affect original
// ---------------------------------------------------------------------------

describe("structuredClone — timeline independence", () => {
  it("mutating clone timeline layers does not affect original", () => {
    const original = makeSymbol();
    const clone = structuredClone(original) as { timeline: { layers: unknown[] } };
    (clone.timeline.layers as unknown[]).push({ id: "extra", name: "Extra" });
    expect(original.timeline.layers).toHaveLength(1);
  });

  it("clone timeline is a different reference", () => {
    const original = makeSymbol();
    const clone = structuredClone(original);
    expect(clone.timeline).not.toBe(original.timeline);
    expect(clone.timeline.layers).not.toBe(original.timeline.layers);
  });
});

// ---------------------------------------------------------------------------
// 3. Mutating cloned symbol's frames doesn't affect original
// ---------------------------------------------------------------------------

describe("structuredClone — frames independence", () => {
  it("clone frame array is a different reference", () => {
    const original = makeSymbol();
    const clone = structuredClone(original);
    expect(clone.timeline.layers[0]!.frames).not.toBe(
      original.timeline.layers[0]!.frames
    );
  });

  it("mutating clone frame object does not affect original", () => {
    const original = makeSymbol();
    const clone = structuredClone(original) as {
      timeline: { layers: Array<{ frames: Array<Record<string, unknown>> }> };
    };
    clone.timeline.layers[0]!.frames[0]!["label"] = "MUTATED";
    expect(original.timeline.layers[0]!.frames[0]!.label).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. Mutating cloned symbol's buttonActions doesn't affect original
// ---------------------------------------------------------------------------

describe("structuredClone — buttonActions independence", () => {
  it("mutating clone buttonActions does not affect original", () => {
    const base = makeButtonSymbol();
    const original: Symbol = {
      ...base,
      buttonActions: [{ event: "press", script: "trace(1);" }],
    };
    const clone = structuredClone(original) as {
      buttonActions: Array<{ event: string; script: string }>;
    };
    clone.buttonActions[0]!.script = "MUTATED";
    expect(original.buttonActions![0]!.script).toBe("trace(1);");
  });

  it("clone buttonActions array is a different reference", () => {
    const base = makeButtonSymbol();
    const original: Symbol = {
      ...base,
      buttonActions: [{ event: "release", script: "" }],
    };
    const clone = structuredClone(original);
    expect(clone.buttonActions).not.toBe(original.buttonActions);
  });
});

// ---------------------------------------------------------------------------
// 5. Deep cloning a Library (array of symbols) is independent
// ---------------------------------------------------------------------------

describe("structuredClone — Library independence", () => {
  it("cloned library items array is a different reference", () => {
    const { library } = makeLibraryWithSymbol();
    const clone = structuredClone(library);
    expect(clone.items).not.toBe(library.items);
  });

  it("mutating cloned library items does not affect original", () => {
    const { library } = makeLibraryWithSymbol();
    const clone = structuredClone(library) as { items: unknown[] };
    clone.items.push({ id: "extra", name: "Extra", itemType: "symbol" });
    expect(library.items).toHaveLength(1);
  });

  it("cloned item is a different reference from original item", () => {
    const { library } = makeLibraryWithSymbol();
    const clone = structuredClone(library);
    expect(clone.items[0]).not.toBe(library.items[0]);
  });

  it("cloned item fields match original", () => {
    const { library, symbol } = makeLibraryWithSymbol("Warrior");
    const clone = structuredClone(library);
    const clonedItem = clone.items[0]! as Symbol;
    expect(clonedItem.id).toBe(symbol.id);
    expect(clonedItem.name).toBe(symbol.name);
  });
});

// ---------------------------------------------------------------------------
// 6. duplicateLibraryItem produces a new id but same name/type
// ---------------------------------------------------------------------------

describe("duplicateLibraryItem — new id, same name/type", () => {
  it("appends ' copy' to the item name", () => {
    const { library, symbol } = makeLibraryWithSymbol("Hero");
    const result = duplicateLibraryItem(library, symbol.id);
    const copy = result.items.find((i) => i.id !== symbol.id)!;
    expect(copy.name).toBe("Hero copy");
  });

  it("the copy has a different id from the source", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = duplicateLibraryItem(library, symbol.id);
    const copy = result.items.find((i) => i.id !== symbol.id)!;
    expect(copy.id).not.toBe(symbol.id);
  });

  it("the copy has the same itemType", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = duplicateLibraryItem(library, symbol.id);
    const copy = result.items.find((i) => i.id !== symbol.id)!;
    expect(copy.itemType).toBe(symbol.itemType);
  });

  it("adds exactly one more item to the library", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = duplicateLibraryItem(library, symbol.id);
    expect(result.items).toHaveLength(library.items.length + 1);
  });

  it("returns original library unchanged when id not found", () => {
    const { library } = makeLibraryWithSymbol();
    const result = duplicateLibraryItem(library, "nonexistent-id");
    expect(result).toBe(library);
  });
});

// ---------------------------------------------------------------------------
// 7. duplicateLibraryItem result is independent — mutate one, other unchanged
// ---------------------------------------------------------------------------

describe("duplicateLibraryItem — independence", () => {
  it("copy symbolType matches original", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = duplicateLibraryItem(library, symbol.id);
    const copy = result.items.find((i) => i.id !== symbol.id)! as Symbol;
    expect(copy.symbolType).toBe((symbol as Symbol).symbolType);
  });

  it("editSymbol on the copy does not change the original item", () => {
    const { library, symbol } = makeLibraryWithSymbol("Alpha");
    const withCopy = duplicateLibraryItem(library, symbol.id);
    const copy = withCopy.items.find((i) => i.id !== symbol.id)! as Symbol;

    const mutated = editSymbol(withCopy, copy.id, (s) => ({ ...s, name: "MUTATED" }));
    const origItem = mutated.items.find((i) => i.id === symbol.id)!;
    expect(origItem.name).toBe("Alpha");
  });

  it("editing original symbol does not change the copy", () => {
    const { library, symbol } = makeLibraryWithSymbol("Beta");
    const withCopy = duplicateLibraryItem(library, symbol.id);
    const copy = withCopy.items.find((i) => i.id !== symbol.id)!;

    const mutated = editSymbol(withCopy, symbol.id, (s) => ({ ...s, name: "CHANGED" }));
    const copyItem = mutated.items.find((i) => i.id === copy.id)!;
    expect(copyItem.name).toBe("Beta copy");
  });
});

// ---------------------------------------------------------------------------
// 8. editSymbol applies the mutator and returns a new library
// ---------------------------------------------------------------------------

describe("editSymbol — applies mutator", () => {
  it("renames the target symbol", () => {
    const { library, symbol } = makeLibraryWithSymbol("Original");
    const result = editSymbol(library, symbol.id, (s) => ({ ...s, name: "Renamed" }));
    const updated = result.items.find((i) => i.id === symbol.id)! as Symbol;
    expect(updated.name).toBe("Renamed");
  });

  it("returns a new Library reference", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = editSymbol(library, symbol.id, (s) => s);
    expect(result).not.toBe(library);
  });

  it("mutator can change symbolType", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = editSymbol(library, symbol.id, (s) => ({
      ...s,
      symbolType: "graphic" as const,
    }));
    const updated = result.items.find((i) => i.id === symbol.id)! as Symbol;
    expect(updated.symbolType).toBe("graphic");
  });

  it("returns library unchanged when id not found", () => {
    const { library } = makeLibraryWithSymbol();
    const result = editSymbol(library, "no-such-id", (s) => ({ ...s, name: "X" }));
    expect(result).toBe(library);
  });

  it("returns library unchanged when id refers to non-symbol item", () => {
    const library = createLibrary();
    // A BitmapItem is not a symbol; add one manually via spread
    const bitmap = {
      id: "bitmap-fixture-1",
      name: "photo.jpg",
      itemType: "bitmap" as const,
      dataUri: "",
      originalWidth: 100,
      originalHeight: 100,
      allowSmoothing: false,
      compressionType: "lossless" as const,
      quality: 90,
    };
    const lib2 = addLibraryItem(library, bitmap);
    const result = editSymbol(lib2, bitmap.id, (s) => ({ ...s, name: "changed" }));
    expect(result).toBe(lib2);
  });
});

// ---------------------------------------------------------------------------
// 9. editSymbol doesn't mutate original library
// ---------------------------------------------------------------------------

describe("editSymbol — immutability", () => {
  it("original library items array is unchanged after editSymbol", () => {
    const { library, symbol } = makeLibraryWithSymbol("Immutable");
    const originalItems = library.items;
    editSymbol(library, symbol.id, (s) => ({ ...s, name: "Mutated" }));
    // Original items array reference must be unchanged
    expect(library.items).toBe(originalItems);
    // Original symbol name is unchanged
    const origItem = library.items.find((i) => i.id === symbol.id)!;
    expect(origItem.name).toBe("Immutable");
  });

  it("items not targeted by editSymbol keep the same reference", () => {
    const sym1 = makeSymbol("One");
    const sym2 = makeSymbol("Two");
    const library = addLibraryItem(addLibraryItem(createLibrary(), sym1), sym2);
    const result = editSymbol(library, sym1.id, (s) => ({ ...s, name: "One-Updated" }));
    // sym2 item reference is preserved
    const resultSym2 = result.items.find((i) => i.id === sym2.id)!;
    const origSym2 = library.items.find((i) => i.id === sym2.id)!;
    expect(resultSym2).toBe(origSym2);
  });
});

// ---------------------------------------------------------------------------
// 10. Deep clone of FlashDocument with nested scenes/layers/frames
// ---------------------------------------------------------------------------

describe("structuredClone — FlashDocument deep independence", () => {
  it("cloned document is a different reference", () => {
    const doc = createDocument();
    const clone = structuredClone(doc);
    expect(clone).not.toBe(doc);
  });

  it("preserves document id, properties, scenes count", () => {
    const doc = createDocument();
    const clone = structuredClone(doc);
    expect(clone.id).toBe(doc.id);
    expect(clone.properties.width).toBe(doc.properties.width);
    expect(clone.scenes).toHaveLength(doc.scenes.length);
  });

  it("cloned scenes array is a different reference", () => {
    const doc = createDocument();
    const clone = structuredClone(doc);
    expect(clone.scenes).not.toBe(doc.scenes);
  });

  it("mutating cloned scenes does not affect original", () => {
    const doc = createDocument();
    const clone = structuredClone(doc) as {
      scenes: Array<{ name: string }>;
    };
    clone.scenes[0]!.name = "MUTATED";
    expect(doc.scenes[0]!.name).toBe("Scene 1");
  });

  it("cloned library items are independent from original", () => {
    const sym = makeSymbol("DocSymbol");
    const doc = createDocument({
      library: addLibraryItem(createLibrary(), sym),
    });
    const clone = structuredClone(doc);
    expect(clone.library.items).not.toBe(doc.library.items);
    expect(clone.library.items[0]).not.toBe(doc.library.items[0]);
  });

  it("document with multiple scenes: all scenes are cloned independently", () => {
    const scene1 = createScene("Act 1");
    const scene2 = createScene("Act 2");
    const doc = createDocument({ scenes: [scene1, scene2] });
    const clone = structuredClone(doc) as FlashDocument;
    expect(clone.scenes).toHaveLength(2);
    expect(clone.scenes[0]!.id).toBe(scene1.id);
    expect(clone.scenes[1]!.id).toBe(scene2.id);
    // Independence
    expect(clone.scenes[0]).not.toBe(scene1);
    expect(clone.scenes[1]).not.toBe(scene2);
  });

  it("document with nested layers and frames: frames are cloned independently", () => {
    const doc = createDocument();
    const clone = structuredClone(doc);
    const origFrame = doc.scenes[0]!.timeline.layers[0]!.frames[0]!;
    const cloneFrame = clone.scenes[0]!.timeline.layers[0]!.frames[0]!;
    expect(cloneFrame).not.toBe(origFrame);
    expect(cloneFrame.index).toBe(origFrame.index);
  });
});
