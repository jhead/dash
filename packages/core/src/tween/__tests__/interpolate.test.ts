import { describe, it, expect } from "vitest";
import { applyEase, interpolateTween } from "../interpolate.js";
import type { TweenTarget, TweenConfig } from "../types.js";

const from: TweenTarget = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  alpha: 100,
};

const to: TweenTarget = {
  x: 100,
  y: 200,
  scaleX: 2,
  scaleY: 2,
  rotation: 180,
  alpha: 0,
};

const linearConfig: TweenConfig = { ease: 0 };
const easeInConfig: TweenConfig = { ease: 100 };
const easeOutConfig: TweenConfig = { ease: -100 };

describe("applyEase", () => {
  it("ease=0 returns t unchanged (linear)", () => {
    expect(applyEase(0.5, 0)).toBeCloseTo(0.5);
    expect(applyEase(0.25, 0)).toBeCloseTo(0.25);
    expect(applyEase(0, 0)).toBeCloseTo(0);
    expect(applyEase(1, 0)).toBeCloseTo(1);
  });

  it("ease=100 (ease-out / fast start): midpoint > 0.5 (more progress at midpoint)", () => {
    // Flash 8: positive ease = ease-out (fast start, slow end)
    // At t=0.5, the animation has covered MORE than 50% of the range
    expect(applyEase(0.5, 100)).toBeGreaterThan(0.5);
  });

  it("ease=-100 (ease-in / slow start): midpoint < 0.5 (less progress at midpoint)", () => {
    // Flash 8: negative ease = ease-in (slow start, fast end)
    // At t=0.5, the animation has covered LESS than 50% of the range
    expect(applyEase(0.5, -100)).toBeLessThan(0.5);
  });

  it("always returns 0 at t=0 and 1 at t=1 regardless of ease", () => {
    for (const ease of [-100, -50, 0, 50, 100]) {
      expect(applyEase(0, ease)).toBeCloseTo(0);
      expect(applyEase(1, ease)).toBeCloseTo(1);
    }
  });

  // Flash 8 exponential ease formula verification
  it("ease=100 (ease-out): t=0.5 maps to ~0.9375 (very strong ease-out)", () => {
    // exponent = 1 + (100/100)*3 = 4, result = 1 - (1-0.5)^4 = 1 - 0.0625 = 0.9375
    expect(applyEase(0.5, 100)).toBeCloseTo(0.9375, 5);
  });

  it("ease=-100 (ease-in): t=0.5 maps to ~0.0625 (very strong ease-in)", () => {
    // exponent = 1 + (100/100)*3 = 4, result = 0.5^4 = 0.0625
    expect(applyEase(0.5, -100)).toBeCloseTo(0.0625, 5);
  });

  it("ease=50 (moderate ease-out): t=0.5 maps to expected value", () => {
    // exponent = 1 + (50/100)*3 = 2.5, result = 1 - (0.5)^2.5 = 1 - 0.17678 ≈ 0.8232
    const expected = 1 - Math.pow(0.5, 2.5);
    expect(applyEase(0.5, 50)).toBeCloseTo(expected, 5);
    expect(applyEase(0.5, 50)).toBeGreaterThan(0.5);
  });

  it("ease=-50 (moderate ease-in): t=0.5 maps to expected value", () => {
    // exponent = 1 + (50/100)*3 = 2.5, result = 0.5^2.5 ≈ 0.17678
    const expected = Math.pow(0.5, 2.5);
    expect(applyEase(0.5, -50)).toBeCloseTo(expected, 5);
    expect(applyEase(0.5, -50)).toBeLessThan(0.5);
  });

  it("ease=100 at t=0.25: result is greater than 0.25 (fast start)", () => {
    // exponent=4, result = 1 - (0.75)^4 = 1 - 0.3164 = 0.6836
    const expected = 1 - Math.pow(0.75, 4);
    expect(applyEase(0.25, 100)).toBeCloseTo(expected, 5);
  });

  it("ease=-100 at t=0.75: result is less than 0.75 (slow start means less progress early)", () => {
    // exponent=4, result = 0.75^4 = 0.3164
    const expected = Math.pow(0.75, 4);
    expect(applyEase(0.75, -100)).toBeCloseTo(expected, 5);
  });
});

describe("interpolateTween", () => {
  // startFrame=0, endFrame=10, midFrame=5
  const startFrame = 0;
  const endFrame = 10;
  const midFrame = 5;

  it("linear tween (ease=0): midpoint at exactly 50% of range", () => {
    const result = interpolateTween(from, to, midFrame, startFrame, endFrame, linearConfig);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(100);
    expect(result.scaleX).toBeCloseTo(1.5);
    expect(result.alpha).toBeCloseTo(50);
  });

  it("linear tween: at start frame returns from values", () => {
    const result = interpolateTween(from, to, startFrame, startFrame, endFrame, linearConfig);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.alpha).toBeCloseTo(100);
  });

  it("linear tween: at end frame returns to values", () => {
    const result = interpolateTween(from, to, endFrame, startFrame, endFrame, linearConfig);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
    expect(result.alpha).toBeCloseTo(0);
  });

  it("ease=100 (Flash ease-out, fast start): midpoint x > 50 (more progress at midpoint)", () => {
    const result = interpolateTween(from, to, midFrame, startFrame, endFrame, easeInConfig);
    // x range is 0..100, positive ease = fast start → > 50% at midpoint
    expect(result.x).toBeGreaterThan(50);
  });

  it("ease=-100 (Flash ease-in, slow start): midpoint x < 50 (less progress at midpoint)", () => {
    const result = interpolateTween(from, to, midFrame, startFrame, endFrame, easeOutConfig);
    // x range is 0..100, negative ease = slow start → < 50% at midpoint
    expect(result.x).toBeLessThan(50);
  });

  it("rotation shortest path: 350° to 10° goes through 360°/0°, not backward", () => {
    const fromRot: TweenTarget = { ...from, rotation: 350 };
    const toRot: TweenTarget = { ...to, rotation: 10 };

    // At t=0.5 (midpoint), rotation should be near 0° (360°), not 180°
    const result = interpolateTween(fromRot, toRot, 5, 0, 10, linearConfig);

    // delta = 10 - 350 = -340 → wrapped to +20 → midpoint = 350 + 10 = 360 → normalized: 360 or 0
    // The raw angle at midpoint is 350 + 10 = 360 (or equivalently 0)
    // We allow slightly past 360 since we don't normalize the output
    expect(result.rotation).toBeCloseTo(360);
  });

  it("rotation shortest path: 10° to 350° goes backward (shortest path through 0°)", () => {
    const fromRot: TweenTarget = { ...from, rotation: 10 };
    const toRot: TweenTarget = { ...to, rotation: 350 };

    const result = interpolateTween(fromRot, toRot, 5, 0, 10, linearConfig);
    // delta = 350 - 10 = 340 → wrapped to -20 → midpoint = 10 - 10 = 0
    expect(result.rotation).toBeCloseTo(0);
  });

  it("span=0 returns from values without division by zero", () => {
    const result = interpolateTween(from, to, 5, 5, 5, linearConfig);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });
});
