/**
 * Task 1388 — Selection-tool Smooth / Straighten geometry transforms. The
 * Selection Options block's Smo/Str buttons call handleSmoothSelection /
 * handleStraightenSelection, which apply these pure transforms to the selected
 * shape. Verified directly (no React/store needed).
 */
import { describe, it, expect } from "vitest";
import type { Shape, ShapePath, Fill } from "@flash/core";
import { smoothShape, straightenShape, smoothShapePath, straightenPath } from "../tools/selectionSmooth.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

// A closed polyline with a redundant collinear point on the top edge (0,0)-(10,0)
// via the midpoint (5,0), plus a jagged detour that straighten should drop.
function jaggedPath(): ShapePath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { type: "line", to: { x: 5, y: 0 } },   // collinear with next → removable
      { type: "line", to: { x: 10, y: 0 } },
      { type: "line", to: { x: 10, y: 10 } },
      { type: "line", to: { x: 0, y: 10 } },
      { type: "line", to: { x: 0, y: 0 } },    // closing duplicate of start
    ],
    closed: true,
    fill: RED,
  };
}

describe("straightenPath (task 1388)", () => {
  it("removes redundant collinear anchors and re-emits straight lines", () => {
    const out = straightenPath(jaggedPath(), 1);
    // Every segment is a straight line (no curves).
    expect(out.segments.every((s) => s.type === "line")).toBe(true);
    // The collinear (5,0) midpoint is gone → fewer anchors than the input.
    const anchorCount = out.segments.length + 1;
    expect(anchorCount).toBeLessThan(6);
    expect(out.closed).toBe(true);
  });

  it("preserves the fill", () => {
    const out = straightenShape({ id: "s", paths: [jaggedPath()] });
    expect(out.paths[0].fill).toEqual(RED);
  });
});

describe("smoothShapePath (task 1388)", () => {
  it("produces curve segments through the outline", () => {
    const out = smoothShapePath(jaggedPath());
    expect(out.segments.some((s) => s.type === "curve")).toBe(true);
    expect(out.fill).toEqual(RED);
  });

  it("smoothShape maps over every path", () => {
    const shape: Shape = { id: "s", paths: [jaggedPath(), jaggedPath()] };
    const out = smoothShape(shape);
    expect(out.paths).toHaveLength(2);
    expect(out.paths.every((p) => p.segments.some((s) => s.type === "curve"))).toBe(true);
  });
});

describe("degenerate paths (task 1388)", () => {
  it("passes through a path with fewer than 3 anchors unchanged", () => {
    const line: ShapePath = { start: { x: 0, y: 0 }, segments: [{ type: "line", to: { x: 5, y: 5 } }], closed: false };
    expect(straightenPath(line)).toBe(line);
    expect(smoothShapePath(line)).toBe(line);
  });
});
