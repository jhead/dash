/**
 * Unit tests for shape tween interpolation.
 * Tests cover getTweenedFrame with shape tween spans and the
 * interpolateShapeTween helper directly.
 */

import { describe, it, expect } from "vitest";
import { interpolateShapeTween } from "../../tween/interpolate.js";
import { getTweenedFrame } from "../../model/timeline-query.js";
import { createFrame, createLayer } from "../../model/timeline.js";
import type { ShapeDisplayObject, Shape, ShapePath } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShape(points: Array<{ x: number; y: number }>): Shape {
  if (points.length < 1) {
    return { id: "s", paths: [] };
  }
  const [start, ...rest] = points;
  const segments = rest.map((p) => ({ type: "line" as const, to: p }));
  const path: ShapePath = {
    start: start!,
    segments,
    closed: false,
  };
  return { id: "s", paths: [path] };
}

function makeShapeObj(
  id: string,
  points: Array<{ x: number; y: number }>,
  overrides: Partial<ShapeDisplayObject> = {}
): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: makeShape(points),
    x: 0,
    y: 0,
    ...overrides,
  };
}

// Build a layer with a shape tween from frame 0 to frame 4 (5-frame span).
// startPoints  → start keyframe shape (frame 0, tweenType="shape")
// endPoints    → end keyframe shape   (frame 4)
// shapeEase    → ease value on start keyframe
function buildShapeTweenLayer(
  startPoints: Array<{ x: number; y: number }>,
  endPoints: Array<{ x: number; y: number }>,
  shapeEase = 0
) {
  const startObj = makeShapeObj("obj1", startPoints);
  const endObj = makeShapeObj("obj1", endPoints);

  const startKf = createFrame(0, {
    tweenType: "shape",
    shapeEase,
    displayObjects: [startObj],
  });
  const endKf = createFrame(4, {
    displayObjects: [endObj],
  });

  return createLayer("Layer 1", "normal", {
    frames: [startKf, endKf],
    frameCount: 5,
  });
}

// ---------------------------------------------------------------------------
// interpolateShapeTween — unit tests
// ---------------------------------------------------------------------------

describe("interpolateShapeTween", () => {
  const startPts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const endPts = [
    { x: 200, y: 200 },
    { x: 300, y: 200 },
    { x: 300, y: 300 },
  ];

  const startObjs = [makeShapeObj("a", startPts)];
  const endObjs = [makeShapeObj("a", endPts)];

  it("t=0 returns start frame geometry (all points match start)", () => {
    const result = interpolateShapeTween(startObjs, endObjs, 0, 0, "distributive");
    expect(result).toHaveLength(1);
    const shape = (result[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(0);
    expect(path.start.y).toBeCloseTo(0);
    // segment 0 "to" should be at startPts[1]
    expect((path.segments[0] as { to: { x: number; y: number } }).to.x).toBeCloseTo(100);
    expect((path.segments[0] as { to: { x: number; y: number } }).to.y).toBeCloseTo(0);
  });

  it("t=1 returns end frame geometry (all points match end)", () => {
    const result = interpolateShapeTween(startObjs, endObjs, 1, 0, "distributive");
    expect(result).toHaveLength(1);
    const shape = (result[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(200);
    expect(path.start.y).toBeCloseTo(200);
    expect((path.segments[0] as { to: { x: number; y: number } }).to.x).toBeCloseTo(300);
    expect((path.segments[0] as { to: { x: number; y: number } }).to.y).toBeCloseTo(200);
  });

  it("t=0.5 returns midpoint coords (±0.5 tolerance)", () => {
    const result = interpolateShapeTween(startObjs, endObjs, 0.5, 0, "distributive");
    expect(result).toHaveLength(1);
    const shape = (result[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    // start: lerp(0,200,0.5)=100, lerp(0,200,0.5)=100
    expect(path.start.x).toBeCloseTo(100, 0);
    expect(path.start.y).toBeCloseTo(100, 0);
    // segment 0 "to": lerp(100,300,0.5)=200, lerp(0,200,0.5)=100
    expect((path.segments[0] as { to: { x: number; y: number } }).to.x).toBeCloseTo(200, 0);
    expect((path.segments[0] as { to: { x: number; y: number } }).to.y).toBeCloseTo(100, 0);
  });

  it("different segment counts: extra start segments are appended unchanged", () => {
    // startPts has 3 points (2 segments), endPts has 2 points (1 segment)
    const fewEndPts = [{ x: 200, y: 200 }, { x: 300, y: 200 }];
    const fewEndObjs = [makeShapeObj("a", fewEndPts)];
    const result = interpolateShapeTween(startObjs, fewEndObjs, 0.5, 0, "distributive");
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    // 2 total segments: 1 interpolated + 1 from start (unchanged)
    expect(path.segments).toHaveLength(2);
    // The extra segment from start shape at segments[1] should be startPts[2]
    const extraSeg = path.segments[1] as { to: { x: number; y: number } };
    expect(extraSeg.to.x).toBeCloseTo(100);
    expect(extraSeg.to.y).toBeCloseTo(100);
  });

  it("non-shape objects pass through from start unchanged", () => {
    const nonShape = {
      type: "instance" as const,
      id: "inst1",
      symbolId: "sym1",
      x: 10,
      y: 20,
    };
    const result = interpolateShapeTween([nonShape], [nonShape], 0.5, 0, "distributive");
    expect(result[0]).toBe(nonShape);
  });

  it("result is a new array (immutability: not same reference as startObjects)", () => {
    const result = interpolateShapeTween(startObjs, endObjs, 0, 0, "distributive");
    expect(result).not.toBe(startObjs);
    expect(result[0]).not.toBe(startObjs[0]);
  });
});

// ---------------------------------------------------------------------------
// shapeEase affects interpolated t
// ---------------------------------------------------------------------------

describe("interpolateShapeTween with shapeEase", () => {
  it("shapeEase=100 (ease-out) at t=0.5 gives more progress than linear", () => {
    // With ease=100, applyEase(0.5, 100) ≈ 0.9375  (strong ease-out)
    const startObjs = [makeShapeObj("a", [{ x: 0, y: 0 }, { x: 0, y: 0 }])];
    const endObjs = [makeShapeObj("a", [{ x: 100, y: 0 }, { x: 100, y: 0 }])];

    const easedResult = interpolateShapeTween(startObjs, endObjs, 0.5, 100, "distributive");
    const linearResult = interpolateShapeTween(startObjs, endObjs, 0.5, 0, "distributive");

    const easedX = (easedResult[0] as ShapeDisplayObject).shape.paths[0]!.start.x;
    const linearX = (linearResult[0] as ShapeDisplayObject).shape.paths[0]!.start.x;

    // ease-out: midpoint has advanced further than linear
    expect(easedX).toBeGreaterThan(linearX);
    // ease=100, t=0.5: applyEase returns ~0.9375 → x ≈ 93.75
    expect(easedX).toBeCloseTo(93.75, 0);
    // linear: x = 50
    expect(linearX).toBeCloseTo(50, 0);
  });
});

// ---------------------------------------------------------------------------
// getTweenedFrame shape tween integration tests
// ---------------------------------------------------------------------------

describe("getTweenedFrame with shape tween", () => {
  const startPts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const endPts = [{ x: 200, y: 200 }, { x: 300, y: 200 }];

  it("at frame 0 (start keyframe), returns start keyframe geometry", () => {
    const layer = buildShapeTweenLayer(startPts, endPts);
    const frame = getTweenedFrame(layer, 0);
    expect(frame).not.toBeNull();
    const shape = (frame!.displayObjects[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(0);
    expect(path.start.y).toBeCloseTo(0);
  });

  it("at the last keyframe (frame 4), returns end keyframe geometry", () => {
    const layer = buildShapeTweenLayer(startPts, endPts);
    const frame = getTweenedFrame(layer, 4);
    expect(frame).not.toBeNull();
    const shape = (frame!.displayObjects[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(200);
    expect(path.start.y).toBeCloseTo(200);
  });

  it("at an intermediate frame, returns interpolated geometry", () => {
    const layer = buildShapeTweenLayer(startPts, endPts);
    // frame 2 is in the tween span (0..3), t = 2/4 = 0.5
    const frame = getTweenedFrame(layer, 2);
    expect(frame).not.toBeNull();
    const shape = (frame!.displayObjects[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    // lerp(0,200,0.5)=100, lerp(0,200,0.5)=100
    expect(path.start.x).toBeCloseTo(100, 0);
    expect(path.start.y).toBeCloseTo(100, 0);
  });

  it("returned frame has isKeyframe=false for intermediate frames", () => {
    const layer = buildShapeTweenLayer(startPts, endPts);
    const frame = getTweenedFrame(layer, 2);
    expect(frame).not.toBeNull();
    expect(frame!.isKeyframe).toBe(false);
    expect(frame!.index).toBe(2);
  });

  it("shapeEase=100 on start keyframe affects interpolation at midframe", () => {
    const layerEased = buildShapeTweenLayer(startPts, endPts, 100);
    const layerLinear = buildShapeTweenLayer(startPts, endPts, 0);

    // frame 2 is the midpoint of a 5-frame span: linearT = 2/4 = 0.5
    const easedFrame = getTweenedFrame(layerEased, 2);
    const linearFrame = getTweenedFrame(layerLinear, 2);

    expect(easedFrame).not.toBeNull();
    expect(linearFrame).not.toBeNull();

    const easedX = (easedFrame!.displayObjects[0] as ShapeDisplayObject).shape.paths[0]!.start.x;
    const linearX = (linearFrame!.displayObjects[0] as ShapeDisplayObject).shape.paths[0]!.start.x;

    // ease-out: more progress at midpoint → x further along toward 200
    expect(easedX).toBeGreaterThan(linearX);
  });

  it("displayObjects array of result is a new object (immutability)", () => {
    const layer = buildShapeTweenLayer(startPts, endPts);
    const startKf = layer.frames[0]!;
    const frame = getTweenedFrame(layer, 2);
    expect(frame).not.toBeNull();
    // The returned frame object is different from the start keyframe
    expect(frame).not.toBe(startKf);
    // The displayObjects array is a new array
    expect(frame!.displayObjects).not.toBe(startKf.displayObjects);
  });
});
