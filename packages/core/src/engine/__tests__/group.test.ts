/**
 * Tests for groupObjects / ungroupObjects engine operations.
 *
 * Verifies:
 * 1. groupObjects with 2 selected objects creates a group
 * 2. The group contains both objects
 * 3. ungroupObjects restores the individual objects
 * 4. Group bounds encompass both objects
 * 5. Immutability: original doc unchanged
 */

import { describe, it, expect } from "vitest";
import { groupObjects, ungroupObjects } from "../shapeOps.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, GroupObject, ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function uid(): string {
  return `grp-test-${++_seq}`;
}

function makeShape(id: string, x = 0, y = 0, w = 10, h = 10): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: {
      id: uid(),
      paths: [
        {
          start: { x, y },
          segments: [
            { type: "line", to: { x: x + w, y } },
            { type: "line", to: { x: x + w, y: y + h } },
            { type: "line", to: { x, y: y + h } },
          ],
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          closed: true,
        },
      ],
    },
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/**
 * Build a one-scene, one-layer document with the given display objects at frame 0.
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

/** Get the display objects of scene 0, layer 0, frame 0. */
function getObjects(doc: FlashDocument): readonly DisplayObject[] {
  return doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("groupObjects and ungroupObjects", () => {
  it("1. groupObjects with 2 selected objects creates a single group", () => {
    const id1 = uid();
    const id2 = uid();
    const doc = makeDoc([makeShape(id1, 0, 0), makeShape(id2, 20, 0)]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const objects = getObjects(result);

    // 2 objects become 1 group
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("group");
  });

  it("2. the group contains both original objects as children", () => {
    const id1 = uid();
    const id2 = uid();
    const doc = makeDoc([makeShape(id1, 0, 0), makeShape(id2, 20, 0)]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const group = getObjects(result)[0] as GroupObject;

    expect(group.children).toHaveLength(2);
    // Both original shapes should be present as children (by type)
    expect(group.children.every((c) => c.type === "shape")).toBe(true);
  });

  it("3. ungroupObjects restores the individual objects", () => {
    const id1 = uid();
    const id2 = uid();
    const doc = makeDoc([makeShape(id1, 0, 0), makeShape(id2, 20, 0)]);

    const grouped = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const group = getObjects(grouped)[0] as GroupObject;

    const ungrouped = ungroupObjects(grouped, 0, 0, 0, group.id);
    const objects = getObjects(ungrouped);

    // Ungrouping a 2-child group should give back 2 objects
    expect(objects).toHaveLength(2);
    expect(objects.every((o) => o.type === "shape")).toBe(true);
  });

  it("4. group bounds encompass both objects (position is min-x, min-y of objects)", () => {
    const id1 = uid();
    const id2 = uid();
    // Shape 1 at (10, 20), shape 2 at (50, 70)
    const s1 = makeShape(id1, 10, 20);
    const s2 = makeShape(id2, 50, 70);
    const doc = makeDoc([s1, s2]);

    const result = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const group = getObjects(result)[0] as GroupObject;

    // Group origin is (min-x, min-y) of the two objects = (10, 20)
    expect(group.x).toBe(10);
    expect(group.y).toBe(20);

    // Children positions are relative to group origin
    // s1 relative: (10 - 10, 20 - 20) = (0, 0)
    // s2 relative: (50 - 10, 70 - 20) = (40, 50)
    const children = group.children as ShapeDisplayObject[];
    const child1 = children.find((c) => c.x === 0 && c.y === 0);
    const child2 = children.find((c) => c.x === 40 && c.y === 50);
    expect(child1).toBeDefined();
    expect(child2).toBeDefined();

    // Group's extent covers both shapes:
    // Rightmost child is at relative x=40, shape width=10 → right edge at 50
    // Bottom child is at relative y=50, shape height=10 → bottom edge at 60
    // Absolute right = group.x(10) + 40 + 10 = 60 ≥ s2.x(50) + 10 = 60 ✓
    // Absolute bottom = group.y(20) + 50 + 10 = 80 ≥ s2.y(70) + 10 = 80 ✓
    const absoluteRight = group.x + (child2 as ShapeDisplayObject).x + 10;
    const absoluteBottom = group.y + (child2 as ShapeDisplayObject).y + 10;
    expect(absoluteRight).toBeGreaterThanOrEqual(s2.x + 10);
    expect(absoluteBottom).toBeGreaterThanOrEqual(s2.y + 10);
  });

  it("5. immutability: original doc is unchanged after groupObjects", () => {
    const id1 = uid();
    const id2 = uid();
    const doc = makeDoc([makeShape(id1, 0, 0), makeShape(id2, 20, 0)]);
    const originalObjects = getObjects(doc);

    groupObjects(doc, 0, 0, 0, [id1, id2]);

    // Original doc's objects reference must be unchanged
    expect(getObjects(doc)).toBe(originalObjects);
    expect(getObjects(doc)).toHaveLength(2);
  });

  it("5. immutability: original doc is unchanged after ungroupObjects", () => {
    const id1 = uid();
    const id2 = uid();
    const doc = makeDoc([makeShape(id1, 0, 0), makeShape(id2, 20, 0)]);
    const grouped = groupObjects(doc, 0, 0, 0, [id1, id2]);
    const groupedObjects = getObjects(grouped);
    const group = groupedObjects[0] as GroupObject;

    ungroupObjects(grouped, 0, 0, 0, group.id);

    // grouped doc's objects reference must be unchanged
    expect(getObjects(grouped)).toBe(groupedObjects);
    expect(getObjects(grouped)).toHaveLength(1);
  });

  it("ungroupObjects restores absolute positions (group at offset + children relative)", () => {
    const groupId = uid();
    // Build a doc that already has a group at (100, 200) with children at relative (5, 10)
    const childId = uid();
    const child = makeShape(childId, 5, 10); // relative position within group
    const group: GroupObject = {
      id: groupId,
      type: "group",
      x: 100,
      y: 200,
      children: [child],
    };
    const frame = createFrame(0, { isKeyframe: true, isEmpty: false, displayObjects: [group] });
    const layer = createLayer("Layer 1", "normal", { frames: [frame], frameCount: 1 });
    const docWithGroup = {
      ...createDocument(),
      scenes: [
        {
          ...createDocument().scenes[0],
          timeline: createTimeline({ layers: [layer] }),
        },
      ],
    };

    const result = ungroupObjects(docWithGroup, 0, 0, 0, groupId);
    const objects = getObjects(result) as ShapeDisplayObject[];

    // Absolute position = group origin + child relative
    expect(objects).toHaveLength(1);
    expect(objects[0].x).toBe(105); // 100 + 5
    expect(objects[0].y).toBe(210); // 200 + 10
  });

  it("groupObjects no-op for empty objectIds", () => {
    const id1 = uid();
    const doc = makeDoc([makeShape(id1)]);
    const result = groupObjects(doc, 0, 0, 0, []);
    expect(result).toBe(doc);
  });

  it("ungroupObjects no-op for non-group object", () => {
    const id1 = uid();
    const doc = makeDoc([makeShape(id1)]);
    const result = ungroupObjects(doc, 0, 0, 0, id1);
    expect(result).toBe(doc);
  });
});
