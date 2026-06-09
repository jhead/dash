/**
 * Tests for applyInkBottle — apply a stroke to all paths of a ShapeDisplayObject.
 */

import { describe, it, expect } from "vitest";
import { applyInkBottle } from "../inkbottle.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject, ShapePath, Stroke } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _idSeq = 0;
function uid(): string {
  return `inkbottle-id-${++_idSeq}`;
}

function makeShapePath(withStroke = false): ShapePath {
  const base: ShapePath = {
    start: { x: 0, y: 0 },
    segments: [
      { type: "line", to: { x: 10, y: 0 } },
      { type: "line", to: { x: 10, y: 10 } },
      { type: "line", to: { x: 0, y: 10 } },
    ],
    fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
    closed: true,
  };
  if (withStroke) {
    return {
      ...base,
      stroke: {
        type: "solid",
        color: { r: 0, g: 0, b: 0, a: 255 },
        width: 1,
        caps: "none",
        joints: "miter",
        miterLimit: 3,
      },
    };
  }
  return base;
}

function makeShape(id: string, paths: ShapePath[]): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: { id: uid(), paths },
    x: 0,
    y: 0,
  };
}

function makeDoc(displayObjects: DisplayObject[]): FlashDocument {
  const frame = createFrame(0, {
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
    displayObjects,
  });
  const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: [layer] }),
      },
    ],
  };
}

function getShape(doc: FlashDocument, id: string): ShapeDisplayObject {
  const objs = doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
  const found = objs.find((o) => o.id === id);
  if (!found || found.type !== "shape") throw new Error(`Shape ${id} not found`);
  return found as ShapeDisplayObject;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyInkBottle", () => {
  it("1. apply stroke to a shape with no existing stroke — all paths get the stroke", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(false), makeShapePath(false)]);
    const doc = makeDoc([shape]);

    const result = applyInkBottle(doc, 0, 0, 0, id, "#ff0000", 2);
    const updated = getShape(result, id);

    for (const path of updated.shape.paths) {
      expect(path.stroke).toBeDefined();
    }
  });

  it("2. replace existing stroke on a shape — all paths get the new stroke", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(true), makeShapePath(true)]);
    const doc = makeDoc([shape]);

    const result = applyInkBottle(doc, 0, 0, 0, id, "#00ff00", 5);
    const updated = getShape(result, id);

    for (const path of updated.shape.paths) {
      const stroke = path.stroke as Stroke;
      expect(stroke.color.g).toBe(255);
      expect(stroke.color.r).toBe(0);
      expect(stroke.width).toBe(5);
    }
  });

  it("3. strokeColor and strokeWidth match what was passed", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(false)]);
    const doc = makeDoc([shape]);

    const result = applyInkBottle(doc, 0, 0, 0, id, "#0000ff", 3);
    const updated = getShape(result, id);
    const stroke = updated.shape.paths[0].stroke as Stroke;

    expect(stroke.color.r).toBe(0);
    expect(stroke.color.g).toBe(0);
    expect(stroke.color.b).toBe(255);
    expect(stroke.width).toBe(3);
  });

  it("4. shape not found — doc returned unchanged", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(false)]);
    const doc = makeDoc([shape]);

    const result = applyInkBottle(doc, 0, 0, 0, "nonexistent-id", "#ff0000", 2);
    expect(result).toBe(doc);
  });

  it("5. immutability — original doc is not mutated", () => {
    const id = uid();
    const path = makeShapePath(false);
    const shape = makeShape(id, [path]);
    const doc = makeDoc([shape]);

    const originalStroke = doc.scenes[0].timeline.layers[0].frames[0]
      .displayObjects[0];

    applyInkBottle(doc, 0, 0, 0, id, "#ff0000", 2);

    // The original shape path should still have no stroke
    const originalShape = originalStroke as ShapeDisplayObject;
    expect(originalShape.shape.paths[0].stroke).toBeUndefined();
  });
});
