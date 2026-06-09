/**
 * Tests for shape tween interpolation via getDisplayObjectsAtFrame and getTweenedFrame.
 *
 * Builds a scene with a shape tween (frame 0 → frame 8) and verifies:
 *  1. Frame 0 returns the first shape (non-null)
 *  2. Frame 8 returns the second shape (non-null)
 *  3. Frame 4 returns a non-null display object (interpolated between shapes)
 *  4. tweenType on frame 0 is 'shape'
 *  5. Shape tween span has correct frameCount
 *
 * The test also uses getDisplayObjectsAtFrame to exercise the timeline-level API.
 */

import { describe, it, expect } from "vitest";
import {
  getTweenedFrame,
  getDisplayObjectsAtFrame,
  getTweenSpans,
} from "../../model/timeline-query.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { ShapeDisplayObject, Shape, ShapePath } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShape(points: Array<{ x: number; y: number }>): Shape {
  const [start, ...rest] = points;
  const segments = rest.map((p) => ({ type: "line" as const, to: p }));
  const path: ShapePath = {
    start: start ?? { x: 0, y: 0 },
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

/**
 * Build a layer with a shape tween from frame 0 to frame 8 (9 frames total).
 * Frame 0 = keyframe with tweenType='shape', ShapeDisplayObject at startPoints
 * Frame 8 = keyframe (no tween), ShapeDisplayObject at endPoints
 * Frames 1-7 are within the tween span.
 */
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
  const endKf = createFrame(8, {
    displayObjects: [endObj],
  });

  return createLayer("Layer 1", "normal", {
    frames: [startKf, endKf],
    frameCount: 9,
  });
}

const START_PTS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

const END_PTS = [
  { x: 200, y: 200 },
  { x: 300, y: 200 },
  { x: 300, y: 300 },
];

// ---------------------------------------------------------------------------
// Tests — getTweenedFrame (layer-level API)
// ---------------------------------------------------------------------------

describe("shape tween — getTweenedFrame", () => {
  it("frame 0: returns non-null (start keyframe)", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 0);
    expect(frame).not.toBeNull();
  });

  it("frame 0: displayObjects[0] is a ShapeDisplayObject", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 0);
    expect(frame!.displayObjects).toHaveLength(1);
    expect(frame!.displayObjects[0]!.type).toBe("shape");
  });

  it("frame 0: shape matches start keyframe geometry", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 0);
    const shape = (frame!.displayObjects[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(0);
    expect(path.start.y).toBeCloseTo(0);
  });

  it("frame 8: returns non-null (end keyframe)", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 8);
    expect(frame).not.toBeNull();
  });

  it("frame 8: shape matches end keyframe geometry", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 8);
    const shape = (frame!.displayObjects[0] as ShapeDisplayObject).shape;
    const path = shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(200);
    expect(path.start.y).toBeCloseTo(200);
  });

  it("frame 4 (midpoint): returns non-null display object", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 4);
    expect(frame).not.toBeNull();
    expect(frame!.displayObjects).toHaveLength(1);
  });

  it("frame 4 (midpoint): shape is a ShapeDisplayObject", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 4);
    expect(frame!.displayObjects[0]!.type).toBe("shape");
  });

  it("frame 4 (midpoint): interpolated shape is between start and end", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 4);
    const path = (frame!.displayObjects[0] as ShapeDisplayObject).shape.paths[0]!;
    // At t=4/9 ≈ 0.444, x should be between 0 and 200
    expect(path.start.x).toBeGreaterThan(0);
    expect(path.start.x).toBeLessThan(200);
  });

  it("tweenType on frame 0 keyframe is 'shape'", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const kf0 = layer.frames[0]!;
    expect(kf0.tweenType).toBe("shape");
  });

  it("intermediate frames have isKeyframe=false", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const frame = getTweenedFrame(layer, 4);
    expect(frame).not.toBeNull();
    expect(frame!.isKeyframe).toBe(false);
    expect(frame!.index).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Tests — getTweenSpans (span metadata)
// ---------------------------------------------------------------------------

describe("shape tween — getTweenSpans span metadata", () => {
  it("returns exactly one span for a two-keyframe shape tween", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const spans = getTweenSpans(layer);
    expect(spans).toHaveLength(1);
  });

  it("span tweenType is 'shape'", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const span = getTweenSpans(layer)[0]!;
    expect(span.tweenType).toBe("shape");
  });

  it("span startFrame is 0", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const span = getTweenSpans(layer)[0]!;
    expect(span.startFrame).toBe(0);
  });

  it("span endFrame is 7 (frame before end keyframe)", () => {
    // The span ends one frame before the end keyframe (frame 8), so endFrame = 7.
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const span = getTweenSpans(layer)[0]!;
    expect(span.endFrame).toBe(7);
  });

  it("span frameCount (endFrame - startFrame + 1) is 8", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const span = getTweenSpans(layer)[0]!;
    const frameCount = span.endFrame - span.startFrame + 1;
    expect(frameCount).toBe(8);
  });

  it("span ease is 0 by default", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS, 0);
    const span = getTweenSpans(layer)[0]!;
    expect(span.ease).toBe(0);
  });

  it("span ease reflects the shapeEase on the start keyframe", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS, 50);
    const span = getTweenSpans(layer)[0]!;
    expect(span.ease).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Tests — getDisplayObjectsAtFrame (timeline-level API)
// ---------------------------------------------------------------------------

describe("shape tween — getDisplayObjectsAtFrame", () => {
  it("frame 0: returns display objects from start keyframe", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const timeline = createTimeline({ layers: [layer] });
    const objects = getDisplayObjectsAtFrame(timeline, 0);
    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe("shape");
  });

  it("frame 8: returns display objects from end keyframe", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const timeline = createTimeline({ layers: [layer] });
    const objects = getDisplayObjectsAtFrame(timeline, 8);
    expect(objects).toHaveLength(1);
    const path = (objects[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(200);
  });

  it("frame 4: returns non-null display object (interpolated shape)", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const timeline = createTimeline({ layers: [layer] });
    const objects = getDisplayObjectsAtFrame(timeline, 4);
    expect(objects).toHaveLength(1);
    expect(objects[0]).not.toBeNull();
    expect(objects[0]!.type).toBe("shape");
  });

  it("all frames 0..8 return exactly one display object", () => {
    const layer = buildShapeTweenLayer(START_PTS, END_PTS);
    const timeline = createTimeline({ layers: [layer] });
    for (let f = 0; f <= 8; f++) {
      const objects = getDisplayObjectsAtFrame(timeline, f);
      expect(objects).toHaveLength(1);
    }
  });
});
