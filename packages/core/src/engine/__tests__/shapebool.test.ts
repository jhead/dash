import { describe, it, expect } from "vitest";
import {
  shapeBoundsUnion,
  shapeBoundsSubtract,
  type PathShape,
} from "../shape-boolean.js";

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  path?: string
): PathShape {
  return {
    path: path ?? `M${x},${y} H${x + width} V${y + height} H${x} Z`,
    bounds: { x, y, width, height },
  };
}

describe("shapeBoundsUnion", () => {
  it("returns an object with a path and bounds", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    const result = shapeBoundsUnion(a, b);
    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("bounds");
  });

  it("union bounds width >= both input widths", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 0, 8, 10);
    const result = shapeBoundsUnion(a, b);
    expect(result.bounds.width).toBeGreaterThanOrEqual(a.bounds.width);
    expect(result.bounds.width).toBeGreaterThanOrEqual(b.bounds.width);
  });

  it("union bounds x is min of inputs", () => {
    const a = rect(3, 0, 10, 10);
    const b = rect(7, 0, 10, 10);
    const result = shapeBoundsUnion(a, b);
    expect(result.bounds.x).toBe(3);
  });

  it("union bounds contains both input bounds (y and height)", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(0, 5, 10, 20);
    const result = shapeBoundsUnion(a, b);
    expect(result.bounds.y).toBe(0);
    expect(result.bounds.height).toBe(25);
  });

  it("union of identical shapes returns same bounds", () => {
    const a = rect(1, 2, 30, 40);
    const result = shapeBoundsUnion(a, a);
    expect(result.bounds).toEqual(a.bounds);
  });

  it("empty paths handled without crash", () => {
    const a: PathShape = { path: "", bounds: { x: 0, y: 0, width: 0, height: 0 } };
    const b: PathShape = { path: "", bounds: { x: 0, y: 0, width: 0, height: 0 } };
    expect(() => shapeBoundsUnion(a, b)).not.toThrow();
  });
});

describe("shapeBoundsSubtract", () => {
  it("returns an object with bounds", () => {
    const a = rect(0, 0, 20, 20);
    const b = rect(5, 5, 10, 10);
    const result = shapeBoundsSubtract(a, b);
    expect(result).toHaveProperty("bounds");
  });

  it("subtract result has same or smaller width than input A", () => {
    const a = rect(0, 0, 20, 20);
    const b = rect(5, 5, 10, 10);
    const result = shapeBoundsSubtract(a, b);
    expect(result.bounds.width).toBeLessThanOrEqual(a.bounds.width);
  });

  it("returns path property", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(0, 0, 10, 10);
    const result = shapeBoundsSubtract(a, b);
    expect(result).toHaveProperty("path");
  });

  it("empty paths handled without crash", () => {
    const a: PathShape = { path: "", bounds: { x: 0, y: 0, width: 5, height: 5 } };
    const b: PathShape = { path: "", bounds: { x: 0, y: 0, width: 5, height: 5 } };
    expect(() => shapeBoundsSubtract(a, b)).not.toThrow();
  });

  it("does not mutate input shape A", () => {
    const a = rect(0, 0, 20, 20);
    const b = rect(5, 5, 10, 10);
    const origPath = a.path;
    const origBounds = { ...a.bounds };
    shapeBoundsSubtract(a, b);
    expect(a.path).toBe(origPath);
    expect(a.bounds).toEqual(origBounds);
  });
});
