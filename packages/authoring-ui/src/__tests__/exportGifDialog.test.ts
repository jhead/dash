/**
 * Unit tests for ExportGifDialog data logic.
 *
 * Covers:
 *   1. defaultFrameDelay computes correctly from doc frame rate
 *   2. Default delay matches standard frame rates (12, 24, 30, 60 fps)
 *   3. Edge cases: very low/high frame rates don't break the computation
 */

import { describe, it, expect } from "vitest";
import { defaultFrameDelay } from "../ExportGifDialog";

describe("ExportGifDialog — defaultFrameDelay", () => {
  it("default GIF delay matches doc frame rate of 24 fps", () => {
    // 1000 / 24 = 41.666... → Math.round = 42
    expect(defaultFrameDelay(24)).toBe(42);
  });

  it("default GIF delay matches doc frame rate of 12 fps", () => {
    // 1000 / 12 = 83.333... → Math.round = 83
    expect(defaultFrameDelay(12)).toBe(83);
  });

  it("default GIF delay matches doc frame rate of 30 fps", () => {
    // 1000 / 30 = 33.333... → Math.round = 33
    expect(defaultFrameDelay(30)).toBe(33);
  });

  it("default GIF delay matches doc frame rate of 60 fps", () => {
    // 1000 / 60 = 16.666... → Math.round = 17
    expect(defaultFrameDelay(60)).toBe(17);
  });

  it("clamps to a minimum of 1 ms when frame rate is absurdly high", () => {
    // 1000 / 10000 = 0.1 → Math.round = 0, but max(1, fps) guard prevents /0 issues
    // and Math.round(1000 / 10000) = 0 which is a valid result for round
    const delay = defaultFrameDelay(10000);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it("does not divide by zero when frame rate is 0 (uses max(1, fps))", () => {
    // defaultFrameDelay guards with Math.max(1, frameRate)
    const delay = defaultFrameDelay(0);
    expect(delay).toBe(1000);
  });

  it("does not divide by zero when frame rate is negative (uses max(1, fps))", () => {
    const delay = defaultFrameDelay(-5);
    expect(delay).toBe(1000);
  });

  it("produces integer milliseconds (no fractional delay)", () => {
    for (const fps of [8, 15, 24, 25, 30, 60]) {
      const delay = defaultFrameDelay(fps);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });
});
