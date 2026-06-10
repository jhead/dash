/**
 * Tests for shapeOps: mergeShapes (document-level) and breakApart.
 */

import { describe, it, expect } from "vitest";
import { mergeShapes, breakApart } from "../shapeOps.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import { createLibrary, createSymbol, addLibraryItem } from "../../model/library.js";
import type { FlashDocument, Frame, Layer, Scene } from "../../model/types.js";
import type {
  DisplayObject,
  DrawingObject,
  ShapeDisplayObject,
  ShapePath,
  SymbolInstance,
} from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _idSeq = 0;
function uid(): string {
  return `test-id-${++_idSeq}`;
}

function makeSolidFill(r = 255, g = 0, b = 0, a = 255) {
  return { type: "solid" as const, color: { r, g, b, a } };
}

function makeShapePath(x = 0, y = 0): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x: x + 10, y } },
      { type: "line", to: { x: x + 10, y: y + 10 } },
      { type: "line", to: { x, y: y + 10 } },
    ],
    fill: makeSolidFill(),
    closed: true,
  };
}

function makeShape(id: string, paths: ShapePath[], x = 0, y = 0): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: { id: uid(), paths },
    x,
    y,
  };
}

function makeDrawingObject(id: string, paths: ShapePath[], x = 0, y = 0): DrawingObject {
  return {
    type: "drawing-object",
    id,
    shape: { id: uid(), paths },
    x,
    y,
  };
}

function makeInstance(id: string, symbolId: string, x = 0, y = 0): SymbolInstance {
  return {
    type: "instance",
    id,
    symbolId,
    x,
    y,
  };
}

/**
 * Build a one-scene, one-layer document with the given display objects
 * placed at frame 0 (keyframe).
 */
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

/** Helper to get the display objects of the first frame of scene 0, layer 0. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  return doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
}

// ---------------------------------------------------------------------------
// mergeShapes tests
// ---------------------------------------------------------------------------

describe("mergeShapes — document level", () => {
  it("1. merging 2 shapes returns a document with 1 shape instead of 2", () => {
    const id1 = uid();
    const id2 = uid();
    const s1 = makeShape(id1, [makeShapePath(0, 0)]);
    const s2 = makeShape(id2, [makeShapePath(20, 0)]);
    const doc = makeDoc([s1, s2]);

    const result = mergeShapes(doc, 0, 0, 0, [id1, id2]);
    const objects = getObjects(result);

    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("shape");
  });

  it("2. merged shape has paths from both shapes", () => {
    const id1 = uid();
    const id2 = uid();
    const path1 = makeShapePath(0, 0);
    const path2 = makeShapePath(20, 0);
    const s1 = makeShape(id1, [path1]);
    const s2 = makeShape(id2, [path2]);
    const doc = makeDoc([s1, s2]);

    const result = mergeShapes(doc, 0, 0, 0, [id1, id2]);
    const merged = getObjects(result)[0] as ShapeDisplayObject;

    expect(merged.shape.paths).toHaveLength(2);
    expect(merged.shape.paths).toContain(path1);
    expect(merged.shape.paths).toContain(path2);
  });

  it("3. merged shape uses the first shape's fill style (x/y position)", () => {
    const id1 = uid();
    const id2 = uid();
    const s1 = makeShape(id1, [makeShapePath()], 10, 20);
    const s2 = makeShape(id2, [makeShapePath()], 30, 40);
    const doc = makeDoc([s1, s2]);

    const result = mergeShapes(doc, 0, 0, 0, [id1, id2]);
    const merged = getObjects(result)[0] as ShapeDisplayObject;

    // Uses first shape's position
    expect(merged.x).toBe(10);
    expect(merged.y).toBe(20);
  });

  it("4. mergeShapes with empty shapeIds returns document unchanged", () => {
    const id1 = uid();
    const s1 = makeShape(id1, [makeShapePath()]);
    const doc = makeDoc([s1]);

    const result = mergeShapes(doc, 0, 0, 0, []);

    expect(result).toBe(doc);
  });

  it("5. mergeShapes with non-existent IDs returns document unchanged", () => {
    const id1 = uid();
    const s1 = makeShape(id1, [makeShapePath()]);
    const doc = makeDoc([s1]);

    const result = mergeShapes(doc, 0, 0, 0, ["nonexistent-id"]);

    expect(result).toBe(doc);
  });

  it("5b. mergeShapes returns unchanged doc when one ID does not exist on the frame", () => {
    const id1 = uid();
    const s1 = makeShape(id1, [makeShapePath()]);
    const doc = makeDoc([s1]);

    // id1 exists but "missing" does not — mismatch in count means no-op
    const result = mergeShapes(doc, 0, 0, 0, [id1, "missing"]);

    expect(result).toBe(doc);
  });

  it("5c. mergeShapes with a non-shape object in shapeIds returns document unchanged", () => {
    const shapeId = uid();
    const instanceId = uid();
    const s1 = makeShape(shapeId, [makeShapePath()]);
    const inst = makeInstance(instanceId, "sym-1");
    const doc = makeDoc([s1, inst]);

    // Trying to merge a shape + a non-shape
    const result = mergeShapes(doc, 0, 0, 0, [shapeId, instanceId]);

    expect(result).toBe(doc);
  });

  it("merged shape gets a new id different from the originals", () => {
    const id1 = uid();
    const id2 = uid();
    const s1 = makeShape(id1, [makeShapePath()]);
    const s2 = makeShape(id2, [makeShapePath()]);
    const doc = makeDoc([s1, s2]);

    const result = mergeShapes(doc, 0, 0, 0, [id1, id2]);
    const merged = getObjects(result)[0];

    expect(merged.id).not.toBe(id1);
    expect(merged.id).not.toBe(id2);
  });

  it("non-selected shapes remain in the frame after merge", () => {
    const id1 = uid();
    const id2 = uid();
    const id3 = uid();
    const s1 = makeShape(id1, [makeShapePath()]);
    const s2 = makeShape(id2, [makeShapePath()]);
    const s3 = makeShape(id3, [makeShapePath()]);
    const doc = makeDoc([s1, s2, s3]);

    // Only merge id1 and id2; id3 should survive
    const result = mergeShapes(doc, 0, 0, 0, [id1, id2]);
    const objects = getObjects(result);

    expect(objects).toHaveLength(2);
    expect(objects.some((o) => o.id === id3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// breakApart tests
// ---------------------------------------------------------------------------

describe("breakApart", () => {
  /**
   * Build a document that contains a SymbolInstance on scene 0 / layer 0 / frame 0,
   * and adds the referenced symbol to the library with the given display objects
   * in its first keyframe.
   */
  function makeDocWithInstance(
    instanceId: string,
    instanceX: number,
    instanceY: number,
    symbolChildren: DisplayObject[]
  ): FlashDocument {
    // Create the symbol
    const symbol = createSymbol("TestSymbol", "movieclip");
    const symbolFrame = createFrame(0, {
      isKeyframe: true,
      isEmpty: symbolChildren.length === 0,
      displayObjects: symbolChildren,
    });
    const symbolLayer = createLayer("Layer 1", "normal", {
      frames: [symbolFrame],
      frameCount: 1,
    });
    const symbolWithTimeline = {
      ...symbol,
      timeline: { layers: [symbolLayer] },
    };

    // Create the instance on the main timeline
    const instance = makeInstance(instanceId, symbol.id, instanceX, instanceY);
    const frame = createFrame(0, {
      isKeyframe: true,
      isEmpty: false,
      displayObjects: [instance],
    });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });

    const baseDoc = createDocument();
    // addLibraryItem takes (Library, LibraryItem) — update doc.library manually
    const updatedLibrary = addLibraryItem(baseDoc.library, symbolWithTimeline);
    return {
      ...baseDoc,
      library: updatedLibrary,
      scenes: [
        {
          ...baseDoc.scenes[0],
          timeline: createTimeline({ layers: [layer] }),
        },
      ],
    };
  }

  it("6. breakApart on SymbolInstance returns shapes from symbol's first keyframe", () => {
    const childId = uid();
    const instanceId = uid();
    const childShape = makeShape(childId, [makeShapePath()]);
    const doc = makeDocWithInstance(instanceId, 0, 0, [childShape]);

    const result = breakApart(doc, 0, 0, 0, instanceId);
    const objects = getObjects(result);

    // The instance is gone; one extracted shape appears
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("shape");
  });

  it("7. breakApart extracted shapes are offset by the instance position", () => {
    const childId = uid();
    const instanceId = uid();
    const childShape = makeShape(childId, [makeShapePath()], 5, 10);
    const doc = makeDocWithInstance(instanceId, 100, 200, [childShape]);

    const result = breakApart(doc, 0, 0, 0, instanceId);
    const extracted = getObjects(result)[0] as ShapeDisplayObject;

    expect(extracted.x).toBe(105); // 5 + 100
    expect(extracted.y).toBe(210); // 10 + 200
  });

  it("8. breakApart removes the SymbolInstance from the frame", () => {
    const childId = uid();
    const instanceId = uid();
    const childShape = makeShape(childId, [makeShapePath()]);
    const doc = makeDocWithInstance(instanceId, 0, 0, [childShape]);

    const result = breakApart(doc, 0, 0, 0, instanceId);
    const objects = getObjects(result);

    // The SymbolInstance should no longer be present
    expect(objects.some((o) => o.id === instanceId)).toBe(false);
    expect(objects.some((o) => o.type === "instance")).toBe(false);
  });

  it("9. breakApart on a ShapeObject returns document unchanged (no-op)", () => {
    const shapeId = uid();
    const s = makeShape(shapeId, [makeShapePath()]);
    const doc = makeDoc([s]);

    const result = breakApart(doc, 0, 0, 0, shapeId);

    expect(result).toBe(doc);
  });

  it("10. breakApart on non-existent objectId returns document unchanged", () => {
    const shapeId = uid();
    const s = makeShape(shapeId, [makeShapePath()]);
    const doc = makeDoc([s]);

    const result = breakApart(doc, 0, 0, 0, "does-not-exist");

    expect(result).toBe(doc);
  });

  it("extracted objects get new IDs different from the symbol's children IDs", () => {
    const childId = uid();
    const instanceId = uid();
    const childShape = makeShape(childId, [makeShapePath()]);
    const doc = makeDocWithInstance(instanceId, 0, 0, [childShape]);

    const result = breakApart(doc, 0, 0, 0, instanceId);
    const extracted = getObjects(result)[0];

    expect(extracted.id).not.toBe(childId);
    expect(extracted.id).not.toBe(instanceId);
  });

  it("breakApart on instance with multiple children extracts all of them", () => {
    const childId1 = uid();
    const childId2 = uid();
    const instanceId = uid();
    const c1 = makeShape(childId1, [makeShapePath(0, 0)]);
    const c2 = makeShape(childId2, [makeShapePath(50, 0)]);
    const doc = makeDocWithInstance(instanceId, 10, 20, [c1, c2]);

    const result = breakApart(doc, 0, 0, 0, instanceId);
    const objects = getObjects(result);

    expect(objects).toHaveLength(2);
    expect(objects.every((o) => o.type === "shape")).toBe(true);
  });

  it("breakApart returns unchanged doc for invalid sceneIndex", () => {
    const instanceId = uid();
    const doc = makeDocWithInstance(instanceId, 0, 0, [makeShape(uid(), [makeShapePath()])]);

    const result = breakApart(doc, 999, 0, 0, instanceId);

    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// breakApart DrawingObject tests
// ---------------------------------------------------------------------------

describe("breakApart DrawingObject", () => {
  it("converts a drawing-object to a plain shape", () => {
    const drawId = uid();
    const drawObj = makeDrawingObject(drawId, [makeShapePath()], 10, 20);
    const doc = makeDoc([drawObj]);

    const result = breakApart(doc, 0, 0, 0, drawId);
    const objects = getObjects(result);

    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("shape");
  });

  it("preserves the id, x, y and shape when converting drawing-object", () => {
    const drawId = uid();
    const path = makeShapePath(5, 5);
    const drawObj = makeDrawingObject(drawId, [path], 10, 20);
    const doc = makeDoc([drawObj]);

    const result = breakApart(doc, 0, 0, 0, drawId);
    const converted = getObjects(result)[0] as ShapeDisplayObject;

    expect(converted.id).toBe(drawId);
    expect(converted.x).toBe(10);
    expect(converted.y).toBe(20);
    expect(converted.shape.paths).toContain(path);
  });

  it("returns a different document object (not same reference)", () => {
    const drawId = uid();
    const drawObj = makeDrawingObject(drawId, [makeShapePath()]);
    const doc = makeDoc([drawObj]);

    const result = breakApart(doc, 0, 0, 0, drawId);

    expect(result).not.toBe(doc);
  });

  it("non-selected objects are unchanged after drawing-object break-apart", () => {
    const drawId = uid();
    const shapeId = uid();
    const drawObj = makeDrawingObject(drawId, [makeShapePath()]);
    const shape = makeShape(shapeId, [makeShapePath(50, 0)]);
    const doc = makeDoc([drawObj, shape]);

    const result = breakApart(doc, 0, 0, 0, drawId);
    const objects = getObjects(result);

    expect(objects).toHaveLength(2);
    const remaining = objects.find((o) => o.id === shapeId);
    expect(remaining).toBeDefined();
    expect(remaining?.type).toBe("shape");
  });
});
