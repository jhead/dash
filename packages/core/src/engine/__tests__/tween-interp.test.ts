/**
 * Tests for motion tween interpolation via getTweenedFrame.
 *
 * Verifies that when a layer has tweenType: 'motion' between two keyframes,
 * the display object properties (x, y) are interpolated at intermediate frames.
 *
 * Flash 8 motion tween span computation:
 *   - Two keyframes at frames A and B (A < B).
 *   - Tween span: startFrame=A, endFrame=B-1.
 *   - interpolateTween receives endFrame as B (endFrame+1).
 *   - linearT at frame F = (F - A) / (B - A).
 *   - Therefore frame A+(B-A)/2 gives linearT=0.5 (true midpoint).
 *
 * This test uses keyframes at 0 and 8:
 *   - Span: startFrame=0, endFrame=7
 *   - interpolateTween endFrame=8, so linearT=frame/8
 *   - Frame 4: linearT=0.5 → true midpoint
 */

import { describe, it, expect } from "vitest";
import { getTweenedFrame, getDisplayObjectsAtFrame } from "../../model/timeline-query.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { SymbolInstance } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a SymbolInstance at (x, y). objectId ties start/end instances together. */
function makeInstance(id: string, x: number, y: number): SymbolInstance {
  return {
    type: "instance",
    id,
    symbolId: "sym-1",
    x,
    y,
  };
}

/**
 * Build a layer with a motion tween.
 * Keyframe 0 has a SymbolInstance at (0, 0) with tweenType='motion'.
 * Keyframe at endKfIndex has the same instance at (100, 50).
 * Layer frameCount = endKfIndex + 1.
 *
 * @param endKfIndex  Frame index of the second keyframe (default: 8)
 * @param motionEase  Ease value on the start keyframe (default: 0 = linear)
 */
function buildMotionTweenLayer(endKfIndex = 8, motionEase = 0) {
  const startObj = makeInstance("inst-1", 0, 0);
  const endObj = makeInstance("inst-1", 100, 50);

  const startKf = createFrame(0, {
    tweenType: "motion",
    motionEase,
    isEmpty: false,
    displayObjects: [startObj],
  });
  const endKf = createFrame(endKfIndex, {
    isEmpty: false,
    displayObjects: [endObj],
  });

  return createLayer("Layer 1", "normal", {
    frames: [startKf, endKf],
    frameCount: endKfIndex + 1,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getTweenedFrame — motion tween interpolation", () => {
  it("returns the start keyframe values at frame 0", () => {
    const layer = buildMotionTweenLayer();
    const frame = getTweenedFrame(layer, 0);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as SymbolInstance;
    expect(obj.x).toBeCloseTo(0);
    expect(obj.y).toBeCloseTo(0);
  });

  it("returns the end keyframe values at the last keyframe (frame 8)", () => {
    const layer = buildMotionTweenLayer();
    const frame = getTweenedFrame(layer, 8);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as SymbolInstance;
    expect(obj.x).toBeCloseTo(100);
    expect(obj.y).toBeCloseTo(50);
  });

  it("interpolates x and y linearly at the midpoint frame (frame 4)", () => {
    // With keyframes at 0 and 8, linearT at frame 4 = 4/8 = 0.5
    // x: lerp(0, 100, 0.5) = 50; y: lerp(0, 50, 0.5) = 25
    const layer = buildMotionTweenLayer();
    const frame = getTweenedFrame(layer, 4);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as SymbolInstance;
    expect(obj.x).toBeCloseTo(50, 1);
    expect(obj.y).toBeCloseTo(25, 1);
  });

  it("intermediate frames have isKeyframe=false", () => {
    const layer = buildMotionTweenLayer();
    const frame = getTweenedFrame(layer, 4);
    expect(frame).not.toBeNull();
    expect(frame!.isKeyframe).toBe(false);
    expect(frame!.index).toBe(4);
  });

  it("frame 1 is linearly interpolated (x≈12.5, y≈6.25)", () => {
    // linearT at frame 1 = 1/8 = 0.125
    // x: lerp(0, 100, 0.125) = 12.5; y: lerp(0, 50, 0.125) = 6.25
    const layer = buildMotionTweenLayer();
    const frame = getTweenedFrame(layer, 1);
    expect(frame).not.toBeNull();
    const obj = frame!.displayObjects[0] as SymbolInstance;
    expect(obj.x).toBeCloseTo(12.5, 1);
    expect(obj.y).toBeCloseTo(6.25, 1);
  });

  it("motionEase=100 (ease-out) at midpoint: applyEase(0.5, 100) ≈ 0.9375 → x ≈ 93.75", () => {
    // ease=100 (ease-out): fast start, slow end.
    // applyEase formula: 1 - (1 - t)^(1 + (ease/100)*3) = 1 - (0.5)^4 = 0.9375
    // x: lerp(0, 100, 0.9375) = 93.75
    const layerEased = buildMotionTweenLayer(8, 100);
    const layerLinear = buildMotionTweenLayer(8, 0);

    const easedFrame = getTweenedFrame(layerEased, 4);
    const linearFrame = getTweenedFrame(layerLinear, 4);

    expect(easedFrame).not.toBeNull();
    expect(linearFrame).not.toBeNull();

    const easedX = (easedFrame!.displayObjects[0] as SymbolInstance).x;
    const linearX = (linearFrame!.displayObjects[0] as SymbolInstance).x;

    // ease-out: at midpoint, animation is much further along than linear (93.75 vs 50)
    expect(easedX).toBeCloseTo(93.75, 1);
    expect(easedX).toBeGreaterThan(linearX);
  });

  it("motionEase=-100 (ease-in) at midpoint: applyEase(0.5, -100) ≈ 0.0625 → x ≈ 6.25", () => {
    // ease=-100 (ease-in): slow start, fast end.
    // applyEase formula: t^(1 + (100/100)*3) = (0.5)^4 = 0.0625
    // x: lerp(0, 100, 0.0625) = 6.25
    const layerEasedIn = buildMotionTweenLayer(8, -100);
    const layerLinear = buildMotionTweenLayer(8, 0);

    const easedFrame = getTweenedFrame(layerEasedIn, 4);
    const linearFrame = getTweenedFrame(layerLinear, 4);

    expect(easedFrame).not.toBeNull();
    expect(linearFrame).not.toBeNull();

    const easedX = (easedFrame!.displayObjects[0] as SymbolInstance).x;
    const linearX = (linearFrame!.displayObjects[0] as SymbolInstance).x;

    // ease-in: at midpoint, animation is much earlier than linear (6.25 vs 50)
    expect(easedX).toBeCloseTo(6.25, 1);
    expect(easedX).toBeLessThan(linearX);
  });

  it("returns null for out-of-range frame index", () => {
    const layer = buildMotionTweenLayer();
    expect(getTweenedFrame(layer, -1)).toBeNull();
    expect(getTweenedFrame(layer, 9)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDisplayObjectsAtFrame integration
// ---------------------------------------------------------------------------

describe("getDisplayObjectsAtFrame — motion tween interpolation", () => {
  it("returns interpolated objects at an intermediate frame", () => {
    const layer = buildMotionTweenLayer();
    const timeline = createTimeline({ layers: [layer] });
    const objects = getDisplayObjectsAtFrame(timeline, 4);
    expect(objects.length).toBeGreaterThan(0);
    const obj = objects[0] as SymbolInstance;
    // At frame 4 (midpoint), x≈50, y≈25
    expect(obj.x).toBeCloseTo(50, 1);
    expect(obj.y).toBeCloseTo(25, 1);
  });

  it("at frame 0, returns start position (x=0, y=0)", () => {
    const layer = buildMotionTweenLayer();
    const timeline = createTimeline({ layers: [layer] });
    const objects = getDisplayObjectsAtFrame(timeline, 0);
    const obj = objects[0] as SymbolInstance;
    expect(obj.x).toBeCloseTo(0);
    expect(obj.y).toBeCloseTo(0);
  });

  it("at frame 8 (end keyframe), returns end position (x=100, y=50)", () => {
    const layer = buildMotionTweenLayer();
    const timeline = createTimeline({ layers: [layer] });
    const objects = getDisplayObjectsAtFrame(timeline, 8);
    const obj = objects[0] as SymbolInstance;
    expect(obj.x).toBeCloseTo(100);
    expect(obj.y).toBeCloseTo(50);
  });
});
