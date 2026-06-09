import { describe, it, expect } from "vitest";
import {
  getGoverningKeyframe,
  getTweenSpans,
  getTweenedFrame,
} from "../timeline-query.js";
import { createLayer, createFrame } from "../timeline.js";

// ---------------------------------------------------------------------------
// getGoverningKeyframe
// ---------------------------------------------------------------------------

describe("getGoverningKeyframe", () => {
  it("returns keyframe at exact index", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3), createFrame(7)],
      frameCount: 10,
    });
    const kf = getGoverningKeyframe(layer, 3);
    expect(kf).not.toBeNull();
    expect(kf!.index).toBe(3);
  });

  it("returns most recent keyframe before the given frame", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(3), createFrame(7)],
      frameCount: 10,
    });
    const kf = getGoverningKeyframe(layer, 5);
    expect(kf).not.toBeNull();
    expect(kf!.index).toBe(3); // most recent before 5
  });

  it("returns first keyframe when frame is 0", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(5)],
      frameCount: 10,
    });
    const kf = getGoverningKeyframe(layer, 0);
    expect(kf).not.toBeNull();
    expect(kf!.index).toBe(0);
  });

  it("returns the last governing keyframe just before end of layer", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(4)],
      frameCount: 10,
    });
    const kf = getGoverningKeyframe(layer, 9);
    expect(kf).not.toBeNull();
    expect(kf!.index).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// getTweenSpans
// ---------------------------------------------------------------------------

describe("getTweenSpans", () => {
  it("identifies a motion tween span between two keyframes", () => {
    const kf0 = createFrame(0, { tweenType: "motion", motionEase: 50 });
    const kf5 = createFrame(5);
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf5],
      frameCount: 5,
    });
    const spans = getTweenSpans(layer);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.startFrame).toBe(0);
    expect(spans[0]!.endFrame).toBe(4); // endFrame = next kf index - 1
    expect(spans[0]!.tweenType).toBe("motion");
    expect(spans[0]!.ease).toBe(50);
  });

  it("identifies a shape tween span between two keyframes", () => {
    const kf0 = createFrame(0, { tweenType: "shape", shapeEase: -25 });
    const kf8 = createFrame(8);
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf8],
      frameCount: 8,
    });
    const spans = getTweenSpans(layer);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.tweenType).toBe("shape");
    expect(spans[0]!.ease).toBe(-25);
  });

  it("returns empty array for a no-tween single-keyframe layer", () => {
    const layer = createLayer("L"); // only frame 0, tweenType="none"
    const spans = getTweenSpans(layer);
    expect(spans).toHaveLength(0);
  });

  it("returns empty array when keyframe tweenType is none", () => {
    const kf0 = createFrame(0, { tweenType: "none" });
    const kf5 = createFrame(5);
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf5],
      frameCount: 5,
    });
    const spans = getTweenSpans(layer);
    expect(spans).toHaveLength(0);
  });

  it("handles multiple tween spans in one layer", () => {
    const kf0 = createFrame(0, { tweenType: "motion" });
    const kf5 = createFrame(5, { tweenType: "shape" });
    const kf10 = createFrame(10);
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf5, kf10],
      frameCount: 10,
    });
    const spans = getTweenSpans(layer);
    expect(spans).toHaveLength(2);
    expect(spans[0]!.tweenType).toBe("motion");
    expect(spans[1]!.tweenType).toBe("shape");
  });
});

// ---------------------------------------------------------------------------
// getTweenedFrame
// ---------------------------------------------------------------------------

describe("getTweenedFrame", () => {
  it("returns governing keyframe when outside a tween span", () => {
    const kf0 = createFrame(0);
    const kf5 = createFrame(5);
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf5],
      frameCount: 10,
    });
    // Frame 7 is beyond kf5 which has no tween — governing keyframe is kf5
    const frame = getTweenedFrame(layer, 7);
    expect(frame).not.toBeNull();
    expect(frame!.index).toBe(5);
  });

  it("returns null for frame index beyond layer duration", () => {
    const layer = createLayer("L"); // frameCount=1
    const frame = getTweenedFrame(layer, 99);
    expect(frame).toBeNull();
  });

  it("returns null for negative frame index", () => {
    const layer = createLayer("L");
    const frame = getTweenedFrame(layer, -1);
    expect(frame).toBeNull();
  });

  it("returns interpolated x/y at midpoint of a motion tween", () => {
    const obj0 = {
      type: "shape" as const,
      id: "s1",
      shape: { id: "sh1", paths: [] },
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const obj10 = {
      type: "shape" as const,
      id: "s1",
      shape: { id: "sh1", paths: [] },
      x: 100,
      y: 200,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const kf0 = createFrame(0, {
      tweenType: "motion",
      motionEase: 0,
      isEmpty: false,
      displayObjects: [obj0],
    });
    const kf10 = createFrame(10, {
      isEmpty: false,
      displayObjects: [obj10],
    });
    const layer = createLayer("L", "normal", {
      frames: [kf0, kf10],
      frameCount: 10,
    });

    // Frame 5 is midpoint of span [0, 9]
    const frame = getTweenedFrame(layer, 5);
    expect(frame).not.toBeNull();
    const interpolatedObj = frame!.displayObjects[0] as { x: number; y: number };
    // At midpoint (linear ease=0), x should be ~50, y ~100
    expect(interpolatedObj.x).toBeCloseTo(50, 0);
    expect(interpolatedObj.y).toBeCloseTo(100, 0);
  });

  it("ease=100 (ease-out): object is closer to end position at midpoint", () => {
    // With ease=100, the object should be much further along at the midpoint
    // (fast start, slow end) compared to a linear tween.
    const objStart = {
      type: "shape" as const,
      id: "s1",
      shape: { id: "sh1", paths: [] },
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const objEnd = {
      type: "shape" as const,
      id: "s1",
      shape: { id: "sh1", paths: [] },
      x: 100,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const kfStart = createFrame(0, {
      tweenType: "motion",
      motionEase: 100,
      isEmpty: false,
      displayObjects: [objStart],
    });
    const kfEnd = createFrame(10, {
      isEmpty: false,
      displayObjects: [objEnd],
    });
    const layer = createLayer("L", "normal", {
      frames: [kfStart, kfEnd],
      frameCount: 10,
    });

    // Frame 5 is midpoint of span [0, 9]; t = 5/10 = 0.5
    // applyEase(0.5, 100) = 1 - (0.5)^4 = 0.9375
    // x = 0 + (100 - 0) * 0.9375 = 93.75
    const frame = getTweenedFrame(layer, 5);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as { x: number };
    expect(obj.x).toBeGreaterThan(50);  // closer to end position
    expect(obj.x).toBeCloseTo(93.75, 1);
  });

  it("ease=-100 (ease-in): object is closer to start position at midpoint", () => {
    // With ease=-100, the object should be much earlier in its journey at midpoint
    // (slow start, fast end) compared to a linear tween.
    const objStart = {
      type: "shape" as const,
      id: "s1",
      shape: { id: "sh1", paths: [] },
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const objEnd = {
      type: "shape" as const,
      id: "s1",
      shape: { id: "sh1", paths: [] },
      x: 100,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const kfStart = createFrame(0, {
      tweenType: "motion",
      motionEase: -100,
      isEmpty: false,
      displayObjects: [objStart],
    });
    const kfEnd = createFrame(10, {
      isEmpty: false,
      displayObjects: [objEnd],
    });
    const layer = createLayer("L", "normal", {
      frames: [kfStart, kfEnd],
      frameCount: 10,
    });

    // Frame 5 is midpoint of span [0, 9]; t = 5/10 = 0.5
    // applyEase(0.5, -100) = 0.5^4 = 0.0625
    // x = 0 + 100 * 0.0625 = 6.25
    const frame = getTweenedFrame(layer, 5);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as { x: number };
    expect(obj.x).toBeLessThan(50);  // closer to start position
    expect(obj.x).toBeCloseTo(6.25, 1);
  });
});
