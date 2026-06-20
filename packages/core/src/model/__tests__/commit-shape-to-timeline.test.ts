/**
 * Tests for the SHARED merge-on-commit helper `commitShapeToTimeline`
 * (docs/36-vector-merge-model.md).
 *
 * This helper is the SINGLE source of truth every shape-creation path now routes
 * through (UI draw / agent stage_add_shape / copy-paste / JSFL), so these tests
 * assert the IDENTICAL semantics those paths inherit:
 *
 *   - two same-color merge-mode shapes UNION into one region
 *   - two different-color merge-mode shapes CUT (top wins; both colors present)
 *   - Object Drawing (`type:"drawing-object"`) NEVER merges — plain append
 *   - gradient/bitmap (non-solid) fills pass through untouched
 *   - drawing on a frame inside a shape tween folds into the governing keyframe
 *     WITHOUT corrupting the tween (the end keyframe + interpolation survive)
 */

import { describe, it, expect } from "vitest";
import type { Fill, Shape, ShapePath } from "../../engine/types.js";
import type { DrawingObject, ShapeDisplayObject } from "../../engine/types.js";
import { buildArrangementFromShapes, faceArea } from "../../engine/planar/index.js";
import {
  commitShapeToTimeline,
  createFrame,
  createLayer,
  createTimeline,
  setShapeTween,
} from "../timeline.js";
import { getTweenedFrame } from "../timeline-query.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const GRADIENT: Fill = {
  type: "linear-gradient",
  angle: 0,
  stops: [
    { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
    { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
  ],
};

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
function rectShape(id: string, x: number, y: number, w: number, h: number, fill: Fill): Shape {
  return { id, paths: [rectPath(x, y, w, h, fill)] };
}
function shapeObj(id: string, shape: Shape, x = 0, y = 0): ShapeDisplayObject {
  return { type: "shape", id, shape, x, y };
}

/** Single-layer timeline whose frame 0 already holds `objs`. */
function timelineWith(objs: ShapeDisplayObject[]) {
  const layer = createLayer("Layer 1", "normal", {
    frames: [createFrame(0, { isEmpty: objs.length === 0, displayObjects: objs })],
  });
  return { timeline: createTimeline({ layers: [layer] }), layerId: layer.id };
}

/** Sum of bounded-face areas carrying a given fill index (-1 = none). */
function areaOfFill(shapes: Shape[], fill: Fill): number {
  const ps = buildArrangementFromShapes(shapes);
  const idx = ps.fills.findIndex(
    (f) =>
      f.type === "solid" &&
      fill.type === "solid" &&
      f.color.r === fill.color.r &&
      f.color.g === fill.color.g &&
      f.color.b === fill.color.b &&
      f.color.a === fill.color.a
  );
  let a = 0;
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    if (f.fill === idx) a += faceArea(ps, f);
  }
  return a;
}

function committedShapes(timeline: ReturnType<typeof timelineWith>["timeline"], layerId: string): Shape[] {
  const layer = timeline.layers.find((l) => l.id === layerId)!;
  const kf = layer.frames.find((f) => f.isKeyframe && f.index === 0)!;
  return kf.displayObjects.filter((o): o is ShapeDisplayObject => o.type === "shape").map((o) => o.shape);
}

describe("commitShapeToTimeline — shared merge-on-commit helper", () => {
  it("same-color UNION: two overlapping blues become one region (area = A + B - overlap)", () => {
    const { timeline, layerId } = timelineWith([shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))]);
    const next = commitShapeToTimeline(
      timeline,
      layerId,
      0,
      shapeObj("b", rectShape("b", 50, 0, 100, 100, BLUE))
    );
    const shapes = committedShapes(next, layerId);
    // The two blues fold into a single merged shape display object.
    const layer = next.layers.find((l) => l.id === layerId)!;
    const objs = layer.frames[0].displayObjects;
    expect(objs.length).toBe(1);
    // Union area = 100*100 + 100*100 - 50*100 (overlap) = 15000.
    expect(areaOfFill(shapes, BLUE)).toBeCloseTo(15000, 0);
  });

  it("different-color CUT: red over blue carves the blue (top wins; both colors present)", () => {
    const { timeline, layerId } = timelineWith([shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))]);
    const next = commitShapeToTimeline(
      timeline,
      layerId,
      0,
      shapeObj("b", rectShape("b", 50, 0, 100, 100, RED))
    );
    const shapes = committedShapes(next, layerId);
    // Red wins the 50x100 overlap; blue keeps the remaining 50x100; red total 100x100.
    expect(areaOfFill(shapes, RED)).toBeCloseTo(10000, 0);
    expect(areaOfFill(shapes, BLUE)).toBeCloseTo(5000, 0);
  });

  it("Object Drawing NEVER merges: a drawing-object is appended discretely on top", () => {
    const { timeline, layerId } = timelineWith([shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))]);
    const draw: DrawingObject = {
      type: "drawing-object",
      id: "d",
      shape: rectShape("d", 50, 0, 100, 100, BLUE),
      x: 0,
      y: 0,
    };
    const next = commitShapeToTimeline(timeline, layerId, 0, draw);
    const objs = next.layers.find((l) => l.id === layerId)!.frames[0].displayObjects;
    // Two discrete objects remain — no fold.
    expect(objs.length).toBe(2);
    expect(objs[0].type).toBe("shape");
    expect(objs[1].type).toBe("drawing-object");
    expect(objs[1].id).toBe("d");
  });

  it("gradient/bitmap passthrough: a non-solid incoming fill is appended, not folded", () => {
    const { timeline, layerId } = timelineWith([shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))]);
    const grad = shapeObj("g", rectShape("g", 50, 0, 100, 100, GRADIENT));
    const next = commitShapeToTimeline(timeline, layerId, 0, grad);
    const objs = next.layers.find((l) => l.id === layerId)!.frames[0].displayObjects;
    // The gradient shape is non-mergeable; it is appended as-is alongside the blue.
    expect(objs.length).toBe(2);
    expect(objs.some((o) => o.id === "g")).toBe(true);
  });

  it("commits into an empty keyframe (plain append when nothing to fold)", () => {
    const { timeline, layerId } = timelineWith([]);
    const next = commitShapeToTimeline(
      timeline,
      layerId,
      0,
      shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))
    );
    const frame0 = next.layers.find((l) => l.id === layerId)!.frames[0];
    expect(frame0.isEmpty).toBe(false);
    expect(frame0.displayObjects.length).toBe(1);
    expect(areaOfFill(committedShapes(next, layerId), BLUE)).toBeCloseTo(10000, 0);
  });
});

describe("commitShapeToTimeline — draw-on-tween (does not corrupt the tween)", () => {
  it("drawing on a middle frame of a shape tween folds into the governing keyframe and the tween still animates", () => {
    // Shape tween: frame 0 (small blue square) -> frame 10 (large blue square).
    const startShape = rectShape("start", 0, 0, 40, 40, BLUE);
    const endShape = rectShape("end", 0, 0, 120, 120, BLUE);
    const frame0 = createFrame(0, { isEmpty: false, displayObjects: [shapeObj("start", startShape)] });
    const frame10 = createFrame(10, { isEmpty: false, displayObjects: [shapeObj("end", endShape)] });
    // In-between frames (1..9) are non-keyframe extensions of the span.
    const between = Array.from({ length: 9 }, (_, i) =>
      createFrame(i + 1, { isKeyframe: false, isEmpty: false, displayObjects: [] })
    );
    let layer = createLayer("Layer 1", "normal", {
      frames: [frame0, ...between, frame10],
      frameCount: 11,
    });
    let timeline = createTimeline({ layers: [layer] });
    const layerId = layer.id;
    timeline = setShapeTween(timeline, layerId, 0);

    // Sanity: the tween interpolates BEFORE the draw — frame 5 is between sizes.
    const before = getTweenedFrame(timeline.layers[0], 5, timeline);
    expect(before).not.toBeNull();

    // Draw a SECOND blue square on the middle frame (5). It folds into the
    // GOVERNING keyframe of frame 5 (the span start keyframe, frame 0).
    const drawn = shapeObj("drawn", rectShape("drawn", 200, 200, 30, 30, BLUE));
    const next = commitShapeToTimeline(timeline, layerId, 5, drawn);

    const nLayer = next.layers.find((l) => l.id === layerId)!;
    const kf0 = nLayer.frames.find((f) => f.index === 0)!;
    const kf10 = nLayer.frames.find((f) => f.index === 10)!;

    // The draw landed on the governing (start) keyframe, NOT the end keyframe.
    // The new shape merged with the start square into the start keyframe's list.
    expect(kf0.isKeyframe).toBe(true);
    expect(kf10.isKeyframe).toBe(true);

    // The END keyframe is UNTOUCHED — its geometry is not corrupted.
    const endStillThere = kf10.displayObjects.filter(
      (o): o is ShapeDisplayObject => o.type === "shape"
    );
    expect(endStillThere.length).toBe(1);
    expect(areaOfFill([endStillThere[0].shape], BLUE)).toBeCloseTo(120 * 120, 0);

    // The start keyframe now carries the disjoint drawn square in addition to
    // the original start square (bbox-cull keeps disjoint shapes independent).
    const startShapes = kf0.displayObjects
      .filter((o): o is ShapeDisplayObject => o.type === "shape")
      .map((o) => o.shape);
    const startArea = startShapes.reduce((a, s) => a + areaOfFill([s], BLUE), 0);
    // 40x40 original + 30x30 drawn = 1600 + 900 = 2500.
    expect(startArea).toBeCloseTo(2500, 0);

    // The tween STILL animates after the draw — frame 5 still interpolates.
    const after = getTweenedFrame(next.layers[0], 5, next);
    expect(after).not.toBeNull();
    // Tween type is preserved on the start keyframe.
    expect(kf0.tweenType).toBe("shape");
  });
});
