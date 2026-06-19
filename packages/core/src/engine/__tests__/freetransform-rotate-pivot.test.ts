/**
 * Free-transform ROTATE pivot math (task 1261).
 *
 * The stage renderer rotates a ShapeDisplayObject about its LOCAL origin
 * (obj.x, obj.y) — see renderer.ts (translate(obj.x,obj.y)→rotate→scale) and the
 * doc-comment on transformedShapeBounds. Editor-drawn shapes bake absolute drawn
 * coordinates into the path geometry with obj.x=obj.y=0, so the local origin is
 * typically far from the bounding-box center. The free-transform rotate handle
 * pivots about the bounding-box center, so updating ONLY `rotation` makes the shape
 * orbit its local origin and drift across the stage.
 *
 * The fix (Shell.tsx handleFreeTransformRotate) compensates obj.x/obj.y so the
 * pivot point's stage position stays fixed. This test pins that math by replicating
 * the exact compensation and asserting the transformedShapeBounds CENTER is
 * invariant under rotation for several angles — and that the naive rotation-only
 * update would NOT be.
 */

import { describe, it, expect } from "vitest";
import { createRectShape, transformedShapeBounds } from "../shapes.js";
import type { ShapeDisplayObject } from "../types.js";

/** Editor-drawn rect: absolute geometry 200..300 / 150..250, local origin at (0,0). */
function makeEditorRect(): ShapeDisplayObject {
  const shape = createRectShape(200, 150, 300, 250, { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 } }, null);
  return {
    type: "shape",
    id: "rect-1",
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    shape,
  } as ShapeDisplayObject;
}

function centerOf(obj: ShapeDisplayObject): { cx: number; cy: number } {
  const b = transformedShapeBounds(obj);
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

/**
 * Apply the production rotate-handle compensation: given the box-center pivot
 * (originX, originY) and a rotation delta, write a new rotation AND new origin so
 * the pivot's stage position is preserved.
 */
function applyRotateHandle(obj: ShapeDisplayObject, deltaAngle: number, originX: number, originY: number): ShapeDisplayObject {
  const rad = (deltaAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = obj.x - originX;
  const dy = obj.y - originY;
  return {
    ...obj,
    rotation: (obj.rotation ?? 0) + deltaAngle,
    x: originX + dx * cos - dy * sin,
    y: originY + dx * sin + dy * cos,
  };
}

describe("free-transform rotate pivots in place (task 1261)", () => {
  for (const angle of [30, 90, 180, 270, -45]) {
    it(`bounding-box center is invariant under ${angle}° rotation`, () => {
      const obj = makeEditorRect();
      const before = centerOf(obj);
      // The handle pivots about the box center.
      const rotated = applyRotateHandle(obj, angle, before.cx, before.cy);
      const after = centerOf(rotated);
      expect(after.cx).toBeCloseTo(before.cx, 6);
      expect(after.cy).toBeCloseTo(before.cy, 6);
    });
  }

  it("the naive rotation-only update (the bug) DOES drift the center", () => {
    const obj = makeEditorRect();
    const before = centerOf(obj);
    // Buggy behavior: change rotation only, leave x/y untouched.
    const buggy = { ...obj, rotation: (obj.rotation ?? 0) + 90 } as ShapeDisplayObject;
    const after = centerOf(buggy);
    // Local origin (0,0) is far from the box center (250,200), so a 90° rotation
    // about the origin sweeps the shape well away from where it was.
    const drift = Math.hypot(after.cx - before.cx, after.cy - before.cy);
    expect(drift).toBeGreaterThan(100);
  });

  it("two successive rotations about the (re-derived) box center stay in place", () => {
    let obj = makeEditorRect();
    const start = centerOf(obj);
    // Real interaction: each move re-derives the pivot from the current bounds.
    for (const d of [25, 25, 40]) {
      const c = centerOf(obj);
      obj = applyRotateHandle(obj, d, c.cx, c.cy);
    }
    const end = centerOf(obj);
    expect(end.cx).toBeCloseTo(start.cx, 6);
    expect(end.cy).toBeCloseTo(start.cy, 6);
    expect(obj.rotation).toBeCloseTo(90, 6);
  });
});
