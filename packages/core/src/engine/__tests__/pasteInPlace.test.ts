/**
 * Unit tests for pasteObjectsInPlace and related object clipboard functions.
 */

import { describe, it, expect } from "vitest";
import { pasteObjectsInPlace, pasteObjects, copyObjects } from "../objectClipboard.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal shape display object at a given position. */
function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: { id: `shape-${id}`, paths: [] },
    x,
    y,
  };
}

/**
 * Create a single-scene document with one layer whose frame 0 already contains
 * the given display objects.
 */
function makeDoc(objects: DisplayObject[]): FlashDocument {
  const frame = createFrame(0, {
    isKeyframe: true,
    isEmpty: objects.length === 0,
    displayObjects: objects,
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

/** Extract display objects from scene 0 / layer 0 / frame 0 of the doc. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  const kf = doc.scenes[0].timeline.layers[0].frames.find(
    (f) => f.isKeyframe && f.index === 0
  );
  return kf?.displayObjects ?? [];
}

// ---------------------------------------------------------------------------
// 1. pasteObjectsInPlace returns updated document with objects added
// ---------------------------------------------------------------------------

describe("pasteObjectsInPlace", () => {
  it("1. adds pasted objects to the target frame", () => {
    const existing = makeShape("orig", 100, 200);
    const doc = makeDoc([existing]);

    const clipboard = [makeShape("clip1", 50, 80)];
    const result = pasteObjectsInPlace(doc, 0, 0, 0, clipboard);

    const objects = getObjects(result);
    // Should have original + 1 pasted
    expect(objects).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // 2. Pasted objects have NEW IDs (no clash with originals)
  // --------------------------------------------------------------------------

  it("2. pasted objects are assigned new IDs different from originals", () => {
    const existing = makeShape("orig", 100, 200);
    const doc = makeDoc([existing]);

    const clipboard = [makeShape("orig", 50, 80)]; // same id intentionally
    const result = pasteObjectsInPlace(doc, 0, 0, 0, clipboard);

    const objects = getObjects(result);
    // Both objects should exist, but the pasted one must have a different id
    const ids = objects.map((o) => o.id);
    expect(ids).toHaveLength(2);
    // All IDs must be unique
    expect(new Set(ids).size).toBe(2);
    // The pasted object must NOT have the original id "orig" on the new copy
    // (the original "orig" stays; the pasted clone gets a fresh id)
    expect(ids.filter((id) => id === "orig")).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // 3. Pasted objects preserve exact x/y coordinates
  // --------------------------------------------------------------------------

  it("3. pasted objects keep exact x/y (no centering offset)", () => {
    const doc = makeDoc([]);

    const clipboard = [makeShape("c1", 123, 456)];
    const result = pasteObjectsInPlace(doc, 0, 0, 0, clipboard);

    const objects = getObjects(result);
    expect(objects).toHaveLength(1);
    const obj = objects[0] as ShapeDisplayObject;
    expect(obj.x).toBe(123);
    expect(obj.y).toBe(456);
  });

  // --------------------------------------------------------------------------
  // 4. Pasting 0 objects returns unchanged document
  // --------------------------------------------------------------------------

  it("4. pasting an empty array returns the unchanged document", () => {
    const doc = makeDoc([makeShape("s1", 10, 20)]);
    const result = pasteObjectsInPlace(doc, 0, 0, 0, []);
    // Should be identical reference (no change)
    expect(result).toBe(doc);
  });

  // --------------------------------------------------------------------------
  // 5. Regular pasteObjects DOES offset; pasteObjectsInPlace does NOT
  // --------------------------------------------------------------------------

  it("5. pasteObjects offsets to stage center; pasteObjectsInPlace does not", () => {
    const doc = makeDoc([]);
    // Stage is 550x400 by default → center = (275, 200)
    const stageCx = doc.properties.width / 2;   // 275
    const stageCy = doc.properties.height / 2;  // 200

    const clipboardObjects = [makeShape("c1", 0, 0)];

    // Regular paste: object should land at stage center
    const centered = pasteObjects(doc, 0, 0, 0, clipboardObjects, stageCx, stageCy);
    const centeredObjs = getObjects(centered);
    expect(centeredObjs).toHaveLength(1);
    const centeredObj = centeredObjs[0] as ShapeDisplayObject;
    expect(centeredObj.x).toBe(stageCx);
    expect(centeredObj.y).toBe(stageCy);

    // Paste in place: object should remain at (0, 0)
    const inPlace = pasteObjectsInPlace(doc, 0, 0, 0, clipboardObjects);
    const inPlaceObjs = getObjects(inPlace);
    expect(inPlaceObjs).toHaveLength(1);
    const inPlaceObj = inPlaceObjs[0] as ShapeDisplayObject;
    expect(inPlaceObj.x).toBe(0);
    expect(inPlaceObj.y).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 6. Multiple objects preserve relative positions
  // --------------------------------------------------------------------------

  it("6. multiple objects preserve their relative positions exactly", () => {
    const doc = makeDoc([]);

    const clipboard: DisplayObject[] = [
      makeShape("c1", 100, 200),
      makeShape("c2", 300, 400),
      makeShape("c3", 50, 50),
    ];

    const result = pasteObjectsInPlace(doc, 0, 0, 0, clipboard);
    const objects = getObjects(result) as ShapeDisplayObject[];

    expect(objects).toHaveLength(3);

    // Sort by original order (they are appended in order)
    const [a, b, c] = objects;

    // Positions should match exactly
    expect(a.x).toBe(100);
    expect(a.y).toBe(200);
    expect(b.x).toBe(300);
    expect(b.y).toBe(400);
    expect(c.x).toBe(50);
    expect(c.y).toBe(50);

    // Relative differences preserved
    expect(b.x - a.x).toBe(200);
    expect(b.y - a.y).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Extra: copyObjects round-trip
// ---------------------------------------------------------------------------

describe("copyObjects + pasteObjectsInPlace round-trip", () => {
  it("copies objects and pastes them in place with new IDs", () => {
    const obj1 = makeShape("s1", 10, 20);
    const obj2 = makeShape("s2", 30, 40);
    const doc = makeDoc([obj1, obj2]);

    const clipboard = copyObjects(doc, 0, 0, 0, ["s1", "s2"]);
    expect(clipboard.objects).toHaveLength(2);
    expect(clipboard.originalPositions).toHaveLength(2);
    expect(clipboard.originalPositions[0]).toEqual({ x: 10, y: 20 });
    expect(clipboard.originalPositions[1]).toEqual({ x: 30, y: 40 });

    // Paste in place into a fresh doc
    const emptyDoc = makeDoc([]);
    const result = pasteObjectsInPlace(emptyDoc, 0, 0, 0, clipboard.objects);
    const pasted = getObjects(result) as ShapeDisplayObject[];

    expect(pasted).toHaveLength(2);
    // IDs should be different from the originals
    expect(pasted[0].id).not.toBe("s1");
    expect(pasted[1].id).not.toBe("s2");
    // But positions should match
    expect(pasted[0].x).toBe(10);
    expect(pasted[0].y).toBe(20);
    expect(pasted[1].x).toBe(30);
    expect(pasted[1].y).toBe(40);
  });
});
