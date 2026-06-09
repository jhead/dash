/**
 * Unit tests for addLibraryItem, removeLibraryItem, and updateLibraryItem
 * on a FlashDocument (engine/library.ts).
 */

import { describe, it, expect } from "vitest";
import {
  addLibraryItem,
  removeLibraryItem,
  updateLibraryItem,
} from "../library.js";
import { createDocument } from "../../model/document.js";
import { createSymbol, createBitmap } from "../../model/library.js";
import type { FlashDocument, Symbol, BitmapItem } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyDoc(): FlashDocument {
  return createDocument({ library: { items: [], folders: [] } });
}

function makeDocWithSymbol(name = "MySymbol"): { doc: FlashDocument; symbol: Symbol } {
  const symbol = createSymbol(name, "movieclip");
  const doc = createDocument({ library: { items: [symbol], folders: [] } });
  return { doc, symbol };
}

// ---------------------------------------------------------------------------
// addLibraryItem
// ---------------------------------------------------------------------------

describe("addLibraryItem", () => {
  it("adds a Symbol to an empty library", () => {
    const doc = makeEmptyDoc();
    const symbol = createSymbol("Hero", "movieclip");
    const result = addLibraryItem(doc, symbol);
    expect(result.library.items).toHaveLength(1);
    expect(result.library.items[0].id).toBe(symbol.id);
  });

  it("adds a BitmapItem; library has 2 items after adding both a Symbol and a Bitmap", () => {
    const doc = makeEmptyDoc();
    const symbol = createSymbol("Hero", "movieclip");
    const bitmap = createBitmap("Background", { dataUri: "data:image/png;base64,abc" });
    const withSymbol = addLibraryItem(doc, symbol);
    const withBoth = addLibraryItem(withSymbol, bitmap);
    expect(withBoth.library.items).toHaveLength(2);
    expect(withBoth.library.items.map((i) => i.id)).toContain(symbol.id);
    expect(withBoth.library.items.map((i) => i.id)).toContain(bitmap.id);
  });

  it("does not add a duplicate (same id) item", () => {
    const symbol = createSymbol("Hero", "movieclip");
    const doc = createDocument({ library: { items: [symbol], folders: [] } });
    const result = addLibraryItem(doc, symbol);
    expect(result).toBe(doc);
    expect(result.library.items).toHaveLength(1);
  });

  it("is immutable — original doc is unchanged", () => {
    const doc = makeEmptyDoc();
    const symbol = createSymbol("Hero", "movieclip");
    const result = addLibraryItem(doc, symbol);
    expect(result).not.toBe(doc);
    expect(doc.library.items).toHaveLength(0);
    expect(result.library.items).toHaveLength(1);
  });

  it("returns a new library reference (immutable)", () => {
    const doc = makeEmptyDoc();
    const symbol = createSymbol("Hero", "movieclip");
    const result = addLibraryItem(doc, symbol);
    expect(result.library).not.toBe(doc.library);
    expect(result.library.items).not.toBe(doc.library.items);
  });
});

// ---------------------------------------------------------------------------
// removeLibraryItem
// ---------------------------------------------------------------------------

describe("removeLibraryItem", () => {
  it("removes an item by id", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = removeLibraryItem(doc, symbol.id);
    expect(result.library.items.find((i) => i.id === symbol.id)).toBeUndefined();
    expect(result.library.items).toHaveLength(0);
  });

  it("library shrinks by 1 after removal", () => {
    const sym1 = createSymbol("Alpha", "movieclip");
    const sym2 = createSymbol("Beta", "movieclip");
    const doc = createDocument({ library: { items: [sym1, sym2], folders: [] } });
    const result = removeLibraryItem(doc, sym1.id);
    expect(result.library.items).toHaveLength(1);
    expect(result.library.items[0].id).toBe(sym2.id);
  });

  it("removing a non-existent id causes no error and returns doc unchanged", () => {
    const { doc } = makeDocWithSymbol();
    const result = removeLibraryItem(doc, "nonexistent-id");
    expect(result).toBe(doc);
    expect(result.library.items).toHaveLength(1);
  });

  it("is immutable — original doc is unchanged", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = removeLibraryItem(doc, symbol.id);
    expect(result).not.toBe(doc);
    expect(doc.library.items).toHaveLength(1);
    expect(result.library.items).toHaveLength(0);
  });

  it("returns a new library reference (immutable)", () => {
    const { doc, symbol } = makeDocWithSymbol();
    const result = removeLibraryItem(doc, symbol.id);
    expect(result.library).not.toBe(doc.library);
    expect(result.library.items).not.toBe(doc.library.items);
  });
});

// ---------------------------------------------------------------------------
// updateLibraryItem
// ---------------------------------------------------------------------------

describe("updateLibraryItem", () => {
  it("replaces the item with the same id", () => {
    const { doc, symbol } = makeDocWithSymbol("Original");
    const updated: Symbol = { ...symbol, name: "Updated" };
    const result = updateLibraryItem(doc, updated);
    const found = result.library.items.find((i) => i.id === symbol.id);
    expect(found?.name).toBe("Updated");
  });

  it("library count remains the same after update", () => {
    const { doc, symbol } = makeDocWithSymbol("Original");
    const updated: Symbol = { ...symbol, name: "Updated" };
    const result = updateLibraryItem(doc, updated);
    expect(result.library.items).toHaveLength(1);
  });

  it("updates a BitmapItem by replacing dataUri", () => {
    const bitmap = createBitmap("Photo", { dataUri: "data:image/png;base64,old" });
    const doc = createDocument({ library: { items: [bitmap], folders: [] } });
    const updatedBitmap: BitmapItem = { ...bitmap, dataUri: "data:image/png;base64,new" };
    const result = updateLibraryItem(doc, updatedBitmap);
    const found = result.library.items.find((i) => i.id === bitmap.id) as BitmapItem;
    expect(found.dataUri).toBe("data:image/png;base64,new");
  });

  it("returns doc unchanged when item id does not exist", () => {
    const { doc } = makeDocWithSymbol();
    const phantom = createSymbol("Ghost", "movieclip");
    const result = updateLibraryItem(doc, phantom);
    expect(result).toBe(doc);
  });

  it("is immutable — original doc is unchanged", () => {
    const { doc, symbol } = makeDocWithSymbol("Before");
    const updated: Symbol = { ...symbol, name: "After" };
    const result = updateLibraryItem(doc, updated);
    expect(result).not.toBe(doc);
    const originalItem = doc.library.items.find((i) => i.id === symbol.id);
    expect(originalItem?.name).toBe("Before");
  });

  it("other items are not affected when one item is updated", () => {
    const sym1 = createSymbol("Alpha", "movieclip");
    const sym2 = createSymbol("Beta", "movieclip");
    const doc = createDocument({ library: { items: [sym1, sym2], folders: [] } });
    const updatedSym1: Symbol = { ...sym1, name: "AlphaRenamed" };
    const result = updateLibraryItem(doc, updatedSym1);
    const sym2After = result.library.items.find((i) => i.id === sym2.id);
    expect(sym2After?.name).toBe("Beta");
  });
});
