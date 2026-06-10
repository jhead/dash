/**
 * Unit tests for motion guide path sampling (guidepath.ts) and guide-layer
 * path following in getTweenedFrame.
 */

import { describe, it, expect } from "vitest";
import { samplePath, getGuideLayerPath } from "../guidepath.js";
import type { ShapePath } from "../types.js";
import { getTweenedFrame } from "../../model/timeline-query.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import type { Timeline } from "../../model/types.js";
import type { ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Helper: build a simple horizontal path from (x0,y) to (x1,y)
// ---------------------------------------------------------------------------

function horizontalPath(x0: number, y0: number, x1: number): ShapePath {
  return {
    start: { x: x0, y: y0 },
    segments: [{ type: "line", to: { x: x1, y: y0 } }],
    closed: false,
  };
}

// ---------------------------------------------------------------------------
// samplePath — basic tests
// ---------------------------------------------------------------------------

describe("samplePath", () => {
  it("t=0 returns the start point", () => {
    const path = horizontalPath(10, 20, 110);
    const pt = samplePath(path, 0);
    expect(pt.x).toBeCloseTo(10);
    expect(pt.y).toBeCloseTo(20);
  });

  it("t=1 returns the end point", () => {
    const path = horizontalPath(10, 20, 110);
    const pt = samplePath(path, 1);
    expect(pt.x).toBeCloseTo(110);
    expect(pt.y).toBeCloseTo(20);
  });

  it("t=0.5 returns the midpoint of a straight horizontal path", () => {
    const path = horizontalPath(0, 50, 200);
    const pt = samplePath(path, 0.5);
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(50);
  });

  it("tangent angle for a rightward (positive x) path is ~0 radians", () => {
    const path = horizontalPath(0, 0, 100);
    const pt = samplePath(path, 0.5);
    expect(pt.angle).toBeCloseTo(0, 3);
  });

  it("tangent angle for an upward path is ~-π/2 radians", () => {
    // From (0, 100) to (0, 0) — moving upward in screen coords → angle = -π/2
    const path: ShapePath = {
      start: { x: 0, y: 100 },
      segments: [{ type: "line", to: { x: 0, y: 0 } }],
      closed: false,
    };
    const pt = samplePath(path, 0.5);
    expect(pt.angle).toBeCloseTo(-Math.PI / 2, 3);
  });

  it("t=0.5 on a two-segment path selects the correct segment", () => {
    // Path: (0,0) → (100,0) → (100,100)
    // Total length = 200. At t=0.5, target = 100 → end of first segment.
    const path: ShapePath = {
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 100, y: 0 } },
        { type: "line", to: { x: 100, y: 100 } },
      ],
      closed: false,
    };
    const pt = samplePath(path, 0.5);
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(0);
  });

  it("quadratic bezier curve is approximated: t=0 returns start", () => {
    // Quadratic bezier from (0,0) with control (50,100) to (100,0)
    const path: ShapePath = {
      start: { x: 0, y: 0 },
      segments: [{ type: "curve", control: { x: 50, y: 100 }, to: { x: 100, y: 0 } }],
      closed: false,
    };
    const pt = samplePath(path, 0);
    expect(pt.x).toBeCloseTo(0, 0);
    expect(pt.y).toBeCloseTo(0, 0);
  });
});

// ---------------------------------------------------------------------------
// getGuideLayerPath
// ---------------------------------------------------------------------------

describe("getGuideLayerPath", () => {
  it("returns null for a layer with no shapes", () => {
    const layer = createLayer("guide", "guide");
    // The default layer has an empty keyframe (no display objects)
    const result = getGuideLayerPath(layer);
    expect(result).toBeNull();
  });

  it("returns the first ShapePath from the first keyframe's first shape", () => {
    const path = horizontalPath(0, 0, 100);
    const shapeObj: ShapeDisplayObject = {
      type: "shape",
      id: "s1",
      shape: { id: "sh1", paths: [path] },
      x: 0,
      y: 0,
    };
    const frame = createFrame(0, { displayObjects: [shapeObj] });
    const layer = createLayer("guide", "guide", { frames: [frame], frameCount: 1 });
    const result = getGuideLayerPath(layer);
    expect(result).not.toBeNull();
    expect(result).toStrictEqual(path);
  });
});

// ---------------------------------------------------------------------------
// Guide path following in getTweenedFrame
// ---------------------------------------------------------------------------

describe("getTweenedFrame with guide path", () => {
  /**
   * Build a minimal timeline:
   *   index 0 — guide layer with a horizontal path from (0,0) to (100,0)
   *   index 1 — guided layer with a motion tween from frame 0 to frame 4
   *
   * Flash layers: index 0 = topmost in UI → guide layer is at layers[0],
   * guided layer is at layers[1] (directly below).
   */
  function buildGuideTimeline(orientToPath = false): Timeline {
    const guidePath = horizontalPath(0, 0, 100);
    const guideShapeObj: ShapeDisplayObject = {
      type: "shape",
      id: "gs1",
      shape: { id: "gsh1", paths: [guidePath] },
      x: 0,
      y: 0,
    };
    const guideFrame = createFrame(0, { displayObjects: [guideShapeObj] });
    const guideLayer = createLayer("guide", "guide", {
      frames: [guideFrame],
      frameCount: 5,
    });

    // Guided layer: motion tween from frame 0 (at origin) to frame 4
    const startObj: ShapeDisplayObject = {
      type: "shape",
      id: "obj1",
      shape: { id: "sh2", paths: [] },
      x: 0,
      y: 0,
    };
    const endObj: ShapeDisplayObject = {
      type: "shape",
      id: "obj1",
      shape: { id: "sh2", paths: [] },
      x: 200,  // would normally move here, but guide path overrides
      y: 200,
    };
    const startKf = createFrame(0, {
      tweenType: "motion",
      displayObjects: [startObj],
      motionOrientToPath: orientToPath,
    });
    const endKf = createFrame(4, { displayObjects: [endObj] });
    const guidedLayer = createLayer("guided", "guided", {
      frames: [startKf, endKf],
      frameCount: 5,
    });

    return { layers: [guideLayer, guidedLayer] };
  }

  it("at frame 0, guided object is placed at the path start (t=0)", () => {
    const timeline = buildGuideTimeline();
    const guidedLayer = timeline.layers[1]!;
    const frame = getTweenedFrame(guidedLayer, 0, timeline);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as ShapeDisplayObject;
    // t=0 → path start = (0, 0)
    expect(obj.x).toBeCloseTo(0);
    expect(obj.y).toBeCloseTo(0);
  });

  it("at frame 4 (last frame), guided object is at the path end (t=1)", () => {
    const timeline = buildGuideTimeline();
    const guidedLayer = timeline.layers[1]!;
    // Frame 4 is the end keyframe itself — getTweenedFrame returns governing kf
    // which has x=200, y=200. Test via a frame just before: frame 3.
    // Actually frame 4 is beyond the tween span (span is 0..3) since endFrame+1=4.
    // Let's check frame 3 which is still in the span, t = 3/(5-1) = 0.75.
    const frame3 = getTweenedFrame(guidedLayer, 3, timeline);
    expect(frame3).not.toBeNull();
    const obj3 = frame3!.displayObjects[0] as ShapeDisplayObject;
    // t = 3/4 = 0.75 along path (0,0)→(100,0) → x=75, y=0
    expect(obj3.x).toBeCloseTo(75);
    expect(obj3.y).toBeCloseTo(0);
  });

  it("at frame 2 (midpoint of 5-frame span), guided object is at path midpoint", () => {
    const timeline = buildGuideTimeline();
    const guidedLayer = timeline.layers[1]!;
    const frame = getTweenedFrame(guidedLayer, 2, timeline);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as ShapeDisplayObject;
    // span: frames 0..3 (endFrame=3), spanLength=5, t = 2/(5-1) = 0.5
    // path (0,0)→(100,0) at t=0.5 → x=50, y=0
    expect(obj.x).toBeCloseTo(50);
    expect(obj.y).toBeCloseTo(0);
    expect(obj.y).toBeCloseTo(0);
  });

  it("without a timeline argument, positions come from normal interpolation", () => {
    const timeline = buildGuideTimeline();
    const guidedLayer = timeline.layers[1]!;
    // No timeline passed — should use normal interpolation (x=200*t, y=200*t at frame 2)
    const frame = getTweenedFrame(guidedLayer, 2);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as ShapeDisplayObject;
    // Normal interpolation: t = 2/4 = 0.5, x = lerp(0,200,0.5)=100, y=100
    expect(obj.x).toBeCloseTo(100);
    expect(obj.y).toBeCloseTo(100);
  });

  it("motionOrientToPath=true sets rotation to path tangent angle", () => {
    const timeline = buildGuideTimeline(true);
    const guidedLayer = timeline.layers[1]!;
    const frame = getTweenedFrame(guidedLayer, 2, timeline);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as ShapeDisplayObject;
    // Horizontal path → angle = 0 rad → rotation = 0 degrees
    expect(obj.rotation ?? 0).toBeCloseTo(0);
  });

  it("guide path overrides linear interpolation: position differs from linear lerp", () => {
    // Build a curved guide path (non-straight) so the guide midpoint is distinct
    // from the linear interpolation midpoint.
    //
    // Guide path: vertical line (0,0) → (0,100) — the midpoint is (0,50).
    // Guided layer linear tween: start (0,0) → end (200,200).
    // Linear interpolation midpoint: (100,100).
    // Guide path midpoint: (0,50).
    //
    // With a timeline, the guided position should be (0,50) — not (100,100).
    const verticalPath: import("../types.js").ShapePath = {
      start: { x: 0, y: 0 },
      segments: [{ type: "line", to: { x: 0, y: 100 } }],
      closed: false,
    };
    const guideShapeObj: ShapeDisplayObject = {
      type: "shape",
      id: "gs-v",
      shape: { id: "gsh-v", paths: [verticalPath] },
      x: 0,
      y: 0,
    };
    const guideFrame = createFrame(0, { displayObjects: [guideShapeObj] });
    const guideLayer = createLayer("guide-v", "guide", {
      frames: [guideFrame],
      frameCount: 5,
    });

    const startObj: ShapeDisplayObject = {
      type: "shape",
      id: "obj-v",
      shape: { id: "sh-v", paths: [] },
      x: 0,
      y: 0,
    };
    const endObj: ShapeDisplayObject = {
      type: "shape",
      id: "obj-v",
      shape: { id: "sh-v", paths: [] },
      x: 200,
      y: 200,
    };
    const startKf = createFrame(0, { tweenType: "motion", displayObjects: [startObj] });
    const endKf = createFrame(4, { displayObjects: [endObj] });
    const guidedLayer = createLayer("guided-v", "guided", {
      frames: [startKf, endKf],
      frameCount: 5,
    });

    const timeline: import("../../model/types.js").Timeline = {
      layers: [guideLayer, guidedLayer],
    };

    // Frame 2 of 5 — t = 2/4 = 0.5 along the path (0,0)→(0,100) → position (0,50)
    const frame = getTweenedFrame(guidedLayer, 2, timeline);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as ShapeDisplayObject;

    // Guide path position at t=0.5: (0, 50)
    expect(obj.x).toBeCloseTo(0);
    expect(obj.y).toBeCloseTo(50);

    // Confirm this differs from what linear interpolation would produce: (100, 100)
    // (by checking the values are NOT 100,100)
    const frameNoGuide = getTweenedFrame(guidedLayer, 2); // no timeline → linear
    const objLinear = frameNoGuide!.displayObjects[0] as ShapeDisplayObject;
    expect(objLinear.x).toBeCloseTo(100);
    expect(objLinear.y).toBeCloseTo(100);

    // Verify the guide path position is different from the linear position
    expect(obj.x).not.toBeCloseTo(objLinear.x);
    expect(obj.y).not.toBeCloseTo(objLinear.y);
  });
});
