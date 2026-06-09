/**
 * Unit tests for convertSymbolType in model/library.ts.
 * Verifies that symbol type conversions are immutable and correct.
 */

import { describe, it, expect } from "vitest";
import {
  createLibrary,
  createSymbol,
  addLibraryItem,
  convertSymbolType,
  createBitmap,
} from "../library.js";
import type { Library } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLibraryWithSymbol(symbolType: "movieclip" | "button" | "graphic" = "movieclip") {
  const symbol = createSymbol("MySymbol", symbolType);
  const library = addLibraryItem(createLibrary(), symbol);
  return { library, symbol };
}

// ---------------------------------------------------------------------------
// convertSymbolType
// ---------------------------------------------------------------------------

describe("convertSymbolType", () => {
  it("changes symbolType from 'movieclip' to 'button'", () => {
    const { library, symbol } = makeLibraryWithSymbol("movieclip");
    const result = convertSymbolType(library, symbol.id, "button");
    const item = result.items.find((i) => i.id === symbol.id);
    expect(item).toBeDefined();
    expect(item!.itemType).toBe("symbol");
    if (item!.itemType === "symbol") {
      expect(item!.symbolType).toBe("button");
    }
  });

  it("changes 'graphic' to 'movieclip'", () => {
    const { library, symbol } = makeLibraryWithSymbol("graphic");
    const result = convertSymbolType(library, symbol.id, "movieclip");
    const item = result.items.find((i) => i.id === symbol.id);
    expect(item).toBeDefined();
    if (item!.itemType === "symbol") {
      expect(item!.symbolType).toBe("movieclip");
    }
  });

  it("original library is not mutated", () => {
    const { library, symbol } = makeLibraryWithSymbol("movieclip");
    const originalItem = library.items.find((i) => i.id === symbol.id)!;
    convertSymbolType(library, symbol.id, "button");
    // Original library item must still have original type
    if (originalItem.itemType === "symbol") {
      expect(originalItem.symbolType).toBe("movieclip");
    }
    // Original library items array must be unchanged
    expect(library.items).toHaveLength(1);
  });

  it("timeline content is preserved after conversion", () => {
    const { library, symbol } = makeLibraryWithSymbol("movieclip");
    const originalTimeline = symbol.timeline;
    const result = convertSymbolType(library, symbol.id, "graphic");
    const item = result.items.find((i) => i.id === symbol.id);
    expect(item).toBeDefined();
    if (item!.itemType === "symbol") {
      expect(item!.timeline).toBe(originalTimeline);
    }
  });

  it("unknown symbolId leaves library unchanged", () => {
    const { library } = makeLibraryWithSymbol("movieclip");
    const result = convertSymbolType(library, "nonexistent-id", "button");
    expect(result.items).toEqual(library.items);
  });

  it("non-symbol item id is ignored (itemType !== 'symbol')", () => {
    const bitmap = createBitmap("MyBitmap");
    const library = addLibraryItem(createLibrary(), bitmap);
    const result = convertSymbolType(library, bitmap.id, "button");
    // Bitmap item must be unchanged
    const item = result.items.find((i) => i.id === bitmap.id);
    expect(item).toBeDefined();
    expect(item!.itemType).toBe("bitmap");
  });

  it("converting to same type is a no-op (returns equal object)", () => {
    const { library, symbol } = makeLibraryWithSymbol("movieclip");
    const result = convertSymbolType(library, symbol.id, "movieclip");
    const item = result.items.find((i) => i.id === symbol.id);
    expect(item).toBeDefined();
    if (item!.itemType === "symbol") {
      expect(item!.symbolType).toBe("movieclip");
    }
  });
});
