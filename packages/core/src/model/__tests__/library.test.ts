/**
 * Unit tests for model/library.ts — Library CRUD helper functions.
 * All operations are immutable — they return a new Library.
 */

import { describe, it, expect } from "vitest";
import {
  createLibrary,
  createLibraryFolder,
  createSymbol,
  createBitmap,
  createSound,
  addLibraryItem,
  removeLibraryItem,
  renameLibraryItem,
  addLibraryFolder,
  removeLibraryFolder,
  findLibraryItem,
  getLibraryItemsByType,
} from "../library.js";
import type { Library } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyLibrary(): Library {
  return createLibrary();
}

function makeLibraryWithSymbol(name = "Hero") {
  const symbol = createSymbol(name, "movieclip");
  const library = addLibraryItem(createLibrary(), symbol);
  return { library, symbol };
}

// ---------------------------------------------------------------------------
// addLibraryItem
// ---------------------------------------------------------------------------

describe("addLibraryItem", () => {
  it("adds a LibraryItem to an empty library", () => {
    const library = makeEmptyLibrary();
    const symbol = createSymbol("Hero", "movieclip");
    const result = addLibraryItem(library, symbol);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(symbol.id);
  });

  it("is immutable — original library is unchanged", () => {
    const library = makeEmptyLibrary();
    const symbol = createSymbol("Hero", "movieclip");
    const result = addLibraryItem(library, symbol);
    expect(result).not.toBe(library);
    expect(library.items).toHaveLength(0);
    expect(result.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeLibraryItem
// ---------------------------------------------------------------------------

describe("removeLibraryItem", () => {
  it("removes item by id", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = removeLibraryItem(library, symbol.id);
    expect(result.items.find((i) => i.id === symbol.id)).toBeUndefined();
    expect(result.items).toHaveLength(0);
  });

  it("with unknown id leaves library unchanged", () => {
    const { library } = makeLibraryWithSymbol();
    const result = removeLibraryItem(library, "nonexistent-id");
    expect(result.items).toHaveLength(1);
  });

  it("is immutable — original library is unchanged", () => {
    const { library, symbol } = makeLibraryWithSymbol();
    const result = removeLibraryItem(library, symbol.id);
    expect(result).not.toBe(library);
    expect(library.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// renameLibraryItem
// ---------------------------------------------------------------------------

describe("renameLibraryItem", () => {
  it("updates the item name", () => {
    const { library, symbol } = makeLibraryWithSymbol("Original");
    const result = renameLibraryItem(library, symbol.id, "Renamed");
    const found = result.items.find((i) => i.id === symbol.id);
    expect(found?.name).toBe("Renamed");
  });

  it("with unknown id leaves library unchanged", () => {
    const { library } = makeLibraryWithSymbol();
    const result = renameLibraryItem(library, "nonexistent-id", "Ghost");
    expect(result).toBe(library);
  });

  it("is immutable — original item name is unchanged", () => {
    const { library, symbol } = makeLibraryWithSymbol("Before");
    renameLibraryItem(library, symbol.id, "After");
    expect(library.items[0]!.name).toBe("Before");
  });

  it("does not affect other items", () => {
    const sym1 = createSymbol("Alpha", "movieclip");
    const sym2 = createSymbol("Beta", "movieclip");
    const library = addLibraryItem(addLibraryItem(createLibrary(), sym1), sym2);
    const result = renameLibraryItem(library, sym1.id, "AlphaRenamed");
    expect(result.items.find((i) => i.id === sym2.id)?.name).toBe("Beta");
  });
});

// ---------------------------------------------------------------------------
// addLibraryFolder
// ---------------------------------------------------------------------------

describe("addLibraryFolder", () => {
  it("adds a folder to the library", () => {
    const library = makeEmptyLibrary();
    const folder = createLibraryFolder("Assets");
    const result = addLibraryFolder(library, folder);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]!.id).toBe(folder.id);
  });

  it("is immutable — original library is unchanged", () => {
    const library = makeEmptyLibrary();
    const folder = createLibraryFolder("Assets");
    const result = addLibraryFolder(library, folder);
    expect(result).not.toBe(library);
    expect(library.folders).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeLibraryFolder
// ---------------------------------------------------------------------------

describe("removeLibraryFolder", () => {
  it("removes a folder by id", () => {
    const folder = createLibraryFolder("Assets");
    const library = addLibraryFolder(makeEmptyLibrary(), folder);
    const result = removeLibraryFolder(library, folder.id);
    expect(result.folders.find((f) => f.id === folder.id)).toBeUndefined();
    expect(result.folders).toHaveLength(0);
  });

  it("with unknown id leaves folders unchanged", () => {
    const folder = createLibraryFolder("Assets");
    const library = addLibraryFolder(makeEmptyLibrary(), folder);
    const result = removeLibraryFolder(library, "nonexistent-id");
    expect(result.folders).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findLibraryItem
// ---------------------------------------------------------------------------

describe("findLibraryItem", () => {
  it("finds an item by id", () => {
    const { library, symbol } = makeLibraryWithSymbol("Target");
    const found = findLibraryItem(library, symbol.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(symbol.id);
    expect(found?.name).toBe("Target");
  });

  it("returns undefined for unknown id", () => {
    const { library } = makeLibraryWithSymbol();
    const found = findLibraryItem(library, "nonexistent-id");
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getLibraryItemsByType
// ---------------------------------------------------------------------------

describe("getLibraryItemsByType", () => {
  it("returns only items of the specified type", () => {
    const symbol = createSymbol("Hero", "movieclip");
    const bitmap = createBitmap("Background");
    const sound = createSound("Music");
    const library = addLibraryItem(
      addLibraryItem(addLibraryItem(createLibrary(), symbol), bitmap),
      sound
    );

    const symbols = getLibraryItemsByType(library, "symbol");
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.id).toBe(symbol.id);

    const bitmaps = getLibraryItemsByType(library, "bitmap");
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0]!.id).toBe(bitmap.id);

    const sounds = getLibraryItemsByType(library, "sound");
    expect(sounds).toHaveLength(1);
    expect(sounds[0]!.id).toBe(sound.id);
  });

  it("returns empty array when no items match the type", () => {
    const { library } = makeLibraryWithSymbol();
    const result = getLibraryItemsByType(library, "video");
    expect(result).toHaveLength(0);
  });

  it("returns multiple items of the same type", () => {
    const sym1 = createSymbol("A", "movieclip");
    const sym2 = createSymbol("B", "button");
    const library = addLibraryItem(addLibraryItem(createLibrary(), sym1), sym2);
    const result = getLibraryItemsByType(library, "symbol");
    expect(result).toHaveLength(2);
  });
});
