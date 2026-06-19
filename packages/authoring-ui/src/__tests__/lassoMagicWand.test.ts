/**
 * Unit tests for the Lasso Magic Wand sub-mode at the authoring-ui layer.
 *
 * The selection ALGORITHMS (rgbDistance, floodFillPixels, traceBoundary,
 * chaikin, douglasPeucker, selectedPixelsToBoundingPolygon) now live in
 * @flash/core (engine/magicWand) and are exhaustively tested there
 * (packages/core/src/engine/__tests__/magicWand.test.ts) — importing them here
 * instead of copying keeps the UI integration honest and prevents drift.
 *
 * This file covers the UI-facing surface:
 *   - ToolState field defaults / round-trips for magic-wand properties
 *   - A smoke test that the imported core pipeline behaves as the UI expects
 */

import { describe, it, expect } from "vitest";
import type { ToolState } from "../tools/types";
import {
  floodFillPixels,
  selectedPixelsToBoundingPolygon,
} from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers — build synthetic pixel data
// ---------------------------------------------------------------------------

/**
 * Create a 1-byte-per-channel RGBA Uint8ClampedArray for a grid of pixels.
 * Each entry in `colors` is [r, g, b, a] for one pixel (row-major order).
 */
function makePixelData(colors: [number, number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  for (let i = 0; i < colors.length; i++) {
    data[i * 4 + 0] = colors[i][0];
    data[i * 4 + 1] = colors[i][1];
    data[i * 4 + 2] = colors[i][2];
    data[i * 4 + 3] = colors[i][3];
  }
  return data;
}

// ---------------------------------------------------------------------------
// ToolState type checks — verifies the fields exist in the type
// ---------------------------------------------------------------------------

describe("ToolState — magic wand fields", () => {
  it("lassoMagicWand is an optional boolean in ToolState", () => {
    const state: ToolState = {
      activeTool: "lasso",
      objectDrawing: false,
      strokeColor: "#000000",
      fill: null,
      fillColor: null,
      strokeWidth: 1,
      strokeAlpha: 100,
      lassoMagicWand: true,
    };
    expect(state.lassoMagicWand).toBe(true);
  });

  it("magicWandThreshold defaults to undefined when not set", () => {
    const state: ToolState = {
      activeTool: "lasso",
      objectDrawing: false,
      strokeColor: "#000000",
      fill: null,
      fillColor: null,
      strokeWidth: 1,
      strokeAlpha: 100,
    };
    expect(state.magicWandThreshold).toBeUndefined();
  });

  it("magicWandThreshold round-trips through state update", () => {
    const initial: ToolState = {
      activeTool: "lasso",
      objectDrawing: false,
      strokeColor: "#000000",
      fill: null,
      fillColor: null,
      strokeWidth: 1,
      strokeAlpha: 100,
      magicWandThreshold: 20,
    };
    const updated: ToolState = { ...initial, magicWandThreshold: 75 };
    expect(updated.magicWandThreshold).toBe(75);
    expect(initial.magicWandThreshold).toBe(20); // no mutation
  });

  it("magicWandSmoothing accepts all valid values", () => {
    const modes: Array<"pixels" | "rough" | "normal" | "smooth"> = ["pixels", "rough", "normal", "smooth"];
    for (const mode of modes) {
      const state: ToolState = {
        activeTool: "lasso",
        objectDrawing: false,
        strokeColor: "#000000",
        fill: null,
        fillColor: null,
        strokeWidth: 1,
        strokeAlpha: 100,
        magicWandSmoothing: mode,
      };
      expect(state.magicWandSmoothing).toBe(mode);
    }
  });

  it("lassoMagicWand toggle: false → true → false round-trips", () => {
    let state: ToolState = {
      activeTool: "lasso",
      objectDrawing: false,
      strokeColor: "#000000",
      fill: null,
      fillColor: null,
      strokeWidth: 1,
      strokeAlpha: 100,
      lassoMagicWand: false,
    };
    state = { ...state, lassoMagicWand: true };
    expect(state.lassoMagicWand).toBe(true);
    state = { ...state, lassoMagicWand: false };
    expect(state.lassoMagicWand).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test — the imported core pipeline behaves as the UI uses it
// ---------------------------------------------------------------------------

describe("Magic Wand pipeline (via @flash/core)", () => {
  it("flood-fill → bounding polygon maps a red region to stage coordinates", () => {
    // 4×4 image: top-left 2×2 is red, rest is blue
    const red: [number, number, number, number] = [255, 0, 0, 255];
    const blue: [number, number, number, number] = [0, 0, 255, 255];
    const data = makePixelData([
      red, red, blue, blue,
      red, red, blue, blue,
      blue, blue, blue, blue,
      blue, blue, blue, blue,
    ]);

    const selected = floodFillPixels(data, 4, 4, 0, 0, 20);
    expect(selected.size).toBe(4);

    // 4×4 image in a 40×40 bitmap at (100, 200); "pixels" → exact AABB.
    const bitmapObj = { x: 100, y: 200, width: 40, height: 40 };
    const polygon = selectedPixelsToBoundingPolygon(selected, 4, 4, bitmapObj, "pixels");
    expect(polygon).toEqual([
      { x: 100, y: 200 },
      { x: 120, y: 200 },
      { x: 120, y: 220 },
      { x: 100, y: 220 },
    ]);
  });
});
