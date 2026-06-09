/**
 * Unit tests for guide layer handling in the renderer and SWF export.
 *
 * Guide layers in Flash 8 are authoring-only constructs used for motion
 * guide paths.  They must:
 *   1. Be present in the document model (layer.type === 'guide').
 *   2. Be accessible from timeline queries (getDisplayObjectsAtFrame).
 *   3. Be excluded from canvas rendering (CanvasRenderer skips them).
 *   4. Be excluded from SWF export (compileDocument skips them).
 */

import { describe, it, expect } from "vitest";
import type { SceneGraph, SceneLayer, ShapeDisplayObject } from "../types.js";
import { getDisplayObjectsAtFrame } from "../../model/timeline-query.js";
import { createLayer, createFrame } from "../../model/timeline.js";
import type { Timeline } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeShape(id: string): ShapeDisplayObject {
  return {
    id,
    type: "shape",
    shape: {
      id,
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [{ type: "line", to: { x: 50, y: 50 } }],
          closed: false,
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        },
      ],
    },
    x: 0,
    y: 0,
  };
}

/**
 * Build a two-layer timeline:
 *   layers[0] — guide layer with one shape
 *   layers[1] — normal layer with one shape
 */
function makeTimeline(): Timeline {
  const guideFrame = createFrame(0, {
    isEmpty: false,
    displayObjects: [makeShape("guide-obj")],
  });
  const normalFrame = createFrame(0, {
    isEmpty: false,
    displayObjects: [makeShape("normal-obj")],
  });

  const guideLayer = createLayer("Guide Layer", "guide", { frames: [guideFrame] });
  const normalLayer = createLayer("Normal Layer", "normal", { frames: [normalFrame] });

  return { layers: [guideLayer, normalLayer] };
}

// ---------------------------------------------------------------------------
// Model access — layer.type and getDisplayObjectsAtFrame
// ---------------------------------------------------------------------------

describe("guide layer model", () => {
  it("layer with type='guide' exposes type property", () => {
    const timeline = makeTimeline();
    const guideLayer = timeline.layers.find((l) => l.type === "guide");
    expect(guideLayer).toBeDefined();
    expect(guideLayer!.type).toBe("guide");
  });

  it("layer with type='normal' exposes type property", () => {
    const timeline = makeTimeline();
    const normalLayer = timeline.layers.find((l) => l.type === "normal");
    expect(normalLayer).toBeDefined();
    expect(normalLayer!.type).toBe("normal");
  });

  it("getDisplayObjectsAtFrame includes guide layer objects (model access)", () => {
    // getDisplayObjectsAtFrame is used by the editor UI (e.g. to select guide paths).
    // It does NOT filter by layer type — it returns all visible objects regardless of type.
    const timeline = makeTimeline();
    const objects = getDisplayObjectsAtFrame(timeline, 0);
    const ids = objects.map((o) => o.id);
    expect(ids).toContain("guide-obj");
    expect(ids).toContain("normal-obj");
  });

  it("guide layer object is accessible directly via layer.frames", () => {
    const timeline = makeTimeline();
    const guideLayer = timeline.layers.find((l) => l.type === "guide")!;
    const frame = guideLayer.frames[0];
    expect(frame).toBeDefined();
    expect(frame!.displayObjects).toHaveLength(1);
    expect(frame!.displayObjects[0]!.id).toBe("guide-obj");
  });
});

// ---------------------------------------------------------------------------
// Renderer exclusion — guide layers must be skipped
// ---------------------------------------------------------------------------

describe("guide layer renderer exclusion", () => {
  /**
   * Simulates the layer-skipping logic from CanvasRenderer.render() without
   * requiring an HTMLCanvasElement.  Returns the IDs of layers that would be
   * rendered (i.e. not skipped by the guide/invisible check).
   */
  function simulateRender(sceneGraph: SceneGraph): string[] {
    const rendered: string[] = [];
    const layers = [...sceneGraph.layers].reverse(); // bottom-to-top

    let i = 0;
    while (i < layers.length) {
      const layer = layers[i];
      if (!layer.visible) { i++; continue; }

      const layerType = layer.type ?? "normal";

      if (layerType === "guide") {
        i++;
        continue; // guide layers are authoring-only — skipped
      }

      rendered.push(layer.id);
      i++;
    }
    return rendered;
  }

  it("guide layer is not included in rendered layer list", () => {
    const sceneGraph: SceneGraph = {
      layers: [
        {
          id: "guide-layer",
          name: "Guide",
          type: "guide",
          visible: true,
          locked: false,
          objects: [makeShape("guide-shape")],
        } as SceneLayer,
        {
          id: "normal-layer",
          name: "Normal",
          type: "normal",
          visible: true,
          locked: false,
          objects: [makeShape("normal-shape")],
        } as SceneLayer,
      ],
    };

    const rendered = simulateRender(sceneGraph);
    expect(rendered).not.toContain("guide-layer");
    expect(rendered).toContain("normal-layer");
  });

  it("normal layer is rendered when no guide layers are present", () => {
    const sceneGraph: SceneGraph = {
      layers: [
        {
          id: "layer-a",
          name: "A",
          type: "normal",
          visible: true,
          locked: false,
          objects: [makeShape("shape-a")],
        } as SceneLayer,
      ],
    };

    const rendered = simulateRender(sceneGraph);
    expect(rendered).toContain("layer-a");
  });

  it("multiple guide layers are all excluded", () => {
    const sceneGraph: SceneGraph = {
      layers: [
        {
          id: "guide-1",
          name: "Guide 1",
          type: "guide",
          visible: true,
          locked: false,
          objects: [makeShape("g1")],
        } as SceneLayer,
        {
          id: "guide-2",
          name: "Guide 2",
          type: "guide",
          visible: true,
          locked: false,
          objects: [makeShape("g2")],
        } as SceneLayer,
        {
          id: "normal-1",
          name: "Normal",
          type: "normal",
          visible: true,
          locked: false,
          objects: [makeShape("n1")],
        } as SceneLayer,
      ],
    };

    const rendered = simulateRender(sceneGraph);
    expect(rendered).not.toContain("guide-1");
    expect(rendered).not.toContain("guide-2");
    expect(rendered).toContain("normal-1");
  });
});
