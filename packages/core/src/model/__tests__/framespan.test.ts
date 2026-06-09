/**
 * Tests for getFrameAtIndex and getFrameSpan.
 *
 * Flash frame ownership rules:
 *  - A keyframe at index K "owns" all frames from K up to (but not including)
 *    the next keyframe, or through the end of the layer if it is the last.
 *  - Accessing a frame index outside [0, layer.frameCount) returns undefined.
 */

import { describe, it, expect } from "vitest";
import { getFrameAtIndex, getFrameSpan } from "../frame-utils.js";
import type { Layer, Frame } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyframe(index: number): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
  };
}

function makeLayer(keyframeIndices: number[], frameCount: number): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: keyframeIndices.map(makeKeyframe),
    frameCount,
  };
}

// ---------------------------------------------------------------------------
// getFrameAtIndex
// ---------------------------------------------------------------------------

describe("getFrameAtIndex", () => {
  it("returns the first keyframe when accessing frame 0", () => {
    // Layer: keyframe at 0, duration 5
    const layer = makeLayer([0], 5);
    const result = getFrameAtIndex(layer, 0);
    expect(result).toBeDefined();
    expect(result!.index).toBe(0);
  });

  it("returns the owning keyframe for a frame in the middle of a span", () => {
    // Layer: keyframes at 0 and 5, duration 10 — frame 3 is owned by KF@0
    const layer = makeLayer([0, 5], 10);
    const result = getFrameAtIndex(layer, 3);
    expect(result).toBeDefined();
    expect(result!.index).toBe(0);
  });

  it("returns the exact keyframe when accessing the keyframe index directly", () => {
    // Frames 0–4 → KF@0, frames 5–9 → KF@5
    const layer = makeLayer([0, 5], 10);
    const result = getFrameAtIndex(layer, 5);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns undefined when idx is negative (out of range)", () => {
    const layer = makeLayer([0], 5);
    expect(getFrameAtIndex(layer, -1)).toBeUndefined();
  });

  it("returns undefined when idx equals frameCount (out of range)", () => {
    const layer = makeLayer([0], 5);
    expect(getFrameAtIndex(layer, 5)).toBeUndefined();
  });

  it("returns undefined when idx is beyond frameCount", () => {
    const layer = makeLayer([0], 5);
    expect(getFrameAtIndex(layer, 10)).toBeUndefined();
  });

  it("returns the last keyframe for a frame in the final span", () => {
    // Layer: KF@0, KF@3, KF@7, duration 12 — frame 9 is owned by KF@7
    const layer = makeLayer([0, 3, 7], 12);
    const result = getFrameAtIndex(layer, 9);
    expect(result).toBeDefined();
    expect(result!.index).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// getFrameSpan
// ---------------------------------------------------------------------------

describe("getFrameSpan", () => {
  it("span for a single keyframe equals the whole layer length", () => {
    // Layer: one keyframe at 0, duration 8
    const layer = makeLayer([0], 8);
    const kf = layer.frames[0];
    expect(getFrameSpan(kf, layer)).toBe(8);
  });

  it("span for the first of two keyframes equals (second.index - first.index)", () => {
    // KF@0, KF@5, duration 10
    const layer = makeLayer([0, 5], 10);
    const kf0 = layer.frames.find((f) => f.index === 0)!;
    expect(getFrameSpan(kf0, layer)).toBe(5); // 5 - 0
  });

  it("span for the last keyframe equals (frameCount - last.index)", () => {
    // KF@0, KF@5, duration 10
    const layer = makeLayer([0, 5], 10);
    const kf5 = layer.frames.find((f) => f.index === 5)!;
    expect(getFrameSpan(kf5, layer)).toBe(5); // 10 - 5
  });

  it("three keyframes: middle span equals (third.index - second.index)", () => {
    // KF@0, KF@4, KF@9, duration 15
    const layer = makeLayer([0, 4, 9], 15);
    const kf4 = layer.frames.find((f) => f.index === 4)!;
    expect(getFrameSpan(kf4, layer)).toBe(5); // 9 - 4
  });

  it("three keyframes: first span is correct", () => {
    // KF@0, KF@4, KF@9, duration 15
    const layer = makeLayer([0, 4, 9], 15);
    const kf0 = layer.frames.find((f) => f.index === 0)!;
    expect(getFrameSpan(kf0, layer)).toBe(4); // 4 - 0
  });

  it("three keyframes: last span is correct", () => {
    // KF@0, KF@4, KF@9, duration 15
    const layer = makeLayer([0, 4, 9], 15);
    const kf9 = layer.frames.find((f) => f.index === 9)!;
    expect(getFrameSpan(kf9, layer)).toBe(6); // 15 - 9
  });

  it("returns 0 for a frame not in the layer's keyframe list", () => {
    const layer = makeLayer([0, 5], 10);
    // Create a frame not in the layer
    const strangerFrame = makeKeyframe(3);
    expect(getFrameSpan(strangerFrame, layer)).toBe(0);
  });
});
