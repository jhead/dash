/**
 * Unit tests for zorder.ts — bringToFront, sendToBack, bringForward, sendBackward.
 */

import { describe, it, expect } from "vitest";
import { bringToFront, sendToBack, bringForward, sendBackward } from "../zorder.js";
import { createDocument } from "../../model/document.js";
import { createFrame, createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";
import type { DisplayObject, ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal ShapeDisplayObject with only id, x, y set.
 */
function makeObj(id: string): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: { id: `shape-${id}`, paths: [] },
  };
}

/**
 * Create a single-scene document with one layer whose frame 0 contains
 * the given display objects.
 */
function makeDoc(objects: DisplayObject[]): FlashDocument {
  const frame = createFrame(0, {
    isKeyframe: true,
    isEmpty: objects.length === 0,
    displayObjects: objects,
  });
  const layer = createLayer("Layer 1", "normal", {
    frames: [frame],
    frameCount: 1,
  });
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

/** Get the ids of objects in order. */
function getIds(doc: FlashDocument): string[] {
  return getObjects(doc).map((o) => o.id);
}

// ---------------------------------------------------------------------------
// bringToFront
// ---------------------------------------------------------------------------

describe("bringToFront", () => {
  it("moves object to last position", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = bringToFront(doc, 0, 0, 0, "a");
    expect(getIds(result)).toEqual(["b", "c", "a"]);
  });

  it("moves middle object to last position", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = bringToFront(doc, 0, 0, 0, "b");
    expect(getIds(result)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op when already at front", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = bringToFront(doc, 0, 0, 0, "c");
    expect(result).toBe(doc);
  });

  it("returns doc unchanged for unknown objectId", () => {
    const a = makeObj("a");
    const doc = makeDoc([a]);

    const result = bringToFront(doc, 0, 0, 0, "unknown");
    expect(result).toBe(doc);
  });

  it("is immutable (returns new doc)", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const doc = makeDoc([a, b]);

    const result = bringToFront(doc, 0, 0, 0, "a");
    expect(result).not.toBe(doc);
    // Original unchanged
    expect(getIds(doc)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// sendToBack
// ---------------------------------------------------------------------------

describe("sendToBack", () => {
  it("moves object to first position", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = sendToBack(doc, 0, 0, 0, "c");
    expect(getIds(result)).toEqual(["c", "a", "b"]);
  });

  it("moves middle object to first position", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = sendToBack(doc, 0, 0, 0, "b");
    expect(getIds(result)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when already at back", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = sendToBack(doc, 0, 0, 0, "a");
    expect(result).toBe(doc);
  });

  it("returns doc unchanged for unknown objectId", () => {
    const a = makeObj("a");
    const doc = makeDoc([a]);

    const result = sendToBack(doc, 0, 0, 0, "unknown");
    expect(result).toBe(doc);
  });

  it("is immutable (returns new doc)", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const doc = makeDoc([a, b]);

    const result = sendToBack(doc, 0, 0, 0, "b");
    expect(result).not.toBe(doc);
    // Original unchanged
    expect(getIds(doc)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// bringForward
// ---------------------------------------------------------------------------

describe("bringForward", () => {
  it("swaps with next element", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = bringForward(doc, 0, 0, 0, "a");
    expect(getIds(result)).toEqual(["b", "a", "c"]);
  });

  it("swaps middle element forward", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = bringForward(doc, 0, 0, 0, "b");
    expect(getIds(result)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op when already at front", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = bringForward(doc, 0, 0, 0, "c");
    expect(result).toBe(doc);
  });

  it("returns doc unchanged for unknown objectId", () => {
    const a = makeObj("a");
    const doc = makeDoc([a]);

    const result = bringForward(doc, 0, 0, 0, "unknown");
    expect(result).toBe(doc);
  });

  it("is immutable (returns new doc)", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const doc = makeDoc([a, b]);

    const result = bringForward(doc, 0, 0, 0, "a");
    expect(result).not.toBe(doc);
    // Original unchanged
    expect(getIds(doc)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// sendBackward
// ---------------------------------------------------------------------------

describe("sendBackward", () => {
  it("swaps with previous element", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = sendBackward(doc, 0, 0, 0, "c");
    expect(getIds(result)).toEqual(["a", "c", "b"]);
  });

  it("swaps middle element backward", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = sendBackward(doc, 0, 0, 0, "b");
    expect(getIds(result)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when already at back", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const c = makeObj("c");
    const doc = makeDoc([a, b, c]);

    const result = sendBackward(doc, 0, 0, 0, "a");
    expect(result).toBe(doc);
  });

  it("returns doc unchanged for unknown objectId", () => {
    const a = makeObj("a");
    const doc = makeDoc([a]);

    const result = sendBackward(doc, 0, 0, 0, "unknown");
    expect(result).toBe(doc);
  });

  it("is immutable (returns new doc)", () => {
    const a = makeObj("a");
    const b = makeObj("b");
    const doc = makeDoc([a, b]);

    const result = sendBackward(doc, 0, 0, 0, "b");
    expect(result).not.toBe(doc);
    // Original unchanged
    expect(getIds(doc)).toEqual(["a", "b"]);
  });
});
