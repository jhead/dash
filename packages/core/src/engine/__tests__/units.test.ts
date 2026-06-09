import { describe, it, expect } from "vitest";
import { convertUnits, formatMeasurement } from "../units.js";

describe("convertUnits", () => {
  it("converts 1 inch to pixels (≈72)", () => {
    expect(convertUnits(1, "inches", "px")).toBeCloseTo(72, 5);
  });

  it("converts 72 pixels to 1 inch", () => {
    expect(convertUnits(72, "px", "inches")).toBeCloseTo(1, 5);
  });

  it("converts 1 cm to pixels (≈28.35)", () => {
    expect(convertUnits(1, "cm", "px")).toBeCloseTo(28.35, 1);
  });

  it("converts 2.54 cm to 1 inch", () => {
    expect(convertUnits(2.54, "cm", "inches")).toBeCloseTo(1, 5);
  });

  it("converts 10 mm to pixels (≈28.35)", () => {
    expect(convertUnits(10, "mm", "px")).toBeCloseTo(28.35, 1);
  });

  it("converts 72 points to 72 pixels", () => {
    expect(convertUnits(72, "points", "px")).toBeCloseTo(72, 5);
  });

  it("identity: 100 px → px === 100", () => {
    expect(convertUnits(100, "px", "px")).toBe(100);
  });

  it("round-trip: px → inches → px ≈ original", () => {
    const original = 150;
    const result = convertUnits(convertUnits(original, "px", "inches"), "inches", "px");
    expect(result).toBeCloseTo(original, 10);
  });
});

describe("formatMeasurement", () => {
  it('formatMeasurement(100, "px") === "100px"', () => {
    expect(formatMeasurement(100, "px")).toBe("100px");
  });

  it('formatMeasurement(1, "inches", 1) === "1in"', () => {
    expect(formatMeasurement(1, "inches", 1)).toBe("1in");
  });

  it('formatMeasurement(2.5, "cm") === "2.5cm"', () => {
    expect(formatMeasurement(2.5, "cm")).toBe("2.5cm");
  });

  it('formatMeasurement(10.567, "mm", 1) === "10.6mm"', () => {
    expect(formatMeasurement(10.567, "mm", 1)).toBe("10.6mm");
  });

  it('formatMeasurement(72, "points") === "72pt"', () => {
    expect(formatMeasurement(72, "points")).toBe("72pt");
  });
});
