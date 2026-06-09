/**
 * Tests for insertFrame and removeFrame at arbitrary positions.
 *
 * Functions: insertFrame(timeline, layerId, frameIndex) and
 *            removeFrame(timeline, layerId, frameIndex)
 * Both are exported from model/timeline.ts and operate on Timeline objects.
 *
 * These tests focus on position > 0 scenarios, multi-frame inserts built
 * via repeated calls, and frameCount accuracy — complementing the broader
 * coverage in timeline-frames.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  createTimeline,
  insertFrame,
  removeFrame,
  layerFrameCount,
} from "../../model/timeline.js";
import type { Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Timeline with one layer having the given keyframe indices and frameCount. */
function makeTimeline(keyframeIndices: number[], frameCount: number): Timeline {
  const frames = keyframeIndices.map((idx) => createFrame(idx));
  const layer = createLayer("Layer 1", "normal", { frames, frameCount });
  return createTimeline({ layers: [layer] });
}

/** Return the single layer from a one-layer timeline. */
function layer0(tl: Timeline) {
  return tl.layers[0]!;
}

/** Return sorted keyframe indices of the single layer. */
function indices0(tl: Timeline): number[] {
  return layer0(tl).frames.map((f) => f.index).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// insertFrame at position > 0
// ---------------------------------------------------------------------------

describe("insertFrame at position > 0", () => {
  it("inserting 1 frame after frame 2 in a 5-frame layer gives total 6 frames", () => {
    // 5-frame layer: keyframes at 0. Insert at position 2 (after frame 2).
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 2);
    expect(layerFrameCount(layer0(result))).toBe(6);
  });

  it("inserting 1 frame after frame 2 in a 5-frame layer shifts keyframes at 3+ right", () => {
    // Keyframes at 0, 2, 4. Insert at 3 → keyframe at 4 shifts to 5.
    const tl = makeTimeline([0, 2, 4], 5);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 3);
    const idx = indices0(result);
    // Frames before position 3 are unchanged
    expect(idx).toContain(0);
    expect(idx).toContain(2);
    // Frame at 4 shifts to 5
    expect(idx).toContain(5);
    expect(idx).not.toContain(4);
    expect(layerFrameCount(layer0(result))).toBe(6);
  });

  it("inserting 3 frames at position 0 shifts all existing content right by 3", () => {
    // Start: keyframes at 0, 3, 7; frameCount 10.
    // Three consecutive inserts at position 0 → each shifts all existing keyframes.
    const tl0 = makeTimeline([0, 3, 7], 10);
    const layerId = layer0(tl0).id;
    let tl = tl0;
    tl = insertFrame(tl, layerId, 0);
    tl = insertFrame(tl, layerId, 0);
    tl = insertFrame(tl, layerId, 0);
    const idx = indices0(tl);
    // Each of the 3 inserts at 0 shifts everything +1, so original 0→3, 3→6, 7→10
    expect(idx).toContain(3);  // was 0
    expect(idx).toContain(6);  // was 3
    expect(idx).toContain(10); // was 7
    expect(layerFrameCount(layer0(tl))).toBe(13);
  });

  it("inserting frames at the end extends the layer", () => {
    // Insert at index equal to current frameCount — extends the layer.
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = insertFrame(tl, layerId, 4); // last valid index
    expect(layerFrameCount(layer0(result))).toBe(6);
    const idx = indices0(result);
    // Keyframe at 0 is before position 4, so it doesn't shift
    expect(idx).toContain(0);
  });

  it("frameCount is updated correctly after insert at arbitrary middle positions", () => {
    const tl = makeTimeline([0, 5], 10);
    const layerId = layer0(tl).id;
    // Insert at 2: frameCount 10 → 11
    const r1 = insertFrame(tl, layerId, 2);
    expect(layerFrameCount(layer0(r1))).toBe(11);
    // Insert at 7 of r1 (frameCount 11 → 12)
    const r2 = insertFrame(r1, layerId, 7);
    expect(layerFrameCount(layer0(r2))).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// removeFrame at position > 0
// ---------------------------------------------------------------------------

describe("removeFrame at position > 0", () => {
  it("removing frame 2 from a 5-frame layer gives total 4 frames", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 2);
    expect(layerFrameCount(layer0(result))).toBe(4);
  });

  it("removing frame 2 from a 5-frame layer shifts frames 3+ left", () => {
    // Keyframes at 0, 2, 4. Remove at 2 → keyframe at 2 is deleted, 4 shifts to 3.
    const tl = makeTimeline([0, 2, 4], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 2);
    const idx = indices0(result);
    // 0 stays; 2 is removed; 4 shifts to 3
    expect(idx).toContain(0);
    expect(idx).not.toContain(2);
    expect(idx).toContain(3); // was 4
    expect(idx).not.toContain(4);
    expect(layerFrameCount(layer0(result))).toBe(4);
  });

  it("removing the last frame decreases frameCount by 1", () => {
    const tl = makeTimeline([0], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 4); // last frame index
    expect(layerFrameCount(layer0(result))).toBe(4);
  });

  it("removing a keyframe at position > 0 removes that keyframe entry", () => {
    // Keyframes at 0, 3. Remove frame 3 → only keyframe at 0 remains.
    const tl = makeTimeline([0, 3], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 3);
    const idx = indices0(result);
    expect(idx).toContain(0);
    expect(idx).not.toContain(3);
    expect(layerFrameCount(layer0(result))).toBe(4);
  });

  it("removing a regular frame (non-keyframe position) within a span shrinks the span", () => {
    // Layer with keyframes at 0 and 5, frameCount 8. Remove at 2 (regular frame).
    const tl = makeTimeline([0, 5], 8);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 2);
    // frameCount decreases by 1
    expect(layerFrameCount(layer0(result))).toBe(7);
    const idx = indices0(result);
    // Keyframe at 0 unchanged; keyframe at 5 shifts to 4
    expect(idx).toContain(0);
    expect(idx).toContain(4); // was 5, shifted left by 1
  });

  it("frameCount is updated correctly after remove at arbitrary positions", () => {
    const tl = makeTimeline([0, 3, 6], 9);
    const layerId = layer0(tl).id;
    // Remove at 5 (regular frame in span 3–5): frameCount 9 → 8
    const r1 = removeFrame(tl, layerId, 5);
    expect(layerFrameCount(layer0(r1))).toBe(8);
    // Remove at 2: frameCount 8 → 7
    const r2 = removeFrame(r1, layerId, 2);
    expect(layerFrameCount(layer0(r2))).toBe(7);
  });

  it("always preserves a keyframe at index 0 after removal", () => {
    // Removing the only keyframe at 0 (which shifts next keyframe to 0)
    const tl = makeTimeline([0, 3], 5);
    const layerId = layer0(tl).id;
    const result = removeFrame(tl, layerId, 0);
    const frame0kf = layer0(result).frames.find(
      (f) => f.index === 0 && f.isKeyframe
    );
    expect(frame0kf).toBeDefined();
  });
});
