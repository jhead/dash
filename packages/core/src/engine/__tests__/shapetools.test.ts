/**
 * Tests for createRoundedRectShape in engine/shapes.ts.
 *
 * Verifies:
 *   - Returns a Shape with type "shape" (via ShapeDisplayObject wrapper)
 *   - Width and height reflected in bounding box
 *   - cornerRadius=0 produces no curve segments
 *   - cornerRadius > min(w,h)/2 is clamped
 *   - fillColor is set on the path fill
 *   - The path is non-empty
 */

import { describe, it, expect } from "vitest";
import { createRoundedRectShape, hexToColor, shapeBounds } from "../shapes.js";
import type { Fill, SolidStroke } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function solidFill(hex: string): Fill {
  return { type: "solid", color: hexToColor(hex) };
}

function solidStroke(hex: string, width = 1): SolidStroke {
  return {
    type: "solid",
    color: hexToColor(hex),
    width,
    caps: "none",
    joints: "miter",
    miterLimit: 3,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createRoundedRectShape", () => {
  it("1. returns a Shape object (id + paths)", () => {
    const shape = createRoundedRectShape(0, 0, 100, 50, 10, null, null);
    expect(shape).toBeDefined();
    expect(typeof shape.id).toBe("string");
    expect(shape.paths).toBeDefined();
    expect(shape.paths.length).toBeGreaterThan(0);
  });

  it("2. bounding-box width and height match the input dimensions", () => {
    const w = 120;
    const h = 80;
    const shape = createRoundedRectShape(10, 20, w, h, 5, null, null);
    const bounds = shapeBounds(shape);
    // Bounds are computed over path segment endpoints (corner arcs are approximated),
    // so width/height should be exactly w and h.
    expect(bounds.width).toBeCloseTo(w, 5);
    expect(bounds.height).toBeCloseTo(h, 5);
  });

  it("3. cornerRadius=0 produces no curve segments (straight corners)", () => {
    const shape = createRoundedRectShape(0, 0, 100, 60, 0, null, null);
    const path = shape.paths[0]!;
    const hasCurves = path.segments.some((s) => s.type === "curve");
    expect(hasCurves).toBe(false);
  });

  it("4. cornerRadius > width/2 is clamped to width/2 (no error, valid shape)", () => {
    // Width=40, height=80 → max allowed r = 20 (width/2)
    expect(() => {
      const shape = createRoundedRectShape(0, 0, 40, 80, 999, null, null);
      // Should still produce a valid shape
      expect(shape.paths.length).toBeGreaterThan(0);
      const bounds = shapeBounds(shape);
      expect(bounds.width).toBeCloseTo(40, 5);
      expect(bounds.height).toBeCloseTo(80, 5);
    }).not.toThrow();
  });

  it("5. cornerRadius > height/2 is clamped to height/2", () => {
    // Width=80, height=30 → max allowed r = 15 (height/2)
    const shape = createRoundedRectShape(0, 0, 80, 30, 999, null, null);
    const bounds = shapeBounds(shape);
    expect(bounds.width).toBeCloseTo(80, 5);
    expect(bounds.height).toBeCloseTo(30, 5);
  });

  it("6. fillColor is reflected in the path fill property", () => {
    const fill = solidFill("#ff0000");
    const shape = createRoundedRectShape(0, 0, 100, 100, 10, fill, null);
    const path = shape.paths[0]!;
    expect(path.fill).toBeDefined();
    expect(path.fill?.type).toBe("solid");
    if (path.fill?.type === "solid") {
      expect(path.fill.color.r).toBe(255);
      expect(path.fill.color.g).toBe(0);
      expect(path.fill.color.b).toBe(0);
    }
  });

  it("7. no fill when fill is null", () => {
    const shape = createRoundedRectShape(0, 0, 100, 100, 10, null, null);
    const path = shape.paths[0]!;
    expect(path.fill).toBeUndefined();
  });

  it("8. stroke is reflected in path stroke property", () => {
    const stroke = solidStroke("#0000ff", 2);
    const shape = createRoundedRectShape(0, 0, 100, 100, 10, null, stroke);
    const path = shape.paths[0]!;
    expect(path.stroke).toBeDefined();
    expect(path.stroke?.type).toBe("solid");
  });

  it("9. path is closed (rounded rects are always closed)", () => {
    const shape = createRoundedRectShape(0, 0, 100, 100, 15, solidFill("#ff0000"), null);
    expect(shape.paths[0]!.closed).toBe(true);
  });

  it("10. positive cornerRadius produces curve segments (rounded corners)", () => {
    const shape = createRoundedRectShape(0, 0, 100, 100, 15, null, null);
    const path = shape.paths[0]!;
    const curveCount = path.segments.filter((s) => s.type === "curve").length;
    // One quadratic Bézier per corner = 4
    expect(curveCount).toBe(4);
  });

  it("11. shape id is a non-empty string and unique across calls", () => {
    const s1 = createRoundedRectShape(0, 0, 100, 100, 10, null, null);
    const s2 = createRoundedRectShape(0, 0, 100, 100, 10, null, null);
    expect(s1.id).toBeTruthy();
    expect(s2.id).toBeTruthy();
    expect(s1.id).not.toBe(s2.id);
  });
});
