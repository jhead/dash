import { describe, it, expect } from "vitest";
import {
  createTimeline,
  createLayer,
  addLayer,
  deleteLayer,
  duplicateLayer,
  renameLayer,
} from "../timeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTimeline() {
  return createTimeline();
}

// ---------------------------------------------------------------------------
// addLayer
// ---------------------------------------------------------------------------

describe("addLayer", () => {
  it("prepends a new layer to the timeline", () => {
    const tl = makeTimeline();
    const result = addLayer(tl, "New Layer");
    expect(result.layers[0].name).toBe("New Layer");
    expect(result.layers.length).toBe(tl.layers.length + 1);
  });

  it("gives the layer the provided name", () => {
    const tl = makeTimeline();
    const result = addLayer(tl, "Foreground");
    expect(result.layers[0].name).toBe("Foreground");
  });

  it("default type is 'normal'", () => {
    const tl = makeTimeline();
    const result = addLayer(tl, "Test");
    expect(result.layers[0].type).toBe("normal");
  });

  it("is immutable — original timeline is unchanged", () => {
    const tl = makeTimeline();
    const originalCount = tl.layers.length;
    addLayer(tl, "Extra");
    expect(tl.layers.length).toBe(originalCount);
  });

  it("auto-generates a name when none is provided", () => {
    const tl = makeTimeline();
    const result = addLayer(tl);
    expect(result.layers[0].name).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// deleteLayer (removeLayer)
// ---------------------------------------------------------------------------

describe("deleteLayer", () => {
  it("removes the layer with the given id", () => {
    const tl = makeTimeline();
    const withTwo = addLayer(tl, "Second");
    const idToRemove = withTwo.layers[0].id;
    const result = deleteLayer(withTwo, idToRemove);
    expect(result.layers.find((l) => l.id === idToRemove)).toBeUndefined();
  });

  it("is a no-op when only one layer remains", () => {
    const tl = makeTimeline();
    expect(tl.layers.length).toBe(1);
    const result = deleteLayer(tl, tl.layers[0].id);
    expect(result.layers.length).toBe(1);
  });

  it("is immutable — original timeline is unchanged", () => {
    const tl = makeTimeline();
    const withTwo = addLayer(tl, "Extra");
    const snapshot = withTwo.layers.length;
    deleteLayer(withTwo, withTwo.layers[0].id);
    expect(withTwo.layers.length).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// duplicateLayer
// ---------------------------------------------------------------------------

describe("duplicateLayer", () => {
  it("inserts a copy immediately after the source layer", () => {
    const tl = makeTimeline();
    const withTwo = addLayer(tl, "Source");
    const sourceId = withTwo.layers[0].id;
    const result = duplicateLayer(withTwo, sourceId);
    // copy is at index 1 (right after index 0)
    expect(result.layers[1].name).toBe("Source copy");
  });

  it("gives the copy a new unique id", () => {
    const tl = makeTimeline();
    const withTwo = addLayer(tl, "Source");
    const sourceId = withTwo.layers[0].id;
    const result = duplicateLayer(withTwo, sourceId);
    expect(result.layers[1].id).not.toBe(sourceId);
  });

  it("preserves frameCount from the source layer", () => {
    const base = createTimeline({ layers: [createLayer("A", "normal", { frameCount: 5, frames: [] })] });
    const result = duplicateLayer(base, base.layers[0].id);
    expect(result.layers[1].frameCount).toBe(5);
  });

  it("is a no-op when the layer id is not found", () => {
    const tl = makeTimeline();
    const result = duplicateLayer(tl, "nonexistent-id");
    expect(result.layers.length).toBe(tl.layers.length);
  });

  it("is immutable — original timeline is unchanged", () => {
    const tl = makeTimeline();
    const originalCount = tl.layers.length;
    duplicateLayer(tl, tl.layers[0].id);
    expect(tl.layers.length).toBe(originalCount);
  });
});

// ---------------------------------------------------------------------------
// renameLayer
// ---------------------------------------------------------------------------

describe("renameLayer", () => {
  it("changes the name of the target layer", () => {
    const tl = makeTimeline();
    const id = tl.layers[0].id;
    const result = renameLayer(tl, id, "Renamed");
    expect(result.layers[0].name).toBe("Renamed");
  });

  it("is a no-op when the layer id is not found", () => {
    const tl = makeTimeline();
    const originalName = tl.layers[0].name;
    const result = renameLayer(tl, "nonexistent-id", "Ghost");
    expect(result.layers[0].name).toBe(originalName);
  });

  it("is immutable — original timeline is unchanged", () => {
    const tl = makeTimeline();
    const originalName = tl.layers[0].name;
    renameLayer(tl, tl.layers[0].id, "Changed");
    expect(tl.layers[0].name).toBe(originalName);
  });
});

// ---------------------------------------------------------------------------
// Guide layer type via setLayerType / createLayer
// ---------------------------------------------------------------------------

describe("guide layer type", () => {
  it("createLayer with type='guide' creates a guide layer", () => {
    const layer = createLayer("Motion Guide", "guide");
    expect(layer.type).toBe("guide");
  });
});
