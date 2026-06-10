/**
 * Unit tests for the frameFilename export utility.
 *
 * frameFilename(frameIndex, format) generates a zero-padded filename for a
 * frame in an exported PNG/JPEG sequence (e.g. "frame_0001.png").
 */

import { describe, it, expect } from "vitest";
import { frameFilename } from "../Shell.js";

describe("frameFilename", () => {
  it("generates frame filename with zero-padded index for frame 0", () => {
    expect(frameFilename(0, "png")).toBe("frame_0001.png");
  });

  it("generates frame filename with zero-padded index for frame 9", () => {
    expect(frameFilename(9, "png")).toBe("frame_0010.png");
  });

  it("generates frame filename for frame 99", () => {
    expect(frameFilename(99, "png")).toBe("frame_0100.png");
  });

  it("generates frame filename for frame 999", () => {
    expect(frameFilename(999, "png")).toBe("frame_1000.png");
  });

  it("uses jpeg extension when format is jpeg", () => {
    expect(frameFilename(0, "jpeg")).toBe("frame_0001.jpeg");
  });

  it("uses png extension when format is png", () => {
    expect(frameFilename(4, "png")).toBe("frame_0005.png");
  });
});
