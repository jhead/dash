/**
 * Unit tests for Lasso Magic Wand sub-mode.
 *
 * Covers:
 *   - ToolState field defaults for magic wand properties
 *   - State round-trips for lassoMagicWand, magicWandThreshold, magicWandSmoothing
 *   - Flood-fill helper (rgbDistance, floodFillPixels) logic
 *   - selectedPixelsToBoundingPolygon bounding-box correctness
 */

import { describe, it, expect } from "vitest";
import type { ToolState } from "../tools/types";

// ---------------------------------------------------------------------------
// Inline copies of the pure helpers from StageArea.tsx
// Keep in sync with the source.
// ---------------------------------------------------------------------------

function rgbDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function floodFillPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  threshold: number,
): Set<number> {
  const selected = new Set<number>();
  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return selected;

  const startIdx = (sy * width + sx) * 4;
  const seedR = data[startIdx];
  const seedG = data[startIdx + 1];
  const seedB = data[startIdx + 2];

  const queue: number[] = [sy * width + sx];
  selected.add(sy * width + sx);

  while (queue.length > 0) {
    const pixelIdx = queue.pop()!;
    const px = pixelIdx % width;
    const py = Math.floor(pixelIdx / width);

    const neighbors: [number, number][] = [
      [px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (selected.has(ni)) continue;
      const nDataIdx = ni * 4;
      const dist = rgbDistance(data[nDataIdx], data[nDataIdx + 1], data[nDataIdx + 2], seedR, seedG, seedB);
      if (dist <= threshold) {
        selected.add(ni);
        queue.push(ni);
      }
    }
  }
  return selected;
}

interface BitmapObjLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

function selectedPixelsToBoundingPolygon(
  pixels: Set<number>,
  imgWidth: number,
  imgHeight: number,
  bitmapObj: BitmapObjLike,
): { x: number; y: number }[] {
  if (pixels.size === 0) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const idx of pixels) {
    const px = idx % imgWidth;
    const py = Math.floor(idx / imgWidth);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  const sx = bitmapObj.width / imgWidth;
  const sy = bitmapObj.height / imgHeight;

  return [
    { x: bitmapObj.x + minX * sx,       y: bitmapObj.y + minY * sy },
    { x: bitmapObj.x + (maxX + 1) * sx, y: bitmapObj.y + minY * sy },
    { x: bitmapObj.x + (maxX + 1) * sx, y: bitmapObj.y + (maxY + 1) * sy },
    { x: bitmapObj.x + minX * sx,       y: bitmapObj.y + (maxY + 1) * sy },
  ];
}

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
// rgbDistance helper
// ---------------------------------------------------------------------------

describe("rgbDistance", () => {
  it("returns 0 for identical colors", () => {
    expect(rgbDistance(100, 150, 200, 100, 150, 200)).toBe(0);
  });

  it("returns correct distance for pure red vs pure green", () => {
    // sqrt(255^2 + 255^2) ≈ 360.6
    const d = rgbDistance(255, 0, 0, 0, 255, 0);
    expect(d).toBeCloseTo(360.6, 0);
  });

  it("returns correct distance for black vs white", () => {
    // sqrt(255^2 + 255^2 + 255^2) ≈ 441.7
    const d = rgbDistance(0, 0, 0, 255, 255, 255);
    expect(d).toBeCloseTo(441.7, 0);
  });

  it("is symmetric", () => {
    const d1 = rgbDistance(10, 20, 30, 40, 50, 60);
    const d2 = rgbDistance(40, 50, 60, 10, 20, 30);
    expect(d1).toBeCloseTo(d2, 10);
  });
});

// ---------------------------------------------------------------------------
// floodFillPixels helper
// ---------------------------------------------------------------------------

describe("floodFillPixels", () => {
  it("returns empty set for out-of-bounds start point", () => {
    const data = makePixelData([[255, 0, 0, 255]]);
    const result = floodFillPixels(data, 1, 1, -1, 0, 10);
    expect(result.size).toBe(0);
  });

  it("selects single pixel in a 1×1 image", () => {
    const data = makePixelData([[200, 100, 50, 255]]);
    const result = floodFillPixels(data, 1, 1, 0, 0, 10);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  it("selects all identical pixels in a uniform 2×2 image", () => {
    const red: [number, number, number, number] = [255, 0, 0, 255];
    const data = makePixelData([red, red, red, red]);
    const result = floodFillPixels(data, 2, 2, 0, 0, 0);
    expect(result.size).toBe(4);
  });

  it("respects threshold — does not cross high-contrast boundary", () => {
    // 2×2: top-left is red, rest is blue
    const data = makePixelData([
      [255, 0, 0, 255],   // (0,0) red
      [0, 0, 255, 255],   // (1,0) blue
      [0, 0, 255, 255],   // (0,1) blue
      [0, 0, 255, 255],   // (1,1) blue
    ]);
    // Threshold of 10 — red vs blue distance ≈ 360, so only (0,0) selected
    const result = floodFillPixels(data, 2, 2, 0, 0, 10);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  it("fills a contiguous similar-color region (3×3 checkerboard-like)", () => {
    // 3×3: center is white (similar to top-left), corners alternate
    const white: [number, number, number, number] = [250, 250, 250, 255];
    const black: [number, number, number, number] = [5, 5, 5, 255];
    const data = makePixelData([
      white, black, white,
      black, white, black,
      white, black, white,
    ]);
    // Seed at (0,0) white, threshold=30 — should select all white pixels
    // White pixels: (0,0)=0, (2,0)=2, (1,1)=4, (0,2)=6, (2,2)=8
    // BUT they're not 4-connected to each other through black pixels
    // Only the seed (0,0) can be selected since neighbors are black
    const result = floodFillPixels(data, 3, 3, 0, 0, 30);
    expect(result.has(0)).toBe(true);   // seed
    expect(result.has(1)).toBe(false);  // black neighbor not included
    expect(result.size).toBe(1);
  });

  it("fills an L-shaped region correctly", () => {
    // 3×3: L-shape of white pixels
    //  W W .
    //  W . .
    //  W . .
    const white: [number, number, number, number] = [200, 200, 200, 255];
    const black: [number, number, number, number] = [10, 10, 10, 255];
    const data = makePixelData([
      white, white, black,
      white, black, black,
      white, black, black,
    ]);
    const result = floodFillPixels(data, 3, 3, 0, 0, 30);
    // Should select pixels: (0,0)=0, (1,0)=1, (0,1)=3, (0,2)=6
    expect(result.has(0)).toBe(true);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has(6)).toBe(true);
    expect(result.size).toBe(4);
  });

  it("high threshold selects everything in a varied image", () => {
    // 2×2 with very different colors — high threshold 500 selects all
    const data = makePixelData([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [128, 128, 128, 255],
    ]);
    const result = floodFillPixels(data, 2, 2, 0, 0, 500);
    expect(result.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// selectedPixelsToBoundingPolygon helper
// ---------------------------------------------------------------------------

describe("selectedPixelsToBoundingPolygon", () => {
  it("returns empty array for empty pixel set", () => {
    const polygon = selectedPixelsToBoundingPolygon(new Set(), 10, 10, { x: 0, y: 0, width: 100, height: 100 });
    expect(polygon).toHaveLength(0);
  });

  it("returns 4-point bounding box for a single pixel", () => {
    // Pixel at (3,3) in a 10×10 image mapped to a 100×100 stage bitmap
    const pixels = new Set([3 * 10 + 3]); // index = y*w + x = 33
    const bitmapObj = { x: 50, y: 50, width: 100, height: 100 };
    const polygon = selectedPixelsToBoundingPolygon(pixels, 10, 10, bitmapObj);
    expect(polygon).toHaveLength(4);
    // Scale: 100/10 = 10 px per pixel
    // minX=3, maxX=3 → stageX range = 50 + 3*10 to 50 + 4*10 = 80 to 90
    // minY=3, maxY=3 → stageY range = 50 + 3*10 to 50 + 4*10 = 80 to 90
    expect(polygon[0]).toEqual({ x: 80, y: 80 }); // top-left
    expect(polygon[1]).toEqual({ x: 90, y: 80 }); // top-right
    expect(polygon[2]).toEqual({ x: 90, y: 90 }); // bottom-right
    expect(polygon[3]).toEqual({ x: 80, y: 90 }); // bottom-left
  });

  it("returns correct bounding box for multiple pixels spanning a region", () => {
    // Pixels at (0,0), (1,0), (0,1) in a 4×4 image mapped to 40×40 stage bitmap at (10,20)
    const pixels = new Set([0, 1, 4]); // (0,0)=0, (1,0)=1, (0,1)=4
    const bitmapObj = { x: 10, y: 20, width: 40, height: 40 };
    const polygon = selectedPixelsToBoundingPolygon(pixels, 4, 4, bitmapObj);
    // Scale: 40/4 = 10 px per pixel
    // minX=0, maxX=1 → stageX range = 10+0 to 10+2*10 = 10 to 30
    // minY=0, maxY=1 → stageY range = 20+0 to 20+2*10 = 20 to 40
    expect(polygon[0]).toEqual({ x: 10, y: 20 }); // top-left
    expect(polygon[1]).toEqual({ x: 30, y: 20 }); // top-right
    expect(polygon[2]).toEqual({ x: 30, y: 40 }); // bottom-right
    expect(polygon[3]).toEqual({ x: 10, y: 40 }); // bottom-left
  });

  it("handles bitmaps with non-square aspect ratio", () => {
    // 4×2 image (wide), displayed as 80×20 on stage at (0,0)
    // Select all 8 pixels
    const pixels = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
    const bitmapObj = { x: 0, y: 0, width: 80, height: 20 };
    const polygon = selectedPixelsToBoundingPolygon(pixels, 4, 2, bitmapObj);
    // scaleX = 80/4 = 20; scaleY = 20/2 = 10
    // minX=0, maxX=3, minY=0, maxY=1
    expect(polygon[0]).toEqual({ x: 0, y: 0 });
    expect(polygon[1]).toEqual({ x: 80, y: 0 });   // (3+1)*20
    expect(polygon[2]).toEqual({ x: 80, y: 20 });   // (1+1)*10
    expect(polygon[3]).toEqual({ x: 0, y: 20 });
  });
});

// ---------------------------------------------------------------------------
// Integration: flood-fill → bounding polygon pipeline
// ---------------------------------------------------------------------------

describe("Magic Wand pipeline — flood-fill → bounding polygon", () => {
  it("selects a rectangular red region from a mixed image and produces correct bounds", () => {
    // 4×4 image: top-left 2×2 is red, rest is blue
    const red: [number, number, number, number] = [255, 0, 0, 255];
    const blue: [number, number, number, number] = [0, 0, 255, 255];
    const data = makePixelData([
      red,  red,  blue, blue,   // row 0
      red,  red,  blue, blue,   // row 1
      blue, blue, blue, blue,   // row 2
      blue, blue, blue, blue,   // row 3
    ]);

    // Click at (0,0) in pixel space — seeds into the red region
    const selected = floodFillPixels(data, 4, 4, 0, 0, 20);
    // Should select (0,0), (1,0), (0,1), (1,1) = indices 0, 1, 4, 5
    expect(selected.size).toBe(4);
    expect(selected.has(0)).toBe(true);
    expect(selected.has(1)).toBe(true);
    expect(selected.has(4)).toBe(true);
    expect(selected.has(5)).toBe(true);

    // Map to stage: 4×4 image in a 40×40 bitmap at (100, 200)
    const bitmapObj = { x: 100, y: 200, width: 40, height: 40 };
    const polygon = selectedPixelsToBoundingPolygon(selected, 4, 4, bitmapObj);
    // Scale = 10 px/pixel; red region spans x=[0..1], y=[0..1]
    expect(polygon[0]).toEqual({ x: 100, y: 200 }); // top-left
    expect(polygon[1]).toEqual({ x: 120, y: 200 }); // top-right  (2*10 + 100)
    expect(polygon[2]).toEqual({ x: 120, y: 220 }); // bottom-right
    expect(polygon[3]).toEqual({ x: 100, y: 220 }); // bottom-left
  });

  it("entire uniform image selected with zero threshold", () => {
    const gray: [number, number, number, number] = [128, 128, 128, 255];
    const data = makePixelData([gray, gray, gray, gray]);
    const selected = floodFillPixels(data, 2, 2, 0, 0, 0);
    expect(selected.size).toBe(4);

    const bitmapObj = { x: 0, y: 0, width: 20, height: 20 };
    const polygon = selectedPixelsToBoundingPolygon(selected, 2, 2, bitmapObj);
    expect(polygon[0]).toEqual({ x: 0, y: 0 });
    expect(polygon[2]).toEqual({ x: 20, y: 20 });
  });
});
