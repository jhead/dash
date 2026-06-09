/**
 * Tests for motion tween display object interpolation.
 *
 * Covers interpolateTween (TweenTarget) with linear and eased interpolation,
 * including x/y, scale, rotation, and alpha properties.
 */

import { describe, it, expect } from "vitest";
import { interpolateTween, applyEase } from "../interpolate.js";
import type { TweenTarget, TweenConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const startState: TweenTarget = {
  x: 0,
  y: 0,
  scaleX: 1.0,
  scaleY: 1.0,
  rotation: 0,
  alpha: 100,
};

const endState: TweenTarget = {
  x: 200,
  y: 400,
  scaleX: 2.0,
  scaleY: 2.0,
  rotation: 90,
  alpha: 0,
};

const linearConfig: TweenConfig = { ease: 0 };
// Flash 8 convention: negative ease = ease-in (slow start, less progress at midpoint)
const easeInConfig: TweenConfig = { ease: -100 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("interpolateTween — motion tween display object interpolation", () => {
  it("linear tween at t=0 returns start values", () => {
    const result = interpolateTween(startState, endState, 0, 0, 10, linearConfig);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.scaleX).toBeCloseTo(1.0);
    expect(result.scaleY).toBeCloseTo(1.0);
    expect(result.rotation).toBeCloseTo(0);
    expect(result.alpha).toBeCloseTo(100);
  });

  it("linear tween at t=1 returns end values", () => {
    const result = interpolateTween(startState, endState, 10, 0, 10, linearConfig);
    expect(result.x).toBeCloseTo(200);
    expect(result.y).toBeCloseTo(400);
    expect(result.scaleX).toBeCloseTo(2.0);
    expect(result.scaleY).toBeCloseTo(2.0);
    expect(result.rotation).toBeCloseTo(90);
    expect(result.alpha).toBeCloseTo(0);
  });

  it("linear tween at t=0.5 returns midpoint for x and y", () => {
    const result = interpolateTween(startState, endState, 5, 0, 10, linearConfig);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("ease-in tween: position at t=0.5 is less than linear midpoint (slow start)", () => {
    // ease=-100 → ease-in (slow start), so at midpoint x < 100
    const result = interpolateTween(startState, endState, 5, 0, 10, easeInConfig);
    expect(result.x).toBeLessThan(100);
    expect(result.y).toBeLessThan(200);
  });

  it("rotation interpolation: from 0 to 90° at t=0.5 → 45°", () => {
    const result = interpolateTween(startState, endState, 5, 0, 10, linearConfig);
    expect(result.rotation).toBeCloseTo(45);
  });

  it("scale interpolation: from 1.0 to 2.0 at t=0.5 → 1.5", () => {
    const result = interpolateTween(startState, endState, 5, 0, 10, linearConfig);
    expect(result.scaleX).toBeCloseTo(1.5);
    expect(result.scaleY).toBeCloseTo(1.5);
  });

  it("alpha interpolation: from 100 to 0 at t=0.5 → 50", () => {
    const result = interpolateTween(startState, endState, 5, 0, 10, linearConfig);
    expect(result.alpha).toBeCloseTo(50);
  });

  it("ease-in tween at t=0 returns start values unchanged", () => {
    const result = interpolateTween(startState, endState, 0, 0, 10, easeInConfig);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.alpha).toBeCloseTo(100);
  });

  it("ease-in tween at t=1 returns end values unchanged", () => {
    const result = interpolateTween(startState, endState, 10, 0, 10, easeInConfig);
    expect(result.x).toBeCloseTo(200);
    expect(result.y).toBeCloseTo(400);
    expect(result.alpha).toBeCloseTo(0);
  });

  it("zero-span tween returns from values without division by zero", () => {
    const result = interpolateTween(startState, endState, 5, 5, 5, linearConfig);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });
});

describe("applyEase — ease function sanity checks for tween", () => {
  it("ease=0 is linear (t=0.5 → 0.5)", () => {
    expect(applyEase(0.5, 0)).toBeCloseTo(0.5);
  });

  it("ease=-100 (ease-in): t=0.5 maps to ~0.0625 (much less than 0.5)", () => {
    // exponent=4, 0.5^4 = 0.0625
    expect(applyEase(0.5, -100)).toBeCloseTo(0.0625, 5);
  });

  it("ease=100 (ease-out): t=0.5 maps to ~0.9375 (much greater than 0.5)", () => {
    // exponent=4, 1-(0.5^4) = 0.9375
    expect(applyEase(0.5, 100)).toBeCloseTo(0.9375, 5);
  });
});
