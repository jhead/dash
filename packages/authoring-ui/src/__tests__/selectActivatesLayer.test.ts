/**
 * Regression test for task 1364 — clicking an object on another layer must make
 * that object's layer the ACTIVE layer (Flash 8 auto-switch), AND the object on
 * the non-active layer must be hit-testable / selectable in the first place.
 *
 * Two coupled defects this guards:
 *   1) HIT-TEST WAS SINGLE-LAYER: the selectable display-object lists fed to the
 *      stage were built only from the active layer, so an object on another layer
 *      was never in the hit-test arrays. `otherLayerSelectables` now enumerates
 *      the selectable objects on every OTHER stage-selectable layer.
 *   2) NO ACTIVE-LAYER-ON-SELECT WIRING: selecting an object never updated the
 *      active layer. `ownerSelectableLayerIndex` resolves the owning layer of any
 *      selected object id (instance, text, or vector shape via its shapeId) so the
 *      select handlers can switch the active layer to it.
 *
 * Both are exercised here against the pure derived selectors (the producer of the
 * data StageArea/Shell consume). Flash nuance: a LOCKED or HIDDEN layer's contents
 * are not selectable and must NOT become the active layer — covered below.
 */

import { describe, it, expect } from "vitest";
import {
  createDocument,
  addLayer,
  addDisplayObject,
  type Timeline,
  type ShapeDisplayObject,
  type SymbolInstance,
} from "@flash/core";
import {
  otherLayerSelectables,
  ownerSelectableLayerIndex,
  isLayerStageSelectable,
} from "../selectors/derived.js";

function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x,
    y,
    shape: {
      id: `shape-${id}`,
      paths: [
        {
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 40, y: 0 } },
            { type: "line", to: { x: 40, y: 40 } },
            { type: "line", to: { x: 0, y: 40 } },
          ],
          closed: true,
        },
      ],
    },
  };
}

function makeInstance(id: string, symbolId: string, x: number, y: number): SymbolInstance {
  return {
    type: "instance",
    id,
    symbolId,
    instanceName: "",
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
  };
}

/**
 * Two-layer scene: Layer A (index 0, the ACTIVE layer in the bug repro) is EMPTY;
 * Layer B (index 1) carries one symbol instance and one vector shape at frame 0.
 */
function twoLayerTimeline(): { timeline: Timeline; layerBId: string } {
  const doc = createDocument();
  // createDocument() seeds a single layer (index 0 = Layer A). addLayer inserts
  // the new layer at the TOP (index 0) in this model, so add it then read indices.
  let t = doc.scenes[0].timeline;
  t = addLayer(t, "Layer B");
  // After addLayer, identify Layer B (the one named "Layer B").
  const bIdx = t.layers.findIndex((l) => l.name === "Layer B");
  const layerBId = t.layers[bIdx].id;
  t = addDisplayObject(t, layerBId, 0, makeInstance("inst-1", "lib-1", 200, 150));
  t = addDisplayObject(t, layerBId, 0, makeShape("shape-1", 200, 150));
  return { timeline: t, layerBId };
}

describe("task 1364 — select activates the object's layer", () => {
  it("ownerSelectableLayerIndex resolves a non-active layer for an instance", () => {
    const { timeline, layerBId } = twoLayerTimeline();
    const bIdx = timeline.layers.findIndex((l) => l.id === layerBId);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(ownerSelectableLayerIndex(timeline, "inst-1", 0)).toBe(bIdx);
  });

  it("ownerSelectableLayerIndex resolves a non-active layer for a vector shape (subselection path)", () => {
    const { timeline, layerBId } = twoLayerTimeline();
    const bIdx = timeline.layers.findIndex((l) => l.id === layerBId);
    // The subselection carries only { shapeId }; resolving it to a layer is the
    // wiring task 1364 adds so a vector-shape sub-select also activates its layer.
    expect(ownerSelectableLayerIndex(timeline, "shape-1", 0)).toBe(bIdx);
  });

  it("ownerSelectableLayerIndex returns -1 for an unknown id", () => {
    const { timeline } = twoLayerTimeline();
    expect(ownerSelectableLayerIndex(timeline, "nope", 0)).toBe(-1);
  });

  it("otherLayerSelectables enumerates objects on non-active layers (cross-layer hit-test fix)", () => {
    const { timeline, layerBId } = twoLayerTimeline();
    const aIdx = timeline.layers.findIndex((l) => l.id !== layerBId);
    const bIdx = timeline.layers.findIndex((l) => l.id === layerBId);
    // Active layer = A (empty). The fallback set must include Layer B's objects.
    const others = otherLayerSelectables(timeline, aIdx, 0);
    const bGroup = others.find((g) => g.layerIndex === bIdx);
    expect(bGroup).toBeDefined();
    expect(bGroup!.instances.map((o) => o.id)).toContain("inst-1");
    expect(bGroup!.shapes.map((o) => o.id)).toContain("shape-1");
    // The active layer itself is never in the OTHER set.
    expect(others.some((g) => g.layerIndex === aIdx)).toBe(false);
  });

  it("does NOT activate or expose a LOCKED layer's contents", () => {
    const { timeline, layerBId } = twoLayerTimeline();
    const aIdx = timeline.layers.findIndex((l) => l.id !== layerBId);
    const locked: Timeline = {
      ...timeline,
      layers: timeline.layers.map((l) => (l.id === layerBId ? { ...l, locked: true } : l)),
    };
    expect(ownerSelectableLayerIndex(locked, "inst-1", 0)).toBe(-1);
    expect(ownerSelectableLayerIndex(locked, "shape-1", 0)).toBe(-1);
    expect(otherLayerSelectables(locked, aIdx, 0).some((g) => g.layerIndex !== aIdx)).toBe(false);
  });

  it("does NOT activate or expose a HIDDEN layer's contents", () => {
    const { timeline, layerBId } = twoLayerTimeline();
    const aIdx = timeline.layers.findIndex((l) => l.id !== layerBId);
    const hidden: Timeline = {
      ...timeline,
      layers: timeline.layers.map((l) => (l.id === layerBId ? { ...l, visible: false } : l)),
    };
    expect(ownerSelectableLayerIndex(hidden, "inst-1", 0)).toBe(-1);
    expect(otherLayerSelectables(hidden, aIdx, 0).some((g) => g.layerIndex !== aIdx)).toBe(false);
  });

  it("isLayerStageSelectable excludes guide and folder layers", () => {
    const { timeline } = twoLayerTimeline();
    const base = timeline.layers[0];
    expect(isLayerStageSelectable(base)).toBe(true);
    expect(isLayerStageSelectable({ ...base, type: "guide" })).toBe(false);
    expect(isLayerStageSelectable({ ...base, type: "folder" })).toBe(false);
    expect(isLayerStageSelectable({ ...base, type: "mask" })).toBe(true);
    expect(isLayerStageSelectable({ ...base, type: "masked" })).toBe(true);
    expect(isLayerStageSelectable(null)).toBe(false);
  });
});
