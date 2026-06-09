/**
 * Tests for layer type transitions: normal, mask, guide, folder.
 *
 * Verifies that setLayerType correctly updates the layer type immutably,
 * preserving all other layer properties and not mutating the original.
 */

import { describe, it, expect } from "vitest";
import { createLayer, createTimeline, setLayerType } from "../../model/timeline.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Layer type transitions", () => {
  // -------------------------------------------------------------------------
  // 1. A layer starts with type='normal' by default
  // -------------------------------------------------------------------------

  it("1. a layer starts with type='normal' by default", () => {
    const layer = createLayer("Layer 1");
    expect(layer.type).toBe("normal");
  });

  // -------------------------------------------------------------------------
  // 2. setLayerType(layer, 'mask') returns a layer with type='mask'
  // -------------------------------------------------------------------------

  it("2. setLayerType to 'mask' updates the layer type to 'mask'", () => {
    const layer = createLayer("Layer 1");
    const timeline = createTimeline({ layers: [layer] });
    const updated = setLayerType(timeline, layer.id, "mask");
    const updatedLayer = updated.layers.find((l) => l.id === layer.id);
    expect(updatedLayer?.type).toBe("mask");
  });

  // -------------------------------------------------------------------------
  // 3. setLayerType(layer, 'guide') returns a layer with type='guide'
  // -------------------------------------------------------------------------

  it("3. setLayerType to 'guide' updates the layer type to 'guide'", () => {
    const layer = createLayer("Layer 1");
    const timeline = createTimeline({ layers: [layer] });
    const updated = setLayerType(timeline, layer.id, "guide");
    const updatedLayer = updated.layers.find((l) => l.id === layer.id);
    expect(updatedLayer?.type).toBe("guide");
  });

  // -------------------------------------------------------------------------
  // 4. setLayerType(layer, 'normal') returns a layer with type='normal'
  // -------------------------------------------------------------------------

  it("4. setLayerType to 'normal' updates the layer type to 'normal'", () => {
    const layer = createLayer("Layer 1", "mask");
    const timeline = createTimeline({ layers: [layer] });
    const updated = setLayerType(timeline, layer.id, "normal");
    const updatedLayer = updated.layers.find((l) => l.id === layer.id);
    expect(updatedLayer?.type).toBe("normal");
  });

  // -------------------------------------------------------------------------
  // 5. Setting type of folder layer to 'folder' — no change to type
  // -------------------------------------------------------------------------

  it("5. setting type of folder layer to 'folder' keeps type as 'folder'", () => {
    const layer = createLayer("Folder", "folder");
    const timeline = createTimeline({ layers: [layer] });
    const updated = setLayerType(timeline, layer.id, "folder");
    const updatedLayer = updated.layers.find((l) => l.id === layer.id);
    expect(updatedLayer?.type).toBe("folder");
  });

  // -------------------------------------------------------------------------
  // 6. Layer type is preserved in the returned immutable object
  // -------------------------------------------------------------------------

  it("6. all other layer properties are preserved after type change", () => {
    const layer = createLayer("MyLayer", "normal");
    const timeline = createTimeline({ layers: [layer] });
    const updated = setLayerType(timeline, layer.id, "guide");
    const updatedLayer = updated.layers.find((l) => l.id === layer.id);
    // type changes
    expect(updatedLayer?.type).toBe("guide");
    // other properties unchanged
    expect(updatedLayer?.id).toBe(layer.id);
    expect(updatedLayer?.name).toBe(layer.name);
    expect(updatedLayer?.visible).toBe(layer.visible);
    expect(updatedLayer?.locked).toBe(layer.locked);
    expect(updatedLayer?.frameCount).toBe(layer.frameCount);
  });

  // -------------------------------------------------------------------------
  // 7. Original layer is not mutated
  // -------------------------------------------------------------------------

  it("7. original layer object is not mutated after setLayerType", () => {
    const layer = createLayer("Layer 1", "normal");
    const originalType = layer.type;
    const timeline = createTimeline({ layers: [layer] });
    setLayerType(timeline, layer.id, "mask");
    // original layer should be unchanged
    expect(layer.type).toBe(originalType);
    expect(layer.type).toBe("normal");
  });

  // -------------------------------------------------------------------------
  // Extra: setLayerType does not affect other layers in the timeline
  // -------------------------------------------------------------------------

  it("8. setLayerType does not affect other layers in the timeline", () => {
    const layer1 = createLayer("Layer 1", "normal");
    const layer2 = createLayer("Layer 2", "normal");
    const timeline = createTimeline({ layers: [layer1, layer2] });
    const updated = setLayerType(timeline, layer1.id, "mask");
    const l1 = updated.layers.find((l) => l.id === layer1.id);
    const l2 = updated.layers.find((l) => l.id === layer2.id);
    expect(l1?.type).toBe("mask");
    expect(l2?.type).toBe("normal");
  });
});
