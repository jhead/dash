/**
 * Unit tests for shape hint model operations.
 *
 * Shape hints are labeled point pairs ('a'–'z') placed on shape-tween
 * keyframes to guide morphing interpolation (authoring-time only, not in SWF).
 */

import { describe, it, expect } from "vitest";
import {
  createLayer,
  createFrame,
  createTimeline,
  setShapeTween,
  addShapeHint,
  updateShapeHint,
  removeShapeHint,
  clearShapeHints,
} from "../index.js";
import type { Timeline } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal 5-frame timeline with a single layer, shape tween at frame 0. */
function makeShapeTweenTimeline(): { tl: Timeline; layerId: string } {
  const layer = createLayer("Shape Layer", "normal", {
    frames: [
      createFrame(0, { isKeyframe: true, tweenType: "shape" }),
      createFrame(1),
      createFrame(2),
      createFrame(3),
      { ...createFrame(4), isKeyframe: true, tweenType: "none" as const, isEmpty: false },
    ],
    frameCount: 5,
  });
  const tl = createTimeline({ layers: [layer] });
  return { tl, layerId: layer.id };
}

// ---------------------------------------------------------------------------
// addShapeHint
// ---------------------------------------------------------------------------

describe("addShapeHint", () => {
  it("adds the first hint ('a') to a shape-tween keyframe", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    const updated = addShapeHint(tl, layerId, 0, 100, 150);
    const kf = updated.layers[0]!.frames.find((f) => f.index === 0);
    expect(kf?.shapeHints).toHaveLength(1);
    expect(kf?.shapeHints?.[0]).toEqual({ id: "a", x: 100, y: 150 });
  });

  it("auto-increments hint id: a, b, c, ...", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    let updated = addShapeHint(tl, layerId, 0, 10, 10);
    updated = addShapeHint(updated, layerId, 0, 20, 20);
    updated = addShapeHint(updated, layerId, 0, 30, 30);
    const kf = updated.layers[0]!.frames.find((f) => f.index === 0);
    const ids = kf?.shapeHints?.map((h) => h.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("does not exceed 26 hints (z is the last)", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    let updated = tl;
    for (let i = 0; i < 30; i++) {
      updated = addShapeHint(updated, layerId, 0, i, i);
    }
    const kf = updated.layers[0]!.frames.find((f) => f.index === 0);
    expect(kf?.shapeHints).toHaveLength(26);
  });

  it("does not add hints when layer is not found", () => {
    const { tl } = makeShapeTweenTimeline();
    const result = addShapeHint(tl, "no-such-layer", 0, 0, 0);
    // No hints should have been added to any layer
    const hints = result.layers[0]!.frames[0]?.shapeHints ?? [];
    expect(hints).toHaveLength(0);
  });

  it("returns unchanged timeline when layer id is invalid", () => {
    const { tl } = makeShapeTweenTimeline();
    const before = JSON.stringify(tl);
    const result = addShapeHint(tl, "nonexistent-layer-id", 0, 10, 10);
    expect(JSON.stringify(result)).toBe(before);
  });

  it("places hint at the given x/y coordinates", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    const updated = addShapeHint(tl, layerId, 0, 275, 200);
    const hint = updated.layers[0]!.frames[0]?.shapeHints?.[0];
    expect(hint?.x).toBe(275);
    expect(hint?.y).toBe(200);
  });

  it("defaults to (0, 0) when x/y are omitted", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    const updated = addShapeHint(tl, layerId, 0);
    const hint = updated.layers[0]!.frames[0]?.shapeHints?.[0];
    expect(hint?.x).toBe(0);
    expect(hint?.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateShapeHint
// ---------------------------------------------------------------------------

describe("updateShapeHint", () => {
  it("moves an existing hint to new coordinates", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    let updated = addShapeHint(tl, layerId, 0, 50, 50);
    updated = updateShapeHint(updated, layerId, 0, "a", 200, 300);
    const hint = updated.layers[0]!.frames[0]?.shapeHints?.[0];
    expect(hint).toEqual({ id: "a", x: 200, y: 300 });
  });

  it("returns unchanged timeline when hint id not found", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    const withHint = addShapeHint(tl, layerId, 0, 50, 50);
    const result = updateShapeHint(withHint, layerId, 0, "z", 100, 100);
    // 'z' doesn't exist; should be a no-op
    const hint = result.layers[0]!.frames[0]?.shapeHints?.[0];
    expect(hint).toEqual({ id: "a", x: 50, y: 50 });
  });

  it("updates only the specified hint, leaving others unchanged", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    let updated = addShapeHint(tl, layerId, 0, 10, 10);
    updated = addShapeHint(updated, layerId, 0, 20, 20);
    updated = updateShapeHint(updated, layerId, 0, "a", 99, 99);
    const hints = updated.layers[0]!.frames[0]?.shapeHints ?? [];
    expect(hints[0]).toEqual({ id: "a", x: 99, y: 99 });
    expect(hints[1]).toEqual({ id: "b", x: 20, y: 20 });
  });
});

// ---------------------------------------------------------------------------
// removeShapeHint
// ---------------------------------------------------------------------------

describe("removeShapeHint", () => {
  it("removes the specified hint by id", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    let updated = addShapeHint(tl, layerId, 0, 10, 10);
    updated = addShapeHint(updated, layerId, 0, 20, 20);
    updated = removeShapeHint(updated, layerId, 0, "a");
    const hints = updated.layers[0]!.frames[0]?.shapeHints ?? [];
    expect(hints).toHaveLength(1);
    expect(hints[0]?.id).toBe("b");
  });

  it("returns unchanged timeline when hint id not found", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    const withHint = addShapeHint(tl, layerId, 0, 10, 10);
    const result = removeShapeHint(withHint, layerId, 0, "z");
    expect(result.layers[0]!.frames[0]?.shapeHints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clearShapeHints
// ---------------------------------------------------------------------------

describe("clearShapeHints", () => {
  it("removes all hints from the keyframe", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    let updated = addShapeHint(tl, layerId, 0, 10, 10);
    updated = addShapeHint(updated, layerId, 0, 20, 20);
    updated = addShapeHint(updated, layerId, 0, 30, 30);
    updated = clearShapeHints(updated, layerId, 0);
    const hints = updated.layers[0]!.frames[0]?.shapeHints ?? [];
    expect(hints).toHaveLength(0);
  });

  it("is idempotent when there are no hints", () => {
    const { tl, layerId } = makeShapeTweenTimeline();
    const result = clearShapeHints(tl, layerId, 0);
    const hints = result.layers[0]!.frames[0]?.shapeHints ?? [];
    expect(hints).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: setShapeTween + addShapeHint round-trip
// ---------------------------------------------------------------------------

describe("shape tween + hints integration", () => {
  it("can add hints after setShapeTween", () => {
    const layer = createLayer("L", "normal", {
      frames: [createFrame(0), createFrame(4, { isKeyframe: true })],
      frameCount: 5,
    });
    let tl = createTimeline({ layers: [layer] });
    tl = setShapeTween(tl, layer.id, 0);
    tl = addShapeHint(tl, layer.id, 0, 100, 100);
    tl = addShapeHint(tl, layer.id, 0, 200, 200);
    const kf = tl.layers[0]!.frames.find((f) => f.index === 0);
    expect(kf?.tweenType).toBe("shape");
    expect(kf?.shapeHints).toHaveLength(2);
    expect(kf?.shapeHints?.[0]?.id).toBe("a");
    expect(kf?.shapeHints?.[1]?.id).toBe("b");
  });
});
