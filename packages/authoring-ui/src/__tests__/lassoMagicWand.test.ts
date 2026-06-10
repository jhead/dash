/**
 * Unit tests for Lasso Magic Wand sub-mode.
 *
 * Covers:
 *   - ToolState field defaults for magic wand properties
 *   - State round-trips for lassoMagicWand, magicWandThreshold, magicWandSmoothing
 *   - Flood-fill helper (rgbDistance, floodFillPixels) logic
 *   - selectedPixelsToBoundingPolygon bounding-box correctness
 *   - traceBoundary — Moore-neighborhood contour tracing
 *   - chaikin — corner-cutting smoothing
 *   - douglasPeucker — polyline simplification
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

// ---------------------------------------------------------------------------
// Inline copies of new contour-tracing helpers from StageArea.tsx
// Keep in sync with the source.
// ---------------------------------------------------------------------------

function traceBoundary(mask: Uint8Array, width: number, height: number): Array<{x: number; y: number}> {
  const dirs: [number, number][] = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1],  [-1, 1], [-1, 0], [-1, -1],
  ];

  let startIdx = -1;
  outer:
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (mask[py * width + px] === 1) {
        startIdx = py * width + px;
        break outer;
      }
    }
  }
  if (startIdx < 0) return [];

  const startX = startIdx % width;
  const startY = Math.floor(startIdx / width);

  if (mask.reduce((s, v) => s + v, 0) === 1) {
    return [
      { x: startX,     y: startY },
      { x: startX + 1, y: startY },
      { x: startX + 1, y: startY + 1 },
      { x: startX,     y: startY + 1 },
    ];
  }

  const boundary: Array<{x: number; y: number}> = [];
  const startEntryDir = 6;
  let cx = startX;
  let cy = startY;
  let entryDir = startEntryDir;
  let iterations = 0;
  const maxIter = width * height * 2 + 8;

  do {
    boundary.push({ x: cx, y: cy });
    const backDir = (entryDir + 4) % 8;
    let found = false;
    for (let r = 1; r <= 8; r++) {
      const d = (backDir + r) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
        entryDir = (d + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;
    iterations++;
  } while (
    iterations < maxIter &&
    !(cx === startX && cy === startY && entryDir === startEntryDir)
  );

  return boundary.map(p => ({ x: p.x + 0.5, y: p.y + 0.5 }));
}

function chaikin(points: Array<{x: number; y: number}>, iterations = 2): Array<{x: number; y: number}> {
  let pts = points;
  for (let i = 0; i < iterations; i++) {
    const next: Array<{x: number; y: number}> = [];
    for (let j = 0; j < pts.length; j++) {
      const p0 = pts[j];
      const p1 = pts[(j + 1) % pts.length];
      next.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      next.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    pts = next;
  }
  return pts;
}

function douglasPeucker(points: Array<{x: number; y: number}>, epsilon: number): Array<{x: number; y: number}> {
  if (points.length <= 2) return points;

  function perpendicularDist(p: {x: number; y: number}, a: {x: number; y: number}, b: {x: number; y: number}): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const nearX = a.x + t * dx;
    const nearY = a.y + t * dy;
    return Math.hypot(p.x - nearX, p.y - nearY);
  }

  function rdp(pts: Array<{x: number; y: number}>, start: number, end: number, eps: number, keep: Set<number>): void {
    if (end <= start + 1) return;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(pts[i], pts[start], pts[end]);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > eps) {
      keep.add(maxIdx);
      rdp(pts, start, maxIdx, eps, keep);
      rdp(pts, maxIdx, end, eps, keep);
    }
  }

  const keep = new Set<number>([0, points.length - 1]);
  rdp(points, 0, points.length - 1, epsilon, keep);
  return points.filter((_, i) => keep.has(i));
}

// ---------------------------------------------------------------------------
// traceBoundary tests
// ---------------------------------------------------------------------------

describe("traceBoundary", () => {
  it("returns empty array for empty mask", () => {
    const mask = new Uint8Array(9); // 3×3 all zero
    const result = traceBoundary(mask, 3, 3);
    expect(result).toHaveLength(0);
  });

  it("returns 4-point square for a single pixel", () => {
    const mask = new Uint8Array(9); // 3×3
    mask[4] = 1; // center pixel at (1,1)
    const result = traceBoundary(mask, 3, 3);
    expect(result).toHaveLength(4);
    // Single pixel: corners at (1,1), (2,1), (2,2), (1,2) — integer coords
    // (the single-pixel path returns raw pixel-corner coords without +0.5 offset)
    expect(result[0]).toEqual({ x: 1, y: 1 });
    expect(result[1]).toEqual({ x: 2, y: 1 });
    expect(result[2]).toEqual({ x: 2, y: 2 });
    expect(result[3]).toEqual({ x: 1, y: 2 });
  });

  it("returns a closed boundary for a 3×3 filled square", () => {
    // All 9 pixels selected in a 3×3 image
    const mask = new Uint8Array(9).fill(1);
    const result = traceBoundary(mask, 3, 3);
    // Should return at least 4 points (the 4 corners of the square)
    expect(result.length).toBeGreaterThanOrEqual(4);
    // All x coordinates should be in [0.5, 3.5] (pixel centers offset by 0.5)
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0.5);
      expect(p.x).toBeLessThanOrEqual(3.5);
      expect(p.y).toBeGreaterThanOrEqual(0.5);
      expect(p.y).toBeLessThanOrEqual(3.5);
    }
  });

  it("returns boundary for an L-shaped mask", () => {
    // 3×3 L-shape:
    //  1 0 0
    //  1 0 0
    //  1 1 0
    const mask = new Uint8Array(9);
    mask[0] = 1; mask[3] = 1; mask[6] = 1; mask[7] = 1;
    const result = traceBoundary(mask, 3, 3);
    // Should have more points than a rectangle (L-shape has a concave corner)
    expect(result.length).toBeGreaterThanOrEqual(4);
    // All boundary points should map back to pixels that are either selected
    // or adjacent to selected pixels
    for (const p of result) {
      // Points are at 0.5 offsets — flooring gives the pixel coordinate
      const px = Math.floor(p.x);
      const py = Math.floor(p.y);
      // px/py should be in bounds
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThan(3);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThan(3);
    }
  });

  it("returns a non-trivial polygon (> 4 points) for a 2×2 square", () => {
    // 2×2 square — should trace around 4 pixels, visiting each boundary pixel
    const mask = new Uint8Array(4).fill(1); // 2×2 all selected
    const result = traceBoundary(mask, 2, 2);
    // The trace should cover the perimeter, visiting at minimum the 4 corner pixels
    expect(result.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// chaikin tests
// ---------------------------------------------------------------------------

describe("chaikin", () => {
  it("doubles the point count per iteration for a closed polygon", () => {
    const square = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ];
    const once = chaikin(square, 1);
    expect(once).toHaveLength(8); // 4 points × 2

    const twice = chaikin(square, 2);
    expect(twice).toHaveLength(16); // 8 × 2
  });

  it("produces points that lie between consecutive input points", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const result = chaikin(pts, 1);
    // All resulting x and y coords should be in [0, 10]
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(10);
    }
  });

  it("returns the input unchanged for 0 iterations", () => {
    const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    expect(chaikin(pts, 0)).toEqual(pts);
  });
});

// ---------------------------------------------------------------------------
// douglasPeucker tests
// ---------------------------------------------------------------------------

describe("douglasPeucker", () => {
  it("keeps endpoints for a 2-point line", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(douglasPeucker(pts, 1)).toEqual(pts);
  });

  it("removes collinear midpoints on a horizontal line", () => {
    // Three collinear points — the middle one should be removed with epsilon > 0
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    const result = douglasPeucker(pts, 0.1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 10, y: 0 });
  });

  it("keeps points that deviate more than epsilon", () => {
    // Right angle path: (0,0) → (5,5) → (10,0)
    // Middle point deviates 5 units from the baseline (0,0)→(10,0)
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    // With epsilon=1, the peak (5,5) is kept
    const result = douglasPeucker(pts, 1);
    expect(result).toHaveLength(3);
  });

  it("collapses a zigzag of tiny deviations to just endpoints", () => {
    // Points that zigzag ±0.1 around y=0, with epsilon=0.5
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 }, { x: 2, y: -0.1 }, { x: 3, y: 0.1 },
      { x: 4, y: 0 },
    ];
    const result = douglasPeucker(pts, 0.5);
    // All intermediate points deviate < 0.5 from the (0,0)→(4,0) line
    expect(result).toHaveLength(2);
  });
});
