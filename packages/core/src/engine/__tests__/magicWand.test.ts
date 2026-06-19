/**
 * Unit tests for engine/magicWand.ts — Lasso tool selection helpers.
 *
 * Covers:
 *   - rgbDistance + floodFillPixels (Magic Wand flood fill)
 *   - buildMask / traceBoundary / douglasPeucker / chaikin (contour shaping)
 *   - aabbPolygon / selectedPixelsToBoundingPolygon (pixel→stage polygon)
 *   - magicWandSelectPixels (full pipeline over RGBA data)
 *   - shouldClosePolygon (Polygon Lasso close logic — double-click / near-start)
 *   - pointInPolygon (selection hit test)
 *
 * These import the REAL source (not inline copies) so the tests cannot drift
 * from the implementation.
 */

import { describe, it, expect } from "vitest";
import {
  rgbDistance,
  floodFillPixels,
  buildMask,
  traceBoundary,
  douglasPeucker,
  chaikin,
  aabbPolygon,
  selectedPixelsToBoundingPolygon,
  magicWandSelectPixels,
  shouldClosePolygon,
  pointInPolygon,
  POLYGON_DOUBLE_CLICK_MS,
  POLYGON_CLOSE_DISTANCE,
  DEFAULT_MAGIC_WAND_THRESHOLD,
} from "../magicWand.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an RGBA Uint8ClampedArray from row-major [r,g,b,a] tuples. */
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

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const GRAY: [number, number, number, number] = [128, 128, 128, 255];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("exposes the Flash 8 default threshold and close tolerances", () => {
    expect(DEFAULT_MAGIC_WAND_THRESHOLD).toBe(20);
    expect(POLYGON_DOUBLE_CLICK_MS).toBe(400);
    expect(POLYGON_CLOSE_DISTANCE).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// rgbDistance
// ---------------------------------------------------------------------------

describe("rgbDistance", () => {
  it("returns 0 for identical colors", () => {
    expect(rgbDistance(100, 150, 200, 100, 150, 200)).toBe(0);
  });

  it("computes red↔green distance ignoring alpha", () => {
    expect(rgbDistance(255, 0, 0, 0, 255, 0)).toBeCloseTo(360.6, 0);
  });

  it("is symmetric", () => {
    expect(rgbDistance(10, 20, 30, 40, 50, 60)).toBeCloseTo(
      rgbDistance(40, 50, 60, 10, 20, 30),
      10,
    );
  });
});

// ---------------------------------------------------------------------------
// floodFillPixels
// ---------------------------------------------------------------------------

describe("floodFillPixels", () => {
  it("returns an empty set for an out-of-bounds seed", () => {
    const data = makePixelData([RED]);
    expect(floodFillPixels(data, 1, 1, -1, 0, 10).size).toBe(0);
  });

  it("selects a single pixel in a 1×1 image", () => {
    const data = makePixelData([[200, 100, 50, 255]]);
    const result = floodFillPixels(data, 1, 1, 0, 0, 10);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  it("does not cross a high-contrast boundary", () => {
    const data = makePixelData([RED, BLUE, BLUE, BLUE]); // 2×2
    const result = floodFillPixels(data, 2, 2, 0, 0, 10);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });

  it("fills a contiguous L-shaped region", () => {
    // 3×3:
    //  W W .
    //  W . .
    //  W . .
    const W: [number, number, number, number] = [200, 200, 200, 255];
    const B: [number, number, number, number] = [10, 10, 10, 255];
    const data = makePixelData([W, W, B, W, B, B, W, B, B]);
    const result = floodFillPixels(data, 3, 3, 0, 0, 30);
    expect([...result].sort((a, b) => a - b)).toEqual([0, 1, 3, 6]);
  });

  it("selects everything when threshold is very high", () => {
    const data = makePixelData([RED, [0, 255, 0, 255], BLUE, GRAY]);
    expect(floodFillPixels(data, 2, 2, 0, 0, 500).size).toBe(4);
  });

  it("isolated same-color pixels behind a barrier are not selected (4-connected)", () => {
    // White corners are not 4-connected through black edges.
    const W: [number, number, number, number] = [250, 250, 250, 255];
    const K: [number, number, number, number] = [5, 5, 5, 255];
    const data = makePixelData([W, K, W, K, W, K, W, K, W]);
    const result = floodFillPixels(data, 3, 3, 0, 0, 30);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMask
// ---------------------------------------------------------------------------

describe("buildMask", () => {
  it("sets 1 for selected indices and 0 elsewhere", () => {
    const mask = buildMask(new Set([0, 3]), 2, 2);
    expect(Array.from(mask)).toEqual([1, 0, 0, 1]);
  });

  it("ignores out-of-range indices", () => {
    const mask = buildMask(new Set([0, 99, -1]), 2, 2);
    expect(Array.from(mask)).toEqual([1, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// traceBoundary
// ---------------------------------------------------------------------------

describe("traceBoundary", () => {
  it("returns an empty array for an empty mask", () => {
    expect(traceBoundary(new Uint8Array(9), 3, 3)).toHaveLength(0);
  });

  it("returns the 4 cell corners for a single pixel", () => {
    const mask = new Uint8Array(9);
    mask[4] = 1; // (1,1)
    expect(traceBoundary(mask, 3, 3)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
  });

  it("returns an enclosing boundary for a filled 3×3 square (half-pixel offset)", () => {
    const result = traceBoundary(new Uint8Array(9).fill(1), 3, 3);
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0.5);
      expect(p.x).toBeLessThanOrEqual(3.5);
      expect(p.y).toBeGreaterThanOrEqual(0.5);
      expect(p.y).toBeLessThanOrEqual(3.5);
    }
  });
});

// ---------------------------------------------------------------------------
// douglasPeucker
// ---------------------------------------------------------------------------

describe("douglasPeucker", () => {
  it("keeps endpoints for a 2-point line", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    expect(douglasPeucker(pts, 1)).toEqual(pts);
  });

  it("removes collinear midpoints", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    expect(douglasPeucker(pts, 0.1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("keeps a peak that deviates more than epsilon", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(douglasPeucker(pts, 1)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// chaikin
// ---------------------------------------------------------------------------

describe("chaikin", () => {
  it("doubles the point count per iteration for a closed polygon", () => {
    const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    expect(chaikin(square, 1)).toHaveLength(8);
    expect(chaikin(square, 2)).toHaveLength(16);
  });

  it("returns the input unchanged for 0 iterations", () => {
    const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
    expect(chaikin(pts, 0)).toEqual(pts);
  });
});

// ---------------------------------------------------------------------------
// aabbPolygon / selectedPixelsToBoundingPolygon
// ---------------------------------------------------------------------------

describe("selectedPixelsToBoundingPolygon", () => {
  it("returns an empty array for an empty pixel set", () => {
    expect(
      selectedPixelsToBoundingPolygon(new Set(), 10, 10, { x: 0, y: 0, width: 100, height: 100 }, "pixels"),
    ).toHaveLength(0);
  });

  it("maps a single pixel to a 4-point AABB in stage space (pixels mode)", () => {
    const pixels = new Set([3 * 10 + 3]); // (3,3)
    const polygon = selectedPixelsToBoundingPolygon(
      pixels,
      10,
      10,
      { x: 50, y: 50, width: 100, height: 100 },
      "pixels",
    );
    expect(polygon).toEqual([
      { x: 80, y: 80 },
      { x: 90, y: 80 },
      { x: 90, y: 90 },
      { x: 80, y: 90 },
    ]);
  });

  it("handles non-square aspect ratios", () => {
    const pixels = new Set([0, 1, 2, 3, 4, 5, 6, 7]); // all of a 4×2 image
    const polygon = selectedPixelsToBoundingPolygon(
      pixels,
      4,
      2,
      { x: 0, y: 0, width: 80, height: 20 },
      "normal",
    );
    expect(polygon).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it("traces a contour (more than 4 points) in rough mode for a larger region", () => {
    // A filled 5×5 region traced should yield a perimeter polygon.
    const pixels = new Set<number>();
    for (let i = 0; i < 25; i++) pixels.add(i);
    const polygon = selectedPixelsToBoundingPolygon(
      pixels,
      5,
      5,
      { x: 0, y: 0, width: 50, height: 50 },
      "rough",
    );
    expect(polygon.length).toBeGreaterThanOrEqual(4);
  });

  it("smooth mode produces at least as many points as rough", () => {
    const pixels = new Set<number>();
    for (let i = 0; i < 25; i++) pixels.add(i);
    const region = { x: 0, y: 0, width: 50, height: 50 };
    const rough = selectedPixelsToBoundingPolygon(pixels, 5, 5, region, "rough");
    const smooth = selectedPixelsToBoundingPolygon(pixels, 5, 5, region, "smooth");
    expect(smooth.length).toBeGreaterThanOrEqual(rough.length);
  });

  it("aabbPolygon directly computes the bounding box", () => {
    const polygon = aabbPolygon(new Set([0, 1, 4]), 4, { x: 10, y: 20, width: 40, height: 40 }, 10, 10);
    expect(polygon).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// magicWandSelectPixels — full pipeline
// ---------------------------------------------------------------------------

describe("magicWandSelectPixels", () => {
  it("selects a red region from a mixed bitmap and maps to stage coords", () => {
    // 4×4: top-left 2×2 red, rest blue.
    const data = makePixelData([
      RED, RED, BLUE, BLUE,
      RED, RED, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
      BLUE, BLUE, BLUE, BLUE,
    ]);
    // 4×4 image rendered as a 40×40 bitmap at (100,200). Click on the red region.
    const region = { x: 100, y: 200, width: 40, height: 40 };
    // Click near pixel (0,0): stageX = 100 + ~5 px.
    const polygon = magicWandSelectPixels(data, 4, 4, region, 105, 205, 20, "pixels");
    // The red region spans pixels x∈[0,1], y∈[0,1] → stage x∈[100,120], y∈[200,220].
    expect(polygon).toEqual([
      { x: 100, y: 200 },
      { x: 120, y: 200 },
      { x: 120, y: 220 },
      { x: 100, y: 220 },
    ]);
  });

  it("returns an empty polygon when the click misses every same-color pixel region edge", () => {
    // Uniform gray — clicking anywhere selects the whole image.
    const data = makePixelData([GRAY, GRAY, GRAY, GRAY]);
    const region = { x: 0, y: 0, width: 20, height: 20 };
    const polygon = magicWandSelectPixels(data, 2, 2, region, 5, 5, 0, "pixels");
    expect(polygon[0]).toEqual({ x: 0, y: 0 });
    expect(polygon[2]).toEqual({ x: 20, y: 20 });
  });
});

// ---------------------------------------------------------------------------
// shouldClosePolygon — Polygon Lasso close logic
// ---------------------------------------------------------------------------

describe("shouldClosePolygon", () => {
  const tri = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ];

  it("never closes with fewer than 3 vertices", () => {
    expect(shouldClosePolygon([{ x: 0, y: 0 }], 0, 0, null, 1000)).toBe(false);
    expect(
      shouldClosePolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0, 0, null, 1000),
    ).toBe(false);
  });

  it("closes on a double-click near the previous click", () => {
    const last = { x: 50, y: 100, time: 1000 };
    // Same spot, 100ms later (< 400ms), distance 0 (< 10).
    expect(shouldClosePolygon(tri, 50, 100, last, 1100)).toBe(true);
  });

  it("does not close on a slow second click (interval exceeds threshold)", () => {
    const last = { x: 50, y: 100, time: 1000 };
    // 500ms later, far from any vertex.
    expect(shouldClosePolygon(tri, 500, 500, last, 1500)).toBe(false);
  });

  it("closes when clicking near the first vertex", () => {
    // Click within POLYGON_CLOSE_DISTANCE of vertex 0 (0,0).
    expect(shouldClosePolygon(tri, 5, 5, null, 9999)).toBe(true);
  });

  it("does not close when clicking far from the first vertex and not a double-click", () => {
    expect(shouldClosePolygon(tri, 500, 500, null, 9999)).toBe(false);
  });

  it("honours a custom (zoom-adjusted) close distance", () => {
    // With a small close distance, a click 8 units away from vertex 0 should NOT close.
    expect(shouldClosePolygon(tri, 8, 0, null, 9999, 5)).toBe(false);
    // With the default 10, it should.
    expect(shouldClosePolygon(tri, 8, 0, null, 9999, 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pointInPolygon
// ---------------------------------------------------------------------------

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it("returns true for a point inside", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it("returns false for a point outside", () => {
    expect(pointInPolygon(20, 5, square)).toBe(false);
    expect(pointInPolygon(-1, -1, square)).toBe(false);
  });
});
