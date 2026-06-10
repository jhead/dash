/**
 * Unit tests for model/library.ts — extended library operations:
 * duplicateLibraryItem, editSymbol, getLibraryItemCountByType, hasLibraryItem.
 */

import { describe, it, expect } from "vitest";
import {
  createLibrary,
  createSymbol,
  createBitmap,
  createSound,
  addLibraryItem,
  duplicateLibraryItem,
  editSymbol,
  getLibraryItemCountByType,
  hasLibraryItem,
  setSymbolLinkage,
} from "../library.js";
import type { Library, Symbol } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLibraryWithSymbol(name = "Hero"): { library: Library; symbol: Symbol } {
  const symbol = createSymbol(name, "movieclip");
  const library = addLibraryItem(createLibrary(), symbol);
  return { library, symbol };
}

// ---------------------------------------------------------------------------
// duplicateLibraryItem
// ---------------------------------------------------------------------------

describe("duplicateLibraryItem", () => {
  it("creates a copy with a new id", () => {
    const { library, symbol } = makeLibraryWithSymbol("Sprite");
    const result = duplicateLibraryItem(library, symbol.id);
    expect(result.items).toHaveLength(2);
    const copy = result.items[1]!;
    expect(copy.id).not.toBe(symbol.id);
  });

  it("appends ' copy' to the name", () => {
    const { library, symbol } = makeLibraryWithSymbol("Sprite");
    const result = duplicateLibraryItem(library, symbol.id);
    const copy = result.items[1]!;
    expect(copy.name).toBe("Sprite copy");
  });

  it("on unknown id returns library unchanged (same reference)", () => {
    const { library } = makeLibraryWithSymbol();
    const result = duplicateLibraryItem(library, "nonexistent-id");
    expect(result).toBe(library);
  });

  it("duplicated item has same itemType as source", () => {
    const bitmap = createBitmap("Background");
    const library = addLibraryItem(createLibrary(), bitmap);
    const result = duplicateLibraryItem(library, bitmap.id);
    const copy = result.items[1]!;
    expect(copy.itemType).toBe("bitmap");
  });

  it("duplicated sound has same itemType as source", () => {
    const sound = createSound("FX");
    const library = addLibraryItem(createLibrary(), sound);
    const result = duplicateLibraryItem(library, sound.id);
    const copy = result.items[1]!;
    expect(copy.itemType).toBe("sound");
  });

  it("is immutable — original library is unchanged", () => {
    const { library } = makeLibraryWithSymbol("A");
    const result = duplicateLibraryItem(library, library.items[0]!.id);
    expect(result).not.toBe(library);
    expect(library.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// editSymbol
// ---------------------------------------------------------------------------

describe("editSymbol", () => {
  it("applies the mutator to the matching symbol", () => {
    const { library, symbol } = makeLibraryWithSymbol("Button");
    const result = editSymbol(library, symbol.id, (s) => ({ ...s, name: "UpdatedButton" }));
    const found = result.items.find((i) => i.id === symbol.id) as Symbol;
    expect(found.name).toBe("UpdatedButton");
  });

  it("on non-symbol item returns library unchanged (non-symbol id)", () => {
    const bitmap = createBitmap("Tile");
    const library = addLibraryItem(createLibrary(), bitmap);
    const result = editSymbol(library, bitmap.id, (s) => ({ ...s, name: "Changed" }));
    // bitmap is not a symbol, so no change
    expect(result.items[0]!.name).toBe("Tile");
  });

  it("on unknown id returns library with no changes", () => {
    const { library } = makeLibraryWithSymbol("Hero");
    const result = editSymbol(library, "nonexistent-id", (s) => ({ ...s, name: "Changed" }));
    expect(result.items[0]!.name).toBe("Hero");
  });

  it("is immutable — original library is not mutated", () => {
    const { library, symbol } = makeLibraryWithSymbol("Original");
    editSymbol(library, symbol.id, (s) => ({ ...s, name: "Modified" }));
    expect(library.items[0]!.name).toBe("Original");
  });

  it("returns a new library object reference", () => {
    const { library, symbol } = makeLibraryWithSymbol("MC");
    const result = editSymbol(library, symbol.id, (s) => ({ ...s, name: "MC2" }));
    expect(result).not.toBe(library);
  });
});

// ---------------------------------------------------------------------------
// getLibraryItemCountByType
// ---------------------------------------------------------------------------

describe("getLibraryItemCountByType", () => {
  it("counts symbols correctly", () => {
    const sym1 = createSymbol("A", "movieclip");
    const sym2 = createSymbol("B", "button");
    const bitmap = createBitmap("Tile");
    const library = addLibraryItem(
      addLibraryItem(addLibraryItem(createLibrary(), sym1), sym2),
      bitmap
    );
    expect(getLibraryItemCountByType(library, "symbol")).toBe(2);
  });

  it("counts bitmaps correctly", () => {
    const sym = createSymbol("A", "movieclip");
    const bmp = createBitmap("BG");
    const library = addLibraryItem(addLibraryItem(createLibrary(), sym), bmp);
    expect(getLibraryItemCountByType(library, "bitmap")).toBe(1);
  });

  it("returns 0 when no items of that type exist", () => {
    const { library } = makeLibraryWithSymbol();
    expect(getLibraryItemCountByType(library, "video")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// hasLibraryItem
// ---------------------------------------------------------------------------

describe("hasLibraryItem", () => {
  it("returns true when the item is present", () => {
    const { library, symbol } = makeLibraryWithSymbol("Hero");
    expect(hasLibraryItem(library, symbol.id)).toBe(true);
  });

  it("returns false when the item is absent", () => {
    const { library } = makeLibraryWithSymbol();
    expect(hasLibraryItem(library, "nonexistent-id")).toBe(false);
  });

  it("returns false on an empty library", () => {
    const library = createLibrary();
    expect(hasLibraryItem(library, "any-id")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setSymbolLinkage
// ---------------------------------------------------------------------------

describe("setSymbolLinkage", () => {
  it("sets linkageIdentifier on a symbol", () => {
    const { library, symbol } = makeLibraryWithSymbol("Enemy");
    const result = setSymbolLinkage(library, symbol.id, { linkageId: "EnemyMC" });
    const updated = result.items.find((i) => i.id === symbol.id);
    expect(updated?.itemType).toBe("symbol");
    if (updated?.itemType === "symbol") {
      expect(updated.linkage.linkageIdentifier).toBe("EnemyMC");
    }
  });

  it("sets exportForActionScript on a symbol", () => {
    const { library, symbol } = makeLibraryWithSymbol("Player");
    const result = setSymbolLinkage(library, symbol.id, { exportForActionScript: true });
    const updated = result.items.find((i) => i.id === symbol.id);
    if (updated?.itemType === "symbol") {
      expect(updated.linkage.exportForActionScript).toBe(true);
    }
  });

  it("sets exportInFirstFrame on a symbol", () => {
    const { library, symbol } = makeLibraryWithSymbol("Bullet");
    const result = setSymbolLinkage(library, symbol.id, { exportInFirstFrame: true });
    const updated = result.items.find((i) => i.id === symbol.id);
    if (updated?.itemType === "symbol") {
      expect(updated.linkage.exportInFirstFrame).toBe(true);
    }
  });

  it("partial update — unspecified fields remain unchanged", () => {
    const { library, symbol } = makeLibraryWithSymbol("Sprite");
    // Set initial linkage
    const lib1 = setSymbolLinkage(library, symbol.id, {
      linkageId: "SpriteMC",
      exportForActionScript: true,
      exportInFirstFrame: false,
    });
    // Only update exportInFirstFrame
    const lib2 = setSymbolLinkage(lib1, symbol.id, { exportInFirstFrame: true });
    const updated = lib2.items.find((i) => i.id === symbol.id);
    if (updated?.itemType === "symbol") {
      expect(updated.linkage.linkageIdentifier).toBe("SpriteMC");
      expect(updated.linkage.exportForActionScript).toBe(true);
      expect(updated.linkage.exportInFirstFrame).toBe(true);
    }
  });

  it("is immutable — original library is unchanged", () => {
    const { library, symbol } = makeLibraryWithSymbol("Gem");
    const result = setSymbolLinkage(library, symbol.id, { linkageId: "GemMC" });
    expect(result).not.toBe(library);
    const original = library.items.find((i) => i.id === symbol.id);
    if (original?.itemType === "symbol") {
      expect(original.linkage.linkageIdentifier).toBe("");
    }
  });

  it("returns library unchanged when symbolId is unknown", () => {
    const { library } = makeLibraryWithSymbol("Hero");
    const result = setSymbolLinkage(library, "nonexistent-id", { linkageId: "X" });
    expect(result).toBe(library);
  });

  it("returns library unchanged when id refers to a non-symbol item", () => {
    const bitmap = createBitmap("Background");
    const library = addLibraryItem(createLibrary(), bitmap);
    const result = setSymbolLinkage(library, bitmap.id, { linkageId: "bg" });
    expect(result).toBe(library);
  });
});
