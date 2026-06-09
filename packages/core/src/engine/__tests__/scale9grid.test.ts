/**
 * Tests for Symbol 9-slice scaling grid (scale9Grid).
 *
 * Tests:
 * 1. A Symbol with scale9Grid set has scale9Grid accessible
 * 2. FLA round-trip: save a doc with a symbol having scale9Grid, loadFla, verify the grid is preserved
 * 3. A Symbol with scale9Grid=null has no grid
 * 4. scale9Grid.x, .y, .width, .height are all correct after round-trip
 */

import { describe, it, expect } from "vitest";
import { createDocument } from "../../model/document.js";
import { createSymbol } from "../../model/library.js";
import { saveFla, loadFla } from "../../fla/zip.js";
import type { Symbol, Scale9Grid } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal document with a single symbol in its library
// ---------------------------------------------------------------------------

function makeDocWithSymbol(symbol: Symbol) {
  return createDocument({
    library: { items: [symbol], folders: [] },
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Symbol scale9Grid", () => {
  /**
   * Test 1: A Symbol with scale9Grid set has scale9Grid accessible.
   */
  it("1. A Symbol with scale9Grid set has scale9Grid accessible", () => {
    const grid: Scale9Grid = { x: 10, y: 10, width: 80, height: 80 };
    const symbol = createSymbol("ScaledMC", "movieclip", { scale9Grid: grid });

    expect(symbol.scale9Grid).not.toBeNull();
    expect(symbol.scale9Grid).toEqual({ x: 10, y: 10, width: 80, height: 80 });
  });

  /**
   * Test 2: FLA round-trip preserves scale9Grid.
   */
  it("2. FLA round-trip preserves scale9Grid", () => {
    const grid: Scale9Grid = { x: 10, y: 10, width: 80, height: 80 };
    const symbol: Symbol = {
      id: "sym1",
      name: "ScaledMC",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [] },
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: false,
        linkageIdentifier: "",
        className: "",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: grid,
    };

    const doc = makeDocWithSymbol(symbol);
    const restored = loadFla(saveFla(doc));

    const restoredSymbol = restored.library.items.find(
      (i) => i.id === "sym1"
    ) as Symbol | undefined;

    expect(restoredSymbol).toBeDefined();
    expect(restoredSymbol?.itemType).toBe("symbol");
    expect(restoredSymbol?.scale9Grid).not.toBeNull();
    expect(restoredSymbol?.scale9Grid).toEqual({ x: 10, y: 10, width: 80, height: 80 });
  });

  /**
   * Test 3: A Symbol with scale9Grid=null has no grid.
   */
  it("3. A Symbol with scale9Grid=null has no grid", () => {
    const symbol = createSymbol("NoGridMC", "movieclip", { scale9Grid: null });

    expect(symbol.scale9Grid).toBeNull();
  });

  /**
   * Test 4: scale9Grid.x, .y, .width, .height are all correct after round-trip.
   */
  it("4. scale9Grid.x, .y, .width, .height are all correct after round-trip", () => {
    const grid: Scale9Grid = { x: 15, y: 25, width: 70, height: 60 };
    const symbol: Symbol = {
      id: "sym2",
      name: "GridMC",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [] },
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: false,
        linkageIdentifier: "",
        className: "",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: grid,
    };

    const doc = makeDocWithSymbol(symbol);
    const restored = loadFla(saveFla(doc));

    const restoredSymbol = restored.library.items.find(
      (i) => i.id === "sym2"
    ) as Symbol | undefined;

    expect(restoredSymbol?.scale9Grid?.x).toBe(15);
    expect(restoredSymbol?.scale9Grid?.y).toBe(25);
    expect(restoredSymbol?.scale9Grid?.width).toBe(70);
    expect(restoredSymbol?.scale9Grid?.height).toBe(60);
  });

  /**
   * Bonus: null scale9Grid also round-trips correctly via FLA.
   */
  it("5. scale9Grid=null is preserved through FLA round-trip", () => {
    const symbol: Symbol = {
      id: "sym3",
      name: "NullGridMC",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [] },
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: false,
        linkageIdentifier: "",
        className: "",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: null,
    };

    const doc = makeDocWithSymbol(symbol);
    const restored = loadFla(saveFla(doc));

    const restoredSymbol = restored.library.items.find(
      (i) => i.id === "sym3"
    ) as Symbol | undefined;

    expect(restoredSymbol?.scale9Grid).toBeNull();
  });
});
