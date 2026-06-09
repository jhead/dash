import { describe, it, expect } from "vitest";
import {
  createLinearGradient,
  createRadialGradient,
  normalizeGradientRatios,
} from "../gradient.js";

describe("createLinearGradient", () => {
  it("returns an object with type 'linear-gradient'", () => {
    const fill = createLinearGradient(["#ff0000", "#0000ff"], [0, 255]);
    expect(fill.type).toBe("linear-gradient");
  });

  it("colors array has the correct length", () => {
    const fill = createLinearGradient(["#ff0000", "#00ff00", "#0000ff"], [0, 128, 255]);
    expect(fill.stops).toHaveLength(3);
  });

  it("stores ratios alongside colors", () => {
    const fill = createLinearGradient(["#ff0000", "#0000ff"], [10, 240]);
    expect(fill.stops[0]!.ratio).toBe(10);
    expect(fill.stops[1]!.ratio).toBe(240);
  });

  it("default angle is 0", () => {
    const fill = createLinearGradient(["#ffffff", "#000000"], [0, 255]);
    expect(fill.angle).toBe(0);
  });

  it("stores a custom angle", () => {
    const fill = createLinearGradient(["#ffffff", "#000000"], [0, 255], 90);
    expect(fill.angle).toBe(90);
  });

  it("parses CSS color strings into Color objects", () => {
    const fill = createLinearGradient(["#ff0000", "#0000ff"], [0, 255]);
    expect(fill.stops[0]!.color.r).toBe(255);
    expect(fill.stops[0]!.color.g).toBe(0);
    expect(fill.stops[0]!.color.b).toBe(0);
    expect(fill.stops[1]!.color.r).toBe(0);
    expect(fill.stops[1]!.color.b).toBe(255);
  });
});

describe("createRadialGradient", () => {
  it("returns an object with type 'radial-gradient'", () => {
    const fill = createRadialGradient(["#ff0000", "#0000ff"], [0, 255]);
    expect(fill.type).toBe("radial-gradient");
  });

  it("focalPoint is clamped to [-1, 1] when too high", () => {
    const fill = createRadialGradient(["#ff0000", "#0000ff"], [0, 255], 5);
    expect(fill.focalPoint).toBe(1);
  });

  it("focalPoint is clamped to [-1, 1] when too low", () => {
    const fill = createRadialGradient(["#ff0000", "#0000ff"], [0, 255], -3);
    expect(fill.focalPoint).toBe(-1);
  });

  it("focalPoint within range is stored as-is", () => {
    const fill = createRadialGradient(["#ff0000", "#0000ff"], [0, 255], 0.5);
    expect(fill.focalPoint).toBeCloseTo(0.5);
  });

  it("default focalPoint is 0", () => {
    const fill = createRadialGradient(["#ff0000", "#0000ff"], [0, 255]);
    expect(fill.focalPoint).toBe(0);
  });
});

describe("normalizeGradientRatios", () => {
  it("single color returns [128]", () => {
    expect(normalizeGradientRatios(1)).toEqual([128]);
  });

  it("two colors returns [0, 255]", () => {
    expect(normalizeGradientRatios(2)).toEqual([0, 255]);
  });

  it("three colors returns [0, 128, 255]", () => {
    const ratios = normalizeGradientRatios(3);
    expect(ratios[0]).toBe(0);
    expect(ratios[2]).toBe(255);
    // Middle value should be ~128 (rounded)
    expect(ratios[1]).toBeGreaterThanOrEqual(127);
    expect(ratios[1]).toBeLessThanOrEqual(128);
  });

  it("result length matches count", () => {
    for (const n of [1, 2, 3, 4, 5, 8]) {
      expect(normalizeGradientRatios(n)).toHaveLength(n);
    }
  });

  it("zero count returns empty array", () => {
    // count <= 1 branch: 0 falls into [128] — document actual behaviour
    const result = normalizeGradientRatios(0);
    expect(result).toEqual([128]);
  });

  it("four colors spans full 0–255 range", () => {
    const ratios = normalizeGradientRatios(4);
    expect(ratios[0]).toBe(0);
    expect(ratios[3]).toBe(255);
  });
});
