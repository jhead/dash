/**
 * Unit tests for Copy Motion / Paste Motion logic.
 *
 * Tests the pure transformation logic:
 *   1. Copying tween parameters from a keyframe into a MotionClipboard object
 *   2. Applying those parameters back onto a different keyframe (preserving
 *      display objects)
 *   3. Motion-only fields are transferred; display objects are untouched
 *   4. Shape tween parameters round-trip correctly
 *   5. Copying from a non-keyframe position (no governing keyframe) is a no-op
 */

import { describe, it, expect } from "vitest";
import {
  createFrame,
  createLayer,
  createTimeline,
  setMotionTween,
  setShapeTween,
} from "@flash/core";
import type { Frame, Layer, Timeline, EaseCurve } from "@flash/core";

// ---------------------------------------------------------------------------
// Inline copy of the MotionClipboard interface (must stay in sync with Shell.tsx)
// ---------------------------------------------------------------------------

interface MotionClipboard {
  tweenType: "none" | "motion" | "shape";
  motionEase: number;
  motionEaseCurve?: EaseCurve | null;
  motionRotate: "none" | "auto" | "cw" | "ccw";
  motionRotateCount: number;
  motionOrientToPath: boolean;
  motionSync: boolean;
  motionScale: boolean;
  shapeEase: number;
  shapeBlend: "distributive" | "angular";
}

// ---------------------------------------------------------------------------
// Inline copies of the pure logic from Shell.tsx handlers
// ---------------------------------------------------------------------------

/**
 * Get the governing keyframe at or before `frameIndex` in a layer.
 * Returns null if no keyframe exists at or before the given frame.
 */
function getGoverningKeyframe(layer: Layer, frameIndex: number): Frame | null {
  const kfs = layer.frames
    .filter((f) => f.isKeyframe && f.index <= frameIndex)
    .sort((a, b) => b.index - a.index);
  return kfs[0] ?? null;
}

/**
 * Copy tween parameters from a frame into a MotionClipboard.
 */
function copyMotionFromFrame(frame: Frame): MotionClipboard {
  return {
    tweenType: frame.tweenType,
    motionEase: frame.motionEase,
    motionEaseCurve: frame.motionEaseCurve ?? null,
    motionRotate: frame.motionRotate,
    motionRotateCount: frame.motionRotateCount,
    motionOrientToPath: frame.motionOrientToPath,
    motionSync: frame.motionSync,
    motionScale: frame.motionScale,
    shapeEase: frame.shapeEase,
    shapeBlend: frame.shapeBlend,
  };
}

/**
 * Apply MotionClipboard parameters to the governing keyframe at `frameIndex`
 * in the given layer, leaving displayObjects untouched.
 * Returns a new Timeline.
 */
function pasteMotionToTimeline(
  timeline: Timeline,
  layerId: string,
  frameIndex: number,
  mc: MotionClipboard
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const kf = getGoverningKeyframe(layer, frameIndex);
      if (!kf) return layer;
      return {
        ...layer,
        frames: layer.frames.map((f) => {
          if (f.index !== kf.index || !f.isKeyframe) return f;
          return {
            ...f,
            tweenType: mc.tweenType,
            motionEase: mc.motionEase,
            motionEaseCurve: mc.motionEaseCurve,
            motionRotate: mc.motionRotate,
            motionRotateCount: mc.motionRotateCount,
            motionOrientToPath: mc.motionOrientToPath,
            motionSync: mc.motionSync,
            motionScale: mc.motionScale,
            shapeEase: mc.shapeEase,
            shapeBlend: mc.shapeBlend,
          };
        }),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a simple two-keyframe timeline for testing. */
function makeTimeline(): { timeline: Timeline; layerId: string } {
  const kf0 = createFrame(0, { isKeyframe: true, isEmpty: false });
  const kf5 = createFrame(5, { isKeyframe: true, isEmpty: false });
  const layer = createLayer("Layer 1", "normal", { frames: [kf0, kf5] });
  const timeline = createTimeline({ layers: [layer] });
  return { timeline, layerId: layer.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("copyMotionFromFrame", () => {
  it("copies all tween parameters from a plain (none) keyframe", () => {
    const frame = createFrame(0, { isKeyframe: true });
    const mc = copyMotionFromFrame(frame);

    expect(mc.tweenType).toBe("none");
    expect(mc.motionEase).toBe(0);
    expect(mc.motionEaseCurve).toBeNull();
    expect(mc.motionRotate).toBe("none");
    expect(mc.motionRotateCount).toBe(0);
    expect(mc.motionOrientToPath).toBe(false);
    expect(mc.motionSync).toBe(false);
    expect(mc.motionScale).toBe(true);
    expect(mc.shapeEase).toBe(0);
    expect(mc.shapeBlend).toBe("distributive");
  });

  it("copies motion tween parameters", () => {
    const { timeline, layerId } = makeTimeline();
    const withMotion = setMotionTween(timeline, layerId, 0, 50);
    const layer = withMotion.layers.find((l) => l.id === layerId)!;
    const kf = layer.frames.find((f) => f.index === 0)!;

    const mc = copyMotionFromFrame(kf);
    expect(mc.tweenType).toBe("motion");
    expect(mc.motionEase).toBe(50);
  });

  it("copies shape tween parameters", () => {
    const { timeline, layerId } = makeTimeline();
    const withShape = setShapeTween(timeline, layerId, 0, { ease: -75, blend: "angular" });
    const layer = withShape.layers.find((l) => l.id === layerId)!;
    const kf = layer.frames.find((f) => f.index === 0)!;

    const mc = copyMotionFromFrame(kf);
    expect(mc.tweenType).toBe("shape");
    expect(mc.shapeEase).toBe(-75);
    expect(mc.shapeBlend).toBe("angular");
  });

  it("copies custom ease curve when present", () => {
    const easeCurve: EaseCurve = { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.9 };
    // Build a frame with the ease curve set directly
    const frame = createFrame(0, {
      isKeyframe: true,
      tweenType: "motion",
      motionEase: 0,
      motionEaseCurve: easeCurve,
    });

    const mc = copyMotionFromFrame(frame);
    expect(mc.motionEaseCurve).toEqual(easeCurve);
  });
});

describe("pasteMotionToTimeline", () => {
  it("applies motion tween parameters to the target keyframe", () => {
    const { timeline, layerId } = makeTimeline();
    const withMotion = setMotionTween(timeline, layerId, 0, 80);
    const layer0 = withMotion.layers.find((l) => l.id === layerId)!;
    const srcKf = layer0.frames.find((f) => f.index === 0)!;
    const mc = copyMotionFromFrame(srcKf);

    // Paste onto kf at frame 5 (which starts as "none")
    const result = pasteMotionToTimeline(withMotion, layerId, 5, mc);
    const resultLayer = result.layers.find((l) => l.id === layerId)!;
    const targetKf = resultLayer.frames.find((f) => f.index === 5)!;

    expect(targetKf.tweenType).toBe("motion");
    expect(targetKf.motionEase).toBe(80);
  });

  it("paste does not alter display objects on the target keyframe", () => {
    const { timeline, layerId } = makeTimeline();
    // Add a display object to kf at frame 5
    const displayObj = {
      id: "obj-1",
      type: "shape" as const,
      x: 10,
      y: 20,
      shape: {
        id: "shape-1",
        paths: [] as const,
      },
    };
    const modifiedLayer = {
      ...timeline.layers.find((l) => l.id === layerId)!,
      frames: timeline.layers.find((l) => l.id === layerId)!.frames.map((f) =>
        f.index === 5 ? { ...f, displayObjects: [displayObj] } : f
      ),
    };
    const timelineWithObj: Timeline = {
      ...timeline,
      layers: timeline.layers.map((l) => (l.id === layerId ? modifiedLayer : l)),
    };

    // Set motion tween on kf 0 and copy it
    const withMotion = setMotionTween(timelineWithObj, layerId, 0, 30);
    const srcKf = withMotion.layers.find((l) => l.id === layerId)!.frames.find((f) => f.index === 0)!;
    const mc = copyMotionFromFrame(srcKf);

    const result = pasteMotionToTimeline(withMotion, layerId, 5, mc);
    const resultLayer = result.layers.find((l) => l.id === layerId)!;
    const targetKf = resultLayer.frames.find((f) => f.index === 5)!;

    // Tween should be updated
    expect(targetKf.tweenType).toBe("motion");
    // Display objects must be unchanged
    expect(targetKf.displayObjects).toHaveLength(1);
    expect(targetKf.displayObjects[0]!.id).toBe("obj-1");
  });

  it("paste on a frame within a span applies to the governing keyframe", () => {
    // Add frames 1–4 as span frames (non-keyframes) between kf0 and kf5
    const { timeline, layerId } = makeTimeline();
    const spanFrames = [1, 2, 3, 4].map((i) =>
      createFrame(i, { isKeyframe: false, isEmpty: false })
    );
    const layerWithSpan: Layer = {
      ...timeline.layers.find((l) => l.id === layerId)!,
      frames: [
        ...timeline.layers.find((l) => l.id === layerId)!.frames,
        ...spanFrames,
      ].sort((a, b) => a.index - b.index),
    };
    const fullTimeline: Timeline = {
      ...timeline,
      layers: timeline.layers.map((l) => (l.id === layerId ? layerWithSpan : l)),
    };

    // Copy "shape" tween from kf0
    const withShape = setShapeTween(fullTimeline, layerId, 0, { ease: 40, blend: "angular" });
    const srcKf = withShape.layers.find((l) => l.id === layerId)!.frames.find((f) => f.index === 0)!;
    const mc = copyMotionFromFrame(srcKf);

    // Paste onto frame index 3 (non-keyframe; should apply to kf0 since that governs frame 3)
    const result = pasteMotionToTimeline(withShape, layerId, 3, mc);
    const resultLayer = result.layers.find((l) => l.id === layerId)!;
    const kf0After = resultLayer.frames.find((f) => f.index === 0)!;

    expect(kf0After.tweenType).toBe("shape");
    expect(kf0After.shapeEase).toBe(40);
    expect(kf0After.shapeBlend).toBe("angular");
  });

  it("returns timeline unchanged when layer id does not match", () => {
    const { timeline, layerId } = makeTimeline();
    const mc = copyMotionFromFrame(
      timeline.layers.find((l) => l.id === layerId)!.frames[0]!
    );
    const result = pasteMotionToTimeline(timeline, "nonexistent-id", 0, mc);
    // Should return a structurally equivalent timeline (no mutation)
    expect(result.layers[0]!.frames[0]!.tweenType).toBe("none");
  });

  it("paste overwrites a previous tween type with the clipboard value", () => {
    const { timeline, layerId } = makeTimeline();

    // Set motion on kf0, shape on kf5
    const withBoth = setShapeTween(
      setMotionTween(timeline, layerId, 0, 20),
      layerId,
      5,
      { ease: -50, blend: "distributive" }
    );

    // Copy the shape tween from kf5
    const srcKf5 = withBoth.layers.find((l) => l.id === layerId)!.frames.find((f) => f.index === 5)!;
    const mc = copyMotionFromFrame(srcKf5);

    // Paste onto kf0 (which currently has "motion")
    const result = pasteMotionToTimeline(withBoth, layerId, 0, mc);
    const kf0After = result.layers.find((l) => l.id === layerId)!.frames.find((f) => f.index === 0)!;

    expect(kf0After.tweenType).toBe("shape");
    expect(kf0After.shapeEase).toBe(-50);
  });
});

describe("getGoverningKeyframe helper", () => {
  it("returns the keyframe at exactly the given index", () => {
    const { timeline, layerId } = makeTimeline();
    const layer = timeline.layers.find((l) => l.id === layerId)!;
    const kf = getGoverningKeyframe(layer, 0);
    expect(kf?.index).toBe(0);
  });

  it("returns the nearest preceding keyframe for a span frame", () => {
    const { timeline, layerId } = makeTimeline();
    const layer = timeline.layers.find((l) => l.id === layerId)!;
    // Frame 3 is not a keyframe; kf0 governs frames 0–4
    const kf = getGoverningKeyframe(layer, 3);
    expect(kf?.index).toBe(0);
  });

  it("returns null when there is no keyframe at or before the index", () => {
    // A layer where the only frame is a non-keyframe at index 0
    const nonKf = createFrame(0, { isKeyframe: false });
    const layer = createLayer("Empty", "normal", { frames: [nonKf] });
    const kf = getGoverningKeyframe(layer, 0);
    expect(kf).toBeNull();
  });
});
