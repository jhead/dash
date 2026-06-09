/**
 * Unit tests for engine/onionskin.ts — onion skin frame range computation.
 */

import { describe, it, expect } from "vitest";
import { getOnionSkinFrames } from "../onionskin.js";
import { createDocument } from "../../model/document.js";
import { createLayer, createFrame, createTimeline } from "../../model/timeline.js";
import type { FlashDocument, Frame, Layer } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a layer with frameCount frames, all as keyframes by default. */
function makeLayer(frameCount: number, keyframeIndices?: number[]): Layer {
  let frames: Frame[];
  if (keyframeIndices !== undefined) {
    // Sparse array: only the specified indices are populated as keyframes
    frames = [];
    for (const idx of keyframeIndices) {
      frames[idx] = createFrame(idx, { isKeyframe: true });
    }
  } else {
    // Dense: all frames are keyframes
    frames = Array.from({ length: frameCount }, (_, i) => createFrame(i, { isKeyframe: true }));
  }
  return createLayer("Layer 1", "normal", { frames, frameCount });
}

/** Build a document with one scene containing the given layer. */
function makeDoc(layer: Layer): FlashDocument {
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: [layer] }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getOnionSkinFrames", () => {
  it("returns frames 3,4,6,7 at frame 5 with before=2 after=2", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 2, after: 2 });
    const indices = frames.map((f) => f.frameIdx);
    expect(indices).toContain(3);
    expect(indices).toContain(4);
    expect(indices).toContain(6);
    expect(indices).toContain(7);
    expect(indices).toHaveLength(4);
  });

  it("does not include the current frame itself", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 2, after: 2 });
    expect(frames.map((f) => f.frameIdx)).not.toContain(5);
  });

  it("alpha decreases with distance: frame at distance 1 has higher alpha than distance 2", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 2, after: 2 });

    const beforeD1 = frames.find((f) => f.frameIdx === 4 && f.isBefore);
    const beforeD2 = frames.find((f) => f.frameIdx === 3 && f.isBefore);
    expect(beforeD1).toBeDefined();
    expect(beforeD2).toBeDefined();
    expect(beforeD1!.alpha).toBeGreaterThan(beforeD2!.alpha);

    const afterD1 = frames.find((f) => f.frameIdx === 6 && !f.isBefore);
    const afterD2 = frames.find((f) => f.frameIdx === 7 && !f.isBefore);
    expect(afterD1).toBeDefined();
    expect(afterD2).toBeDefined();
    expect(afterD1!.alpha).toBeGreaterThan(afterD2!.alpha);
  });

  it("alpha at distance 1 is 0.5", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 1, after: 1 });
    for (const f of frames) {
      expect(f.alpha).toBeCloseTo(0.5);
    }
  });

  it("alpha at distance 2 is 0.25", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 3, after: 3 });
    const d2frames = frames.filter((f) => Math.abs(f.frameIdx - 5) === 2);
    for (const f of d2frames) {
      expect(f.alpha).toBeCloseTo(0.25);
    }
  });

  it("clamps to frame 0 at start — no negative frame indices", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 1, { before: 5, after: 0 });
    for (const f of frames) {
      expect(f.frameIdx).toBeGreaterThanOrEqual(0);
    }
    // Only frame 0 should be included (frame 1 - 1 = 0; frames -1..-4 skipped)
    expect(frames.map((f) => f.frameIdx)).toContain(0);
    expect(frames.filter((f) => f.isBefore)).toHaveLength(1);
  });

  it("clamps at end — no frame indices beyond frameCount-1", () => {
    const layer = makeLayer(10); // frames 0..9
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 8, { before: 0, after: 5 });
    for (const f of frames) {
      expect(f.frameIdx).toBeLessThanOrEqual(9);
    }
    // Only frame 9 should be included (8+1=9; 8+2..8+5 clamped out)
    expect(frames.map((f) => f.frameIdx)).toContain(9);
    expect(frames.filter((f) => !f.isBefore)).toHaveLength(1);
  });

  it("with before=0: no frames before current", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 0, after: 2 });
    expect(frames.every((f) => !f.isBefore)).toBe(true);
    expect(frames.filter((f) => f.isBefore)).toHaveLength(0);
  });

  it("with after=0: no frames after current", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 2, after: 0 });
    expect(frames.every((f) => f.isBefore)).toBe(true);
    expect(frames.filter((f) => !f.isBefore)).toHaveLength(0);
  });

  it("isBefore is true for frames before current, false for after", () => {
    const layer = makeLayer(20);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 0, 5, { before: 2, after: 2 });
    for (const f of frames) {
      if (f.frameIdx < 5) {
        expect(f.isBefore).toBe(true);
      } else {
        expect(f.isBefore).toBe(false);
      }
    }
  });

  it("with onlyKeyframes=true: skips non-keyframe frames", () => {
    // Keyframes only at indices 0, 3, 6, 9
    const layer = makeLayer(20, [0, 3, 6, 9]);
    const doc = makeDoc(layer);
    // current=5, before=3, after=3 → candidates 2,3,4 before and 6,7,8 after
    // only keyframes: 3 before, 6 after
    const frames = getOnionSkinFrames(doc, 0, 0, 5, {
      before: 3,
      after: 3,
      onlyKeyframes: true,
    });
    const indices = frames.map((f) => f.frameIdx);
    expect(indices).toContain(3);
    expect(indices).toContain(6);
    expect(indices).not.toContain(2);
    expect(indices).not.toContain(4);
    expect(indices).not.toContain(7);
    expect(indices).not.toContain(8);
  });

  it("returns empty array for invalid scene index", () => {
    const layer = makeLayer(10);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 99, 0, 5, { before: 2, after: 2 });
    expect(frames).toEqual([]);
  });

  it("returns empty array for invalid layer index", () => {
    const layer = makeLayer(10);
    const doc = makeDoc(layer);
    const frames = getOnionSkinFrames(doc, 0, 99, 5, { before: 2, after: 2 });
    expect(frames).toEqual([]);
  });

  it("alpha minimum is 0.1 for large distances", () => {
    const layer = makeLayer(100);
    const doc = makeDoc(layer);
    // At distance 10: 0.5/10 = 0.05, which is below minimum; should be clamped to 0.1
    const frames = getOnionSkinFrames(doc, 0, 0, 50, { before: 10, after: 10 });
    for (const f of frames) {
      expect(f.alpha).toBeGreaterThanOrEqual(0.1);
    }
  });
});
