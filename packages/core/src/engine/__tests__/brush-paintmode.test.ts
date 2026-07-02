/**
 * Tests for brush paint-mode compositing (task 1421):
 *   - clipBrushStroke honors Fills / Behind / Selection / Inside on the planar
 *     face model.
 */

import { describe, it, expect } from "vitest";
import type { Fill, Point, Shape, ShapePath } from "../types.js";
import { clipBrushStroke, pointInPolygon } from "../planar/index.js";
import type { PlacedShape } from "../planar/index.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };

/** A CCW closed axis-aligned rect ShapePath with a fill. */
function rectPath(x: number, y: number, w: number, h: number, fill: Fill): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x, y: y + h } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x, y } },
    ],
    fill,
    closed: true,
  };
}
function rect(id: string, x: number, y: number, w: number, h: number, fill: Fill): PlacedShape {
  return { shape: { id, paths: [rectPath(x, y, w, h, fill)] }, x: 0, y: 0 };
}

/** Even-odd point-in-shape over all closed paths' vertex polygons. */
function pointInShape(shape: Shape, pt: Point): boolean {
  let inside = false;
  for (const path of shape.paths) {
    const poly: Point[] = [path.start, ...path.segments.map((s) => s.to)];
    if (poly.length >= 3 && pointInPolygon(pt, poly)) inside = !inside;
  }
  return inside;
}

// A blue ribbon rect (the brush stroke area).
function ribbon(x: number, y: number, w: number, h: number): PlacedShape {
  return { shape: { id: "brush", paths: [rectPath(x, y, w, h, BLUE)] }, x: 0, y: 0 };
}

// ---------------------------------------------------------------------------
// clipBrushStroke — Normal
// ---------------------------------------------------------------------------

describe("clipBrushStroke — normal", () => {
  it("returns the ribbon unchanged (paints over everything)", () => {
    const r = ribbon(0, 0, 100, 100);
    const out = clipBrushStroke(r, "normal", { existing: [] });
    expect(out).not.toBeNull();
    expect(out!.paths.length).toBeGreaterThan(0);
    expect(pointInShape(out!, { x: 50, y: 50 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clipBrushStroke — Fills (only over existing fills)
// ---------------------------------------------------------------------------

describe("clipBrushStroke — fills", () => {
  it("keeps only the part over an existing fill", () => {
    const existing = [rect("bg", 0, 0, 100, 100, RED)];
    // Ribbon straddles the red rect: (50,50)-(150,150) — half over red, half empty.
    const out = clipBrushStroke(ribbon(50, 50, 100, 100), "fills", { existing });
    expect(out).not.toBeNull();
    expect(pointInShape(out!, { x: 75, y: 75 })).toBe(true); // over red
    expect(pointInShape(out!, { x: 130, y: 130 })).toBe(false); // over empty
  });

  it("returns null over empty canvas (nothing to paint on)", () => {
    const out = clipBrushStroke(ribbon(0, 0, 50, 50), "fills", { existing: [] });
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clipBrushStroke — Behind (only where empty)
// ---------------------------------------------------------------------------

describe("clipBrushStroke — behind", () => {
  it("keeps only the part over empty space", () => {
    const existing = [rect("bg", 0, 0, 100, 100, RED)];
    const out = clipBrushStroke(ribbon(50, 50, 100, 100), "behind", { existing });
    expect(out).not.toBeNull();
    expect(pointInShape(out!, { x: 75, y: 75 })).toBe(false); // over red → excluded
    expect(pointInShape(out!, { x: 130, y: 130 })).toBe(true); // over empty → kept
  });

  it("paints everywhere over empty canvas", () => {
    const out = clipBrushStroke(ribbon(0, 0, 50, 50), "behind", { existing: [] });
    expect(out).not.toBeNull();
    expect(pointInShape(out!, { x: 25, y: 25 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clipBrushStroke — Selection (only within selected fills)
// ---------------------------------------------------------------------------

describe("clipBrushStroke — selection", () => {
  it("keeps only the part over the SELECTED fill", () => {
    const redA = rect("a", 0, 0, 50, 100, RED);
    const redB = rect("b", 100, 0, 50, 100, RED);
    const existing = [redA, redB];
    // Horizontal band across both rects; only redA is selected.
    const out = clipBrushStroke(ribbon(0, 40, 200, 20), "selection", {
      existing,
      selection: [redA],
    });
    expect(out).not.toBeNull();
    expect(pointInShape(out!, { x: 25, y: 50 })).toBe(true); // over redA (selected)
    expect(pointInShape(out!, { x: 125, y: 50 })).toBe(false); // over redB (not selected)
    expect(pointInShape(out!, { x: 75, y: 50 })).toBe(false); // over gap
  });

  it("returns null when nothing is selected", () => {
    const existing = [rect("a", 0, 0, 100, 100, RED)];
    const out = clipBrushStroke(ribbon(0, 40, 200, 20), "selection", {
      existing,
      selection: [],
    });
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clipBrushStroke — Inside (start-region-locked)
// ---------------------------------------------------------------------------

describe("clipBrushStroke — inside", () => {
  it("locks to the fill the stroke STARTED in", () => {
    const existing = [rect("bg", 0, 0, 100, 100, RED)];
    // Ribbon starts inside red (60,60) and extends past its right edge.
    const out = clipBrushStroke(ribbon(50, 50, 100, 30), "inside", {
      existing,
      startPoint: { x: 60, y: 60 },
    });
    expect(out).not.toBeNull();
    expect(pointInShape(out!, { x: 75, y: 65 })).toBe(true); // inside starting fill
    expect(pointInShape(out!, { x: 130, y: 65 })).toBe(false); // past the fill edge
  });

  it("locks to the EMPTY region when the stroke started on empty", () => {
    const existing = [rect("bg", 0, 0, 100, 100, RED)];
    // Ribbon starts on empty (130,65) and extends back into red.
    const out = clipBrushStroke(ribbon(50, 50, 100, 30), "inside", {
      existing,
      startPoint: { x: 130, y: 65 },
    });
    expect(out).not.toBeNull();
    expect(pointInShape(out!, { x: 130, y: 65 })).toBe(true); // empty (started here)
    expect(pointInShape(out!, { x: 75, y: 65 })).toBe(false); // over red → excluded
  });
});

