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

describe("interpolateTween — per-property ease curves", () => {
  const from: TweenTarget = {
    x: 0,
    y: 0,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    alpha: 100,
  };
  const to: TweenTarget = {
    x: 200,
    y: 200,
    scaleX: 2.0,
    scaleY: 2.0,
    rotation: 90,
    alpha: 0,
  };

  it("per-property easeForRotation uses its own curve while position stays linear", () => {
    // easeForRotation = strong ease-in (slow start for rotation)
    // position/scale/color have no per-property curve → linear
    const config: TweenConfig = {
      ease: 0,
      easeForRotation: { x1: 0.9, y1: 0, x2: 1, y2: 1 }, // very steep ease-in
    };
    const result = interpolateTween(from, to, 5, 0, 10, config);
    // Position should be ~linear at midpoint → ~100
    expect(result.x).toBeCloseTo(100, 0);
    // Rotation should be much less than the linear 45° due to ease-in
    expect(result.rotation).toBeLessThan(40);
  });

  it("per-property easeForScale uses its own curve independently of position", () => {
    // scale gets a strong ease-out (fast start), position stays linear
    const config: TweenConfig = {
      ease: 0,
      easeForScale: { x1: 0, y1: 1, x2: 0.1, y2: 1 }, // very steep ease-out
    };
    const result = interpolateTween(from, to, 5, 0, 10, config);
    // Position should be ~linear at midpoint → ~100
    expect(result.x).toBeCloseTo(100, 0);
    // Scale should be much greater than linear 1.5 due to ease-out
    expect(result.scaleX).toBeGreaterThan(1.7);
  });

  it("per-property easeForColor uses its own curve for alpha/colorEffect", () => {
    // color gets ease-in (slow start), so alpha should be barely changed at midpoint
    const config: TweenConfig = {
      ease: 0,
      easeForColor: { x1: 0.9, y1: 0, x2: 1, y2: 1 }, // steep ease-in
    };
    const result = interpolateTween(from, to, 5, 0, 10, config);
    // Alpha linear midpoint = 50; with ease-in it should be much closer to 100
    expect(result.alpha).toBeGreaterThan(70);
  });

  it("per-property ease falls back to easeCurve when per-property curve is null", () => {
    // Strong global ease-out via easeCurve
    const config: TweenConfig = {
      ease: 100,
      easeCurve: null, // use integer ease
      easeForRotation: null, // explicitly null → fall back to global ease
    };
    const linearResult = interpolateTween(from, to, 5, 0, 10, { ease: 0 });
    const easedResult  = interpolateTween(from, to, 5, 0, 10, config);
    // With ease=100 (ease-out), midpoint x should be > linear midpoint
    expect(easedResult.x).toBeGreaterThan(linearResult.x);
    // Rotation should also follow the fallback ease-out curve
    expect(easedResult.rotation).toBeGreaterThan(linearResult.rotation);
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
