/**
 * Tests for path simplification (Ramer-Douglas-Peucker) and
 * smoothing (Catmull-Rom midpoint → quadratic Bézier) utilities.
 */

import { describe, it, expect } from "vitest";
import {
  simplifyPath,
  smoothPath,
  createSimplifiedPencilShape,
} from "../simplify.js";

// ---------------------------------------------------------------------------
// simplifyPath
// ---------------------------------------------------------------------------

describe("simplifyPath", () => {
  it("two points — returns both unchanged", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const result = simplifyPath(pts, 2.0);
    expect(result).toEqual(pts);
  });

  it("collinear points — middle point removed", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    const result = simplifyPath(pts, 1.0);
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it("non-collinear L-shape — all 3 points kept", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
    const result = simplifyPath(pts, 1.0);
    // The middle point (5,0) is far from the line (0,0)-(5,5), so it is kept
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 5, y: 0 });
    expect(result[2]).toEqual({ x: 5, y: 5 });
  });

  it("epsilon=0 — no points removed (all deviations exceed 0)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 1 }, { x: 6, y: 0 }];
    // The middle point has a perpendicular distance of 1, which is > 0
    const result = simplifyPath(pts, 0);
    expect(result).toHaveLength(3);
  });

  it("large epsilon — aggressively simplifies to endpoints only", () => {
    // A curve that deviates by at most 5 units from the straight line
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 5 },
      { x: 15, y: 3 },
      { x: 20, y: 0 },
    ];
    const result = simplifyPath(pts, 100);
    expect(result).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
  });

  it("100-point near-straight line reduces to 2 points", () => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 100; i++) {
      pts.push({ x: i, y: i * 0.001 }); // near-flat line
    }
    const result = simplifyPath(pts, 2.0);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("always preserves first and last points", () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 10, y: 50 },
      { x: 20, y: 30 },
      { x: 100, y: 200 },
    ];
    const result = simplifyPath(pts, 5.0);
    expect(result[0]).toEqual(pts[0]);
    expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// smoothPath
// ---------------------------------------------------------------------------

describe("smoothPath", () => {
  it("returns a ShapePath with start and segments", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    const path = smoothPath(pts, false);
    expect(path).toHaveProperty("start");
    expect(path).toHaveProperty("segments");
    expect(Array.isArray(path.segments)).toBe(true);
  });

  it("3 points → 2 segments (1 curve + 1 line-to-end)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    const path = smoothPath(pts, false);
    // midpoints: [(2.5,2.5), (7.5,2.5)]
    // segments: curve to midpoints[1] with control pts[1], then line to pts[2]
    expect(path.segments).toHaveLength(2);
    expect(path.segments[0].type).toBe("curve");
    expect(path.segments[1].type).toBe("line");
  });

  it("2 points → 1 line segment", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const path = smoothPath(pts, false);
    expect(path.segments).toHaveLength(1);
    expect(path.segments[0].type).toBe("line");
    expect(path.segments[0].to).toEqual({ x: 10, y: 0 });
  });

  it("closed path ends at start point", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ];
    const path = smoothPath(pts, true);
    expect(path.closed).toBe(true);
    // Last segment should curve back toward start midpoint
    const lastSeg = path.segments[path.segments.length - 1];
    expect(lastSeg.type).toBe("curve");
    // The 'to' of the last segment should be midpoints[0] = mid(pts[0], pts[1])
    expect(lastSeg.to).toEqual({ x: 5, y: 0 });
  });

  it("start point is the midpoint of the first two input points", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
    const path = smoothPath(pts, false);
    expect(path.start).toEqual({ x: 5, y: 5 });
  });

  it("4 points open path → 3 segments", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 0 },
      { x: 15, y: 5 },
    ];
    const path = smoothPath(pts, false);
    // midpoints: [2.5,2.5], [7.5,2.5], [12.5,2.5]
    // segments: curve(ctrl=pts[1],to=mid[1]), curve(ctrl=pts[2],to=mid[2]), line(to=pts[3])
    expect(path.segments).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// createSimplifiedPencilShape
// ---------------------------------------------------------------------------

describe("createSimplifiedPencilShape", () => {
  it("returns a ShapeDisplayObject with type='shape'", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
      { x: 30, y: 0 },
    ];
    const obj = createSimplifiedPencilShape(pts, null, null);
    expect(obj.type).toBe("shape");
  });

  it("returns object with id, x, y, and shape fields", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
    const obj = createSimplifiedPencilShape(pts, null, null);
    expect(obj).toHaveProperty("id");
    expect(obj).toHaveProperty("x", 0);
    expect(obj).toHaveProperty("y", 0);
    expect(obj).toHaveProperty("shape");
    expect(obj.shape).toHaveProperty("paths");
    expect(obj.shape.paths.length).toBeGreaterThan(0);
  });

  it("applies stroke style when provided", () => {
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 50 }];
    const stroke = {
      type: "solid" as const,
      color: { r: 0, g: 0, b: 0, a: 255 },
      width: 2,
      caps: "round" as const,
      joints: "round" as const,
      miterLimit: 3,
    };
    const obj = createSimplifiedPencilShape(pts, null, stroke);
    expect(obj.shape.paths[0].stroke).toEqual(stroke);
  });

  it("applies fill style when provided", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ];
    const fill = {
      type: "solid" as const,
      color: { r: 255, g: 0, b: 0, a: 255 },
    };
    const obj = createSimplifiedPencilShape(pts, fill, null, true);
    expect(obj.shape.paths[0].fill).toEqual(fill);
  });
});
