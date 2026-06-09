/**
 * Unit tests for display-order.ts — Frame-level z-order manipulation.
 *
 * displayObjects array is back-to-front: index 0 is at the back, last index
 * is at the front. Functions:
 *   moveDisplayObjectToTop    — bringToFront equivalent
 *   moveDisplayObjectToBottom — sendToBack equivalent
 *   moveDisplayObjectUp       — bringForward equivalent
 *   moveDisplayObjectDown     — sendBackward equivalent
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  moveDisplayObjectToTop,
  moveDisplayObjectToBottom,
  moveDisplayObjectUp,
  moveDisplayObjectDown,
} from "../display-order.js";
import { createFrame } from "../timeline.js";
import type { Frame } from "../types.js";
import type { ShapeDisplayObject } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObj(id: string): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: { id: `shape-${id}`, paths: [] },
  };
}

function makeFrame(ids: string[]): Frame {
  return createFrame(0, {
    isKeyframe: true,
    isEmpty: ids.length === 0,
    displayObjects: ids.map(makeObj),
  });
}

function getIds(frame: Frame): string[] {
  return frame.displayObjects.map((o) => o.id);
}

// ---------------------------------------------------------------------------
// 1. bringToFront (moveDisplayObjectToTop) moves last-placed to front
// ---------------------------------------------------------------------------

describe("moveDisplayObjectToTop (bringToFront)", () => {
  it("1. moves a back object to the front (last index)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToTop(frame, "a");
    expect(getIds(result)).toEqual(["b", "c", "a"]);
  });

  it("2. bringToFront on already-front object is a no-op (returns same length)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToTop(frame, "c");
    // Still 3 objects and c is still last
    expect(result.displayObjects.length).toBe(3);
    expect(getIds(result)).toEqual(["a", "b", "c"]);
  });

  it("3. bringToFront does not mutate the original frame", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const originalIds = getIds(frame).slice();
    moveDisplayObjectToTop(frame, "a");
    expect(getIds(frame)).toEqual(originalIds);
  });
});

// ---------------------------------------------------------------------------
// 4. sendToBack (moveDisplayObjectToBottom) moves to index 0
// ---------------------------------------------------------------------------

describe("moveDisplayObjectToBottom (sendToBack)", () => {
  it("4. moves a front object to the back (index 0)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToBottom(frame, "c");
    expect(getIds(result)).toEqual(["c", "a", "b"]);
  });

  it("5. sendToBack on already-back object is a no-op", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToBottom(frame, "a");
    expect(result.displayObjects.length).toBe(3);
    expect(getIds(result)).toEqual(["a", "b", "c"]);
  });

  it("6. sendToBack does not mutate the original frame", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const originalIds = getIds(frame).slice();
    moveDisplayObjectToBottom(frame, "c");
    expect(getIds(frame)).toEqual(originalIds);
  });
});

// ---------------------------------------------------------------------------
// 7. bringForward (moveDisplayObjectUp) swaps with next
// ---------------------------------------------------------------------------

describe("moveDisplayObjectUp (bringForward)", () => {
  it("7. swaps object with the one above it", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectUp(frame, "a");
    expect(getIds(result)).toEqual(["b", "a", "c"]);
  });

  it("8. bringForward on front object is a no-op", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectUp(frame, "c");
    expect(result.displayObjects.length).toBe(3);
    expect(getIds(result)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// 9. sendBackward (moveDisplayObjectDown) swaps with prev
// ---------------------------------------------------------------------------

describe("moveDisplayObjectDown (sendBackward)", () => {
  it("9. swaps object with the one below it", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectDown(frame, "c");
    expect(getIds(result)).toEqual(["a", "c", "b"]);
  });

  it("10. sendBackward on back object is a no-op", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectDown(frame, "a");
    expect(result.displayObjects.length).toBe(3);
    expect(getIds(result)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// 11. Unknown id returns frame unchanged
// ---------------------------------------------------------------------------

describe("unknown id handling", () => {
  it("11. bringToFront with unknown id returns unchanged frame", () => {
    const frame = makeFrame(["a", "b"]);
    const result = moveDisplayObjectToTop(frame, "x");
    expect(getIds(result)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// 12. Operations maintain array length
// ---------------------------------------------------------------------------

describe("array length preservation", () => {
  it("12. all operations preserve displayObjects length", () => {
    const frame = makeFrame(["a", "b", "c", "d"]);
    expect(moveDisplayObjectToTop(frame, "a").displayObjects.length).toBe(4);
    expect(moveDisplayObjectToBottom(frame, "d").displayObjects.length).toBe(4);
    expect(moveDisplayObjectUp(frame, "b").displayObjects.length).toBe(4);
    expect(moveDisplayObjectDown(frame, "c").displayObjects.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 13. Sequential bringForward reaches front
// ---------------------------------------------------------------------------

describe("sequential operations", () => {
  it("13. sequential bringForward reaches front", () => {
    let frame = makeFrame(["a", "b", "c", "d"]);
    frame = moveDisplayObjectUp(frame, "a");
    frame = moveDisplayObjectUp(frame, "a");
    frame = moveDisplayObjectUp(frame, "a");
    expect(getIds(frame)[3]).toBe("a");
  });

  it("14. sequential sendBackward reaches back", () => {
    let frame = makeFrame(["a", "b", "c", "d"]);
    frame = moveDisplayObjectDown(frame, "d");
    frame = moveDisplayObjectDown(frame, "d");
    frame = moveDisplayObjectDown(frame, "d");
    expect(getIds(frame)[0]).toBe("d");
  });
});

// ---------------------------------------------------------------------------
// 15. Single-item frame: all ops are no-ops
// ---------------------------------------------------------------------------

describe("single-item frame edge cases", () => {
  it("15. single-item frame: all operations are no-ops", () => {
    const frame = makeFrame(["only"]);
    expect(getIds(moveDisplayObjectToTop(frame, "only"))).toEqual(["only"]);
    expect(getIds(moveDisplayObjectToBottom(frame, "only"))).toEqual(["only"]);
    expect(getIds(moveDisplayObjectUp(frame, "only"))).toEqual(["only"]);
    expect(getIds(moveDisplayObjectDown(frame, "only"))).toEqual(["only"]);
  });
});
