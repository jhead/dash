/**
 * Paste merge-on-commit parity (task 1328).
 *
 * useClipboardHandlers' handlePaste now routes pasted display objects through
 * the SHARED commitShapeToTimeline helper, so a pasted merge-mode shape
 * (type:"shape") folds into the active layer's planar arrangement IDENTICALLY to
 * the interactive UI draw path (union / cut), while a pasted NON-shape (symbol
 * instance, drawing-object, text, bitmap) appends as-is. These tests exercise
 * the exact paste transformation the hook applies (clone-with-new-id +/- offset,
 * then commitShapeToTimeline) without mounting React — the hook is a thin
 * wrapper over this pure logic.
 */

import { describe, it, expect } from "vitest";
import {
  commitShapeToTimeline,
  createDocument,
  buildArrangementFromShapes,
  faceArea,
} from "@flash/core";
import type {
  DisplayObject,
  Fill,
  Shape,
  ShapePath,
  ShapeDisplayObject,
  DrawingObject,
  Timeline,
} from "@flash/core";

const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

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

/** Mirror handlePaste's per-item transform: clone with a new id + optional offset. */
function pasteOne(item: DisplayObject, inPlace: boolean, newId: string): DisplayObject {
  return {
    ...item,
    id: newId,
    ...(inPlace ? {} : { x: (item.x ?? 0) + 10, y: (item.y ?? 0) + 10 }),
  } as DisplayObject;
}

function areaOf(t: Timeline, layerId: string, fill: Fill): number {
  const kf = t.layers.find((l) => l.id === layerId)!.frames.find((f) => f.isKeyframe && f.index === 0)!;
  const shapes = kf.displayObjects
    .filter((o): o is ShapeDisplayObject => o.type === "shape")
    .map((o) => o.shape);
  const ps = buildArrangementFromShapes(shapes);
  const idx = ps.fills.findIndex(
    (f) =>
      f.type === "solid" &&
      fill.type === "solid" &&
      f.color.r === fill.color.r &&
      f.color.g === fill.color.g &&
      f.color.b === fill.color.b
  );
  let a = 0;
  for (const face of ps.faces) if (!face.unbounded && face.fill === idx) a += faceArea(ps, face);
  return a;
}

describe("paste — merge-on-commit parity", () => {
  it("pasting a same-color shape over an existing one UNIONs (paste in place)", () => {
    const doc = createDocument();
    const layerId = doc.scenes[0].timeline.layers[0].id;
    // Existing blue rect; geometry baked in stage space, object at (0,0).
    let t = commitShapeToTimeline(
      doc.scenes[0].timeline,
      layerId,
      0,
      shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))
    );
    // Clipboard holds a blue rect overlapping by 50; paste in place.
    const clip = shapeObj("src", rectShape("src", 50, 0, 100, 100, BLUE));
    const pasted = pasteOne(clip, true, "paste-1");
    t = commitShapeToTimeline(t, layerId, 0, pasted);
    const objs = t.layers.find((l) => l.id === layerId)!.frames[0].displayObjects;
    expect(objs.length).toBe(1); // folded into ONE merged shape
    expect(areaOf(t, layerId, BLUE)).toBeCloseTo(15000, 0);
  });

  it("pasting a different-color shape CUTS the underlying one (top wins)", () => {
    const doc = createDocument();
    const layerId = doc.scenes[0].timeline.layers[0].id;
    let t = commitShapeToTimeline(
      doc.scenes[0].timeline,
      layerId,
      0,
      shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))
    );
    const clip = shapeObj("src", rectShape("src", 50, 0, 100, 100, RED));
    t = commitShapeToTimeline(t, layerId, 0, pasteOne(clip, true, "paste-1"));
    expect(areaOf(t, layerId, RED)).toBeCloseTo(10000, 0);
    expect(areaOf(t, layerId, BLUE)).toBeCloseTo(5000, 0);
  });

  it("pasting a NON-shape (drawing-object) appends as-is, never merges", () => {
    const doc = createDocument();
    const layerId = doc.scenes[0].timeline.layers[0].id;
    let t = commitShapeToTimeline(
      doc.scenes[0].timeline,
      layerId,
      0,
      shapeObj("a", rectShape("a", 0, 0, 100, 100, BLUE))
    );
    const clipDraw: DrawingObject = {
      type: "drawing-object",
      id: "src",
      shape: rectShape("src", 50, 0, 100, 100, BLUE),
      x: 0,
      y: 0,
    };
    t = commitShapeToTimeline(t, layerId, 0, pasteOne(clipDraw, false, "paste-1"));
    const objs = t.layers.find((l) => l.id === layerId)!.frames[0].displayObjects;
    expect(objs.length).toBe(2); // discrete: blue shape + pasted drawing-object
    expect(objs.some((o) => o.type === "drawing-object" && o.id === "paste-1")).toBe(true);
  });
});
