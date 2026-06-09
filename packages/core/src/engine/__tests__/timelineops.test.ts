/**
 * Tests for Timeline insertFrame, removeFrame, insertKeyframe, and
 * insertBlankKeyframe operations.
 *
 * All operations are pure functions: they return a new Timeline and leave
 * the original unchanged.
 */

import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  createTimeline,
  insertFrame,
  removeFrame,
  insertKeyframe,
  insertBlankKeyframe,
  layerFrameCount,
} from "../../model/timeline.js";
import type { Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Timeline with a single layer having the given frameCount. */
function makeTimeline(frameCount: number, extraKeyframeIndices: number[] = []): Timeline {
  const frames = [createFrame(0), ...extraKeyframeIndices.map((i) => createFrame(i))];
  const layer = createLayer("Layer 1", "normal", { frames, frameCount });
  return createTimeline({ layers: [layer] });
}

function layer0(tl: Timeline) {
  return tl.layers[0]!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Timeline insertFrame and removeFrame operations", () => {
  // -------------------------------------------------------------------------
  // Test 1: insertFrame at position 0 increases frameCount by 1
  // -------------------------------------------------------------------------

  it("1. insertFrame(layer, 0) increases frameCount by 1", () => {
    const tl = makeTimeline(5);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 0);
    expect(layerFrameCount(layer0(result))).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Test 2: insertFrame at position 2 inserts and shifts frames after
  // -------------------------------------------------------------------------

  it("2. insertFrame at position 2 shifts all keyframes at >= 2 right by 1", () => {
    const tl = makeTimeline(5, [2, 4]);
    const layerId = layer0(tl).id;
    const before = layer0(tl).frames.map((f) => f.index);
    const result = insertFrame(tl, layerId, 2);
    const after = layer0(result).frames.map((f) => f.index);

    // frameCount increases
    expect(layerFrameCount(layer0(result))).toBe(6);
    // Keyframes originally at index >= 2 shift right by 1
    for (const origIdx of before.filter((i) => i >= 2)) {
      expect(after).toContain(origIdx + 1);
    }
    // Keyframes before index 2 stay in place
    for (const origIdx of before.filter((i) => i < 2)) {
      expect(after).toContain(origIdx);
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: removeFrame at position 0 decreases frameCount by 1
  // -------------------------------------------------------------------------

  it("3. removeFrame(layer, 0) decreases frameCount by 1 (2-frame layer)", () => {
    const tl = makeTimeline(2);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 0);
    expect(layerFrameCount(layer0(result))).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 4: insertKeyframe adds a keyframe at the given frame index
  // -------------------------------------------------------------------------

  it("4. insertKeyframe at frame 3 adds a keyframe at index 3", () => {
    const tl = makeTimeline(6);
    const layerId = layer0(tl).id;
    const result = insertKeyframe(tl, layerId, 3);
    const frames = layer0(result).frames;
    const kf = frames.find((f) => f.index === 3);
    expect(kf).toBeDefined();
    expect(kf?.isKeyframe).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: insertBlankKeyframe adds an empty keyframe at frame 5
  // -------------------------------------------------------------------------

  it("5. insertBlankKeyframe at frame 5 adds an empty keyframe at index 5", () => {
    const tl = makeTimeline(7);
    const layerId = layer0(tl).id;
    const result = insertBlankKeyframe(tl, layerId, 5);
    const frames = layer0(result).frames;
    const kf = frames.find((f) => f.index === 5);
    expect(kf).toBeDefined();
    expect(kf?.isKeyframe).toBe(true);
    expect(kf?.isEmpty).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: removeFrame on a 1-frame layer is a no-op (cannot go below 1)
  // -------------------------------------------------------------------------

  it("6. removeFrame on a 1-frame layer is a no-op — frameCount stays at 1", () => {
    const tl = makeTimeline(1);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 0);
    // Flash preserves at least 1 frame — no-op per the implementation
    expect(layerFrameCount(layer0(result))).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 7: Frame count after multiple insertions and removals
  // -------------------------------------------------------------------------

  it("7. sequential insertFrame, insertFrame, removeFrame yields correct frameCount", () => {
    let tl = makeTimeline(5);
    const layerId = layer0(tl).id;

    tl = insertFrame(tl, layerId, 2); // 5 + 1 = 6
    tl = insertFrame(tl, layerId, 3); // 6 + 1 = 7
    tl = removeFrame(tl, layerId, 1); // 7 - 1 = 6

    expect(layerFrameCount(layer0(tl))).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Test 8: insertKeyframe does not shift existing keyframe indices (F6 semantics)
  // -------------------------------------------------------------------------

  it("8. insertKeyframe does not shift existing keyframe indices (no-shift semantics)", () => {
    const tl = makeTimeline(6, [4]);
    const layerId = layer0(tl).id;
    const before = layer0(tl).frames.map((f) => f.index);
    const result = insertKeyframe(tl, layerId, 2);
    const after = layer0(result).frames.map((f) => f.index);

    // All original keyframe indices must still appear
    for (const idx of before) {
      expect(after).toContain(idx);
    }
    // The new keyframe at 2 must appear
    expect(after).toContain(2);
  });

  // -------------------------------------------------------------------------
  // Test 9: insertBlankKeyframe on existing keyframe position is a no-op
  // -------------------------------------------------------------------------

  it("9. insertBlankKeyframe on an already-keyframe position is a no-op", () => {
    const tl = makeTimeline(5);
    const layerId = layer0(tl).id;
    const before = layer0(tl).frames.length;
    const result = insertBlankKeyframe(tl, layerId, 0); // 0 is already a keyframe
    // No new frame should be added
    expect(layer0(result).frames.length).toBe(before);
  });

  // -------------------------------------------------------------------------
  // Test 10: Operations on one layer do not affect other layers
  // -------------------------------------------------------------------------

  it("10. insertFrame on layer 0 does not change frameCount of layer 1", () => {
    const layer0obj = createLayer("Layer 1", "normal", {
      frames: [createFrame(0)],
      frameCount: 5,
    });
    const layer1obj = createLayer("Layer 2", "normal", {
      frames: [createFrame(0)],
      frameCount: 3,
    });
    const tl = createTimeline({ layers: [layer0obj, layer1obj] });

    const result = insertFrame(tl, layer0obj.id, 1);
    expect(layerFrameCount(result.layers[0]!)).toBe(6);
    expect(layerFrameCount(result.layers[1]!)).toBe(3); // unchanged
  });
});
