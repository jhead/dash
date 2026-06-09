import { describe, it, expect } from "vitest";
import { createLayer } from "../timeline.js";
import {
  isGuidedLayer,
  isMaskedLayer,
  validateLayerPairing,
  getGuideLayerFor,
  getMaskLayerFor,
} from "../layer-pairing.js";
import type { Timeline } from "../types.js";

function makeTimeline(layers: ReturnType<typeof createLayer>[]): Timeline {
  return { layers };
}

describe("isGuidedLayer", () => {
  it("returns true for a guided layer", () => {
    const layer = createLayer("l1", "guided");
    expect(isGuidedLayer(layer)).toBe(true);
  });

  it("returns false for a normal layer", () => {
    const layer = createLayer("l1", "normal");
    expect(isGuidedLayer(layer)).toBe(false);
  });

  it("returns false for a guide layer", () => {
    const layer = createLayer("l1", "guide");
    expect(isGuidedLayer(layer)).toBe(false);
  });
});

describe("isMaskedLayer", () => {
  it("returns true for a masked layer", () => {
    const layer = createLayer("l1", "masked");
    expect(isMaskedLayer(layer)).toBe(true);
  });

  it("returns false for a mask layer", () => {
    const layer = createLayer("l1", "mask");
    expect(isMaskedLayer(layer)).toBe(false);
  });

  it("returns false for a normal layer", () => {
    const layer = createLayer("l1", "normal");
    expect(isMaskedLayer(layer)).toBe(false);
  });
});

describe("validateLayerPairing", () => {
  it("returns no issues for a well-paired guide+guided timeline", () => {
    const guide = createLayer("Guide Layer", "guide");
    const guided = createLayer("Guided Layer", "guided");
    const timeline = makeTimeline([guide, guided]);
    expect(validateLayerPairing(timeline)).toHaveLength(0);
  });

  it("returns no issues for a well-paired mask+masked timeline", () => {
    const mask = createLayer("Mask Layer", "mask");
    const masked = createLayer("Masked Layer", "masked");
    const timeline = makeTimeline([mask, masked]);
    expect(validateLayerPairing(timeline)).toHaveLength(0);
  });

  it("returns an issue when guide layer has no guided layers below it", () => {
    const guide = createLayer("Guide Layer", "guide");
    const normal = createLayer("Normal Layer", "normal");
    const timeline = makeTimeline([guide, normal]);
    const issues = validateLayerPairing(timeline);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.layerId).toBe(guide.id);
    expect(issues[0]!.message).toMatch(/guide/i);
  });

  it("returns an issue when mask layer has no masked layers below it", () => {
    const mask = createLayer("Mask Layer", "mask");
    const normal = createLayer("Normal Layer", "normal");
    const timeline = makeTimeline([mask, normal]);
    const issues = validateLayerPairing(timeline);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.layerId).toBe(mask.id);
    expect(issues[0]!.message).toMatch(/mask/i);
  });

  it("returns no issues for an empty timeline", () => {
    const timeline = makeTimeline([]);
    expect(validateLayerPairing(timeline)).toHaveLength(0);
  });

  it("returns no issues for a normal-only timeline", () => {
    const l1 = createLayer("Layer 1", "normal");
    const l2 = createLayer("Layer 2", "normal");
    const timeline = makeTimeline([l1, l2]);
    expect(validateLayerPairing(timeline)).toHaveLength(0);
  });

  it("returns two issues when both guide and mask are unpaired", () => {
    const guide = createLayer("Guide Layer", "guide");
    const mask = createLayer("Mask Layer", "mask");
    const normal = createLayer("Normal Layer", "normal");
    const timeline = makeTimeline([guide, mask, normal]);
    const issues = validateLayerPairing(timeline);
    expect(issues).toHaveLength(2);
  });
});

describe("getGuideLayerFor", () => {
  it("returns the guide layer directly above a guided layer", () => {
    const guide = createLayer("Guide Layer", "guide");
    const guided = createLayer("Guided Layer", "guided");
    const timeline = makeTimeline([guide, guided]);
    expect(getGuideLayerFor(timeline, guided.id)).toBe(guide);
  });

  it("returns undefined when the layer above is not a guide", () => {
    const normal = createLayer("Normal Layer", "normal");
    const guided = createLayer("Guided Layer", "guided");
    const timeline = makeTimeline([normal, guided]);
    expect(getGuideLayerFor(timeline, guided.id)).toBeUndefined();
  });

  it("returns undefined for a layer id that does not exist", () => {
    const guide = createLayer("Guide Layer", "guide");
    const guided = createLayer("Guided Layer", "guided");
    const timeline = makeTimeline([guide, guided]);
    expect(getGuideLayerFor(timeline, "nonexistent-id")).toBeUndefined();
  });

  it("finds the guide layer when there are intermediate layers between guide and guided", () => {
    const guide = createLayer("Guide Layer", "guide");
    const normal = createLayer("Normal Layer", "normal");
    const guided = createLayer("Guided Layer", "guided");
    const timeline = makeTimeline([guide, normal, guided]);
    // walks upward and finds the guide layer
    expect(getGuideLayerFor(timeline, guided.id)).toBe(guide);
  });

  it("returns undefined when guided layer is at index 0 (no layers above)", () => {
    const guided = createLayer("Guided Layer", "guided");
    const timeline = makeTimeline([guided]);
    expect(getGuideLayerFor(timeline, guided.id)).toBeUndefined();
  });
});

describe("getMaskLayerFor", () => {
  it("returns the mask layer directly above a masked layer", () => {
    const mask = createLayer("Mask Layer", "mask");
    const masked = createLayer("Masked Layer", "masked");
    const timeline = makeTimeline([mask, masked]);
    expect(getMaskLayerFor(timeline, masked.id)).toBe(mask);
  });

  it("returns undefined when no mask layer exists above", () => {
    const normal = createLayer("Normal Layer", "normal");
    const masked = createLayer("Masked Layer", "masked");
    const timeline = makeTimeline([normal, masked]);
    expect(getMaskLayerFor(timeline, masked.id)).toBeUndefined();
  });

  it("returns undefined for a layer id that does not exist", () => {
    const mask = createLayer("Mask Layer", "mask");
    const masked = createLayer("Masked Layer", "masked");
    const timeline = makeTimeline([mask, masked]);
    expect(getMaskLayerFor(timeline, "nonexistent-id")).toBeUndefined();
  });
});
