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

describe("Large timeline performance", () => {
  it("creates 9999 frame layer correctly", () => {
    const layer = makeLargeLayer(9999);
    expect(layer.frames).toHaveLength(9999);
    expect(layer.frameCount).toBe(9999);
  });

  it("getAllKeyframes on 9999-frame layer is fast (< 50ms)", () => {
    const layer = makeLargeLayer(9999, 24);
    const start = performance.now();
    const keys = getAllKeyframes(layer);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    // Every 24th frame is a keyframe
    expect(keys.length).toBeGreaterThan(400);
  });

  it("getKeyframeAt on 9999-frame layer is fast (< 5ms)", () => {
    const layer = makeLargeLayer(9999, 24);
    const start = performance.now();
    const kf = getKeyframeAt(layer, 9998);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
    expect(kf).toBeDefined();
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

  it("copyFrames of large range is fast (< 50ms)", () => {
    const layer = makeLargeLayer(9999);
    const start = performance.now();
    const copy = copyFrames(layer, 0, 9998);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(copy).toHaveLength(9999);
  });

  it("layer with 9999 frames: last frame has correct index", () => {
    const layer = makeLargeLayer(9999);
    expect(layer.frames[9998].index).toBe(9998);
  });
});
