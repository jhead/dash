/**
 * Unit tests for SymbolPropertiesDialog data logic.
 *
 * Covers:
 *   1. scale9Grid is preserved in SymbolPropertiesData when non-null
 *   2. scale9Grid is null when not a movieclip (non-MC types should not carry grid)
 *   3. scale9Grid fields are parsed as numbers
 *   4. symbolType round-trips through SymbolPropertiesData
 */

import { describe, it, expect } from "vitest";
import type { SymbolPropertiesData } from "../SymbolPropertiesDialog.js";
import type { Scale9Grid } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers that mirror the dialog's handleOk logic (pure functions for testing)
// ---------------------------------------------------------------------------

function buildSymbolPropertiesData(opts: {
  name: string;
  symbolType: "movieclip" | "button" | "graphic";
  gridEnabled: boolean;
  gridX: string;
  gridY: string;
  gridW: string;
  gridH: string;
}): SymbolPropertiesData {
  const { name, symbolType, gridEnabled, gridX, gridY, gridW, gridH } = opts;
  let scale9Grid: Scale9Grid | null = null;
  if (gridEnabled && symbolType === "movieclip") {
    scale9Grid = {
      x: parseFloat(gridX) || 0,
      y: parseFloat(gridY) || 0,
      width: parseFloat(gridW) || 0,
      height: parseFloat(gridH) || 0,
    };
  }
  return {
    name,
    symbolType,
    linkage: {
      exportForActionScript: false,
      linkageIdentifier: "",
      className: "",
      exportInFirstFrame: false,
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: "",
    },
    scale9Grid,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SymbolPropertiesDialog data logic", () => {
  it("scale9Grid is null when grid is disabled", () => {
    const data = buildSymbolPropertiesData({
      name: "MyClip",
      symbolType: "movieclip",
      gridEnabled: false,
      gridX: "10",
      gridY: "20",
      gridW: "100",
      gridH: "80",
    });
    expect(data.scale9Grid).toBeNull();
  });

  it("scale9Grid is null for non-movieclip types even if gridEnabled", () => {
    const dataBtn = buildSymbolPropertiesData({
      name: "MyButton",
      symbolType: "button",
      gridEnabled: true,
      gridX: "5",
      gridY: "5",
      gridW: "50",
      gridH: "40",
    });
    expect(dataBtn.scale9Grid).toBeNull();

    const dataGrfx = buildSymbolPropertiesData({
      name: "MyGraphic",
      symbolType: "graphic",
      gridEnabled: true,
      gridX: "5",
      gridY: "5",
      gridW: "50",
      gridH: "40",
    });
    expect(dataGrfx.scale9Grid).toBeNull();
  });

  it("scale9Grid has correct numeric values when enabled for movieclip", () => {
    const data = buildSymbolPropertiesData({
      name: "MyClip",
      symbolType: "movieclip",
      gridEnabled: true,
      gridX: "10",
      gridY: "20",
      gridW: "100",
      gridH: "80",
    });
    expect(data.scale9Grid).toEqual({ x: 10, y: 20, width: 100, height: 80 });
  });

  it("scale9Grid defaults to 0 for non-numeric inputs", () => {
    const data = buildSymbolPropertiesData({
      name: "MyClip",
      symbolType: "movieclip",
      gridEnabled: true,
      gridX: "",
      gridY: "abc",
      gridW: "50.5",
      gridH: "0",
    });
    expect(data.scale9Grid).toEqual({ x: 0, y: 0, width: 50.5, height: 0 });
  });

  it("symbolType round-trips for all types", () => {
    for (const type of ["movieclip", "button", "graphic"] as const) {
      const data = buildSymbolPropertiesData({
        name: "TestSymbol",
        symbolType: type,
        gridEnabled: false,
        gridX: "0",
        gridY: "0",
        gridW: "0",
        gridH: "0",
      });
      expect(data.symbolType).toBe(type);
    }
  });

  it("name is preserved in result", () => {
    const data = buildSymbolPropertiesData({
      name: "My Symbol Name",
      symbolType: "movieclip",
      gridEnabled: false,
      gridX: "0",
      gridY: "0",
      gridW: "0",
      gridH: "0",
    });
    expect(data.name).toBe("My Symbol Name");
  });
});
