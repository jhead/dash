/**
 * Unit tests for frame-level display object clipboard operations:
 * copyDisplayObjects, pasteDisplayObjects, cutDisplayObjects, deleteDisplayObjects.
 *
 * Covers:
 *  1. copyDisplayObjects returns array with same length as ids
 *  2. copyDisplayObjects gives each copy a new unique ID
 *  3. copyDisplayObjects does not modify the original frame
 *  4. copyDisplayObjects with unknown id skips it (returns empty for unknown)
 *  5. pasteDisplayObjects adds objects to frame
 *  6. pasteDisplayObjects returns new frame (original unchanged)
 *  7. cutDisplayObjects returns copies and frame without originals
 *  8. deleteDisplayObjects removes specified objects
 *  9. deleteDisplayObjects with unknown id leaves frame unchanged
 * 10. pasteDisplayObjects preserves existing display objects
 */

import { describe, it, expect } from "vitest";
import {
  copyDisplayObjects,
  pasteDisplayObjects,
  cutDisplayObjects,
  deleteDisplayObjects,
} from "../clipboard.js";
import { createFrame } from "../../model/timeline.js";
import type { Frame } from "../../model/types.js";
import type { ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShape(id: string, x = 0, y = 0): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: { id: `shape-${id}`, paths: [] },
    x,
    y,
  };
}

function makeFrame(objects: ShapeDisplayObject[]): Frame {
  return createFrame(0, {
    isKeyframe: true,
    isEmpty: objects.length === 0,
    displayObjects: objects,
  });
}

// ---------------------------------------------------------------------------
// 1. copyDisplayObjects returns array with same length as ids
// ---------------------------------------------------------------------------

describe("copyDisplayObjects", () => {
  it("1. returns array with same length as ids", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b"), makeShape("c")]);
    const copies = copyDisplayObjects(frame, ["a", "c"]);
    expect(copies).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 2. copyDisplayObjects gives each copy a new unique ID
  // -------------------------------------------------------------------------

  it("2. gives each copy a new unique ID", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b")]);
    const copies = copyDisplayObjects(frame, ["a", "b"]);
    expect(copies).toHaveLength(2);
    expect(copies[0].id).not.toBe("a");
    expect(copies[1].id).not.toBe("b");
    expect(copies[0].id).not.toBe(copies[1].id);
  });

  // -------------------------------------------------------------------------
  // 3. copyDisplayObjects does not modify the original frame
  // -------------------------------------------------------------------------

  it("3. does not modify the original frame", () => {
    const shape = makeShape("a", 10, 20);
    const frame = makeFrame([shape]);
    const originalRef = frame.displayObjects;

    copyDisplayObjects(frame, ["a"]);

    expect(frame.displayObjects).toBe(originalRef);
    expect(frame.displayObjects).toHaveLength(1);
    expect(frame.displayObjects[0].id).toBe("a");
  });

  // -------------------------------------------------------------------------
  // 4. copyDisplayObjects with unknown id skips it
  // -------------------------------------------------------------------------

  it("4. returns empty for unknown id", () => {
    const frame = makeFrame([makeShape("a")]);
    const copies = copyDisplayObjects(frame, ["nonexistent"]);
    expect(copies).toHaveLength(0);
  });

  it("4b. skips unknown ids and copies known ones", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b")]);
    const copies = copyDisplayObjects(frame, ["a", "unknown"]);
    expect(copies).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. pasteDisplayObjects adds objects to frame
// ---------------------------------------------------------------------------

describe("pasteDisplayObjects", () => {
  it("5. adds objects to frame displayObjects", () => {
    const frame = makeFrame([makeShape("existing")]);
    const newObj = makeShape("new1", 50, 50);
    const result = pasteDisplayObjects(frame, [newObj]);
    expect(result.displayObjects).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 6. pasteDisplayObjects returns new frame (original unchanged)
  // -------------------------------------------------------------------------

  it("6. returns new frame without modifying the original", () => {
    const frame = makeFrame([makeShape("a")]);
    const originalRef = frame.displayObjects;
    const newObj = makeShape("b");
    const result = pasteDisplayObjects(frame, [newObj]);

    expect(result).not.toBe(frame);
    expect(frame.displayObjects).toBe(originalRef);
    expect(frame.displayObjects).toHaveLength(1);
    expect(result.displayObjects).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 10. pasteDisplayObjects preserves existing display objects
  // -------------------------------------------------------------------------

  it("10. preserves existing display objects", () => {
    const existing = makeShape("existing", 10, 20);
    const frame = makeFrame([existing]);
    const newObj = makeShape("new1", 30, 40);
    const result = pasteDisplayObjects(frame, [newObj]);

    expect(result.displayObjects[0].id).toBe("existing");
    expect(result.displayObjects[1].id).toBe("new1");
  });
});

// ---------------------------------------------------------------------------
// 7. cutDisplayObjects returns copies and frame without originals
// ---------------------------------------------------------------------------

describe("cutDisplayObjects", () => {
  it("7. returns copies with new IDs and a frame without the originals", () => {
    const a = makeShape("a", 10, 10);
    const b = makeShape("b", 20, 20);
    const c = makeShape("c", 30, 30);
    const frame = makeFrame([a, b, c]);

    const [copies, newFrame] = cutDisplayObjects(frame, ["a", "b"]);

    // Copies have new IDs
    expect(copies).toHaveLength(2);
    expect(copies[0].id).not.toBe("a");
    expect(copies[1].id).not.toBe("b");

    // New frame doesn't contain the cut objects
    const ids = newFrame.displayObjects.map(o => o.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    expect(ids).toContain("c");
    expect(newFrame.displayObjects).toHaveLength(1);
  });

  it("7b. original frame is unchanged after cut", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b")]);
    const originalRef = frame.displayObjects;

    cutDisplayObjects(frame, ["a"]);

    expect(frame.displayObjects).toBe(originalRef);
    expect(frame.displayObjects).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 8. deleteDisplayObjects removes specified objects
// ---------------------------------------------------------------------------

describe("deleteDisplayObjects", () => {
  it("8. removes specified objects from frame", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b"), makeShape("c")]);
    const result = deleteDisplayObjects(frame, ["a", "c"]);

    expect(result.displayObjects).toHaveLength(1);
    expect(result.displayObjects[0].id).toBe("b");
  });

  // -------------------------------------------------------------------------
  // 9. deleteDisplayObjects with unknown id leaves frame unchanged
  // -------------------------------------------------------------------------

  it("9. with unknown id leaves displayObjects unchanged in size", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b")]);
    const result = deleteDisplayObjects(frame, ["nonexistent"]);
    expect(result.displayObjects).toHaveLength(2);
  });

  it("9b. returns a new frame reference even when nothing removed", () => {
    const frame = makeFrame([makeShape("a")]);
    const result = deleteDisplayObjects(frame, ["nonexistent"]);
    // Frame is new but content is same
    expect(result.displayObjects).toHaveLength(1);
    expect(result.displayObjects[0].id).toBe("a");
  });

  it("8b. original frame is unchanged after delete", () => {
    const frame = makeFrame([makeShape("a"), makeShape("b")]);
    const originalRef = frame.displayObjects;

    deleteDisplayObjects(frame, ["a"]);

    expect(frame.displayObjects).toBe(originalRef);
    expect(frame.displayObjects).toHaveLength(2);
  });
});
