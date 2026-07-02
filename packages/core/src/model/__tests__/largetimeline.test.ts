import { describe, it, expect } from "vitest";
import { getAllKeyframes, getKeyframeAt, copyFrames } from "../frame-utils.js";
import type { Layer, Frame } from "../types.js";

function makeFrame(index: number, isKeyframe: boolean = false): Frame {
  return {
    index, isKeyframe, isEmpty: false, tweenType: "none",
    label: "", labelType: "name", script: "", sound: null,
    motionEase: 0, motionRotate: "none", motionRotateCount: 0,
    motionOrientToPath: false, motionSnap: false, motionSync: false, motionScale: true,
    shapeEase: 0, shapeBlend: "distributive", displayObjects: [],
  };
}

function makeLargeLayer(frameCount: number, keyframeEvery: number = 24): Layer {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(makeFrame(i, i % keyframeEvery === 0));
  }
  return {
    id: "big-layer", name: "Big Layer", type: "normal",
    visible: true, locked: false, outlineMode: false,
    outlineColor: "#000000", height: 20, parentFolderId: null,
    frameCount, frames,
  };
}

/**
 * Robust timing helper for perf-guard tests.
 *
 * These operations are all O(n) linear scans that take microseconds in
 * isolation. A single un-warmed `performance.now()` sample is dominated by JIT
 * warmup and — under parallel CI/agent load — by scheduler noise (an early
 * version of this suite asserted a bare `< 5ms` and intermittently measured
 * 10.3ms while passing in isolation). We instead JIT-warm the callback and take
 * the MEDIAN of N samples, which discards transient scheduling spikes. The
 * ceilings are deliberately generous: their only job is to catch a real
 * algorithmic regression (an O(n²) blowup on a ~10k-frame layer would cost
 * hundreds of ms to seconds — orders of magnitude over these ceilings), not to
 * benchmark absolute speed.
 */
function medianTimeMs(
  fn: () => void,
  { warmup = 5, runs = 15 }: { warmup?: number; runs?: number } = {},
): number {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  return samples.length % 2 === 0
    ? (samples[mid - 1] + samples[mid]) / 2
    : samples[mid];
}

describe("Large timeline performance", () => {
  it("creates 9999 frame layer correctly", () => {
    const layer = makeLargeLayer(9999);
    expect(layer.frames).toHaveLength(9999);
    expect(layer.frameCount).toBe(9999);
  });

  it("getAllKeyframes on 9999-frame layer stays O(n) (median well under ceiling)", () => {
    const layer = makeLargeLayer(9999, 24);
    const elapsed = medianTimeMs(() => {
      getAllKeyframes(layer);
    });
    // Generous ceiling: guards against an O(n^2) regression without flaking
    // under concurrent load. A quadratic scan of ~10k frames would be >>50ms.
    expect(elapsed).toBeLessThan(50);
    // Every 24th frame is a keyframe
    expect(getAllKeyframes(layer).length).toBeGreaterThan(400);
  });

  it("getKeyframeAt on 9999-frame layer stays O(n) (median well under ceiling)", () => {
    const layer = makeLargeLayer(9999, 24);
    const elapsed = medianTimeMs(() => {
      getKeyframeAt(layer, 9998);
    });
    // A single linear scan of ~10k frames is microseconds; the ceiling exists
    // only to catch a real O(n^2) blowup (which would cost hundreds of ms+),
    // so it is generous enough to never fail on scheduler noise.
    expect(elapsed).toBeLessThan(50);
    expect(getKeyframeAt(layer, 9998)).toBeDefined();
  });

  it("getKeyframeAt(0) returns first keyframe", () => {
    const layer = makeLargeLayer(100, 24);
    const kf = getKeyframeAt(layer, 0);
    expect(kf?.index).toBe(0);
    expect(kf?.isKeyframe).toBe(true);
  });

  it("getKeyframeAt(25) returns keyframe at 24", () => {
    const layer = makeLargeLayer(100, 24);
    const kf = getKeyframeAt(layer, 25);
    expect(kf?.index).toBe(24);
  });

  it("getAllKeyframes returns correct count for 9999 frames", () => {
    const layer = makeLargeLayer(9999, 24);
    const keys = getAllKeyframes(layer);
    // frames at 0, 24, 48, ..., 9984 = floor(9998/24) + 1 = 417
    expect(keys.length).toBe(Math.floor(9998 / 24) + 1);
  });

  it("copyFrames of large range stays O(n) (median well under ceiling)", () => {
    const layer = makeLargeLayer(9999);
    const elapsed = medianTimeMs(() => {
      copyFrames(layer, 0, 9998);
    });
    // Generous ceiling to catch an O(n^2) regression, robust to CI/agent load.
    expect(elapsed).toBeLessThan(50);
    expect(copyFrames(layer, 0, 9998)).toHaveLength(9999);
  });

  it("layer with 9999 frames: last frame has correct index", () => {
    const layer = makeLargeLayer(9999);
    expect(layer.frames[9998].index).toBe(9998);
  });
});
