/**
 * Unit tests for contentFrameCount — the unpadded frame-counter value shown in
 * the "current / total" readout on the Timeline bottom bar.
 *
 * Bug fixed: totalFrameCount() was padded to MIN_VISIBLE_FRAMES (48) and that
 * value was used for both the grid width AND the display readout, making a
 * 2-frame document show "1 / 48".  contentFrameCount() returns the raw longest-
 * layer count so the readout correctly shows "1 / 2".
 */

import { describe, it, expect } from "vitest";
import { createTimeline, createLayer, createFrame } from "@flash/core";
import { contentFrameCount } from "../Timeline";

describe("contentFrameCount", () => {
  it("returns 1 for an empty timeline (single blank keyframe per layer)", () => {
    const tl = createTimeline();
    expect(contentFrameCount(tl)).toBe(1);
  });

  it("returns the actual frame count, NOT the MIN_VISIBLE_FRAMES padding (48)", () => {
    const layer = createLayer("L1");
    const frame0 = createFrame(0, { isKeyframe: true, isEmpty: false });
    const frame1 = createFrame(1, { isKeyframe: true, isEmpty: false });
    // Override frameCount so layerFrameCount() uses the frames array index path
    const tl = { ...createTimeline(), layers: [{ ...layer, frames: [frame0, frame1], frameCount: 2 }] };

    const count = contentFrameCount(tl);
    // Must be 2, not 48
    expect(count).toBe(2);
    expect(count).toBeLessThan(48);
  });

  it("returns the longest layer frame count across multiple layers", () => {
    const layerA = { ...createLayer("A"), frames: [createFrame(0, {}), createFrame(1, {})], frameCount: 2 };
    const layerB = {
      ...createLayer("B"),
      frames: [createFrame(0, {}), createFrame(1, {}), createFrame(2, {}), createFrame(3, {})],
      frameCount: 4,
    };
    const tl = { ...createTimeline(), layers: [layerA, layerB] };

    expect(contentFrameCount(tl)).toBe(4);
  });

  it("returns exactly MIN_VISIBLE_FRAMES only when content actually spans that many frames", () => {
    const frames = Array.from({ length: 48 }, (_, i) => createFrame(i, {}));
    const layer = { ...createLayer("L"), frames, frameCount: 48 };
    const tl = { ...createTimeline(), layers: [layer] };

    expect(contentFrameCount(tl)).toBe(48);
  });
});
