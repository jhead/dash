/**
 * Tests for keyframe query helpers: getAllKeyframes, getKeyframeAt,
 * getNextKeyframe, getPrevKeyframe.
 *
 * In Flash, a layer contains both keyframes (isKeyframe === true) and
 * regular (non-keyframe) frames that extend spans between keyframes.
 * These helpers allow property-panel and timeline-query code to navigate
 * keyframe boundaries without duplicating the walk logic.
 */

import { describe, it, expect } from "vitest";
import {
  getAllKeyframes,
  getKeyframeAt,
  getNextKeyframe,
  getPrevKeyframe,
} from "../frame-utils.js";
import type { Layer, Frame } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(index: number, isKeyframe: boolean): Frame {
  return {
    index,
    isKeyframe,
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

function makeKeyframe(index: number): Frame {
  return makeFrame(index, true);
}

function makeRegularFrame(index: number): Frame {
  return makeFrame(index, false);
}

/**
 * Build a layer with an explicit frames array.
 * keyframeIndices and regularFrameIndices together form all frames.
 */
function makeLayer(
  keyframeIndices: number[],
  regularFrameIndices: number[],
  frameCount: number
): Layer {
  const frames: Frame[] = [
    ...keyframeIndices.map(makeKeyframe),
    ...regularFrameIndices.map(makeRegularFrame),
  ].sort((a, b) => a.index - b.index);

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
    frames,
    frameCount,
  };
}

// Convenience: layer with only keyframes
function makeKeyframeOnlyLayer(
  keyframeIndices: number[],
  frameCount: number
): Layer {
  return makeLayer(keyframeIndices, [], frameCount);
}

// ---------------------------------------------------------------------------
// getAllKeyframes
// ---------------------------------------------------------------------------

describe("getAllKeyframes", () => {
  it("returns only keyframes from a layer that has both types", () => {
    // KF@0, regular@1, regular@2, KF@3
    const layer = makeLayer([0, 3], [1, 2], 4);
    const kfs = getAllKeyframes(layer);
    expect(kfs).toHaveLength(2);
    expect(kfs.every((f) => f.isKeyframe)).toBe(true);
  });

  it("returns all keyframes when every frame is a keyframe", () => {
    const layer = makeKeyframeOnlyLayer([0, 1, 2], 3);
    const kfs = getAllKeyframes(layer);
    expect(kfs).toHaveLength(3);
  });

  it("returns empty array for an empty-frame layer", () => {
    const layer = makeLayer([], [], 0);
    const kfs = getAllKeyframes(layer);
    expect(kfs).toHaveLength(0);
  });

  it("non-keyframes are not included in the result", () => {
    // Only regular frames; no keyframes
    const layer = makeLayer([], [0, 1, 2], 3);
    const kfs = getAllKeyframes(layer);
    expect(kfs).toHaveLength(0);
  });

  it("returned keyframes are in ascending index order (layer order preserved)", () => {
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const kfs = getAllKeyframes(layer);
    expect(kfs.map((f) => f.index)).toEqual([0, 5, 10]);
  });
});

// ---------------------------------------------------------------------------
// getKeyframeAt
// ---------------------------------------------------------------------------

describe("getKeyframeAt", () => {
  it("returns keyframe 0 when querying frame 0", () => {
    const layer = makeKeyframeOnlyLayer([0, 5], 10);
    const result = getKeyframeAt(layer, 0);
    expect(result).toBeDefined();
    expect(result!.index).toBe(0);
  });

  it("returns the owning keyframe for a frame in the middle of a span", () => {
    // KF@0, KF@5 — frame 3 is owned by KF@0
    const layer = makeLayer([0, 5], [1, 2, 3, 4, 6, 7, 8, 9], 10);
    const result = getKeyframeAt(layer, 3);
    expect(result).toBeDefined();
    expect(result!.index).toBe(0);
  });

  it("returns the exact keyframe when querying its own index", () => {
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getKeyframeAt(layer, 5);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns the last keyframe when querying a frame beyond all keyframes", () => {
    // KF@0, KF@5, duration 12 — frame 9 is owned by KF@5
    const layer = makeLayer([0, 5], [1, 2, 3, 4, 6, 7, 8, 9, 10, 11], 12);
    const result = getKeyframeAt(layer, 9);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns undefined when no keyframe exists at or before the queried index", () => {
    // Layer has only a keyframe at 5, querying frame 3 should return undefined
    const layer = makeLayer([5], [6, 7, 8, 9], 10);
    const result = getKeyframeAt(layer, 3);
    expect(result).toBeUndefined();
  });

  it("returns the last keyframe when queried with a very large index", () => {
    const layer = makeKeyframeOnlyLayer([0, 10, 20], 30);
    const result = getKeyframeAt(layer, 25);
    expect(result).toBeDefined();
    expect(result!.index).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// getNextKeyframe
// ---------------------------------------------------------------------------

describe("getNextKeyframe", () => {
  it("returns the next keyframe after the given frame index", () => {
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getNextKeyframe(layer, 0);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns the correct next keyframe from mid-span", () => {
    // Frame 3 is between KF@0 and KF@5; next keyframe is KF@5
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getNextKeyframe(layer, 3);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns undefined when querying at or after the last keyframe", () => {
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getNextKeyframe(layer, 10);
    expect(result).toBeUndefined();
  });

  it("returns undefined when there are no keyframes", () => {
    const layer = makeLayer([], [0, 1, 2], 3);
    const result = getNextKeyframe(layer, 0);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPrevKeyframe
// ---------------------------------------------------------------------------

describe("getPrevKeyframe", () => {
  it("returns the keyframe before the given frame index", () => {
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getPrevKeyframe(layer, 10);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns undefined when querying at or before the first keyframe", () => {
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getPrevKeyframe(layer, 0);
    expect(result).toBeUndefined();
  });

  it("returns the last keyframe before the queried index from mid-span", () => {
    // Querying frame 7 (between KF@5 and KF@10): prev is KF@5
    const layer = makeKeyframeOnlyLayer([0, 5, 10], 15);
    const result = getPrevKeyframe(layer, 7);
    expect(result).toBeDefined();
    expect(result!.index).toBe(5);
  });

  it("returns undefined when there are no keyframes", () => {
    const layer = makeLayer([], [0, 1, 2], 3);
    const result = getPrevKeyframe(layer, 2);
    expect(result).toBeUndefined();
  });
});
