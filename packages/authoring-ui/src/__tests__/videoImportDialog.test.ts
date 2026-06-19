/**
 * Unit tests for the Import Video wizard's pure item-building logic
 * (buildVideoItem). Covers metadata pass-through, dimension/frame-rate
 * sanitization, and the undecodable-stub fallback.
 */

import { describe, it, expect } from "vitest";
import { buildVideoItem } from "../VideoImportDialog";
import type { PendingVideoImport } from "../store/uiStore";

function makePending(overrides?: Partial<PendingVideoImport>): PendingVideoImport {
  return {
    dataUri: "data:video/x-flv;base64,RkxW",
    suggestedName: "clip",
    fileName: "clip.flv",
    probe: {
      codecId: 4,
      codecName: "On2 VP6",
      width: 640,
      height: 480,
      frameCount: 30,
      frameRate: 24,
    },
    ...overrides,
  };
}

describe("VideoImportDialog — buildVideoItem", () => {
  it("creates a video library item carrying the probed metadata", () => {
    const item = buildVideoItem({
      pending: makePending(),
      name: "My Clip",
      width: 640,
      height: 480,
      frameRate: 24,
    });
    expect(item.itemType).toBe("video");
    expect(item.name).toBe("My Clip");
    expect(item.dataUri).toBe("data:video/x-flv;base64,RkxW");
    expect(item.frameCount).toBe(30);
    expect(item.frameRate).toBe(24);
    expect(item.width).toBe(640);
    expect(item.height).toBe(480);
  });

  it("honours user-edited dimensions and frame rate over the probe", () => {
    const item = buildVideoItem({
      pending: makePending(),
      name: "Clip",
      width: 320,
      height: 240,
      frameRate: 12,
    });
    expect(item.width).toBe(320);
    expect(item.height).toBe(240);
    expect(item.frameRate).toBe(12);
  });

  it("clamps non-positive dimensions and frame rate to at least 1", () => {
    const item = buildVideoItem({
      pending: makePending(),
      name: "Clip",
      width: 0,
      height: -5,
      frameRate: 0,
    });
    expect(item.width).toBe(1);
    expect(item.height).toBe(1);
    expect(item.frameRate).toBe(12); // 0 → falls back to 12
  });

  it("falls back to frameCount 0 when the container was undecodable", () => {
    const item = buildVideoItem({
      pending: makePending({ probe: null }),
      name: "Stub",
      width: 320,
      height: 240,
      frameRate: 15,
    });
    expect(item.frameCount).toBe(0);
    expect(item.frameRate).toBe(15);
  });

  it("defaults a blank name to 'Video'", () => {
    const item = buildVideoItem({
      pending: makePending(),
      name: "   ",
      width: 100,
      height: 100,
      frameRate: 10,
    });
    expect(item.name).toBe("Video");
  });

  it("rounds fractional dimensions and frame rate", () => {
    const item = buildVideoItem({
      pending: makePending(),
      name: "Clip",
      width: 319.6,
      height: 239.4,
      frameRate: 23.976,
    });
    expect(item.width).toBe(320);
    expect(item.height).toBe(239);
    expect(item.frameRate).toBe(23.98);
  });
});
