/**
 * Unit tests for object clipboard operations:
 * copyObjects, pasteObjects, pasteObjectsInPlace.
 *
 * Covers:
 *  1. copyObjects returns clipboard containing the selected objects
 *  2. pasteObjects into a different frame adds objects to that frame
 *  3. Pasted objects have new IDs (different from originals)
 *  4. Pasted objects have the same visual properties as originals
 *  5. pasteObjectsInPlace preserves the original x/y coordinates
 *  6. pasteObjects (not in-place) offsets pasted objects
 *  7. Original frame is not modified after paste (immutability)
 *  8. Pasting into a different layer works correctly
 *  9. copyObjects with empty array returns empty clipboard
 * 10. Pasting empty clipboard returns doc unchanged
 */

import { describe, it, expect } from "vitest";
import {
  copyObjects,
  pasteObjects,
  pasteObjectsInPlace,
} from "../objectClipboard.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal shape display object at a given position. */
function makeShape(
  id: string,
  x: number,
  y: number,
  fill?: { r: number; g: number; b: number; a: number }
): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: {
      id: `shape-${id}`,
      paths: fill
        ? [
            {
              start: { x: 0, y: 0 },
              segments: [],
              fill: { type: "solid", color: fill },
              closed: true,
            },
          ]
        : [],
    },
    x,
    y,
  };
}

/**
 * Build a document with two layers. Layer 0 has keyframes at indices listed in
 * layer0KeyframeIndices, each populated with layer0Objects on keyframe 0 and
 * empty otherwise. Layer 1 has a single keyframe at index 0.
 */
function makeMultiLayerDoc(
  layer0Objects: DisplayObject[],
  layer0ExtraKeyframes: number[] = [],
  layer1Objects: DisplayObject[] = []
): FlashDocument {
  // Layer 0: keyframe at 0 with objects + any extra keyframes
  const kf0 = createFrame(0, {
    isKeyframe: true,
    isEmpty: layer0Objects.length === 0,
    displayObjects: layer0Objects,
  });

  const extraFrames = layer0ExtraKeyframes.map((idx) =>
    createFrame(idx, {
      isKeyframe: true,
      isEmpty: true,
      displayObjects: [],
    })
  );

  const maxIdx0 = Math.max(0, ...layer0ExtraKeyframes);
  const layer0 = createLayer("Layer 0", "normal", {
    frames: [kf0, ...extraFrames],
    frameCount: maxIdx0 + 1,
  });

  // Layer 1: single keyframe at 0
  const kf1 = createFrame(0, {
    isKeyframe: true,
    isEmpty: layer1Objects.length === 0,
    displayObjects: layer1Objects,
  });
  const layer1 = createLayer("Layer 1", "normal", {
    frames: [kf1],
    frameCount: 1,
  });

  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers: [layer0, layer1] }),
      },
    ],
  };
}

/** Return display objects from scene 0, given layer index, at the keyframe
 *  that governs frameIndex (the last keyframe at or before frameIndex). */
function getObjects(
  doc: FlashDocument,
  layerIndex = 0,
  frameIndex = 0
): readonly DisplayObject[] {
  const layer = doc.scenes[0].timeline.layers[layerIndex];
  if (!layer) return [];
  let kf = layer.frames.find((f) => f.isKeyframe && f.index === 0) ?? null;
  for (const f of layer.frames) {
    if (f.isKeyframe && f.index <= frameIndex) kf = f;
  }
  return kf?.displayObjects ?? [];
}

// ---------------------------------------------------------------------------
// 1. copyObjects returns clipboard containing the selected objects
// ---------------------------------------------------------------------------

describe("copyObjects", () => {
  it("1. returns clipboard with the selected objects", () => {
    const obj1 = makeShape("s1", 10, 20);
    const obj2 = makeShape("s2", 30, 40);
    const doc = makeMultiLayerDoc([obj1, obj2]);

    const cb = copyObjects(doc, 0, 0, 0, ["s1", "s2"]);

    expect(cb.objects).toHaveLength(2);
    expect(cb.objects[0].id).toBe("s1");
    expect(cb.objects[1].id).toBe("s2");
    expect(cb.originalPositions).toHaveLength(2);
    expect(cb.originalPositions[0]).toEqual({ x: 10, y: 20 });
    expect(cb.originalPositions[1]).toEqual({ x: 30, y: 40 });
  });

  // -------------------------------------------------------------------------
  // 9. copyObjects with empty array returns empty clipboard
  // -------------------------------------------------------------------------

  it("9. returns empty clipboard when given an empty id list", () => {
    const doc = makeMultiLayerDoc([makeShape("s1", 0, 0)]);

    const cb = copyObjects(doc, 0, 0, 0, []);

    expect(cb.objects).toHaveLength(0);
    expect(cb.originalPositions).toHaveLength(0);
  });

  it("9b. returns empty clipboard when ids match nothing", () => {
    const doc = makeMultiLayerDoc([makeShape("s1", 0, 0)]);

    const cb = copyObjects(doc, 0, 0, 0, ["nonexistent"]);

    expect(cb.objects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. pasteObjects into a different frame adds objects to that frame
// ---------------------------------------------------------------------------

describe("pasteObjects — different frame target", () => {
  it("2. adds objects to a different keyframe than the source", () => {
    const obj = makeShape("s1", 50, 50);
    // Layer 0 has keyframe at 0 (with obj) and an extra keyframe at 5
    const doc = makeMultiLayerDoc([obj], [5]);

    const cb = copyObjects(doc, 0, 0, 0, ["s1"]);

    // Paste into frame 5 of layer 0
    const stageCx = doc.properties.width / 2;
    const stageCy = doc.properties.height / 2;
    const result = pasteObjects(doc, 0, 0, 5, cb.objects, stageCx, stageCy);

    // Frame 0 should be unchanged (still 1 object)
    expect(getObjects(result, 0, 0)).toHaveLength(1);
    // Frame 5 should now contain the pasted object
    expect(getObjects(result, 0, 5)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Pasted objects have new IDs
// ---------------------------------------------------------------------------

describe("new IDs after paste", () => {
  it("3. pasted objects receive IDs different from the originals", () => {
    const obj = makeShape("original-id", 100, 100);
    const doc = makeMultiLayerDoc([obj]);

    const cb = copyObjects(doc, 0, 0, 0, ["original-id"]);
    const stageCx = doc.properties.width / 2;
    const stageCy = doc.properties.height / 2;
    const result = pasteObjects(doc, 0, 0, 0, cb.objects, stageCx, stageCy);

    const objects = getObjects(result, 0, 0);
    // Two objects: original + pasted clone
    expect(objects).toHaveLength(2);
    const ids = objects.map((o) => o.id);
    // All IDs must be unique
    expect(new Set(ids).size).toBe(2);
    // The original id still exists exactly once
    expect(ids.filter((id) => id === "original-id")).toHaveLength(1);
    // The new clone must have a different id
    const cloneId = ids.find((id) => id !== "original-id");
    expect(cloneId).toBeDefined();
    expect(cloneId).not.toBe("original-id");
  });

  it("3b. pasteObjectsInPlace also assigns new IDs", () => {
    const obj = makeShape("orig", 10, 20);
    const doc = makeMultiLayerDoc([obj]);

    const cb = copyObjects(doc, 0, 0, 0, ["orig"]);
    const result = pasteObjectsInPlace(doc, 0, 0, 0, cb.objects);

    const objects = getObjects(result, 0, 0);
    expect(objects).toHaveLength(2);
    const ids = objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Pasted objects have the same visual properties as originals
// ---------------------------------------------------------------------------

describe("visual properties preserved after paste", () => {
  it("4. pasted shape retains type, shape paths, and fill", () => {
    const fillColor = { r: 255, g: 0, b: 0, a: 255 };
    const obj = makeShape("s1", 10, 20, fillColor);
    const doc = makeMultiLayerDoc([obj]);

    const cb = copyObjects(doc, 0, 0, 0, ["s1"]);

    // Use pasteObjectsInPlace so we can check position too
    const result = pasteObjectsInPlace(doc, 0, 0, 0, cb.objects);
    const objects = getObjects(result, 0, 0);
    // Find the pasted clone (the one with a different id)
    const clone = objects.find((o) => o.id !== "s1") as ShapeDisplayObject;

    expect(clone).toBeDefined();
    expect(clone.type).toBe("shape");
    // Shape paths should be equivalent
    expect(clone.shape.paths).toHaveLength(obj.shape.paths.length);
    if (obj.shape.paths.length > 0 && obj.shape.paths[0].fill?.type === "solid") {
      const cloneFill = clone.shape.paths[0].fill;
      expect(cloneFill).toBeDefined();
      expect(cloneFill?.type).toBe("solid");
      if (cloneFill?.type === "solid") {
        expect(cloneFill.color).toEqual(fillColor);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. pasteObjectsInPlace preserves original x/y coordinates
// ---------------------------------------------------------------------------

describe("pasteObjectsInPlace — coordinate preservation", () => {
  it("5. preserves exact x/y of each pasted object", () => {
    const doc = makeMultiLayerDoc([]);
    const clipboard: DisplayObject[] = [
      makeShape("c1", 123, 456),
      makeShape("c2", 789, 0),
    ];

    const result = pasteObjectsInPlace(doc, 0, 0, 0, clipboard);
    const objects = getObjects(result, 0, 0) as ShapeDisplayObject[];

    expect(objects).toHaveLength(2);
    expect(objects[0].x).toBe(123);
    expect(objects[0].y).toBe(456);
    expect(objects[1].x).toBe(789);
    expect(objects[1].y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. pasteObjects (not in-place) offsets pasted objects
// ---------------------------------------------------------------------------

describe("pasteObjects — centering offset", () => {
  it("6. offsets a single object to land at the stage center", () => {
    const doc = makeMultiLayerDoc([]);
    const stageCx = doc.properties.width / 2;  // 275
    const stageCy = doc.properties.height / 2; // 200

    const clipboard: DisplayObject[] = [makeShape("c1", 0, 0)];
    const result = pasteObjects(doc, 0, 0, 0, clipboard, stageCx, stageCy);

    const objects = getObjects(result, 0, 0) as ShapeDisplayObject[];
    expect(objects).toHaveLength(1);
    // A single-object group: its center IS its position, so it moves to stageCx/Cy
    expect(objects[0].x).toBe(stageCx);
    expect(objects[0].y).toBe(stageCy);
  });

  it("6b. offsets a group of objects so the group center aligns with stage center", () => {
    const doc = makeMultiLayerDoc([]);
    const stageCx = doc.properties.width / 2;  // 275
    const stageCy = doc.properties.height / 2; // 200

    // Two objects symmetrically placed at (0,0) and (100,100) → group center (50,50)
    const clipboard: DisplayObject[] = [
      makeShape("c1", 0, 0),
      makeShape("c2", 100, 100),
    ];

    const result = pasteObjects(doc, 0, 0, 0, clipboard, stageCx, stageCy);
    const objects = getObjects(result, 0, 0) as ShapeDisplayObject[];

    expect(objects).toHaveLength(2);
    // Group center should now be at (stageCx, stageCy)
    const pastedCx = (objects[0].x + objects[1].x) / 2;
    const pastedCy = (objects[0].y + objects[1].y) / 2;
    expect(pastedCx).toBeCloseTo(stageCx, 5);
    expect(pastedCy).toBeCloseTo(stageCy, 5);
    // Objects should have moved equally (relative offset preserved)
    expect(objects[1].x - objects[0].x).toBeCloseTo(100, 5);
    expect(objects[1].y - objects[0].y).toBeCloseTo(100, 5);
  });
});

// ---------------------------------------------------------------------------
// 7. Original frame is not modified after paste (immutability)
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("7. original document is unchanged after pasteObjects", () => {
    const obj = makeShape("s1", 10, 20);
    const doc = makeMultiLayerDoc([obj]);

    const originalObjects = getObjects(doc, 0, 0);
    const originalLength = originalObjects.length;
    const originalRef = doc.scenes[0].timeline.layers[0].frames[0].displayObjects;

    const cb = copyObjects(doc, 0, 0, 0, ["s1"]);
    const stageCx = doc.properties.width / 2;
    const stageCy = doc.properties.height / 2;
    pasteObjects(doc, 0, 0, 0, cb.objects, stageCx, stageCy);

    // Original doc structure must be unmodified
    const afterObjects = getObjects(doc, 0, 0);
    expect(afterObjects).toHaveLength(originalLength);
    expect(doc.scenes[0].timeline.layers[0].frames[0].displayObjects).toBe(originalRef);
  });

  it("7b. original document is unchanged after pasteObjectsInPlace", () => {
    const obj = makeShape("s1", 10, 20);
    const doc = makeMultiLayerDoc([obj]);

    const originalRef = doc.scenes[0].timeline.layers[0].frames[0].displayObjects;

    const cb = copyObjects(doc, 0, 0, 0, ["s1"]);
    pasteObjectsInPlace(doc, 0, 0, 0, cb.objects);

    expect(doc.scenes[0].timeline.layers[0].frames[0].displayObjects).toBe(originalRef);
    expect(getObjects(doc, 0, 0)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Pasting into a different layer works correctly
// ---------------------------------------------------------------------------

describe("pasting into a different layer", () => {
  it("8. pasteObjectsInPlace adds objects to a different layer without affecting the source layer", () => {
    const obj = makeShape("s1", 50, 60);
    // Layer 0 has obj; Layer 1 starts empty
    const doc = makeMultiLayerDoc([obj], [], []);

    const cb = copyObjects(doc, 0, 0, 0, ["s1"]);

    // Paste into layer 1 (index 1)
    const result = pasteObjectsInPlace(doc, 0, 1, 0, cb.objects);

    // Layer 0 should still have only the original object
    expect(getObjects(result, 0, 0)).toHaveLength(1);
    expect(getObjects(result, 0, 0)[0].id).toBe("s1");

    // Layer 1 should now contain the pasted clone
    const layer1Objects = getObjects(result, 1, 0) as ShapeDisplayObject[];
    expect(layer1Objects).toHaveLength(1);
    expect(layer1Objects[0].id).not.toBe("s1");
    // Position preserved
    expect(layer1Objects[0].x).toBe(50);
    expect(layer1Objects[0].y).toBe(60);
  });

  it("8b. pasteObjects into a different layer applies centering offset correctly", () => {
    const obj = makeShape("s1", 0, 0);
    const doc = makeMultiLayerDoc([obj], [], []);

    const cb = copyObjects(doc, 0, 0, 0, ["s1"]);

    const stageCx = doc.properties.width / 2;
    const stageCy = doc.properties.height / 2;

    // Paste into layer 1
    const result = pasteObjects(doc, 0, 1, 0, cb.objects, stageCx, stageCy);

    const layer1Objects = getObjects(result, 1, 0) as ShapeDisplayObject[];
    expect(layer1Objects).toHaveLength(1);
    expect(layer1Objects[0].x).toBe(stageCx);
    expect(layer1Objects[0].y).toBe(stageCy);

    // Layer 0 unchanged
    expect(getObjects(result, 0, 0)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Pasting empty clipboard returns doc unchanged
// ---------------------------------------------------------------------------

describe("pasting empty clipboard", () => {
  it("10. pasteObjects with empty objects array returns the same doc reference", () => {
    const doc = makeMultiLayerDoc([makeShape("s1", 10, 20)]);

    const result = pasteObjects(doc, 0, 0, 0, [], 275, 200);
    expect(result).toBe(doc);
  });

  it("10b. pasteObjectsInPlace with empty objects array returns the same doc reference", () => {
    const doc = makeMultiLayerDoc([makeShape("s1", 10, 20)]);

    const result = pasteObjectsInPlace(doc, 0, 0, 0, []);
    expect(result).toBe(doc);
  });

  it("10c. copyObjects empty + pasteObjects returns doc unchanged", () => {
    const doc = makeMultiLayerDoc([makeShape("s1", 10, 20)]);

    const cb = copyObjects(doc, 0, 0, 0, []);
    expect(cb.objects).toHaveLength(0);

    const stageCx = doc.properties.width / 2;
    const stageCy = doc.properties.height / 2;
    const result = pasteObjects(doc, 0, 0, 0, cb.objects, stageCx, stageCy);
    expect(result).toBe(doc);
  });
});
