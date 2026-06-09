/**
 * Tests for scene and layer duration synchronization / independence.
 *
 * In Flash 8, inserting a frame affects only the selected layer — not all layers.
 * Each layer within a scene maintains its own frameCount. The scene duration is
 * derived as the maximum frameCount across all its layers.
 *
 * Verifies:
 * 1. insertFrame on layer 0 increments layer 0's frameCount but leaves layer 1 unchanged.
 * 2. getTweenedFrame still works after frame insertion (no out-of-bounds).
 * 3. Layers with different lengths (10 vs 5 frames) can coexist in the same scene.
 * 4. insertBlankKeyframe on layer 0 does not affect layer 1.
 * 5. getSceneDuration returns the max frameCount across all layers.
 */

import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  createTimeline,
  insertFrame,
  insertBlankKeyframe,
  layerFrameCount,
} from "../../model/timeline.js";
import { createScene } from "../../model/scene.js";
import { getTweenedFrame, getSceneDuration } from "../../model/timeline-query.js";
import type { Scene, Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a two-layer Timeline. Layer 0 has `count0` frames, layer 1 has `count1` frames.
 */
function makeTwoLayerTimeline(count0: number, count1: number): Timeline {
  const layer0 = createLayer("Layer 1", "normal", {
    frames: [createFrame(0)],
    frameCount: count0,
  });
  const layer1 = createLayer("Layer 2", "normal", {
    frames: [createFrame(0)],
    frameCount: count1,
  });
  return createTimeline({ layers: [layer0, layer1] });
}

/**
 * Build a two-layer Scene. Layer 0 has `count0` frames, layer 1 has `count1` frames.
 */
function makeTwoLayerScene(count0: number, count1: number): Scene {
  const tl = makeTwoLayerTimeline(count0, count1);
  return { ...createScene("Scene 1"), timeline: tl };
}

// ---------------------------------------------------------------------------
// 1. insertFrame on layer 0 increments layer 0's frameCount but not layer 1's
// ---------------------------------------------------------------------------

describe("insertFrame — per-layer isolation", () => {
  it("layer 0 frameCount increases by 1 after insertFrame", () => {
    const tl = makeTwoLayerTimeline(10, 10);
    const layer0Id = tl.layers[0]!.id;
    const result = insertFrame(tl, layer0Id, 5);
    expect(layerFrameCount(result.layers[0]!)).toBe(11);
  });

  it("layer 1 frameCount is unchanged after insertFrame on layer 0", () => {
    const tl = makeTwoLayerTimeline(10, 10);
    const layer0Id = tl.layers[0]!.id;
    const result = insertFrame(tl, layer0Id, 5);
    expect(layerFrameCount(result.layers[1]!)).toBe(10);
  });

  it("only the targeted layer is mutated", () => {
    const tl = makeTwoLayerTimeline(8, 6);
    const layer0Id = tl.layers[0]!.id;
    const result = insertFrame(tl, layer0Id, 3);
    // Layer 0 grows by 1
    expect(layerFrameCount(result.layers[0]!)).toBe(9);
    // Layer 1 stays at 6
    expect(layerFrameCount(result.layers[1]!)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 2. getTweenedFrame works after frame insertion (no out-of-bounds)
// ---------------------------------------------------------------------------

describe("getTweenedFrame after insertFrame", () => {
  it("returns a frame for an index within the new frame range", () => {
    const tl = makeTwoLayerTimeline(5, 5);
    const layer0Id = tl.layers[0]!.id;
    const result = insertFrame(tl, layer0Id, 2);
    const layer0 = result.layers[0]!;
    // Layer 0 now has 6 frames; frame at index 5 should be accessible
    const frame = getTweenedFrame(layer0, 5);
    expect(frame).not.toBeNull();
  });

  it("returns null for an index beyond the new frame range", () => {
    const tl = makeTwoLayerTimeline(5, 5);
    const layer0Id = tl.layers[0]!.id;
    const result = insertFrame(tl, layer0Id, 2);
    const layer0 = result.layers[0]!;
    // Frame at index 6 is out of range (new frameCount is 6)
    const frame = getTweenedFrame(layer0, 6);
    expect(frame).toBeNull();
  });

  it("returns a frame at the first index (0) after insertion", () => {
    const tl = makeTwoLayerTimeline(3, 3);
    const layer0Id = tl.layers[0]!.id;
    const result = insertFrame(tl, layer0Id, 0);
    const layer0 = result.layers[0]!;
    const frame = getTweenedFrame(layer0, 0);
    expect(frame).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Layers with different lengths can coexist in the same scene
// ---------------------------------------------------------------------------

describe("layers with different lengths coexist", () => {
  it("layer 0 with 10 frames and layer 1 with 5 frames can coexist", () => {
    const scene = makeTwoLayerScene(10, 5);
    expect(layerFrameCount(scene.timeline.layers[0]!)).toBe(10);
    expect(layerFrameCount(scene.timeline.layers[1]!)).toBe(5);
  });

  it("layer 0 getTweenedFrame works independently of layer 1's shorter length", () => {
    const scene = makeTwoLayerScene(10, 5);
    const layer0 = scene.timeline.layers[0]!;
    // Frame 9 is valid for layer 0 (which has 10 frames)
    const frame = getTweenedFrame(layer0, 9);
    expect(frame).not.toBeNull();
  });

  it("layer 1 getTweenedFrame returns null for a frame beyond its length", () => {
    const scene = makeTwoLayerScene(10, 5);
    const layer1 = scene.timeline.layers[1]!;
    // Frame 9 is out of range for layer 1 (which has only 5 frames)
    const frame = getTweenedFrame(layer1, 9);
    expect(frame).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. insertBlankKeyframe on layer 0 does not affect layer 1
// ---------------------------------------------------------------------------

describe("insertBlankKeyframe — per-layer isolation", () => {
  it("layer 1 frameCount unchanged after insertBlankKeyframe on layer 0", () => {
    const tl = makeTwoLayerTimeline(5, 5);
    const layer0Id = tl.layers[0]!.id;
    // Insert a blank keyframe at frame 3 (extends layer 0 to at least 4 frames)
    const result = insertBlankKeyframe(tl, layer0Id, 3);
    // Layer 1 must be unaffected
    expect(layerFrameCount(result.layers[1]!)).toBe(5);
  });

  it("layer 0 frameCount is at least 4 after insertBlankKeyframe at frame 3", () => {
    const tl = makeTwoLayerTimeline(5, 5);
    const layer0Id = tl.layers[0]!.id;
    const result = insertBlankKeyframe(tl, layer0Id, 3);
    // Layer 0 already had frame 3 within its 5-frame span — no-op on frameCount
    // but the keyframe is inserted at index 3
    expect(layerFrameCount(result.layers[0]!)).toBeGreaterThanOrEqual(4);
  });

  it("layer 0 gains a new keyframe at the inserted index", () => {
    const tl = makeTwoLayerTimeline(5, 5);
    const layer0Id = tl.layers[0]!.id;
    const result = insertBlankKeyframe(tl, layer0Id, 3);
    const layer0 = result.layers[0]!;
    const kf = layer0.frames.find((f) => f.index === 3 && f.isKeyframe);
    expect(kf).toBeDefined();
  });

  it("layer 1 frames are unchanged after insertBlankKeyframe on layer 0", () => {
    const tl = makeTwoLayerTimeline(5, 5);
    const layer0Id = tl.layers[0]!.id;
    const originalLayer1Frames = tl.layers[1]!.frames;
    const result = insertBlankKeyframe(tl, layer0Id, 3);
    // Layer 1's frames array should be the same reference (not mutated)
    expect(result.layers[1]!.frames).toBe(originalLayer1Frames);
  });
});

// ---------------------------------------------------------------------------
// 5. getSceneDuration returns the max frameCount across all layers
// ---------------------------------------------------------------------------

describe("getSceneDuration", () => {
  it("returns 10 when layer 0 has 10 frames and layer 1 has 5 frames", () => {
    const scene = makeTwoLayerScene(10, 5);
    expect(getSceneDuration(scene)).toBe(10);
  });

  it("returns 5 when both layers have 5 frames", () => {
    const scene = makeTwoLayerScene(5, 5);
    expect(getSceneDuration(scene)).toBe(5);
  });

  it("returns 1 for a freshly created scene (default 1-frame layer)", () => {
    const scene = createScene("Test");
    expect(getSceneDuration(scene)).toBe(1);
  });

  it("equals the longer layer's frameCount when layers differ", () => {
    const scene = makeTwoLayerScene(3, 20);
    expect(getSceneDuration(scene)).toBe(20);
  });

  it("updates correctly after insertFrame on one layer", () => {
    const scene = makeTwoLayerScene(5, 5);
    const layer0Id = scene.timeline.layers[0]!.id;
    const newTimeline = insertFrame(scene.timeline, layer0Id, 4);
    const updatedScene: Scene = { ...scene, timeline: newTimeline };
    // Layer 0 is now 6 frames, layer 1 is 5 — duration should be 6
    expect(getSceneDuration(updatedScene)).toBe(6);
  });
});
