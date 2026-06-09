import { describe, it, expect } from "vitest";
import { hitTestPoint, pointInPolygon } from "../hittest.js";
import type { DisplayObject, ShapeDisplayObject, SymbolInstance } from "../types.js";

// Helper: build a ShapeDisplayObject with a triangle given three vertices (in local space)
function makeTriangleShape(
  ox: number,
  oy: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): ShapeDisplayObject {
  return {
    type: "shape",
    id: "tri1",
    x: ox,
    y: oy,
    shape: {
      id: "triShape",
      paths: [
        {
          start: { x: ax, y: ay },
          segments: [
            { type: "line", to: { x: bx, y: by } },
            { type: "line", to: { x: cx, y: cy } },
          ],
          fill: { type: "solid", color: { r: 0, g: 128, b: 0, a: 255 } },
          closed: true,
        },
      ],
    },
  };
}

// Helper: build a ShapeDisplayObject with a closed square from (0,0) to (w,h)
function makeSquareShape(
  x: number,
  y: number,
  w: number,
  h: number,
  overrides: Partial<ShapeDisplayObject> = {},
): ShapeDisplayObject {
  return {
    type: "shape",
    id: "s1",
    x,
    y,
    shape: {
      id: "shape1",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: w, y: 0 } },
            { type: "line", to: { x: w, y: h } },
            { type: "line", to: { x: 0, y: h } },
          ],
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          closed: true,
        },
      ],
    },
    ...overrides,
  };
}

describe("hitTestPoint – ShapeDisplayObject (square)", () => {
  it("returns true for a point inside the square", () => {
    const obj = makeSquareShape(10, 20, 100, 80);
    // Center in local coords: (50, 40); world coords: (60, 60)
    expect(hitTestPoint(obj, 60, 60)).toBe(true);
  });

  it("returns false for a point outside the square (to the right)", () => {
    const obj = makeSquareShape(10, 20, 100, 80);
    // World point (200, 60) is outside
    expect(hitTestPoint(obj, 200, 60)).toBe(false);
  });

  it("returns false for a point outside the square (above)", () => {
    const obj = makeSquareShape(10, 20, 100, 80);
    // World point (60, 10) is above the square (y < 20)
    expect(hitTestPoint(obj, 60, 10)).toBe(false);
  });

  it("handles a point on the boundary without crashing", () => {
    const obj = makeSquareShape(0, 0, 100, 100);
    // Boundary points should not throw
    expect(() => hitTestPoint(obj, 0, 0)).not.toThrow();
    expect(() => hitTestPoint(obj, 100, 100)).not.toThrow();
    expect(() => hitTestPoint(obj, 50, 0)).not.toThrow();
  });

  it("returns false for a shape with no filled paths", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "s2",
      x: 0,
      y: 0,
      shape: {
        id: "shape2",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { type: "line", to: { x: 100, y: 0 } },
              { type: "line", to: { x: 100, y: 100 } },
              { type: "line", to: { x: 0, y: 100 } },
            ],
            // No fill – stroke only
            stroke: {
              type: "solid",
              color: { r: 0, g: 0, b: 0, a: 255 },
              width: 2,
              caps: "none",
              joints: "miter",
              miterLimit: 3,
            },
            closed: true,
          },
        ],
      },
    };
    expect(hitTestPoint(obj, 50, 50)).toBe(false);
  });
});

describe("hitTestPoint – ShapeDisplayObject with rotation", () => {
  it("returns true for a point inside a 90°-rotated shape (transformed space)", () => {
    // A 100×20 rectangle placed at origin, rotated 90°.
    // In local space the shape spans x:[0,100] y:[0,20].
    // After 90° rotation the point (10, 50) in world space should map back
    // to local (50, -10+... ) — let's use a simpler explicit local calculation.
    //
    // inverseTransform: dx=wx-ox, dy=wy-oy, then rotate by -90° => (dy, -dx)
    // With ox=0, oy=0, wx=10, wy=50:
    //   dx=10, dy=50 → rotate -90° → rx=50, ry=-10
    // (50, -10) is NOT inside [0,100]×[0,20], so let's pick (5, 10):
    //   dx=5, dy=10 → rotate -90° → rx=10, ry=-5  (not inside either)
    //
    // Easier: just test that points in local space map correctly.
    // Local interior point: (50, 10). World after 90° rotation:
    //   wx = ox + lx*cos(90) - ly*sin(90) = 0 + 50*0 - 10*1 = -10
    //   wy = oy + lx*sin(90) + ly*cos(90) = 0 + 50*1 + 10*0 = 50
    const obj = makeSquareShape(0, 0, 100, 20, { rotation: 90 });
    expect(hitTestPoint(obj, -10, 50)).toBe(true);
  });

  it("returns false for a point outside a rotated shape", () => {
    // Using same setup: world point (50, 50) maps to local (50, -50)
    // which is outside [0,100]×[0,20].
    const obj = makeSquareShape(0, 0, 100, 20, { rotation: 90 });
    expect(hitTestPoint(obj, 50, 50)).toBe(false);
  });
});

describe("hitTestPoint – SymbolInstance (bounding box)", () => {
  // SymbolInstance doesn't have explicit width/height, so getTransformedBounds
  // will return width=0, height=0 — still useful to test that it doesn't crash
  // and returns false when clearly outside.
  const makeInstance = (
    x: number,
    y: number,
    overrides: Partial<SymbolInstance> = {},
  ): SymbolInstance => ({
    type: "instance",
    id: "i1",
    symbolId: "sym1",
    x,
    y,
    ...overrides,
  });

  it("point at the instance origin is inside the (zero-size) bounding box", () => {
    const obj = makeInstance(50, 50);
    // bounds: x=50, y=50, w=0, h=0 → only exactly (50,50) qualifies
    expect(hitTestPoint(obj, 50, 50)).toBe(true);
  });

  it("point away from instance is outside the bounding box", () => {
    const obj = makeInstance(50, 50);
    expect(hitTestPoint(obj, 100, 100)).toBe(false);
  });
});

describe("hitTestPoint – TextDisplayObject (bounding box)", () => {
  const makeText = (): DisplayObject => ({
    type: "text",
    id: "t1",
    x: 10,
    y: 20,
    width: 200,
    height: 40,
    text: "Hello",
    textType: "static",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    multiline: false,
    wordWrap: false,
  });

  it("returns true for a point inside the text bounding box", () => {
    const obj = makeText();
    expect(hitTestPoint(obj, 100, 35)).toBe(true);
  });

  it("returns false for a point outside the text bounding box", () => {
    const obj = makeText();
    expect(hitTestPoint(obj, 5, 35)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Polygon (triangle) hit tests — ray casting improvements
// ---------------------------------------------------------------------------
//
// Triangle: vertices (0,0), (100,0), (50,100) placed at world origin (0,0).
// AABB of this triangle: x:[0,100], y:[0,100] (a 100×100 box).
// The polygon test must reject points inside the AABB but outside the triangle.

describe("hitTestPoint – ShapeDisplayObject triangle (polygon ray casting)", () => {
  // Triangle with vertices A=(0,0), B=(100,0), C=(50,100) at world pos (0,0)
  const makeTriangle = () => makeTriangleShape(0, 0, 0, 0, 100, 0, 50, 100);

  it("point inside the triangle returns true", () => {
    // Centroid of the triangle is at (50, 33.3) — clearly inside
    const obj = makeTriangle();
    expect(hitTestPoint(obj, 50, 33)).toBe(true);
  });

  it("point outside the triangle (far right) returns false", () => {
    // (90, 90) is outside the triangle: the right edge goes from (100,0) to
    // (50,100) so at y=90 the right boundary is at x = 100 - 50*(90/100) = 55
    const obj = makeTriangle();
    expect(hitTestPoint(obj, 90, 90)).toBe(false);
  });

  it("point inside AABB but outside triangle returns false (polygon matters)", () => {
    // (5, 90) is inside the AABB [0,100]×[0,100] but far outside the triangle.
    // At y=90 the left edge of the triangle (from (0,0) to (50,100)) is at
    // x = 50*(90/100) = 45, so x=5 is to the left of the triangle.
    const obj = makeTriangle();
    expect(hitTestPoint(obj, 5, 90)).toBe(false);
  });

  it("point near/on the top edge returns a deterministic result without throwing", () => {
    // (50, 0) is on the top edge of the triangle — must not throw
    const obj = makeTriangle();
    expect(() => hitTestPoint(obj, 50, 0)).not.toThrow();
  });

  it("point near/on the left edge returns a deterministic result without throwing", () => {
    // (25, 50) is on the left edge A→C
    const obj = makeTriangle();
    expect(() => hitTestPoint(obj, 25, 50)).not.toThrow();
  });

  it("empty shape (no paths) returns false", () => {
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "empty",
      x: 0,
      y: 0,
      shape: {
        id: "emptyShape",
        paths: [],
      },
    };
    expect(hitTestPoint(obj, 50, 50)).toBe(false);
  });

  it("shape with paths but no fill returns false", () => {
    // A triangle path with only a stroke (no fill) should not hit
    const obj: ShapeDisplayObject = {
      type: "shape",
      id: "strokeOnly",
      x: 0,
      y: 0,
      shape: {
        id: "strokeOnlyShape",
        paths: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { type: "line", to: { x: 100, y: 0 } },
              { type: "line", to: { x: 50, y: 100 } },
            ],
            stroke: {
              type: "solid",
              color: { r: 0, g: 0, b: 0, a: 255 },
              width: 2,
              caps: "none",
              joints: "miter",
              miterLimit: 3,
            },
            closed: true,
          },
        ],
      },
    };
    expect(hitTestPoint(obj, 50, 33)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pointInPolygon — explicit vertex array ray-casting
// ---------------------------------------------------------------------------

describe("pointInPolygon – rectangular polygon", () => {
  // Rectangle with corners (0,0),(100,0),(100,80),(0,80)
  const rect = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 },
  ];

  it("point inside rectangular polygon returns true", () => {
    expect(pointInPolygon(50, 40, rect)).toBe(true);
  });

  it("point outside rectangular polygon returns false", () => {
    expect(pointInPolygon(200, 40, rect)).toBe(false);
  });

  it("point inside AABB but outside triangular polygon returns false", () => {
    // Triangle (0,0),(100,0),(50,100): AABB is [0,100]x[0,100]
    // Point (5,90) is inside AABB but outside the triangle
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    expect(pointInPolygon(5, 90, triangle)).toBe(false);
  });

  it("empty vertex array returns false", () => {
    expect(pointInPolygon(50, 50, [])).toBe(false);
  });

  it("single-vertex polygon returns false", () => {
    expect(pointInPolygon(50, 50, [{ x: 50, y: 50 }])).toBe(false);
  });

  it("point inside triangular polygon returns true", () => {
    // Triangle (0,0),(100,0),(50,100): centroid at (50,33)
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    expect(pointInPolygon(50, 33, triangle)).toBe(true);
  });
});
