/**
 * Tests for groupObjects and ungroupObjects in shapeOps.ts.
 */

import { describe, it, expect } from "vitest";
import { groupObjects, ungroupObjects } from "../shapeOps.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, GroupObject, ShapeDisplayObject, ShapePath } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _idSeq = 0;
function uid(): string {
  return `test-grp-${++_idSeq}`;
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

function makeShape(id: string, x = 0, y = 0): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: { id: uid(), paths: [makeShapePath()] },
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

/** Helper to get the display objects of scene 0, layer 0, frame 0. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  return doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
}

// ---------------------------------------------------------------------------
// groupObjects tests
// ---------------------------------------------------------------------------

describe("groupObjects", () => {
  it("1. groupObjects reduces display object count by N-1 (N objects → 1 group)", () => {
    const id1 = uid();
    const id2 = uid();
    const id3 = uid();
    const doc = makeDoc([makeShape(id1), makeShape(id2), makeShape(id3)]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2, id3]);
    const objects = getObjects(result);

    // 3 objects → 1 group; net reduction = 3 - 1 = 2 (so count = 3 - 3 + 1 = 1)
    expect(objects).toHaveLength(1);
  });

  it("2. groupObjects creates a GroupObject with N children", () => {
    const id1 = uid();
    const id2 = uid();
    const id3 = uid();
    const doc = makeDoc([makeShape(id1), makeShape(id2), makeShape(id3)]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2, id3]);
    const objects = getObjects(result);

    expect(objects[0].type).toBe("group");
    const group = objects[0] as GroupObject;
    expect(group.children).toHaveLength(3);
  });

  it("3. groupObjects group position is the min-x, min-y of selected objects", () => {
    const id1 = uid();
    const id2 = uid();
    const id3 = uid();
    // Place objects at various positions
    const s1 = makeShape(id1, 30, 50);
    const s2 = makeShape(id2, 10, 80);
    const s3 = makeShape(id3, 20, 40);
    const doc = makeDoc([s1, s2, s3]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2, id3]);
    const group = getObjects(result)[0] as GroupObject;

    expect(group.x).toBe(10); // min of 30, 10, 20
    expect(group.y).toBe(40); // min of 50, 80, 40
  });

  it("4. groupObjects children positions are relative to group origin", () => {
    const id1 = uid();
    const id2 = uid();
    const s1 = makeShape(id1, 30, 50);
    const s2 = makeShape(id2, 10, 20);
    const doc = makeDoc([s1, s2]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const group = getObjects(result)[0] as GroupObject;

    // groupX = min(30, 10) = 10, groupY = min(50, 20) = 20
    // s1 relative: (30 - 10, 50 - 20) = (20, 30)
    // s2 relative: (10 - 10, 20 - 20) = (0, 0)
    const child1 = group.children.find((c) => (c as ShapeDisplayObject).x === 20);
    const child2 = group.children.find((c) => (c as ShapeDisplayObject).x === 0);

    expect(child1).toBeDefined();
    expect((child1 as ShapeDisplayObject).y).toBe(30);
    expect(child2).toBeDefined();
    expect((child2 as ShapeDisplayObject).y).toBe(0);
  });

  it("7. groupObjects with empty objectIds returns unchanged doc", () => {
    const id1 = uid();
    const doc = makeDoc([makeShape(id1)]);

    const result = groupObjects(doc, 0, 0, 0, []);

    expect(result).toBe(doc);
  });

  it("groupObjects with non-existent IDs returns unchanged doc", () => {
    const id1 = uid();
    const doc = makeDoc([makeShape(id1)]);

    const result = groupObjects(doc, 0, 0, 0, ["nonexistent"]);

    expect(result).toBe(doc);
  });

  it("groupObjects preserves non-selected objects on the frame", () => {
    const id1 = uid();
    const id2 = uid();
    const id3 = uid();
    const doc = makeDoc([makeShape(id1), makeShape(id2), makeShape(id3)]);

    // Only group id1 and id2; id3 should remain outside the group
    const result = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const objects = getObjects(result);

    // 1 group + 1 ungrouped shape
    expect(objects).toHaveLength(2);
    expect(objects.some((o) => o.id === id3)).toBe(true);
  });

  it("groupObjects assigns a new id to the group", () => {
    const id1 = uid();
    const id2 = uid();
    const doc = makeDoc([makeShape(id1), makeShape(id2)]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const group = getObjects(result)[0] as GroupObject;

    expect(group.id).not.toBe(id1);
    expect(group.id).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// ungroupObjects tests
// ---------------------------------------------------------------------------

describe("ungroupObjects", () => {
  /** Helper to create a doc that already has a GroupObject */
  function makeDocWithGroup(
    groupId: string,
    groupX: number,
    groupY: number,
    childIds: string[],
    childOffsets: Array<{ x: number; y: number }>
  ): FlashDocument {
    const children: DisplayObject[] = childIds.map((id, i) =>
      makeShape(id, childOffsets[i].x, childOffsets[i].y)
    );
    const group: GroupObject = {
      id: groupId,
      type: "group",
      x: groupX,
      y: groupY,
      children,
    };
    return makeDoc([group]);
  }

  it("5. ungroupObjects on a GroupObject increases count by children.length - 1", () => {
    const groupId = uid();
    const childId1 = uid();
    const childId2 = uid();
    const childId3 = uid();
    const doc = makeDocWithGroup(
      groupId, 10, 20,
      [childId1, childId2, childId3],
      [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }]
    );

    const result = ungroupObjects(doc, 0, 0, 0, groupId);
    const objects = getObjects(result);

    // Was 1 group with 3 children; now should be 3 objects (1 + 3 - 1 = 3)
    expect(objects).toHaveLength(3);
  });

  it("6. ungroupObjects restores absolute positions", () => {
    const groupId = uid();
    const childId1 = uid();
    const childId2 = uid();
    // Group at (100, 200); children relative to group
    const doc = makeDocWithGroup(
      groupId, 100, 200,
      [childId1, childId2],
      [{ x: 5, y: 10 }, { x: 15, y: 25 }]
    );

    const result = ungroupObjects(doc, 0, 0, 0, groupId);
    const objects = getObjects(result);

    // child1 absolute: (5 + 100, 10 + 200) = (105, 210)
    // child2 absolute: (15 + 100, 25 + 200) = (115, 225)
    const objs = objects as ShapeDisplayObject[];
    const sorted = [...objs].sort((a, b) => a.x - b.x);
    expect(sorted[0].x).toBe(105);
    expect(sorted[0].y).toBe(210);
    expect(sorted[1].x).toBe(115);
    expect(sorted[1].y).toBe(225);
  });

  it("8. ungroupObjects on non-group object returns unchanged doc", () => {
    const shapeId = uid();
    const doc = makeDoc([makeShape(shapeId)]);

    const result = ungroupObjects(doc, 0, 0, 0, shapeId);

    expect(result).toBe(doc);
  });

  it("ungroupObjects with non-existent groupId returns unchanged doc", () => {
    const shapeId = uid();
    const doc = makeDoc([makeShape(shapeId)]);

    const result = ungroupObjects(doc, 0, 0, 0, "does-not-exist");

    expect(result).toBe(doc);
  });

  it("ungroupObjects removes the group from the frame", () => {
    const groupId = uid();
    const childId = uid();
    const doc = makeDocWithGroup(groupId, 0, 0, [childId], [{ x: 0, y: 0 }]);

    const result = ungroupObjects(doc, 0, 0, 0, groupId);
    const objects = getObjects(result);

    expect(objects.some((o) => o.id === groupId)).toBe(false);
    expect(objects.some((o) => o.type === "group")).toBe(false);
  });

  it("ungroupObjects extracted children get new IDs", () => {
    const groupId = uid();
    const childId1 = uid();
    const childId2 = uid();
    const doc = makeDocWithGroup(
      groupId, 0, 0,
      [childId1, childId2],
      [{ x: 0, y: 0 }, { x: 5, y: 5 }]
    );

    const result = ungroupObjects(doc, 0, 0, 0, groupId);
    const objects = getObjects(result);

    // Original child IDs should not appear (new IDs generated)
    expect(objects.some((o) => o.id === childId1)).toBe(false);
    expect(objects.some((o) => o.id === childId2)).toBe(false);
    expect(objects.some((o) => o.id === groupId)).toBe(false);
  });

  it("ungroupObjects returns unchanged doc for invalid sceneIndex", () => {
    const groupId = uid();
    const childId = uid();
    const doc = makeDocWithGroup(groupId, 0, 0, [childId], [{ x: 0, y: 0 }]);

    const result = ungroupObjects(doc, 999, 0, 0, groupId);

    expect(result).toBe(doc);
  });
});
