import { describe, it, expect } from "vitest";
import { getTransformedBounds, getUnionBounds, getBoundingBox, getSelectionBounds, objectsOverlap, objectContainsPoint } from "../bounds.js";
import { createRectShape } from "../shapes.js";
import type { DisplayObject, ShapeDisplayObject, DrawingObject } from "../types.js";

const SOLID = { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 } } as const;

/** A merge-model raw shape: geometry in shape.paths, object anchored at (x,y). */
function makeShape(
  geomX: number, geomY: number, geomW: number, geomH: number,
  x = 0, y = 0, extra: Partial<ShapeDisplayObject> = {}
): ShapeDisplayObject {
  return {
    type: "shape", id: "sh1",
    shape: createRectShape(geomX, geomY, geomX + geomW, geomY + geomH, SOLID, null),
    x, y, ...extra,
  } as ShapeDisplayObject;
}

function makeDrawingObject(
  geomX: number, geomY: number, geomW: number, geomH: number, x = 0, y = 0
): DrawingObject {
  return {
    type: "drawing-object", id: "do1",
    shape: createRectShape(geomX, geomY, geomX + geomW, geomY + geomH, SOLID, null),
    x, y,
  } as DrawingObject;
}

describe("getTransformedBounds", () => {
  it("non-rotated object returns unchanged bounds", () => {
    const obj = { type: "text", id: "1", x: 10, y: 20, width: 100, height: 50, rotation: 0,
      text: "", textType: "static", fontFamily: "Arial", fontSize: 12, bold: false,
      italic: false, color: { r: 0, g: 0, b: 0, a: 255 }, align: "left",
      multiline: false, wordWrap: false } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("90° rotation swaps width and height", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 90 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(50, 1);
    expect(b.height).toBeCloseTo(100, 1);
  });

  it("45° rotation of square is still square (larger)", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 100, rotation: 45 } as DisplayObject;
    const b = getTransformedBounds(obj);
    // diagonal = 100*sqrt(2) ≈ 141.4
    expect(b.width).toBeCloseTo(141.4, 0);
    expect(b.height).toBeCloseTo(141.4, 0);
  });

  it("45° rotation of 100x50 rect produces wider and taller AABB", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 45 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeGreaterThan(100);
    expect(b.height).toBeGreaterThan(50);
  });

  it("scaleX=2 doubles width in non-rotated case", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleX: 2 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(200, 5);
    expect(b.height).toBeCloseTo(50, 5);
  });

  it("scaleY=0.5 halves height in non-rotated case", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleY: 0.5 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(100, 5);
    expect(b.height).toBeCloseTo(25, 5);
  });

  it("object with no rotation field is treated as 0 rotation", () => {
    // ShapeDisplayObject has optional rotation — omit it
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 5, y: 10, width: 60, height: 30 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b).toEqual({ x: 5, y: 10, width: 60, height: 30 });
  });

  it("180° rotation of a rectangle returns same-size AABB at same position", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 80, height: 40, rotation: 180 } as DisplayObject;
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(80, 1);
    expect(b.height).toBeCloseTo(40, 1);
  });

  it("scaled and rotated object produces correct AABB", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 100, height: 50, rotation: 90, scaleX: 2, scaleY: 1 } as DisplayObject;
    const b = getTransformedBounds(obj);
    // After scaleX=2: effective width=200, height=50; 90° rotates these so AABB width≈50, height≈200
    expect(b.width).toBeCloseTo(50, 1);
    expect(b.height).toBeCloseTo(200, 1);
  });

  // --- task 1378: shapes/drawing-objects carry geometry in shape.paths ---

  it("shape returns geometry bounds, not zero-size at origin (task 1378)", () => {
    const obj = makeShape(20, 30, 100, 60);
    expect(getTransformedBounds(obj)).toEqual({ x: 20, y: 30, width: 100, height: 60 });
  });

  it("shape honours its own scale transform", () => {
    const obj = makeShape(0, 0, 100, 50, 0, 0, { scaleX: 2 });
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(200, 5);
    expect(b.height).toBeCloseTo(50, 5);
  });

  it("shape honours its own 90° rotation transform", () => {
    const obj = makeShape(0, 0, 100, 50, 0, 0, { rotation: 90 });
    const b = getTransformedBounds(obj);
    expect(b.width).toBeCloseTo(50, 1);
    expect(b.height).toBeCloseTo(100, 1);
  });

  it("drawing-object returns geometry bounds offset by x/y", () => {
    const obj = makeDrawingObject(0, 0, 40, 40, 100, 200);
    expect(getTransformedBounds(obj)).toEqual({ x: 100, y: 200, width: 40, height: 40 });
  });
});

describe("getUnionBounds", () => {
  it("returns null for empty array", () => {
    expect(getUnionBounds([])).toBeNull();
  });

  it("single object returns its own bounds", () => {
    const obj = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 5, y: 10, width: 60, height: 30 } as DisplayObject;
    const b = getUnionBounds([obj]);
    expect(b).toEqual({ x: 5, y: 10, width: 60, height: 30 });
  });

  it("two non-overlapping objects produce correct union", () => {
    const a = { type: "bitmap", id: "1", libraryItemId: "bmp1",
      x: 0, y: 0, width: 50, height: 50 } as DisplayObject;
    const b = { type: "bitmap", id: "2", libraryItemId: "bmp2",
      x: 100, y: 100, width: 50, height: 50 } as DisplayObject;
    const u = getUnionBounds([a, b]);
    expect(u).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it("shape-only selection yields real union bounds, not {0,0,0,0} (task 1378)", () => {
    // Two merge-model shapes anchored at the origin with disjoint geometry.
    const a = makeShape(0, 0, 40, 40);
    const b = makeShape(100, 100, 40, 40);
    const u = getUnionBounds([a, b]);
    expect(u).toEqual({ x: 0, y: 0, width: 140, height: 140 });
  });
});

// ---------------------------------------------------------------------------
// getBoundingBox
// ---------------------------------------------------------------------------

function makeBitmap(x: number, y: number, w: number, h: number): DisplayObject {
  return { type: "bitmap", id: "1", libraryItemId: "bmp1", x, y, width: w, height: h } as DisplayObject;
}

describe("getBoundingBox", () => {
  it("returns correct x/y/width/height for a simple object", () => {
    const obj = makeBitmap(10, 20, 100, 50);
    expect(getBoundingBox(obj)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("empty-paths shape at the origin returns zeros", () => {
    const obj = { type: "shape", id: "s1", shape: { id: "s1", paths: [] }, x: 0, y: 0 } as DisplayObject;
    expect(getBoundingBox(obj)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("shape reflects its path geometry, not zero-size at the object origin (task 1378)", () => {
    // Merge-model shape: geometry at (30,40) 100x60, object anchored at origin.
    const obj = makeShape(30, 40, 100, 60);
    expect(getBoundingBox(obj)).toEqual({ x: 30, y: 40, width: 100, height: 60 });
  });

  it("drawing-object reflects its path geometry (task 1378)", () => {
    const obj = makeDrawingObject(10, 20, 40, 50, 5, 5);
    expect(getBoundingBox(obj)).toEqual({ x: 15, y: 25, width: 40, height: 50 });
  });
});

// ---------------------------------------------------------------------------
// getSelectionBounds
// ---------------------------------------------------------------------------

describe("getSelectionBounds", () => {
  it("returns null for empty array", () => {
    expect(getSelectionBounds([])).toBeNull();
  });

  it("single object returns its own bounds", () => {
    const obj = makeBitmap(5, 10, 60, 30);
    expect(getSelectionBounds([obj])).toEqual({ x: 5, y: 10, width: 60, height: 30 });
  });

  it("two objects side by side return union", () => {
    const a = makeBitmap(0, 0, 50, 50);
    const b = makeBitmap(100, 0, 50, 50);
    expect(getSelectionBounds([a, b])).toEqual({ x: 0, y: 0, width: 150, height: 50 });
  });

  it("two objects stacked vertically return union", () => {
    const a = makeBitmap(0, 0, 100, 40);
    const b = makeBitmap(0, 60, 100, 40);
    expect(getSelectionBounds([a, b])).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("partially overlapping objects return tight union", () => {
    const a = makeBitmap(0, 0, 80, 80);
    const b = makeBitmap(40, 40, 80, 80);
    expect(getSelectionBounds([a, b])).toEqual({ x: 0, y: 0, width: 120, height: 120 });
  });

  it("negative coordinates are handled correctly", () => {
    const a = makeBitmap(-50, -50, 40, 40);
    const b = makeBitmap(10, 10, 40, 40);
    expect(getSelectionBounds([a, b])).toEqual({ x: -50, y: -50, width: 100, height: 100 });
  });
});

// ---------------------------------------------------------------------------
// objectsOverlap
// ---------------------------------------------------------------------------

describe("objectsOverlap", () => {
  it("clearly overlapping rectangles return true", () => {
    const a = makeBitmap(0, 0, 100, 100);
    const b = makeBitmap(50, 50, 100, 100);
    expect(objectsOverlap(a, b)).toBe(true);
  });

  it("non-overlapping rectangles return false", () => {
    const a = makeBitmap(0, 0, 50, 50);
    const b = makeBitmap(100, 100, 50, 50);
    expect(objectsOverlap(a, b)).toBe(false);
  });

  it("rectangles touching at an edge return false (exclusive boundary)", () => {
    const a = makeBitmap(0, 0, 50, 50);
    const b = makeBitmap(50, 0, 50, 50);
    expect(objectsOverlap(a, b)).toBe(false);
  });

  it("one rectangle fully inside another returns true", () => {
    const outer = makeBitmap(0, 0, 200, 200);
    const inner = makeBitmap(50, 50, 50, 50);
    expect(objectsOverlap(outer, inner)).toBe(true);
  });

  it("symmetry: overlap(a,b) === overlap(b,a)", () => {
    const a = makeBitmap(0, 0, 80, 80);
    const b = makeBitmap(60, 60, 80, 80);
    expect(objectsOverlap(a, b)).toBe(objectsOverlap(b, a));
  });

  it("shapes overlap by real geometry, not all-at-origin (task 1378)", () => {
    // Both anchored at origin; before the fix every shape was a zero-size box
    // at (0,0) so disjoint geometry would wrongly report overlap.
    const a = makeShape(0, 0, 40, 40);
    const b = makeShape(100, 100, 40, 40);
    expect(objectsOverlap(a, b)).toBe(false);
    const c = makeShape(20, 20, 40, 40);
    expect(objectsOverlap(a, c)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// objectContainsPoint
// ---------------------------------------------------------------------------

describe("objectContainsPoint", () => {
  it("point inside returns true", () => {
    const obj = makeBitmap(0, 0, 100, 100);
    expect(objectContainsPoint(obj, 50, 50)).toBe(true);
  });

  it("point outside returns false", () => {
    const obj = makeBitmap(0, 0, 100, 100);
    expect(objectContainsPoint(obj, 150, 50)).toBe(false);
  });

  it("point on top-left corner (boundary) returns true", () => {
    const obj = makeBitmap(10, 20, 100, 50);
    expect(objectContainsPoint(obj, 10, 20)).toBe(true);
  });

  it("point on bottom-right corner (boundary) returns true", () => {
    const obj = makeBitmap(10, 20, 100, 50);
    expect(objectContainsPoint(obj, 110, 70)).toBe(true);
  });

  it("point just outside right edge returns false", () => {
    const obj = makeBitmap(0, 0, 100, 100);
    expect(objectContainsPoint(obj, 101, 50)).toBe(false);
  });

  it("point just above top edge returns false", () => {
    const obj = makeBitmap(0, 10, 100, 100);
    expect(objectContainsPoint(obj, 50, 9)).toBe(false);
  });

  it("shape containment uses geometry bounds (task 1378)", () => {
    const obj = makeShape(50, 50, 100, 100);
    expect(objectContainsPoint(obj, 100, 100)).toBe(true);
    expect(objectContainsPoint(obj, 0, 0)).toBe(false); // origin is outside the geometry
  });
});
