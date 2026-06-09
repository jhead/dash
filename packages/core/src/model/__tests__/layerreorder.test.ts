import { describe, it, expect } from "vitest";
import {
  moveLayerUp,
  moveLayerDown,
  moveLayerToTop,
  moveLayerToBottom,
  moveLayerBefore,
} from "../layer-reorder.js";
import { createLayer, createTimeline } from "../timeline.js";
import type { Timeline } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Timeline with layers named by the provided IDs. */
function makeTimeline(...ids: string[]): Timeline {
  const tl = createTimeline();
  const layers = ids.map((id) =>
    Object.assign(createLayer(id), { id })
  );
  return { ...tl, layers };
}

/** Return the ordered list of layer IDs from a timeline. */
function layerIds(tl: Timeline): string[] {
  return tl.layers.map((l) => l.id);
}

// ---------------------------------------------------------------------------
// moveLayerUp
// ---------------------------------------------------------------------------

describe("moveLayerUp", () => {
  it("swaps the layer with the one above it", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerUp(tl, "b");
    expect(layerIds(result)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when the layer is already at the top (index 0)", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerUp(tl, "a");
    expect(result).toBe(tl); // same reference
    expect(layerIds(result)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for an unknown layer id", () => {
    const tl = makeTimeline("a", "b");
    const result = moveLayerUp(tl, "z");
    expect(result).toBe(tl);
  });
});

// ---------------------------------------------------------------------------
// moveLayerDown
// ---------------------------------------------------------------------------

describe("moveLayerDown", () => {
  it("swaps the layer with the one below it", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerDown(tl, "b");
    expect(layerIds(result)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op when the layer is already at the bottom", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerDown(tl, "c");
    expect(result).toBe(tl);
    expect(layerIds(result)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op for an unknown layer id", () => {
    const tl = makeTimeline("a", "b");
    const result = moveLayerDown(tl, "z");
    expect(result).toBe(tl);
  });
});

// ---------------------------------------------------------------------------
// moveLayerToTop
// ---------------------------------------------------------------------------

describe("moveLayerToTop", () => {
  it("brings a middle layer to index 0", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToTop(tl, "b");
    expect(layerIds(result)).toEqual(["b", "a", "c"]);
  });

  it("brings the bottom layer to index 0", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToTop(tl, "c");
    expect(layerIds(result)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when the layer is already at the top", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToTop(tl, "a");
    expect(result).toBe(tl);
  });
});

// ---------------------------------------------------------------------------
// moveLayerToBottom
// ---------------------------------------------------------------------------

describe("moveLayerToBottom", () => {
  it("brings a middle layer to the last index", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToBottom(tl, "b");
    expect(layerIds(result)).toEqual(["a", "c", "b"]);
  });

  it("brings the top layer to the last index", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToBottom(tl, "a");
    expect(layerIds(result)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op when the layer is already at the bottom", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToBottom(tl, "c");
    expect(result).toBe(tl);
  });
});

// ---------------------------------------------------------------------------
// moveLayerBefore
// ---------------------------------------------------------------------------

describe("moveLayerBefore", () => {
  it("inserts a layer immediately before the target", () => {
    const tl = makeTimeline("a", "b", "c", "d");
    // Move "c" before "b"
    const result = moveLayerBefore(tl, "c", "b");
    expect(layerIds(result)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves the last layer before the first", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerBefore(tl, "c", "a");
    expect(layerIds(result)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op when layerId is not found", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerBefore(tl, "z", "a");
    expect(result).toBe(tl);
  });

  it("is a no-op when targetId is not found", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerBefore(tl, "a", "z");
    expect(result).toBe(tl);
  });

  it("is a no-op when layerId and targetId are the same", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerBefore(tl, "a", "a");
    expect(result).toBe(tl);
  });
});

// ---------------------------------------------------------------------------
// Immutability checks
// ---------------------------------------------------------------------------

describe("immutability — all operations return a new Timeline object", () => {
  it("moveLayerUp returns a new timeline", () => {
    const tl = makeTimeline("a", "b");
    const result = moveLayerUp(tl, "b");
    expect(result).not.toBe(tl);
    expect(result.layers).not.toBe(tl.layers);
  });

  it("moveLayerDown returns a new timeline", () => {
    const tl = makeTimeline("a", "b");
    const result = moveLayerDown(tl, "a");
    expect(result).not.toBe(tl);
  });

  it("moveLayerToTop returns a new timeline", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToTop(tl, "c");
    expect(result).not.toBe(tl);
  });

  it("moveLayerToBottom returns a new timeline", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerToBottom(tl, "a");
    expect(result).not.toBe(tl);
  });

  it("moveLayerBefore returns a new timeline", () => {
    const tl = makeTimeline("a", "b", "c");
    const result = moveLayerBefore(tl, "c", "a");
    expect(result).not.toBe(tl);
  });

  it("original timeline layers array is not mutated", () => {
    const tl = makeTimeline("a", "b", "c");
    const originalIds = [...layerIds(tl)];
    moveLayerUp(tl, "c");
    moveLayerDown(tl, "a");
    moveLayerToTop(tl, "c");
    moveLayerToBottom(tl, "a");
    moveLayerBefore(tl, "c", "a");
    expect(layerIds(tl)).toEqual(originalIds);
  });
});
