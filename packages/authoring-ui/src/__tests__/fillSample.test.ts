/**
 * Task 1389 — Paint Bucket / Eyedropper correctness helpers.
 *
 * Verifies that:
 *   - the Paint Bucket recolors only the ENCLOSED REGION under the cursor (not
 *     every path of the object), does nothing when the click is outside the
 *     geometry, and can remove a region's fill ("No Color");
 *   - the Eyedropper reports whether the click landed on a fill or a stroke.
 */

import { describe, it, expect } from "vitest";
import type { Fill, Point, Shape, ShapePath, SolidStroke } from "@flash/core";
import { createRectShape, buildArrangementFromShapes, planar } from "@flash/core";
import { bucketFillRegion, sampleAttributeAt } from "../tools/fillSample.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const STROKE: SolidStroke = {
  type: "solid",
  color: { r: 0, g: 0, b: 0, a: 255 },
  width: 4,
  caps: "round",
  joints: "round",
  miterLimit: 3,
};

/** The solid fill color under a point (or null if no filled face there). */
function fillColorAt(shape: Shape, pt: Point): { r: number; g: number; b: number } | null {
  const ps = buildArrangementFromShapes([shape]);
  const face = planar.locateFace(ps, pt);
  if (!face || face.fill === null) return null;
  const fill = ps.fills[face.fill];
  return fill.type === "solid" ? fill.color : null;
}

describe("bucketFillRegion (task 1389)", () => {
  it("recolors a whole single-region shape", () => {
    const rect = createRectShape(0, 0, 100, 100, RED, null);
    const next = bucketFillRegion(rect, { x: 50, y: 50 }, BLUE);
    expect(next).not.toBeNull();
    expect(fillColorAt(next!, { x: 50, y: 50 })).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it("returns null (no-op) when the click is outside the geometry", () => {
    const rect = createRectShape(0, 0, 100, 100, RED, null);
    // Well outside the rectangle — bbox pre-filter would still pass upstream, but
    // there is no enclosed region here.
    const next = bucketFillRegion(rect, { x: 500, y: 500 }, BLUE);
    expect(next).toBeNull();
  });

  it("recolors ONLY the enclosed region under the cursor, not other regions", () => {
    // Two disjoint red rectangles held in ONE shape (shape soup).
    const rectA: ShapePath = {
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 40, y: 0 } },
        { type: "line", to: { x: 40, y: 40 } },
        { type: "line", to: { x: 0, y: 40 } },
        { type: "line", to: { x: 0, y: 0 } },
      ],
      closed: true,
      fill: RED,
    };
    const rectB: ShapePath = {
      start: { x: 60, y: 0 },
      segments: [
        { type: "line", to: { x: 100, y: 0 } },
        { type: "line", to: { x: 100, y: 40 } },
        { type: "line", to: { x: 60, y: 40 } },
        { type: "line", to: { x: 60, y: 0 } },
      ],
      closed: true,
      fill: RED,
    };
    const shape: Shape = { id: "soup", paths: [rectA, rectB] };

    const next = bucketFillRegion(shape, { x: 20, y: 20 }, BLUE);
    expect(next).not.toBeNull();
    // Region A is now blue; region B stays red.
    expect(fillColorAt(next!, { x: 20, y: 20 })).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect(fillColorAt(next!, { x: 80, y: 20 })).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("removes a region's fill when fill is null (No Color)", () => {
    const rect = createRectShape(0, 0, 100, 100, RED, null);
    const next = bucketFillRegion(rect, { x: 50, y: 50 }, null);
    // With the only fill removed and no stroke, nothing remains under the point.
    expect(next).not.toBeNull();
    expect(fillColorAt(next!, { x: 50, y: 50 })).toBeNull();
  });
});

describe("sampleAttributeAt (task 1389)", () => {
  it("reports 'fill' for a click in the fill body", () => {
    const rect = createRectShape(0, 0, 100, 100, RED, STROKE);
    expect(sampleAttributeAt(rect, { x: 50, y: 50 })).toBe("fill");
  });

  it("reports 'stroke' for a click on the stroke", () => {
    const rect = createRectShape(0, 0, 100, 100, RED, STROKE);
    // On the left edge (x≈0), within the stroke's on-ink tolerance.
    expect(sampleAttributeAt(rect, { x: 0, y: 50 })).toBe("stroke");
  });

  it("reports null when the click is outside the geometry", () => {
    const rect = createRectShape(0, 0, 100, 100, RED, STROKE);
    expect(sampleAttributeAt(rect, { x: 400, y: 400 })).toBeNull();
  });
});
