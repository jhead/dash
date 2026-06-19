/**
 * Unit tests for engine/bitmapTrace.ts — marching-squares contour extraction
 * + Douglas-Peucker simplification + curve fitting.
 */

import { describe, it, expect } from "vitest";
import {
  traceBitmapToPaths,
  marchingSquaresContour,
  simplifyPolyline,
  simplifyClosedPolygon,
  polygonToShapePath,
  curveFitEpsilon,
  curveFitSmooths,
  cornerThresholdAngle,
  DEFAULT_BITMAP_TRACE_OPTIONS,
  type BitmapTraceImageData,
} from "../bitmapTrace.js";
import type { Point, SolidFill } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): BitmapTraceImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

/** Signed area (shoelace) of a polygon; |2A| is twice the enclosed area. */
function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) / 2;
}

const SOLID_RED: SolidFill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

// ---------------------------------------------------------------------------
// marchingSquaresContour
// ---------------------------------------------------------------------------

describe("marchingSquaresContour", () => {
  it("traces a single pixel as a unit square", () => {
    const mask = [1];
    const contour = marchingSquaresContour(mask, 1, 1);
    expect(contour.length).toBe(4);
    expect(polygonArea(contour)).toBe(1);
  });

  it("traces a solid rectangle to its exact 4-corner outline", () => {
    // 4×3 filled region.
    const w = 4;
    const h = 3;
    const mask = new Uint8Array(w * h).fill(1);
    const contour = marchingSquaresContour(mask, w, h);
    // Should be a rectangle (only 4 distinct vertices on the boundary).
    expect(polygonArea(contour)).toBe(w * h);
    const xs = contour.map((p) => p.x);
    const ys = contour.map((p) => p.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(w);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(h);
  });

  it("returns empty for an all-empty mask", () => {
    const contour = marchingSquaresContour(new Uint8Array(9), 3, 3);
    expect(contour).toEqual([]);
  });

  it("traces an L-shaped region preserving its concave corner", () => {
    // 3×3 with the top-right cell removed → an L (8 cells).
    //   1 1 0
    //   1 1 1
    //   1 1 1
    const mask = [1, 1, 0, 1, 1, 1, 1, 1, 1];
    const contour = marchingSquaresContour(mask, 3, 3);
    expect(polygonArea(contour)).toBe(8); // 9 - 1 removed cell
    // Raw marching-squares keeps collinear edge vertices; the concave corner of
    // the notch (the inner step at the missing top-right cell) must be present.
    const hasNotch = contour.some((p) => p.x === 2 && p.y === 1);
    expect(hasNotch).toBe(true);
    // After Douglas-Peucker the L collapses to its 6 true corners.
    const simplified = simplifyClosedPolygon(contour, 0.1);
    expect(simplified.length).toBe(6);
  });

  it("walks the outer boundary back to the start (closed loop)", () => {
    const mask = new Uint8Array(25).fill(1);
    const contour = marchingSquaresContour(mask, 5, 5);
    // First vertex is the top-left grid corner of the first filled cell.
    expect(contour[0]).toEqual({ x: 0, y: 0 });
    expect(polygonArea(contour)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Douglas-Peucker
// ---------------------------------------------------------------------------

describe("simplifyPolyline", () => {
  it("removes near-collinear interior points", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: 0 },
      { x: 3, y: 0.1 },
      { x: 4, y: 0 },
    ];
    const out = simplifyPolyline(pts, 0.5);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it("keeps a vertex that deviates beyond epsilon", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 5 },
      { x: 4, y: 0 },
    ];
    const out = simplifyPolyline(pts, 0.5);
    expect(out.length).toBe(3);
  });

  it("epsilon <= 0 keeps every point", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(simplifyPolyline(pts, 0).length).toBe(3);
  });
});

describe("simplifyClosedPolygon", () => {
  it("simplifies a jagged near-rectangle toward 4 corners", () => {
    // A rectangle outline densely sampled along each edge.
    const poly: Point[] = [];
    for (let x = 0; x <= 10; x++) poly.push({ x, y: 0 });
    for (let y = 1; y <= 10; y++) poly.push({ x: 10, y });
    for (let x = 9; x >= 0; x--) poly.push({ x, y: 10 });
    for (let y = 9; y >= 1; y--) poly.push({ x: 0, y });
    const out = simplifyClosedPolygon(poly, 1);
    expect(out.length).toBe(4);
    expect(polygonArea(out)).toBe(100);
  });

  it("does not simplify a polygon with <= 3 vertices", () => {
    const tri: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ];
    expect(simplifyClosedPolygon(tri, 5).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Parameter mapping
// ---------------------------------------------------------------------------

describe("parameter mapping", () => {
  it("curveFitEpsilon increases from tight to smooth", () => {
    expect(curveFitEpsilon("pixels")).toBe(0);
    expect(curveFitEpsilon("very-tight")).toBeLessThan(curveFitEpsilon("normal"));
    expect(curveFitEpsilon("normal")).toBeLessThan(curveFitEpsilon("very-smooth"));
  });

  it("curveFitSmooths is true only for smoothing modes", () => {
    expect(curveFitSmooths("pixels")).toBe(false);
    expect(curveFitSmooths("tight")).toBe(false);
    expect(curveFitSmooths("normal")).toBe(true);
    expect(curveFitSmooths("very-smooth")).toBe(true);
  });

  it("cornerThresholdAngle: 'many' keeps more corners than 'few'", () => {
    expect(cornerThresholdAngle("many")).toBeLessThan(cornerThresholdAngle("normal"));
    expect(cornerThresholdAngle("normal")).toBeLessThan(cornerThresholdAngle("few"));
  });
});

// ---------------------------------------------------------------------------
// polygonToShapePath
// ---------------------------------------------------------------------------

describe("polygonToShapePath", () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  it("emits straight line segments when not smoothing", () => {
    const path = polygonToShapePath(square, SOLID_RED, false, Math.PI / 4);
    expect(path).not.toBeNull();
    expect(path!.closed).toBe(true);
    expect(path!.segments.every((s) => s.type === "line")).toBe(true);
    expect(path!.segments.length).toBe(4);
  });

  it("keeps 90° corners sharp even when smoothing", () => {
    // 90° turn (π/2) exceeds the normal corner threshold (π/4) → all corners.
    const path = polygonToShapePath(square, SOLID_RED, true, Math.PI / 4);
    expect(path).not.toBeNull();
    expect(path!.segments.every((s) => s.type === "line")).toBe(true);
  });

  it("rounds shallow vertices into quadratic curves when smoothing", () => {
    // A near-flat polygon: tiny turns should be smoothed into curves.
    const octagon: Point[] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      octagon.push({ x: Math.cos(a) * 10, y: Math.sin(a) * 10 });
    }
    const path = polygonToShapePath(octagon, SOLID_RED, true, Math.PI / 2);
    expect(path).not.toBeNull();
    expect(path!.segments.some((s) => s.type === "curve")).toBe(true);
  });

  it("returns null for a degenerate polygon", () => {
    expect(polygonToShapePath([{ x: 0, y: 0 }, { x: 1, y: 1 }], SOLID_RED, false, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// traceBitmapToPaths (end-to-end)
// ---------------------------------------------------------------------------

describe("traceBitmapToPaths", () => {
  it("returns one solid-filled closed path for a single-color image", () => {
    const img = makeImage(8, 8, () => [10, 20, 30, 255]);
    const paths = traceBitmapToPaths(img, { ...DEFAULT_BITMAP_TRACE_OPTIONS, minimumArea: 1 });
    expect(paths.length).toBe(1);
    expect(paths[0].closed).toBe(true);
    expect(paths[0].fill?.type).toBe("solid");
  });

  it("separates four colored quadrants into four regions", () => {
    const img = makeImage(10, 10, (x, y) => {
      if (y < 5 && x < 5) return [255, 0, 0, 255];
      if (y < 5) return [0, 255, 0, 255];
      if (x < 5) return [0, 0, 255, 255];
      return [255, 255, 255, 255];
    });
    const paths = traceBitmapToPaths(img, { ...DEFAULT_BITMAP_TRACE_OPTIONS, minimumArea: 1 });
    expect(paths.length).toBe(4);
  });

  it("drops fully transparent regions", () => {
    const img = makeImage(4, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const paths = traceBitmapToPaths(img, { ...DEFAULT_BITMAP_TRACE_OPTIONS, minimumArea: 1 });
    expect(paths.length).toBe(1);
  });

  it("respects the minimum-area filter", () => {
    // One 1px unique region + a larger region.
    const img = makeImage(4, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const paths = traceBitmapToPaths(img, { ...DEFAULT_BITMAP_TRACE_OPTIONS, minimumArea: 2 });
    expect(paths.length).toBe(1);
    expect(paths[0].fill?.type).toBe("solid");
    if (paths[0].fill?.type === "solid") {
      expect(paths[0].fill.color.b).toBeGreaterThan(100);
    }
  });

  it("merges similar colors at a high color threshold", () => {
    // Two slightly-different blues; a high threshold buckets them together.
    const img = makeImage(4, 1, (x) =>
      x < 2 ? [0, 0, 200, 255] : [0, 0, 210, 255],
    );
    const merged = traceBitmapToPaths(img, {
      colorThreshold: 400,
      minimumArea: 1,
      curveFit: "pixels",
      cornerThreshold: "normal",
    });
    expect(merged.length).toBe(1);
    const split = traceBitmapToPaths(img, {
      colorThreshold: 1,
      minimumArea: 1,
      curveFit: "pixels",
      cornerThreshold: "normal",
    });
    expect(split.length).toBe(2);
  });

  it("returns an empty array for an empty image", () => {
    expect(traceBitmapToPaths({ width: 0, height: 0, data: [] }).length).toBe(0);
  });

  it("a traced rectangle path covers the region's bounds", () => {
    const img = makeImage(6, 4, () => [40, 50, 60, 255]);
    const paths = traceBitmapToPaths(img, {
      colorThreshold: 100,
      minimumArea: 1,
      curveFit: "pixels",
      cornerThreshold: "normal",
    });
    expect(paths.length).toBe(1);
    const p = paths[0];
    const xs = [p.start.x, ...p.segments.map((s) => s.to.x)];
    const ys = [p.start.y, ...p.segments.map((s) => s.to.y)];
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(6);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(4);
  });
});
