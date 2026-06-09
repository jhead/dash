/**
 * Extended interpolation tests covering rotation modes and interpolateShapeTween.
 * Basic interpolateTween tests live in interpolate.test.ts.
 */
import { describe, it, expect } from "vitest";
import { interpolateTween, interpolateShapeTween } from "../interpolate.js";
import type { TweenTarget } from "../types.js";
import type { DisplayObject, ShapeDisplayObject } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// interpolateTween — rotation modes
// ---------------------------------------------------------------------------

const base: TweenTarget = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  alpha: 100,
};

describe("interpolateTween — rotation modes", () => {
  it("at t=0 (startFrame) returns start frame values", () => {
    const from: TweenTarget = { ...base, x: 10, y: 20, rotation: 45 };
    const to: TweenTarget = { ...base, x: 100, y: 200, rotation: 90 };
    const result = interpolateTween(from, to, 0, 0, 10, { ease: 0 });
    expect(result.x).toBeCloseTo(from.x);
    expect(result.y).toBeCloseTo(from.y);
  });

  it("at t=1 (endFrame) returns end frame values", () => {
    const from: TweenTarget = { ...base, x: 10, y: 20 };
    const to: TweenTarget = { ...base, x: 100, y: 200 };
    const result = interpolateTween(from, to, 10, 0, 10, { ease: 0 });
    expect(result.x).toBeCloseTo(to.x);
    expect(result.y).toBeCloseTo(to.y);
  });

  it("at t=0.5 interpolates x midpoint", () => {
    const from: TweenTarget = { ...base, x: 0 };
    const to: TweenTarget = { ...base, x: 200 };
    const result = interpolateTween(from, to, 5, 0, 10, { ease: 0 });
    expect(result.x).toBeCloseTo(100);
  });

  it("rotation cw: adds 360 degrees per rotateCount=1 extra rotation", () => {
    const from: TweenTarget = { ...base, rotation: 0 };
    const to: TweenTarget = { ...base, rotation: 0 };
    // With cw + count=1, full rotation at t=1 should be 0 + 360 = 360
    const result = interpolateTween(from, to, 10, 0, 10, {
      ease: 0,
      motionRotate: "cw",
      motionRotateCount: 1,
    });
    expect(result.rotation).toBeCloseTo(360);
  });

  it("rotation ccw: subtracts 360 degrees per rotateCount=1 extra rotation", () => {
    const from: TweenTarget = { ...base, rotation: 0 };
    const to: TweenTarget = { ...base, rotation: 0 };
    // With ccw + count=1, full rotation at t=1 should be 0 - 360 = -360
    const result = interpolateTween(from, to, 10, 0, 10, {
      ease: 0,
      motionRotate: "ccw",
      motionRotateCount: 1,
    });
    expect(result.rotation).toBeCloseTo(-360);
  });

  it("rotation none: holds start angle throughout the tween", () => {
    const from: TweenTarget = { ...base, rotation: 45 };
    const to: TweenTarget = { ...base, rotation: 270 };
    // With mode=none, rotation should stay at start value (45)
    const mid = interpolateTween(from, to, 5, 0, 10, {
      ease: 0,
      motionRotate: "none",
    });
    expect(mid.rotation).toBeCloseTo(45);
    const end = interpolateTween(from, to, 10, 0, 10, {
      ease: 0,
      motionRotate: "none",
    });
    expect(end.rotation).toBeCloseTo(45);
  });

  it("rotation cw: always rotates clockwise even when delta is negative normally", () => {
    // From 90° to 10°: normally (auto) would go -80° backward.
    // With cw it should go +280° forward.
    const from: TweenTarget = { ...base, rotation: 90 };
    const to: TweenTarget = { ...base, rotation: 10 };
    const result = interpolateTween(from, to, 10, 0, 10, {
      ease: 0,
      motionRotate: "cw",
      motionRotateCount: 0,
    });
    // delta = (10 - 90 + 360) = 280, result at t=1 should be 90 + 280 = 370
    expect(result.rotation).toBeCloseTo(370);
  });
});

// ---------------------------------------------------------------------------
// interpolateShapeTween
// ---------------------------------------------------------------------------

function makeShapeObj(id: string, x: number, y: number, startX: number, startY: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: {
      id: `sh-${id}`,
      paths: [
        {
          start: { x: startX, y: startY },
          segments: [{ type: "line", to: { x: startX + 10, y: startY + 10 } }],
          closed: false,
        },
      ],
    },
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

describe("interpolateShapeTween", () => {
  it("at t=0 returns start frame object positions", () => {
    const startObjs: DisplayObject[] = [makeShapeObj("a", 10, 20, 0, 0)];
    const endObjs: DisplayObject[] = [makeShapeObj("a", 100, 200, 0, 0)];
    const result = interpolateShapeTween(startObjs, endObjs, 0, 0, "distributive");
    const obj = result[0] as ShapeDisplayObject;
    expect(obj.x).toBeCloseTo(10);
    expect(obj.y).toBeCloseTo(20);
  });

  it("at t=1 returns end frame object positions", () => {
    const startObjs: DisplayObject[] = [makeShapeObj("a", 10, 20, 0, 0)];
    const endObjs: DisplayObject[] = [makeShapeObj("a", 100, 200, 0, 0)];
    const result = interpolateShapeTween(startObjs, endObjs, 1, 0, "distributive");
    const obj = result[0] as ShapeDisplayObject;
    expect(obj.x).toBeCloseTo(100);
    expect(obj.y).toBeCloseTo(200);
  });

  it("at t=0.5 interpolates x midpoint", () => {
    const startObjs: DisplayObject[] = [makeShapeObj("a", 0, 0, 0, 0)];
    const endObjs: DisplayObject[] = [makeShapeObj("a", 100, 200, 0, 0)];
    const result = interpolateShapeTween(startObjs, endObjs, 0.5, 0, "distributive");
    const obj = result[0] as ShapeDisplayObject;
    expect(obj.x).toBeCloseTo(50);
    expect(obj.y).toBeCloseTo(100);
  });

  it("first segment start point is path.start not (0,0) — regression for fixed bug", () => {
    // This tests the fix: when promoting a line segment to a degenerate curve,
    // the control point's "previous point" must use path.start, not (0,0).
    // A shape with path.start at (100, 200) should NOT interpolate toward origin.

    const startPath = {
      start: { x: 100, y: 200 },
      segments: [{ type: "line" as const, to: { x: 110, y: 210 } }],
      closed: false,
    };
    const endPath = {
      start: { x: 100, y: 200 },
      segments: [
        {
          type: "curve" as const,
          control: { x: 105, y: 205 },
          to: { x: 110, y: 210 },
        },
      ],
      closed: false,
    };

    const startObj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: { id: "sh1", paths: [startPath] },
      x: 0,
      y: 0,
    };
    const endObj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: { id: "sh1", paths: [endPath] },
      x: 0,
      y: 0,
    };

    const result = interpolateShapeTween([startObj], [endObj], 0.5, 0, "distributive");
    const interpolated = result[0] as ShapeDisplayObject;
    const interpolatedPath = interpolated.shape.paths[0]!;
    const seg = interpolatedPath.segments[0]!;

    // The interpolated first segment should be a curve (promoted from line)
    expect(seg.type).toBe("curve");

    if (seg.type === "curve") {
      // The control point should be near the midpoint of the line (100,200)→(110,210)
      // which is (105,205), NOT near origin (0,0).
      // At t=0.5: lerp(midA, controlB) = lerp((105,205), (105,205)) = (105,205)
      // midA = midpoint of line from path.start=(100,200) to to=(110,210) = (105,205)
      expect(seg.control.x).toBeGreaterThan(50); // not near 0
      expect(seg.control.y).toBeGreaterThan(50); // not near 0
    }
  });
});
