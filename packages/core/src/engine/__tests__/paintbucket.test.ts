/**
 * Tests for applyPaintBucket — apply a fill to all paths of a ShapeDisplayObject.
 */

import { describe, it, expect } from "vitest";
import { applyPaintBucket } from "../paintbucket.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject, ShapePath, SolidFill } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _idSeq = 0;
function uid(): string {
  return `paintbucket-id-${++_idSeq}`;
}

function makeShapePath(withFill = false): ShapePath {
  const base: ShapePath = {
    start: { x: 0, y: 0 },
    segments: [
      { type: "line", to: { x: 10, y: 0 } },
      { type: "line", to: { x: 10, y: 10 } },
      { type: "line", to: { x: 0, y: 10 } },
    ],
    closed: true,
  };
  if (withFill) {
    return {
      ...base,
      fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
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

describe("applyPaintBucket", () => {
  it("1. apply fill to a shape with no existing fill — all paths get the fill color", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(false), makeShapePath(false)]);
    const doc = makeDoc([shape]);

    const result = applyPaintBucket(doc, 0, 0, 0, id, "#ff0000");
    const updated = getShape(result, id);

    for (const path of updated.shape.paths) {
      expect(path.fill).toBeDefined();
    }
  });

  it("2. replace existing fill color on a shape — all paths get the new fill", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(true), makeShapePath(true)]);
    const doc = makeDoc([shape]);

    const result = applyPaintBucket(doc, 0, 0, 0, id, "#00ff00");
    const updated = getShape(result, id);

    for (const path of updated.shape.paths) {
      const fill = path.fill as SolidFill;
      expect(fill.color.g).toBe(255);
      expect(fill.color.r).toBe(0);
    }
  });

  it("3. fillColor matches what was passed", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(false)]);
    const doc = makeDoc([shape]);

    const result = applyPaintBucket(doc, 0, 0, 0, id, "#0000ff");
    const updated = getShape(result, id);
    const fill = updated.shape.paths[0].fill as SolidFill;

    expect(fill.color.r).toBe(0);
    expect(fill.color.g).toBe(0);
    expect(fill.color.b).toBe(255);
  });

  it("4. shape not found — doc returned unchanged", () => {
    const id = uid();
    const shape = makeShape(id, [makeShapePath(false)]);
    const doc = makeDoc([shape]);

    const result = applyPaintBucket(doc, 0, 0, 0, "nonexistent-id", "#ff0000");
    expect(result).toBe(doc);
  });

  it("5. immutability — original doc is not mutated", () => {
    const id = uid();
    const path = makeShapePath(false);
    const shape = makeShape(id, [path]);
    const doc = makeDoc([shape]);

    const originalObj = doc.scenes[0].timeline.layers[0].frames[0].displayObjects[0];

    applyPaintBucket(doc, 0, 0, 0, id, "#ff0000");

    // The original shape path should still have no fill
    const originalShape = originalObj as ShapeDisplayObject;
    expect(originalShape.shape.paths[0].fill).toBeUndefined();
  });
});
