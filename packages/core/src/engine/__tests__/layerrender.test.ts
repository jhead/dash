/**
 * Tests for layer rendering exclusion logic (guide layers, visibility).
 *
 * Guide layers are authoring constructs — they must never appear in the
 * rendered output or the compiled SWF display list.
 */

import { describe, it, expect } from "vitest";
import {
  getRenderedLayers,
  getMaskLayers,
  isRenderableLayer,
} from "../layer-render.js";
import type { Layer, Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayer(overrides: Partial<Layer>): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [],
    frameCount: 1,
    ...overrides,
  };
}

function makeTimeline(layers: Layer[]): Timeline {
  return { layers };
}

// ---------------------------------------------------------------------------
// getRenderedLayers
// ---------------------------------------------------------------------------

describe("getRenderedLayers", () => {
  it("excludes guide layers from rendered output", () => {
    const guideLayer = makeLayer({ id: "g", type: "guide" });
    const timeline = makeTimeline([guideLayer]);
    const rendered = getRenderedLayers(timeline);
    expect(rendered).toHaveLength(0);
  });

  it("includes normal layers in rendered output", () => {
    const normalLayer = makeLayer({ id: "n", type: "normal" });
    const timeline = makeTimeline([normalLayer]);
    const rendered = getRenderedLayers(timeline);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe("n");
  });

  it("includes mask layers in rendered output (mask renders as clip source)", () => {
    const maskLayer = makeLayer({ id: "m", type: "mask" });
    const timeline = makeTimeline([maskLayer]);
    const rendered = getRenderedLayers(timeline);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe("m");
  });

  it("includes masked layers in rendered output", () => {
    const maskedLayer = makeLayer({ id: "md", type: "masked" });
    const timeline = makeTimeline([maskedLayer]);
    const rendered = getRenderedLayers(timeline);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe("md");
  });

  it("excludes invisible layers regardless of type", () => {
    const invisibleNormal = makeLayer({ id: "in", type: "normal", visible: false });
    const invisibleGuide = makeLayer({ id: "ig", type: "guide", visible: false });
    const invisibleMask = makeLayer({ id: "im", type: "mask", visible: false });
    const timeline = makeTimeline([invisibleNormal, invisibleGuide, invisibleMask]);
    const rendered = getRenderedLayers(timeline);
    expect(rendered).toHaveLength(0);
  });

  it("excludes guide but includes all other visible layer types", () => {
    const layers: Layer[] = [
      makeLayer({ id: "normal", type: "normal" }),
      makeLayer({ id: "guide", type: "guide" }),
      makeLayer({ id: "guided", type: "guided" }),
      makeLayer({ id: "mask", type: "mask" }),
      makeLayer({ id: "masked", type: "masked" }),
    ];
    const timeline = makeTimeline(layers);
    const rendered = getRenderedLayers(timeline);
    expect(rendered).toHaveLength(4);
    const ids = rendered.map((l) => l.id);
    expect(ids).not.toContain("guide");
    expect(ids).toContain("normal");
    expect(ids).toContain("guided");
    expect(ids).toContain("mask");
    expect(ids).toContain("masked");
  });
});

// ---------------------------------------------------------------------------
// getMaskLayers
// ---------------------------------------------------------------------------

describe("getMaskLayers", () => {
  it("returns only mask-type layers", () => {
    const maskLayer = makeLayer({ id: "mask", type: "mask" });
    const normalLayer = makeLayer({ id: "normal", type: "normal" });
    const guideLayer = makeLayer({ id: "guide", type: "guide" });
    const timeline = makeTimeline([maskLayer, normalLayer, guideLayer]);
    const masks = getMaskLayers(timeline);
    expect(masks).toHaveLength(1);
    expect(masks[0].id).toBe("mask");
  });

  it("excludes invisible mask layers", () => {
    const invisibleMask = makeLayer({ id: "im", type: "mask", visible: false });
    const visibleMask = makeLayer({ id: "vm", type: "mask", visible: true });
    const timeline = makeTimeline([invisibleMask, visibleMask]);
    const masks = getMaskLayers(timeline);
    expect(masks).toHaveLength(1);
    expect(masks[0].id).toBe("vm");
  });

  it("returns empty array when no mask layers exist", () => {
    const timeline = makeTimeline([
      makeLayer({ id: "n", type: "normal" }),
      makeLayer({ id: "g", type: "guide" }),
    ]);
    expect(getMaskLayers(timeline)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isRenderableLayer
// ---------------------------------------------------------------------------

describe("isRenderableLayer", () => {
  it("returns false for guide layer", () => {
    const layer = makeLayer({ type: "guide" });
    expect(isRenderableLayer(layer)).toBe(false);
  });

  it("returns false for invisible layer (any type)", () => {
    expect(isRenderableLayer(makeLayer({ type: "normal", visible: false }))).toBe(false);
    expect(isRenderableLayer(makeLayer({ type: "mask", visible: false }))).toBe(false);
    expect(isRenderableLayer(makeLayer({ type: "guide", visible: false }))).toBe(false);
  });

  it("returns true for visible normal layer", () => {
    const layer = makeLayer({ type: "normal", visible: true });
    expect(isRenderableLayer(layer)).toBe(true);
  });

  it("returns true for visible mask layer", () => {
    const layer = makeLayer({ type: "mask", visible: true });
    expect(isRenderableLayer(layer)).toBe(true);
  });

  it("returns true for visible guided layer", () => {
    const layer = makeLayer({ type: "guided", visible: true });
    expect(isRenderableLayer(layer)).toBe(true);
  });
});
