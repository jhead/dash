/**
 * Regression test for task 1273 — Off-stage objects not visible or selectable; no
 * editable pasteboard work area around the stage.
 *
 * BUG: objects positioned partly or fully OUTSIDE the white stage rect (x<0, y<0,
 * x>stageWidth, y>stageHeight) could neither be seen nor selected on the editor stage.
 * Real Flash 8 renders and lets you fully select/drag objects on the gray pasteboard
 * surrounding the stage; the white stage rect is only the publish-crop guide.
 *
 * ROOT CAUSE (StageArea.tsx): the render <canvas>, grid canvas, and the CanvasRenderer
 * backing buffer were sized to EXACTLY stageW×H and positioned at top:0/left:0, so any
 * object drawn at off-stage coordinates landed at a canvas pixel outside the bitmap and
 * was clipped away by the canvas's own dimensions (invisible). Selection halos were
 * drawn on that same stage-sized canvas, so even a (math-wise) selected off-stage object
 * showed no affordance off the edge.
 *
 * FIX: enlarge the render/grid canvases + renderer backing buffer to stage + a
 * surrounding PASTEBOARD MARGIN on every side (`computePasteboardMargin`), position them
 * at -margin, and translate ALL drawing (scene via the viewport, halos via the canvas
 * base transform) by +margin so stage (0,0) maps to canvas pixel (margin, margin) and
 * off-stage content renders onto the visible pasteboard. Hit-testing was never stage-
 * clamped, so once the content is visible it is also selectable.
 *
 * These tests assert the two halves of the fix at the unit level:
 *  (1) the pasteboard render surface extends beyond the stage on every side, with a
 *      generous margin (so off-stage content has somewhere to be drawn); and
 *  (2) the hit-test predicate StageArea uses (transformedShapeBounds + an unclamped
 *      stage-coord bounds compare) selects an object placed fully off the stage.
 */

import { describe, it, expect } from "vitest";
import {
  createRectShape,
  transformedShapeBounds,
  type ShapeDisplayObject,
} from "@flash/core";
import { computePasteboardMargin } from "../StageArea.js";

/** A 40×40 red square display object at the given stage origin. */
function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x,
    y,
    shape: createRectShape(0, 0, 40, 40, { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } }, null),
  };
}

/**
 * Mirror of the StageArea selection hit-test: stage coords are NOT clamped to the stage
 * rect (toStageCoords returns raw off-stage coords), and the predicate is a plain bounds
 * compare against transformedShapeBounds. This is exactly the comparison used at the
 * onMouseDown shape hit-test sites (e.g. StageArea.tsx "stageX >= bounds.x && ...").
 */
function hitTest(obj: ShapeDisplayObject, stageX: number, stageY: number): boolean {
  const b = transformedShapeBounds(obj);
  return (
    stageX >= b.x &&
    stageX <= b.x + b.width &&
    stageY >= b.y &&
    stageY <= b.y + b.height
  );
}

describe("off-stage pasteboard render surface (task 1273)", () => {
  it("computePasteboardMargin gives a generous positive margin so the canvas extends past the stage", () => {
    const stageWidth = 550;
    const stageHeight = 400;
    const margin = computePasteboardMargin(stageWidth, stageHeight);

    // There must be a real pasteboard surface around the stage (the load-bearing fix:
    // canvas was previously sized to stageW×H with margin == 0, clipping everything off-stage).
    expect(margin).toBeGreaterThan(0);

    const canvasWidth = stageWidth + margin * 2;
    const canvasHeight = stageHeight + margin * 2;
    expect(canvasWidth).toBeGreaterThan(stageWidth);
    expect(canvasHeight).toBeGreaterThan(stageHeight);

    // The margin should comfortably hold a 40px object parked fully off the left/top edge
    // (the "tween in from off-screen" staging workflow the bug broke).
    expect(margin).toBeGreaterThanOrEqual(40);
  });

  it("margin is bounded for tiny and huge stages (no zero, no runaway buffer)", () => {
    // Tiny stage still gets the floor margin.
    expect(computePasteboardMargin(1, 1)).toBeGreaterThanOrEqual(220);
    // Huge stage is capped so the backing bitmap doesn't balloon.
    expect(computePasteboardMargin(10000, 10000)).toBeLessThanOrEqual(900);
    // It never collapses to 0 for a normal stage.
    expect(computePasteboardMargin(550, 400)).toBeGreaterThan(0);
  });

  it("an object fully off the LEFT edge (x<0) is mapped onto the visible pasteboard surface", () => {
    const stageWidth = 550;
    const stageHeight = 400;
    const margin = computePasteboardMargin(stageWidth, stageHeight);

    // Symbol parked just past the left edge: x = -60 → spans x ∈ [-60, -20].
    const obj = makeShape("offL", -60, 100);
    const b = transformedShapeBounds(obj);
    expect(b.x).toBeLessThan(0); // genuinely off-stage

    // In canvas-pixel space the renderer draws at (stageX + margin). The object's left
    // edge maps to (b.x + margin); for it to be VISIBLE that must be >= 0 (inside buffer).
    expect(b.x + margin).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width + margin).toBeLessThanOrEqual(stageWidth + margin * 2);
  });
});

describe("off-stage object hit-testing / selectability (task 1273)", () => {
  it("selects an object placed fully off the LEFT edge", () => {
    const obj = makeShape("offL", -60, 100); // bounds x ∈ [-60,-20], y ∈ [100,140]
    // A click at off-stage stage coords (negative x) hits the object.
    expect(hitTest(obj, -40, 120)).toBe(true);
    // A click on the stage where the object is NOT does not hit it.
    expect(hitTest(obj, 40, 120)).toBe(false);
  });

  it("selects an object placed fully off the TOP edge", () => {
    const obj = makeShape("offT", 100, -80); // bounds y ∈ [-80,-40]
    expect(hitTest(obj, 120, -60)).toBe(true);
    expect(hitTest(obj, 120, 60)).toBe(false);
  });

  it("selects an object straddling the right/bottom stage edge", () => {
    const stageWidth = 550;
    const stageHeight = 400;
    // Half on, half off the bottom-right corner.
    const obj = makeShape("straddle", stageWidth - 20, stageHeight - 20);
    // Hit on the off-stage portion (past both edges).
    expect(hitTest(obj, stageWidth + 10, stageHeight + 10)).toBe(true);
    // Hit on the on-stage portion.
    expect(hitTest(obj, stageWidth - 10, stageHeight - 10)).toBe(true);
  });

  it("hit-test is NOT clamped to the stage rect (off-stage coords are honored)", () => {
    const obj = makeShape("offFar", -200, -200);
    // Far off-stage in the pasteboard corner — still selectable.
    expect(hitTest(obj, -180, -180)).toBe(true);
  });
});
