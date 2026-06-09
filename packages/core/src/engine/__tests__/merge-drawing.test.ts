/**
 * Unit tests for the merge-drawing model.
 *
 * These tests exercise the core rules of Flash's merge-drawing:
 *   1. Same-color fills overlap → both paths survive (merged by renderer).
 *   2. Different-color fills overlap → existing path cut if fully contained.
 *   3. No spatial overlap → existing path survives regardless of fill color.
 *   4. Stroke-only paths are never cut by a fill.
 *   5. applyMergeDrawing produces the correct updated layer object list.
 */

import { applyMergeDrawing, colorsEqual, mergeShapes } from "../merge-drawing.js";
import type { Color, Shape, ShapeDisplayObject, ShapePath } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: { r: number; g: number; b: number; a: number }
): ShapePath {
  const color: Color = fill ?? { r: 255, g: 0, b: 0, a: 255 };
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x, y: y + h } },
    ],
    fill: { type: "solid", color },
    closed: true,
  };
}

function makeShape(id: string, paths: ShapePath[]): Shape {
  return { id, paths };
}

// ---------------------------------------------------------------------------
// colorsEqual
// ---------------------------------------------------------------------------

describe("colorsEqual", () => {
  it("returns true for identical colors", () => {
    const c: Color = { r: 10, g: 20, b: 30, a: 255 };
    expect(colorsEqual(c, { ...c })).toBe(true);
  });

  it("returns false when any channel differs", () => {
    const c: Color = { r: 10, g: 20, b: 30, a: 255 };
    expect(colorsEqual(c, { ...c, r: 11 })).toBe(false);
    expect(colorsEqual(c, { ...c, g: 21 })).toBe(false);
    expect(colorsEqual(c, { ...c, b: 31 })).toBe(false);
    expect(colorsEqual(c, { ...c, a: 0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeShapes — no overlap
// ---------------------------------------------------------------------------

describe("mergeShapes — no spatial overlap", () => {
  it("preserves existing paths when incoming shape does not overlap", () => {
    const existing = makeShape("e", [rect(0, 0, 10, 10)]);
    const incoming = makeShape("i", [rect(100, 100, 10, 10)]);

    const result = mergeShapes(existing, incoming);

    expect(result.survivingPaths).toHaveLength(1);
    expect(result.incomingPaths).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeShapes — same fill color
// ---------------------------------------------------------------------------

describe("mergeShapes — overlapping same-color fills", () => {
  it("keeps existing path when fills match", () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const existing = makeShape("e", [rect(0, 0, 20, 20, red)]);
    const incoming = makeShape("i", [rect(10, 10, 20, 20, red)]);

    const result = mergeShapes(existing, incoming);

    expect(result.survivingPaths).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeShapes — different fill color, fully contained
// ---------------------------------------------------------------------------

describe("mergeShapes — different-color fill, existing fully inside incoming", () => {
  it("cuts (removes) existing path when fully contained by incoming", () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const blue = { r: 0, g: 0, b: 255, a: 255 };

    // Existing small rect fully inside the incoming large rect
    const existing = makeShape("e", [rect(5, 5, 5, 5, red)]);
    const incoming = makeShape("i", [rect(0, 0, 20, 20, blue)]);

    const result = mergeShapes(existing, incoming);

    expect(result.survivingPaths).toHaveLength(0);
    expect(result.incomingPaths).toHaveLength(1);
  });

  it("keeps existing path when only partially overlapped by incoming", () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const blue = { r: 0, g: 0, b: 255, a: 255 };

    // Existing straddles the incoming boundary
    const existing = makeShape("e", [rect(0, 0, 15, 15, red)]);
    const incoming = makeShape("i", [rect(10, 10, 20, 20, blue)]);

    const result = mergeShapes(existing, incoming);

    // Partially overlapping → survival (production would subtract the overlap).
    expect(result.survivingPaths).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// mergeShapes — stroke-only path
// ---------------------------------------------------------------------------

describe("mergeShapes — stroke-only paths", () => {
  it("never removes a stroke-only path even when fully contained", () => {
    const strokePath: ShapePath = {
      start: { x: 5, y: 5 },
      segments: [{ type: "line", to: { x: 8, y: 8 } }],
      stroke: { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 }, width: 1, caps: "round", joints: "miter", miterLimit: 3 },
      closed: false,
    };

    const existing = makeShape("e", [strokePath]);
    const incoming = makeShape("i", [rect(0, 0, 20, 20)]);

    const result = mergeShapes(existing, incoming);

    expect(result.survivingPaths).toHaveLength(1);
    expect(result.survivingPaths[0]).toBe(strokePath);
  });
});

// ---------------------------------------------------------------------------
// applyMergeDrawing
// ---------------------------------------------------------------------------

describe("applyMergeDrawing", () => {
  const makeShapeObj = (id: string, path: ShapePath): ShapeDisplayObject => ({
    type: "shape",
    id,
    shape: makeShape(id + "-shape", [path]),
    x: 0,
    y: 0,
  });

  it("appends incoming shape to an empty layer", () => {
    const incoming = makeShapeObj("new", rect(0, 0, 10, 10));
    const result = applyMergeDrawing([], incoming);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(incoming);
  });

  it("removes existing shape fully cut by incoming shape", () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const blue = { r: 0, g: 0, b: 255, a: 255 };

    const existingObj = makeShapeObj("old", rect(5, 5, 5, 5, red));
    const incomingObj: ShapeDisplayObject = {
      type: "shape",
      id: "new",
      shape: makeShape("new-shape", [rect(0, 0, 20, 20, blue)]),
      x: 0,
      y: 0,
    };

    const result = applyMergeDrawing([existingObj], incomingObj);

    // existingObj fully cut → removed; incoming appended
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(incomingObj);
  });

  it("does not affect display objects at a different offset", () => {
    const red = { r: 255, g: 0, b: 0, a: 255 };
    const blue = { r: 0, g: 0, b: 255, a: 255 };

    const existingObj: ShapeDisplayObject = {
      type: "shape",
      id: "far",
      shape: makeShape("far-shape", [rect(5, 5, 5, 5, red)]),
      x: 100,
      y: 100,
    };

    const incomingObj: ShapeDisplayObject = {
      type: "shape",
      id: "new",
      shape: makeShape("new-shape", [rect(0, 0, 20, 20, blue)]),
      x: 0,
      y: 0,
    };

    const result = applyMergeDrawing([existingObj], incomingObj);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existingObj);
    expect(result[1]).toBe(incomingObj);
  });
});
