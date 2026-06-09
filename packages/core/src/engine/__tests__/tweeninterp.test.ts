/**
 * Tests for core tween interpolation property coverage.
 *
 * Covers interpolateTween for:
 * 1. ratio=0 returns start values
 * 2. ratio=1 returns end values
 * 3. ratio=0.5 returns midpoint for linear (ease=0)
 * 4. x position interpolates linearly
 * 5. y position interpolates linearly
 * 6. scaleX interpolates linearly
 * 7. rotation interpolates correctly (including 360° wrap)
 * 8. positive ease (ease-out) changes interpolation curve
 * 9. negative ease (ease-in) changes interpolation in opposite direction
 */

import { describe, it, expect } from "vitest";
import { interpolateTween } from "../../tween/interpolate.js";
import type { TweenTarget, TweenConfig } from "../../tween/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const start: TweenTarget = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  alpha: 100,
};

const end: TweenTarget = {
  x: 200,
  y: 400,
  scaleX: 3,
  scaleY: 3,
  rotation: 90,
  alpha: 0,
};

const linear: TweenConfig = { ease: 0 };
// Flash 8 convention: positive ease = ease-out (fast start, more progress at midpoint)
const easeOut: TweenConfig = { ease: 100 };
// Flash 8 convention: negative ease = ease-in (slow start, less progress at midpoint)
const easeIn: TweenConfig = { ease: -100 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("interpolateTween — property coverage", () => {
  it("ratio=0: returns start values for all properties", () => {
    const result = interpolateTween(start, end, 0, 0, 10, linear);
    expect(result.x).toBeCloseTo(start.x);
    expect(result.y).toBeCloseTo(start.y);
    expect(result.scaleX).toBeCloseTo(start.scaleX);
    expect(result.scaleY).toBeCloseTo(start.scaleY);
    expect(result.rotation).toBeCloseTo(start.rotation);
    expect(result.alpha).toBeCloseTo(start.alpha);
  });

  it("ratio=1: returns end values for all properties", () => {
    const result = interpolateTween(start, end, 10, 0, 10, linear);
    expect(result.x).toBeCloseTo(end.x);
    expect(result.y).toBeCloseTo(end.y);
    expect(result.scaleX).toBeCloseTo(end.scaleX);
    expect(result.scaleY).toBeCloseTo(end.scaleY);
    expect(result.rotation).toBeCloseTo(end.rotation);
    expect(result.alpha).toBeCloseTo(end.alpha);
  });

  it("ratio=0.5, linear: returns exact midpoint for x and y", () => {
    const result = interpolateTween(start, end, 5, 0, 10, linear);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("x position interpolates linearly across multiple frames", () => {
    // x goes from 0 to 200; at t=0.25 → 50, t=0.75 → 150
    const r1 = interpolateTween(start, end, 2, 0, 8, linear);  // t=0.25
    const r2 = interpolateTween(start, end, 6, 0, 8, linear);  // t=0.75
    expect(r1.x).toBeCloseTo(50);
    expect(r2.x).toBeCloseTo(150);
  });

  it("y position interpolates linearly across multiple frames", () => {
    // y goes from 0 to 400; at t=0.25 → 100, t=0.75 → 300
    const r1 = interpolateTween(start, end, 2, 0, 8, linear);  // t=0.25
    const r2 = interpolateTween(start, end, 6, 0, 8, linear);  // t=0.75
    expect(r1.y).toBeCloseTo(100);
    expect(r2.y).toBeCloseTo(300);
  });

  it("scaleX interpolates linearly: from 1 to 3, midpoint = 2", () => {
    const result = interpolateTween(start, end, 5, 0, 10, linear);
    expect(result.scaleX).toBeCloseTo(2);
  });

  it("rotation interpolates: from 0° to 90°, midpoint = 45°", () => {
    const result = interpolateTween(start, end, 5, 0, 10, linear);
    expect(result.rotation).toBeCloseTo(45);
  });

  it("rotation 360° wrap: 350° to 10° takes shortest path (through 0°/360°)", () => {
    const from: TweenTarget = { ...start, rotation: 350 };
    const to: TweenTarget = { ...end, rotation: 10 };
    // auto mode: delta = 10-350 = -340 → wrapped to +20 → midpoint = 350 + 10 = 360
    const result = interpolateTween(from, to, 5, 0, 10, linear);
    expect(result.rotation).toBeCloseTo(360);
  });

  it("rotation 360° wrap: 10° to 350° takes shortest path backward (through 0°)", () => {
    const from: TweenTarget = { ...start, rotation: 10 };
    const to: TweenTarget = { ...end, rotation: 350 };
    // auto mode: delta = 350-10 = 340 → wrapped to -20 → midpoint = 10 - 10 = 0
    const result = interpolateTween(from, to, 5, 0, 10, linear);
    expect(result.rotation).toBeCloseTo(0);
  });

  it("positive ease (ease-out, ease=100): more progress at midpoint than linear", () => {
    // ease=100 → fast start → at t=0.5 the eased t ≈ 0.9375, so x ≈ 0.9375 * 200 = 187.5
    const eased = interpolateTween(start, end, 5, 0, 10, easeOut);
    const lin = interpolateTween(start, end, 5, 0, 10, linear);
    expect(eased.x).toBeGreaterThan(lin.x);
  });

  it("positive ease (ease-out): exact midpoint x ≈ 187.5 (applyEase(0.5,100) = 0.9375)", () => {
    // applyEase(0.5, 100) = 1 - (0.5)^4 = 0.9375; x = 0.9375 * 200 = 187.5
    const result = interpolateTween(start, end, 5, 0, 10, easeOut);
    expect(result.x).toBeCloseTo(187.5, 1);
  });

  it("negative ease (ease-in, ease=-100): less progress at midpoint than linear", () => {
    // ease=-100 → slow start → at t=0.5 the eased t ≈ 0.0625, so x ≈ 0.0625 * 200 = 12.5
    const eased = interpolateTween(start, end, 5, 0, 10, easeIn);
    const lin = interpolateTween(start, end, 5, 0, 10, linear);
    expect(eased.x).toBeLessThan(lin.x);
  });

  it("negative ease (ease-in): exact midpoint x ≈ 12.5 (applyEase(0.5,-100) = 0.0625)", () => {
    // applyEase(0.5, -100) = 0.5^4 = 0.0625; x = 0.0625 * 200 = 12.5
    const result = interpolateTween(start, end, 5, 0, 10, easeIn);
    expect(result.x).toBeCloseTo(12.5, 1);
  });

  it("both ease variants are symmetric: eased + (-eased) midpoints straddle linear midpoint", () => {
    const easedOut = interpolateTween(start, end, 5, 0, 10, easeOut);
    const easedIn = interpolateTween(start, end, 5, 0, 10, easeIn);
    const lin = interpolateTween(start, end, 5, 0, 10, linear);
    expect(easedOut.x).toBeGreaterThan(lin.x);
    expect(easedIn.x).toBeLessThan(lin.x);
  });

  it("ease boundaries: t=0 and t=1 are unaffected by ease value", () => {
    for (const cfg of [linear, easeIn, easeOut]) {
      const atStart = interpolateTween(start, end, 0, 0, 10, cfg);
      const atEnd = interpolateTween(start, end, 10, 0, 10, cfg);
      expect(atStart.x).toBeCloseTo(start.x);
      expect(atEnd.x).toBeCloseTo(end.x);
    }
  });
});
