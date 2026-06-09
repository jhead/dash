/**
 * Unit tests for getOnionSkinRange — simple frame index array with clamping.
 */

import { describe, it, expect } from "vitest";
import { getOnionSkinRange } from "../onionskin.js";

describe("getOnionSkinRange", () => {
  it("returns [3,4,5,6,7] for frame 5, before=2, after=2, total=10", () => {
    expect(getOnionSkinRange(5, 2, 2, 10)).toEqual([3, 4, 5, 6, 7]);
  });

  it("clamps at start: frame 0, before=2, after=2, total=10 → [0,1,2]", () => {
    expect(getOnionSkinRange(0, 2, 2, 10)).toEqual([0, 1, 2]);
  });

  it("clamps at end: frame 9, before=2, after=2, total=10 → [7,8,9]", () => {
    expect(getOnionSkinRange(9, 2, 2, 10)).toEqual([7, 8, 9]);
  });

  it("returns only current frame when before=0 and after=0", () => {
    expect(getOnionSkinRange(5, 0, 0, 10)).toEqual([5]);
  });

  it("returns full range when before and after exceed bounds: frame 5, before=10, after=10, total=10 → [0..9]", () => {
    expect(getOnionSkinRange(5, 10, 10, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("clamps both ends: frame 2, before=5, after=5, total=6 → [0,1,2,3,4,5]", () => {
    expect(getOnionSkinRange(2, 5, 5, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
