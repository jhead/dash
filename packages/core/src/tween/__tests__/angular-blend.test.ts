/**
 * Tests for angular blend mode in interpolateShapeTween.
 *
 * Angular mode rotates each path's vertices around the shape centroid
 * during morphing, producing a rotation-arc effect instead of purely
 * linear straight-line interpolation (distributive mode).
 */

import { describe, it, expect } from "vitest";
import { interpolateShapeTween } from "../interpolate.js";
import type { ShapeDisplayObject } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a triangle ShapeDisplayObject. */
function makeTriangle(
  id: string,
  cx: number,
  cy: number,
  radius: number,
  angleOffsetDeg = 0
): ShapeDisplayObject {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const pts = [0, 120, 240].map((deg) => ({
    x: cx + radius * Math.cos(toRad(deg + angleOffsetDeg)),
    y: cy + radius * Math.sin(toRad(deg + angleOffsetDeg)),
  }));
  const [p0, p1, p2] = pts as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number }
  ];
  return {
    type: "shape",
    id,
    shape: {
      id: `sh-${id}`,
      paths: [
        {
          start: p0,
          segments: [
            { type: "line", to: p1 },
            { type: "line", to: p2 },
            { type: "line", to: p0 },
          ],
          closed: true,
        },
      ],
    },
    x: 0,
    y: 0,
  };
}

/** Build a closed square ShapeDisplayObject. */
function makeSquare(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): ShapeDisplayObject {
  const tl = { x: x1, y: y1 };
  const tr = { x: x2, y: y1 };
  const br = { x: x2, y: y2 };
  const bl = { x: x1, y: y2 };
  return {
    type: "shape",
    id,
    shape: {
      id: `sh-${id}`,
      paths: [
        {
          start: tl,
          segments: [
            { type: "line", to: tr },
            { type: "line", to: br },
            { type: "line", to: bl },
            { type: "line", to: tl },
          ],
          closed: true,
        },
      ],
    },
    x: 0,
    y: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("interpolateShapeTween — angular blend mode", () => {
  it("at t=0 angular returns the start shape", () => {
    const start = [makeTriangle("s", 100, 100, 50, 0)];
    const end = [makeTriangle("e", 100, 100, 50, 120)];
    const result = interpolateShapeTween(start, end, 0, 0, "angular");
    const startPath = (start[0] as ShapeDisplayObject).shape.paths[0]!;
    const resultPath = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(resultPath.start.x).toBeCloseTo(startPath.start.x, 5);
    expect(resultPath.start.y).toBeCloseTo(startPath.start.y, 5);
  });

  it("at t=1 angular returns the end shape", () => {
    const start = [makeTriangle("s", 100, 100, 50, 0)];
    const end = [makeTriangle("e", 100, 100, 50, 120)];
    const result = interpolateShapeTween(start, end, 1, 0, "angular");
    const endPath = (end[0] as ShapeDisplayObject).shape.paths[0]!;
    const resultPath = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(resultPath.start.x).toBeCloseTo(endPath.start.x, 4);
    expect(resultPath.start.y).toBeCloseTo(endPath.start.y, 4);
  });

  it("angular blend differs from distributive at t=0.5", () => {
    // Two triangles with the same centroid but different orientations (120° rotation).
    // Distributive: straight-line vertex lerp → midpoint is the average of vertices.
    // Angular: adds rotation arc → midpoint is rotated 60° from start, different from lerp.
    const start = [makeTriangle("s", 100, 100, 50, 0)];
    const end = [makeTriangle("e", 100, 100, 50, 120)];

    const distributive = interpolateShapeTween(start, end, 0.5, 0, "distributive");
    const angular = interpolateShapeTween(start, end, 0.5, 0, "angular");

    const distPath = (distributive[0] as ShapeDisplayObject).shape.paths[0]!;
    const angPath = (angular[0] as ShapeDisplayObject).shape.paths[0]!;

    // The start vertex under distributive: lerp(150, 40) = 95 (for a 50-radius triangle at 0°)
    // Angular adds a rotation component so the result is different.
    const dx = Math.abs(distPath.start.x - angPath.start.x);
    const dy = Math.abs(distPath.start.y - angPath.start.y);
    // At least one coordinate must differ by more than a floating-point epsilon.
    expect(dx + dy).toBeGreaterThan(0.01);
  });

  it("angular blend with identical shapes produces same result as distributive", () => {
    // When start and end are identical, both modes should produce identical results.
    const start = [makeSquare("s", 0, 0, 100, 100)];
    const end = [makeSquare("e", 0, 0, 100, 100)];

    const distributive = interpolateShapeTween(start, end, 0.5, 0, "distributive");
    const angular = interpolateShapeTween(start, end, 0.5, 0, "angular");

    const distPath = (distributive[0] as ShapeDisplayObject).shape.paths[0]!;
    const angPath = (angular[0] as ShapeDisplayObject).shape.paths[0]!;

    expect(angPath.start.x).toBeCloseTo(distPath.start.x, 4);
    expect(angPath.start.y).toBeCloseTo(distPath.start.y, 4);
  });

  it("angular centroid is interpolated linearly between shapes", () => {
    // Both squares use the same vertex layout; the centroid computed by
    // pathCentroid (start + segment endpoints, including the closing-back-to-start
    // vertex) is (90, 90) for makeSquare(50, 50, 150, 150) and (190, 190) for
    // makeSquare(150, 150, 250, 250).  At t=0.5 the result centroid must be
    // the average: (140, 140).
    const start = [makeSquare("s", 50, 50, 150, 150)];
    const end = [makeSquare("e", 150, 150, 250, 250)];

    const result = interpolateShapeTween(start, end, 0.5, 0, "angular");
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;

    const verts = [path.start, ...path.segments.map((s) => s.to)];
    const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length;
    // Expected: lerp(90, 190, 0.5) = 140 for both axes
    expect(cx).toBeCloseTo(140, 1);
    expect(cy).toBeCloseTo(140, 1);
  });

  it("all segment vertices are interpolated under angular mode", () => {
    // Verify that all segment endpoints (not just start) are transformed in angular mode.
    const start = [makeTriangle("s", 100, 100, 50, 0)];
    const end = [makeTriangle("e", 100, 100, 50, 90)];

    const result = interpolateShapeTween(start, end, 0.5, 0, "angular");
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;

    // All 3 segment endpoints should differ from both the start and end values
    const startPath = (start[0] as ShapeDisplayObject).shape.paths[0]!;
    const endPath = (end[0] as ShapeDisplayObject).shape.paths[0]!;

    for (let i = 0; i < path.segments.length; i++) {
      const rv = path.segments[i]!.to;
      const sv = startPath.segments[i]!.to;
      const ev = endPath.segments[i]!.to;
      // Result should not be identical to either endpoint
      const diffFromStart = Math.abs(rv.x - sv.x) + Math.abs(rv.y - sv.y);
      const diffFromEnd = Math.abs(rv.x - ev.x) + Math.abs(rv.y - ev.y);
      expect(diffFromStart).toBeGreaterThan(0.01);
      expect(diffFromEnd).toBeGreaterThan(0.01);
    }
  });
});
