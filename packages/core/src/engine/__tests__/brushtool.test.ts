/**
 * Tests for engine/brushtool.ts — addBrushStroke function.
 */

import { describe, it, expect } from "vitest";
import { addBrushStroke } from "../brushtool.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject, SolidFill } from "../types.js";
import type { BrushPoint } from "../brushtool.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal doc with one layer containing a single keyframe at index 0. */
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

// Two simple points for a horizontal brush stroke
const twoPoints: BrushPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

// ---------------------------------------------------------------------------
// addBrushStroke — basic creation
// ---------------------------------------------------------------------------

describe("addBrushStroke — basic creation", () => {
  it("creates a ShapeDisplayObject with 2 points", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#ff0000", 10);
    const objects = getObjects(result);
    expect(objects).toHaveLength(1);
  });

  it("created object has type 'shape'", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#ff0000", 10);
    const obj = getObjects(result)[0];
    expect(obj!.type).toBe("shape");
  });

  it("shape paths are non-empty", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#ff0000", 10);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    expect(obj.shape.paths.length).toBeGreaterThan(0);
  });

  it("path fill color matches input color (#ff0000)", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#ff0000", 10);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const fill = obj.shape.paths[0]?.fill as SolidFill | undefined;
    expect(fill?.type).toBe("solid");
    expect(fill?.color.r).toBe(255);
    expect(fill?.color.g).toBe(0);
    expect(fill?.color.b).toBe(0);
  });

  it("path fill color matches input color (#0000ff)", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#0000ff", 8);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const fill = obj.shape.paths[0]?.fill as SolidFill | undefined;
    expect(fill?.color.r).toBe(0);
    expect(fill?.color.g).toBe(0);
    expect(fill?.color.b).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// addBrushStroke — insufficient points
// ---------------------------------------------------------------------------

describe("addBrushStroke — insufficient points", () => {
  it("returns doc unchanged for 0 points", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, [], "#000000", 5);
    expect(result).toBe(doc);
  });

  it("returns doc unchanged for 1 point", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, [{ x: 10, y: 10 }], "#000000", 5);
    expect(result).toBe(doc);
  });

  it("does not add any objects for 0 points", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, [], "#000000", 5);
    expect(getObjects(result)).toHaveLength(0);
  });

  it("does not add any objects for 1 point", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, [{ x: 10, y: 10 }], "#000000", 5);
    expect(getObjects(result)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addBrushStroke — immutability
// ---------------------------------------------------------------------------

describe("addBrushStroke — immutability", () => {
  it("original doc is unchanged after adding a stroke", () => {
    const doc = makeDoc();
    const originalObjects = getObjects(doc);
    addBrushStroke(doc, 0, 0, 0, twoPoints, "#000000", 5);
    expect(getObjects(doc)).toHaveLength(originalObjects.length);
  });

  it("returns a new doc reference (not the same object)", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#000000", 5);
    expect(result).not.toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// addBrushStroke — multi-point stroke
// ---------------------------------------------------------------------------

describe("addBrushStroke — multi-point stroke", () => {
  it("works with more than 2 points", () => {
    const doc = makeDoc();
    const points: BrushPoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
      { x: 150, y: -20 },
    ];
    const result = addBrushStroke(doc, 0, 0, 0, points, "#00ff00", 12);
    const objects = getObjects(result);
    expect(objects).toHaveLength(1);
    const obj = objects[0] as ShapeDisplayObject;
    expect(obj.type).toBe("shape");
    expect(obj.shape.paths.length).toBeGreaterThan(0);
  });

  it("outline polygon has enough points (at least 4 vertices) for 2 input points", () => {
    const doc = makeDoc();
    const result = addBrushStroke(doc, 0, 0, 0, twoPoints, "#000000", 10);
    const obj = getObjects(result)[0] as ShapeDisplayObject;
    const path = obj.shape.paths[0]!;
    // start + segments = total polygon vertices
    const vertexCount = 1 + path.segments.length;
    expect(vertexCount).toBeGreaterThanOrEqual(4);
  });
});
