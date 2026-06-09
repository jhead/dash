import { describe, it, expect } from "vitest";
import { applyEase, lerp, tweenValue } from "../tween.js";

describe("tween easing utilities", () => {
  it("ease=0 is linear (midpoint = 0.5)", () => {
    expect(applyEase(0.5, 0)).toBeCloseTo(0.5, 5);
  });

  it("ease=0 at t=0 returns 0", () => {
    expect(applyEase(0, 0)).toBe(0);
  });

  it("ease=0 at t=1 returns 1", () => {
    expect(applyEase(1, 0)).toBe(1);
  });

  it("ease=100 (ease-out): midpoint is greater than 0.5", () => {
    // Flash 8: ease=100 is ease-out (fast start, slow end) → at t=0.5, value > 0.5
    expect(applyEase(0.5, 100)).toBeGreaterThan(0.5);
  });

  it("ease=-100 (ease-in): midpoint is less than 0.5", () => {
    // Flash 8: ease=-100 is ease-in (slow start, fast end) → at t=0.5, value < 0.5
    expect(applyEase(0.5, -100)).toBeLessThan(0.5);
  });

  it("applyEase always returns 0 at t=0 and 1 at t=1", () => {
    for (const e of [-100, -50, 0, 50, 100]) {
      expect(applyEase(0, e)).toBeCloseTo(0, 5);
      expect(applyEase(1, e)).toBeCloseTo(1, 5);
    }
  });

  it("lerp basic interpolation", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("tweenValue linear at ease=0", () => {
    expect(tweenValue(0, 200, 0.5, 0)).toBeCloseTo(100, 5);
  });

  it("tweenValue ease-out: position at midpoint > linear midpoint", () => {
    // Flash 8 ease=100 is ease-out
    const linear = tweenValue(0, 100, 0.5, 0);
    const easeOut = tweenValue(0, 100, 0.5, 100);
    expect(easeOut).toBeGreaterThan(linear);
  });

  it("tweenValue ease-in: position at midpoint < linear midpoint", () => {
    // Flash 8 ease=-100 is ease-in
    const linear = tweenValue(0, 100, 0.5, 0);
    const easeIn = tweenValue(0, 100, 0.5, -100);
    expect(easeIn).toBeLessThan(linear);
  });
});
