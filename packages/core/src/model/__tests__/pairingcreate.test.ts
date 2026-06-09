import { describe, it, expect } from "vitest";
import { createLayer, createTimeline } from "../timeline.js";
import { addGuideLayerAbove, addMaskLayerAbove } from "../layer-pairing.js";
import type { Timeline } from "../types.js";

function makeTimeline(names: string[]): Timeline {
  const layers = names.map(n => createLayer(n));
  return { layers };
}

describe("addGuideLayerAbove", () => {
  it("inserts guide layer before the target layer", () => {
    const tl = makeTimeline(["Layer 1"]);
    const targetId = tl.layers[0]!.id;
    const result = addGuideLayerAbove(tl, targetId);
    expect(result.layers[0]!.type).toBe("guide");
    expect(result.layers[1]!.id).toBe(targetId);
  });

  it("sets the target layer type to 'guided'", () => {
    const tl = makeTimeline(["Layer 1"]);
    const targetId = tl.layers[0]!.id;
    const result = addGuideLayerAbove(tl, targetId);
    const target = result.layers.find(l => l.id === targetId)!;
    expect(target.type).toBe("guided");
  });

  it("increases layer count by 1", () => {
    const tl = makeTimeline(["Layer 1", "Layer 2"]);
    const targetId = tl.layers[1]!.id;
    const result = addGuideLayerAbove(tl, targetId);
    expect(result.layers.length).toBe(tl.layers.length + 1);
  });

  it("does not mutate the original timeline", () => {
    const tl = makeTimeline(["Layer 1"]);
    const originalLength = tl.layers.length;
    const targetId = tl.layers[0]!.id;
    addGuideLayerAbove(tl, targetId);
    expect(tl.layers.length).toBe(originalLength);
    expect(tl.layers[0]!.type).toBe("normal");
  });

  it("the inserted guide layer has type 'guide'", () => {
    const tl = makeTimeline(["Layer 1"]);
    const targetId = tl.layers[0]!.id;
    const result = addGuideLayerAbove(tl, targetId);
    // Guide is inserted at index 0 (above target)
    const guideLayer = result.layers[0]!;
    expect(guideLayer.type).toBe("guide");
  });

  it("is a no-op when layerId is unknown", () => {
    const tl = makeTimeline(["Layer 1"]);
    const result = addGuideLayerAbove(tl, "nonexistent-id");
    expect(result).toBe(tl);
  });

  it("guide layer name includes the target layer name", () => {
    const tl = makeTimeline(["Background"]);
    const targetId = tl.layers[0]!.id;
    const result = addGuideLayerAbove(tl, targetId);
    expect(result.layers[0]!.name).toContain("Background");
  });

  it("works when there are multiple layers and target is in the middle", () => {
    const tl = makeTimeline(["Top", "Middle", "Bottom"]);
    const targetId = tl.layers[1]!.id;
    const result = addGuideLayerAbove(tl, targetId);
    expect(result.layers.length).toBe(4);
    // Guide should be at index 1, target at index 2
    expect(result.layers[1]!.type).toBe("guide");
    expect(result.layers[2]!.id).toBe(targetId);
  });
});

describe("addMaskLayerAbove", () => {
  it("inserts mask layer before the target layer", () => {
    const tl = makeTimeline(["Layer 1"]);
    const targetId = tl.layers[0]!.id;
    const result = addMaskLayerAbove(tl, targetId);
    expect(result.layers[0]!.type).toBe("mask");
    expect(result.layers[1]!.id).toBe(targetId);
  });

  it("sets the target layer type to 'masked'", () => {
    const tl = makeTimeline(["Layer 1"]);
    const targetId = tl.layers[0]!.id;
    const result = addMaskLayerAbove(tl, targetId);
    const target = result.layers.find(l => l.id === targetId)!;
    expect(target.type).toBe("masked");
  });

  it("increases layer count by 1", () => {
    const tl = makeTimeline(["Layer 1", "Layer 2"]);
    const targetId = tl.layers[0]!.id;
    const result = addMaskLayerAbove(tl, targetId);
    expect(result.layers.length).toBe(tl.layers.length + 1);
  });

  it("does not mutate the original timeline", () => {
    const tl = makeTimeline(["Layer 1"]);
    const originalLength = tl.layers.length;
    const targetId = tl.layers[0]!.id;
    addMaskLayerAbove(tl, targetId);
    expect(tl.layers.length).toBe(originalLength);
    expect(tl.layers[0]!.type).toBe("normal");
  });

  it("the inserted mask layer has type 'mask'", () => {
    const tl = makeTimeline(["Layer 1"]);
    const targetId = tl.layers[0]!.id;
    const result = addMaskLayerAbove(tl, targetId);
    const maskLayer = result.layers[0]!;
    expect(maskLayer.type).toBe("mask");
  });

  it("is a no-op when layerId is unknown", () => {
    const tl = makeTimeline(["Layer 1"]);
    const result = addMaskLayerAbove(tl, "nonexistent-id");
    expect(result).toBe(tl);
  });

  it("mask layer name includes the target layer name", () => {
    const tl = makeTimeline(["Foreground"]);
    const targetId = tl.layers[0]!.id;
    const result = addMaskLayerAbove(tl, targetId);
    expect(result.layers[0]!.name).toContain("Foreground");
  });

  it("works when there are multiple layers and target is the last one", () => {
    const tl = makeTimeline(["Top", "Bottom"]);
    const targetId = tl.layers[1]!.id;
    const result = addMaskLayerAbove(tl, targetId);
    expect(result.layers.length).toBe(3);
    expect(result.layers[1]!.type).toBe("mask");
    expect(result.layers[2]!.id).toBe(targetId);
  });
});
