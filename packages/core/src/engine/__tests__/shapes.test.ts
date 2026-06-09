/**
 * Unit tests for engine/shapes.ts — addRectangle and addOval functions.
 */

import { describe, it, expect } from "vitest";
import { addRectangle, addOval } from "../shapes.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal doc with one scene, one layer, and one keyframe at index 0. */
function makeDoc(): FlashDocument {
  const frame = createFrame(0, { isKeyframe: true, isEmpty: true });
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

/** Extract display objects from scene 0 / layer 0 / frame 0. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  const kf = doc.scenes[0].timeline.layers[0].frames.find(
    (f) => f.isKeyframe && f.index === 0
  );
  return kf?.displayObjects ?? [];
}

// ---------------------------------------------------------------------------
// addRectangle tests
// ---------------------------------------------------------------------------

describe("addRectangle", () => {
  it("returns a doc with a shape in the correct frame", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 10, 20, 100, 50, "#ff0000", null);
    expect(getObjects(result)).toHaveLength(1);
  });

  it("shape has type 'shape'", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, "#ff0000", null);
    expect(getObjects(result)[0].type).toBe("shape");
  });

  it("shape path is non-empty", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, "#ff0000", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    expect(obj.shape.paths.length).toBeGreaterThan(0);
    expect(obj.shape.paths[0].segments.length).toBeGreaterThan(0);
  });

  it("shape with fill has fill color matching input", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, "#ff0000", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const path = obj.shape.paths[0];
    expect(path.fill).toBeDefined();
    expect(path.fill?.type).toBe("solid");
    if (path.fill?.type === "solid") {
      expect(path.fill.color.r).toBe(255);
      expect(path.fill.color.g).toBe(0);
      expect(path.fill.color.b).toBe(0);
    }
  });

  it("shape with stroke has stroke color matching input", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, null, "#0000ff", 2);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const path = obj.shape.paths[0];
    expect(path.stroke).toBeDefined();
    if (path.stroke) {
      expect(path.stroke.color.r).toBe(0);
      expect(path.stroke.color.g).toBe(0);
      expect(path.stroke.color.b).toBe(255);
      expect(path.stroke.width).toBe(2);
    }
  });

  it("null fill produces no fill on path", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, null, "#000000");
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    expect(obj.shape.paths[0].fill).toBeUndefined();
  });

  it("null stroke produces no stroke on path", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, "#ffffff", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    expect(obj.shape.paths[0].stroke).toBeUndefined();
  });

  it("immutability: original doc is unchanged", () => {
    const doc = makeDoc();
    const originalObjects = getObjects(doc);
    addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, "#ff0000", null);
    expect(getObjects(doc)).toHaveLength(0);
    expect(getObjects(doc)).toBe(originalObjects);
  });

  it("returns a new document, not the original", () => {
    const doc = makeDoc();
    const result = addRectangle(doc, 0, 0, 0, 0, 0, 100, 100, "#ff0000", null);
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// addOval tests
// ---------------------------------------------------------------------------

describe("addOval", () => {
  it("returns a doc with a shape in the correct frame", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 30, "#00ff00", null);
    expect(getObjects(result)).toHaveLength(1);
  });

  it("shape has type 'shape'", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#00ff00", null);
    expect(getObjects(result)[0].type).toBe("shape");
  });

  it("shape has multiple path points (approximated oval)", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#00ff00", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    // Oval is approximated with 8 segments
    expect(obj.shape.paths[0].segments.length).toBeGreaterThan(1);
  });

  it("oval path segments use curve type", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#00ff00", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const hasCurve = obj.shape.paths[0].segments.some((s) => s.type === "curve");
    expect(hasCurve).toBe(true);
  });

  it("oval with fill has fill color matching input", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#00ff00", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const path = obj.shape.paths[0];
    expect(path.fill).toBeDefined();
    if (path.fill?.type === "solid") {
      expect(path.fill.color.r).toBe(0);
      expect(path.fill.color.g).toBe(255);
      expect(path.fill.color.b).toBe(0);
    }
  });

  it("oval with stroke has stroke color matching input", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, null, "#ff00ff", 3);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const path = obj.shape.paths[0];
    expect(path.stroke).toBeDefined();
    if (path.stroke) {
      expect(path.stroke.color.r).toBe(255);
      expect(path.stroke.color.g).toBe(0);
      expect(path.stroke.color.b).toBe(255);
      expect(path.stroke.width).toBe(3);
    }
  });

  it("null fill produces no fill on oval path", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, null, "#000000");
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    expect(obj.shape.paths[0].fill).toBeUndefined();
  });

  it("null stroke produces no stroke on oval path", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#ffffff", null);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    expect(obj.shape.paths[0].stroke).toBeUndefined();
  });

  it("immutability: original doc is unchanged", () => {
    const doc = makeDoc();
    const originalObjects = getObjects(doc);
    addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#00ff00", null);
    expect(getObjects(doc)).toHaveLength(0);
    expect(getObjects(doc)).toBe(originalObjects);
  });

  it("returns a new document, not the original", () => {
    const doc = makeDoc();
    const result = addOval(doc, 0, 0, 0, 100, 100, 50, 50, "#00ff00", null);
    expect(result).not.toBe(doc);
  });
});
