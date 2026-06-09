import { describe, it, expect } from "vitest";
import {
  moveDisplayObjectUp,
  moveDisplayObjectDown,
  moveDisplayObjectToTop,
  moveDisplayObjectToBottom,
} from "../display-order.js";
import type { Frame } from "../types.js";
import type { DisplayObject } from "../../engine/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShape(id: string): DisplayObject {
  return {
    type: "shape",
    id,
    shape: { paths: [] },
    x: 0,
    y: 0,
  };
}

function makeFrame(ids: string[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: ids.map(makeShape),
  };
}

function ids(frame: Frame): string[] {
  return frame.displayObjects.map(d => d.id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("moveDisplayObjectUp", () => {
  it("moves object up one position (higher index = higher z-order)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectUp(frame, "b");
    expect(ids(result)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op when object is already at the top (last index)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectUp(frame, "c");
    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("returns unchanged frame for unknown objectId", () => {
    const frame = makeFrame(["a", "b"]);
    const result = moveDisplayObjectUp(frame, "z");
    expect(result).toBe(frame);
  });
});

describe("moveDisplayObjectDown", () => {
  it("moves object down one position (lower index = lower z-order)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectDown(frame, "b");
    expect(ids(result)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when object is already at the bottom (index 0)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectDown(frame, "a");
    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("returns unchanged frame for unknown objectId", () => {
    const frame = makeFrame(["a", "b"]);
    const result = moveDisplayObjectDown(frame, "z");
    expect(result).toBe(frame);
  });
});

describe("moveDisplayObjectToTop", () => {
  it("moves object to last position (highest z-order)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToTop(frame, "a");
    expect(ids(result)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when object is already at top (last position)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToTop(frame, "c");
    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("returns unchanged frame for unknown objectId", () => {
    const frame = makeFrame(["a", "b"]);
    const result = moveDisplayObjectToTop(frame, "z");
    expect(result).toBe(frame);
  });

  it("three items: move middle one to top", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToTop(frame, "b");
    expect(ids(result)).toEqual(["a", "c", "b"]);
  });
});

describe("moveDisplayObjectToBottom", () => {
  it("moves object to first position (lowest z-order)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToBottom(frame, "c");
    expect(ids(result)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when object is already at bottom (index 0)", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const result = moveDisplayObjectToBottom(frame, "a");
    expect(ids(result)).toEqual(["a", "b", "c"]);
  });

  it("returns unchanged frame for unknown objectId", () => {
    const frame = makeFrame(["a", "b"]);
    const result = moveDisplayObjectToBottom(frame, "z");
    expect(result).toBe(frame);
  });
});

describe("immutability", () => {
  it("original frame is not mutated", () => {
    const frame = makeFrame(["a", "b", "c"]);
    const originalIds = [...ids(frame)];
    moveDisplayObjectUp(frame, "a");
    moveDisplayObjectDown(frame, "c");
    moveDisplayObjectToTop(frame, "a");
    moveDisplayObjectToBottom(frame, "c");
    expect(ids(frame)).toEqual(originalIds);
  });
});
