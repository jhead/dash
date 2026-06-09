/**
 * Edge-case tests for insertFrame and removeFrame.
 *
 * Focuses on boundary conditions and invariants not covered by the main
 * timeline.test.ts and frame-ops.test.ts suites:
 *   - insertFrame at index 0, at last index, and in the middle
 *   - Immutability (original unchanged)
 *   - Correct index renumbering after insertion/removal
 *   - Removing the single frame is a no-op
 *   - Consecutive operations maintain consistency
 *   - Preservation of existing frame properties (scripts, keyframe status)
 */

import { describe, it, expect } from "vitest";
import {
  createFrame,
  createLayer,
  insertFrame,
  removeFrame,
  layerFrameCount,
} from "../index.js";
import type { Timeline } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimeline(...layers: ReturnType<typeof createLayer>[]): Timeline {
  return { layers };
}

function singleLayerTimeline(
  keyframeIndices: number[],
  frameCount: number
): { tl: Timeline; layerId: string } {
  const frames = keyframeIndices.map((i) => createFrame(i));
  const layer = createLayer("L", "normal", { frames, frameCount });
  return { tl: makeTimeline(layer), layerId: layer.id };
}

// ---------------------------------------------------------------------------
// insertFrame edge cases
// ---------------------------------------------------------------------------

describe("insertFrame edge cases", () => {
  it("1. insertFrame at index 0 increases frameCount by 1", () => {
    const { tl, layerId } = singleLayerTimeline([0], 5);
    const result = insertFrame(tl, layerId, 0);
    expect(layerFrameCount(result.layers[0]!)).toBe(6);
  });

  it("2. insertFrame at last index appends correctly", () => {
    const { tl, layerId } = singleLayerTimeline([0], 3);
    // Insert at current last index (2), which should shift the span end to index 3
    const result = insertFrame(tl, layerId, 2);
    expect(layerFrameCount(result.layers[0]!)).toBe(4);
  });

  it("3. insertFrame in middle shifts existing keyframes at or after index", () => {
    const { tl, layerId } = singleLayerTimeline([0, 3, 6], 8);
    const result = insertFrame(tl, layerId, 3);
    const indices = result.layers[0]!.frames.map((f) => f.index);
    // 0 stays; 3 shifts to 4; 6 shifts to 7
    expect(indices).toContain(0);
    expect(indices).toContain(4);
    expect(indices).toContain(7);
    expect(indices).not.toContain(3);
    expect(indices).not.toContain(6);
  });

  it("4. insertFrame at 0 does not change original timeline (immutable)", () => {
    const { tl, layerId } = singleLayerTimeline([0, 2], 4);
    const originalCount = layerFrameCount(tl.layers[0]!);
    insertFrame(tl, layerId, 0);
    // Original must be unchanged
    expect(layerFrameCount(tl.layers[0]!)).toBe(originalCount);
  });

  it("5. insertFrame at 0 sets correct index values after insertion", () => {
    const { tl, layerId } = singleLayerTimeline([0, 2, 4], 6);
    const result = insertFrame(tl, layerId, 0);
    const indices = result.layers[0]!.frames.map((f) => f.index).sort((a, b) => a - b);
    // All three keyframes shift right by 1: 1, 3, 5
    expect(indices).toContain(1);
    expect(indices).toContain(3);
    expect(indices).toContain(5);
    expect(indices).not.toContain(0); // no keyframe at 0 after shifting all of them
  });

  it("6. insertFrame preserves keyframe scripts on shifted frames", () => {
    const scriptFrame = createFrame(5, { script: "trace('hello');", isKeyframe: true, isEmpty: false });
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), scriptFrame],
      frameCount: 8,
    });
    const tl = makeTimeline(layer);
    const result = insertFrame(tl, layer.id, 2);
    const shifted = result.layers[0]!.frames.find((f) => f.index === 6);
    expect(shifted).toBeDefined();
    expect(shifted!.script).toBe("trace('hello');");
  });

  it("7. insertFrame preserves isKeyframe status of shifted frames", () => {
    const { tl, layerId } = singleLayerTimeline([0, 4], 6);
    const result = insertFrame(tl, layerId, 2);
    const shifted = result.layers[0]!.frames.find((f) => f.index === 5);
    expect(shifted).toBeDefined();
    expect(shifted!.isKeyframe).toBe(true);
  });

  it("8. Consecutive insertFrame calls maintain consistency", () => {
    let { tl, layerId } = singleLayerTimeline([0], 1);
    // Insert 4 frames at index 0 repeatedly
    for (let i = 0; i < 4; i++) {
      tl = insertFrame(tl, layerId, 0);
    }
    expect(layerFrameCount(tl.layers[0]!)).toBe(5);
  });

  it("9. insertFrame beyond current end sets frameCount to frameIndex + 1", () => {
    const { tl, layerId } = singleLayerTimeline([0], 1);
    const result = insertFrame(tl, layerId, 9);
    expect(layerFrameCount(result.layers[0]!)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// removeFrame edge cases
// ---------------------------------------------------------------------------

describe("removeFrame edge cases", () => {
  it("10. removeFrame removes frame at given index", () => {
    const { tl, layerId } = singleLayerTimeline([0, 3, 6], 8);
    const result = removeFrame(tl, layerId, 3);
    const indices = result.layers[0]!.frames.map((f) => f.index);
    expect(indices).not.toContain(3);
  });

  it("11. removeFrame decreases frameCount by 1", () => {
    const { tl, layerId } = singleLayerTimeline([0], 5);
    const result = removeFrame(tl, layerId, 4);
    expect(layerFrameCount(result.layers[0]!)).toBe(4);
  });

  it("12. removeFrame shifts remaining frame indices down by 1 after the removed index", () => {
    const { tl, layerId } = singleLayerTimeline([0, 3, 7], 9);
    const result = removeFrame(tl, layerId, 3);
    const indices = result.layers[0]!.frames.map((f) => f.index).sort((a, b) => a - b);
    // 0 stays; 7 shifts to 6
    expect(indices).toContain(0);
    expect(indices).toContain(6);
    expect(indices).not.toContain(7);
  });

  it("13. removeFrame of single frame returns layer with frameCount unchanged", () => {
    const { tl, layerId } = singleLayerTimeline([0], 1);
    const result = removeFrame(tl, layerId, 0);
    expect(layerFrameCount(result.layers[0]!)).toBe(1);
    expect(result.layers[0]!.frames).toHaveLength(1);
  });

  it("14. removeFrame at last index works correctly", () => {
    const { tl, layerId } = singleLayerTimeline([0, 4], 5);
    const result = removeFrame(tl, layerId, 4);
    expect(layerFrameCount(result.layers[0]!)).toBe(4);
    const indices = result.layers[0]!.frames.map((f) => f.index);
    expect(indices).not.toContain(4);
  });

  it("15. insertFrame then removeFrame at same index returns original frameCount", () => {
    const { tl, layerId } = singleLayerTimeline([0], 5);
    const afterInsert = insertFrame(tl, layerId, 2);
    const afterRemove = removeFrame(afterInsert, layerId, 2);
    expect(layerFrameCount(afterRemove.layers[0]!)).toBe(5);
  });

  it("16. removeFrame preserves isKeyframe status of remaining frames", () => {
    const { tl, layerId } = singleLayerTimeline([0, 3, 6], 8);
    const result = removeFrame(tl, layerId, 3);
    // Shifted frame at 5 (was 6) should still be a keyframe
    const shifted = result.layers[0]!.frames.find((f) => f.index === 5);
    expect(shifted).toBeDefined();
    expect(shifted!.isKeyframe).toBe(true);
  });

  it("17. removeFrame does not mutate the original timeline", () => {
    const { tl, layerId } = singleLayerTimeline([0, 3], 5);
    const originalCount = layerFrameCount(tl.layers[0]!);
    removeFrame(tl, layerId, 3);
    expect(layerFrameCount(tl.layers[0]!)).toBe(originalCount);
  });

  it("18. Insert at index 0 of single-frame layer then remove restores original", () => {
    const frames = [createFrame(0, { script: "init();", isEmpty: false })];
    const layer = createLayer("L", "normal", { frames, frameCount: 1 });
    const tl = makeTimeline(layer);
    // Insert then remove should yield a layer with the same single keyframe
    const afterInsert = insertFrame(tl, layer.id, 0);
    expect(layerFrameCount(afterInsert.layers[0]!)).toBe(2);
    const afterRemove = removeFrame(afterInsert, layer.id, 0);
    expect(layerFrameCount(afterRemove.layers[0]!)).toBe(1);
  });
});
