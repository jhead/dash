import { describe, it, expect } from "vitest";
import {
  createTimeline,
  createLayer,
  addLayer,
  setLayerVisible,
  setLayerLocked,
  setLayerOutlineMode,
  getVisibleLayers,
  setAllLayersVisible,
  setAllLayersLocked,
} from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTwoLayerTimeline() {
  const tl = createTimeline();
  return addLayer(tl, "Second");
}

// ---------------------------------------------------------------------------
// setLayerVisible
// ---------------------------------------------------------------------------

describe("setLayerVisible", () => {
  it("sets visible=true on the target layer", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    // first hide it
    const hidden = setLayerVisible(tl, id, false);
    const shown = setLayerVisible(hidden, id, true);
    expect(shown.layers[0].visible).toBe(true);
  });

  it("sets visible=false on the target layer", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const result = setLayerVisible(tl, id, false);
    expect(result.layers[0].visible).toBe(false);
  });

  it("does not mutate the original timeline", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    setLayerVisible(tl, id, false);
    expect(tl.layers[0].visible).toBe(true);
  });

  it("only affects the target layer", () => {
    const tl = makeTwoLayerTimeline();
    const targetId = tl.layers[0].id;
    const otherId = tl.layers[1].id;
    const result = setLayerVisible(tl, targetId, false);
    expect(result.layers[0].visible).toBe(false);
    expect(result.layers[1].visible).toBe(tl.layers[1].visible);
    expect(result.layers.find((l) => l.id === otherId)?.visible).toBe(
      tl.layers[1].visible
    );
  });
});

// ---------------------------------------------------------------------------
// setLayerLocked
// ---------------------------------------------------------------------------

describe("setLayerLocked", () => {
  it("sets locked=true on the target layer", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const result = setLayerLocked(tl, id, true);
    expect(result.layers[0].locked).toBe(true);
  });

  it("does not mutate the original timeline", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    setLayerLocked(tl, id, true);
    expect(tl.layers[0].locked).toBe(false);
  });

  it("only affects the target layer", () => {
    const tl = makeTwoLayerTimeline();
    const targetId = tl.layers[0].id;
    const result = setLayerLocked(tl, targetId, true);
    expect(result.layers[0].locked).toBe(true);
    expect(result.layers[1].locked).toBe(tl.layers[1].locked);
  });
});

// ---------------------------------------------------------------------------
// setLayerOutlineMode
// ---------------------------------------------------------------------------

describe("setLayerOutlineMode", () => {
  it("sets outlineMode=true on the target layer", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const result = setLayerOutlineMode(tl, id, true);
    expect(result.layers[0].outlineMode).toBe(true);
  });

  it("sets outlineMode=false on the target layer", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const withOutline = setLayerOutlineMode(tl, id, true);
    const result = setLayerOutlineMode(withOutline, id, false);
    expect(result.layers[0].outlineMode).toBe(false);
  });

  it("sets outlineColor when provided", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const result = setLayerOutlineMode(tl, id, true, "#ff0000");
    expect(result.layers[0].outlineColor).toBe("#ff0000");
  });

  it("preserves existing outlineColor when not provided", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const original = tl.layers[0].outlineColor;
    const result = setLayerOutlineMode(tl, id, true);
    expect(result.layers[0].outlineColor).toBe(original);
  });

  it("does not affect other layers", () => {
    const tl = makeTwoLayerTimeline();
    const targetId = tl.layers[0].id;
    const result = setLayerOutlineMode(tl, targetId, true, "#ff0000");
    expect(result.layers[0].outlineMode).toBe(true);
    expect(result.layers[1].outlineMode).toBe(tl.layers[1].outlineMode);
    expect(result.layers[1].outlineColor).toBe(tl.layers[1].outlineColor);
  });

  it("does not mutate the original timeline", () => {
    const tl = createTimeline();
    const id = tl.layers[0].id;
    const origMode = tl.layers[0].outlineMode;
    setLayerOutlineMode(tl, id, true);
    expect(tl.layers[0].outlineMode).toBe(origMode);
  });
});

// ---------------------------------------------------------------------------
// getVisibleLayers
// ---------------------------------------------------------------------------

describe("getVisibleLayers", () => {
  it("returns only visible layers", () => {
    const tl = makeTwoLayerTimeline();
    const hiddenId = tl.layers[0].id;
    const withHidden = setLayerVisible(tl, hiddenId, false);
    const visible = getVisibleLayers(withHidden);
    expect(visible.length).toBe(1);
    expect(visible[0].id).not.toBe(hiddenId);
  });

  it("returns all layers when all are visible", () => {
    const tl = makeTwoLayerTimeline();
    const visible = getVisibleLayers(tl);
    expect(visible.length).toBe(tl.layers.length);
  });

  it("returns none when all layers are hidden", () => {
    const tl = makeTwoLayerTimeline();
    const allHidden = setAllLayersVisible(tl, false);
    const visible = getVisibleLayers(allHidden);
    expect(visible.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// setAllLayersVisible
// ---------------------------------------------------------------------------

describe("setAllLayersVisible", () => {
  it("hides all layers when called with false", () => {
    const tl = makeTwoLayerTimeline();
    const result = setAllLayersVisible(tl, false);
    expect(result.layers.every((l) => l.visible === false)).toBe(true);
  });

  it("shows all layers when called with true", () => {
    const tl = makeTwoLayerTimeline();
    const allHidden = setAllLayersVisible(tl, false);
    const result = setAllLayersVisible(allHidden, true);
    expect(result.layers.every((l) => l.visible === true)).toBe(true);
  });

  it("does not mutate the original timeline", () => {
    const tl = makeTwoLayerTimeline();
    const origVisible = tl.layers.map((l) => l.visible);
    setAllLayersVisible(tl, false);
    expect(tl.layers.map((l) => l.visible)).toEqual(origVisible);
  });
});

// ---------------------------------------------------------------------------
// setAllLayersLocked
// ---------------------------------------------------------------------------

describe("setAllLayersLocked", () => {
  it("locks all layers when called with true", () => {
    const tl = makeTwoLayerTimeline();
    const result = setAllLayersLocked(tl, true);
    expect(result.layers.every((l) => l.locked === true)).toBe(true);
  });

  it("unlocks all layers when called with false", () => {
    const tl = makeTwoLayerTimeline();
    const allLocked = setAllLayersLocked(tl, true);
    const result = setAllLayersLocked(allLocked, false);
    expect(result.layers.every((l) => l.locked === false)).toBe(true);
  });

  it("does not mutate the original timeline", () => {
    const tl = makeTwoLayerTimeline();
    const origLocked = tl.layers.map((l) => l.locked);
    setAllLayersLocked(tl, true);
    expect(tl.layers.map((l) => l.locked)).toEqual(origLocked);
  });
});
