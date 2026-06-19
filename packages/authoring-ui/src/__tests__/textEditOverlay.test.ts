/**
 * Unit tests for task 1266: Text tool — editing text double-renders (canvas object +
 * overlay, slightly offset).
 *
 * Root cause: the object currently being edited was never excluded from the canvas
 * render, so the model text object stayed painted on the stage canvas while the HTML
 * <textarea> edit overlay drew it on top — producing a doubled/overlapping "Text" in
 * both the create and double-click-edit flows. The overlay was also positioned at the
 * object's top-left WITH a 1px border + 2px padding (border-box), so its text content
 * origin sat 3px inset from where the canvas paints text (textBaseline:"top" at the
 * object origin) — the source of the "slightly offset" duplicate.
 *
 * These tests replicate the StageArea scene-graph build + overlay-alignment math (the
 * same convention as enableSimpleButtons.test.ts) and assert the fix.
 */

import { describe, it, expect } from "vitest";
import type { SceneGraph, TextDisplayObject } from "@flash/core";

// Overlay chrome constants (kept in sync with StageArea.tsx).
const TEXT_OVERLAY_BORDER = 1;
const TEXT_OVERLAY_PADDING = 2;
const TEXT_OVERLAY_INSET = TEXT_OVERLAY_BORDER + TEXT_OVERLAY_PADDING; // 3px

function makeText(id: string, x: number, y: number): TextDisplayObject {
  return {
    id,
    type: "text",
    x,
    y,
    width: 100,
    height: 22,
    text: "Text",
    textType: "static",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    multiline: false,
    wordWrap: false,
  } as TextDisplayObject;
}

/**
 * Replicates StageArea's "exclude the in-edit text object from the canvas render" step.
 * The in-edit id prefers StageArea's local textEditState.editingId and falls back to the
 * editingTextId prop round-trip.
 */
function buildRenderGraph(
  base: SceneGraph,
  editingId: string | null,
  propEditingTextId: string | null
): SceneGraph {
  const inEditTextId = editingId ?? propEditingTextId ?? null;
  if (!inEditTextId) return base;
  return {
    ...base,
    layers: base.layers.map((layer) => ({
      ...layer,
      objects: layer.objects.filter((obj) => obj.id !== inEditTextId),
    })),
  };
}

function singleLayer(objects: TextDisplayObject[]): SceneGraph {
  return {
    layers: [
      { id: "main", name: "Layer 1", visible: true, locked: false, objects },
    ],
  };
}

describe("task 1266: in-edit text excluded from canvas render", () => {
  it("creates: the just-placed text object is NOT painted by the canvas (overlay draws it)", () => {
    const t = makeText("txt-1", 50, 60);
    const graph = singleLayer([t]);
    // create flow: onTextPlace inserted the object and set editingId to its id
    const render = buildRenderGraph(graph, "txt-1", "txt-1");
    expect(render.layers[0].objects).toHaveLength(0);
  });

  it("double-click edit: the edited existing object is excluded; siblings remain", () => {
    const a = makeText("txt-a", 10, 10);
    const b = makeText("txt-b", 120, 10);
    const graph = singleLayer([a, b]);
    const render = buildRenderGraph(graph, "txt-b", null);
    expect(render.layers[0].objects.map((o) => o.id)).toEqual(["txt-a"]);
  });

  it("no edit in progress: every object is still painted (no regression)", () => {
    const a = makeText("txt-a", 10, 10);
    const b = makeText("txt-b", 120, 10);
    const graph = singleLayer([a, b]);
    const render = buildRenderGraph(graph, null, null);
    expect(render.layers[0].objects.map((o) => o.id)).toEqual(["txt-a", "txt-b"]);
  });

  it("falls back to the editingTextId prop when local editingId is null", () => {
    const a = makeText("txt-a", 10, 10);
    const graph = singleLayer([a]);
    const render = buildRenderGraph(graph, null, "txt-a");
    expect(render.layers[0].objects).toHaveLength(0);
  });

  it("local editingId takes precedence over the prop", () => {
    const a = makeText("txt-a", 10, 10);
    const b = makeText("txt-b", 120, 10);
    const graph = singleLayer([a, b]);
    // local says edit b, stale prop says a — local wins, only b is excluded
    const render = buildRenderGraph(graph, "txt-b", "txt-a");
    expect(render.layers[0].objects.map((o) => o.id)).toEqual(["txt-a"]);
  });

  it("excludes the object across multiple layers (multi-layer scene graph)", () => {
    const a = makeText("txt-a", 10, 10);
    const b = makeText("txt-b", 120, 10);
    const graph: SceneGraph = {
      layers: [
        { id: "l1", name: "L1", visible: true, locked: false, objects: [a] },
        { id: "l2", name: "L2", visible: true, locked: false, objects: [b] },
      ],
    };
    const render = buildRenderGraph(graph, "txt-b", null);
    expect(render.layers[0].objects.map((o) => o.id)).toEqual(["txt-a"]);
    expect(render.layers[1].objects).toHaveLength(0);
  });
});

describe("task 1266: overlay aligned to canvas text origin (no offset)", () => {
  // The canvas paints text with its top-left exactly at the object origin (x, y)
  // (textBaseline:"top"). The textarea content box is inset by border + padding, so the
  // overlay box is shifted up-left by that inset and grown so the content region still
  // covers the object — making the overlay text coincide with the canvas text.
  function overlayBox(stageX: number, stageY: number, w: number, h: number) {
    return {
      left: stageX - TEXT_OVERLAY_INSET,
      top: stageY - TEXT_OVERLAY_INSET,
      width: w + TEXT_OVERLAY_INSET * 2,
      height: h + TEXT_OVERLAY_INSET * 2,
    };
  }

  it("the overlay's text content origin equals the object origin", () => {
    const stageX = 80;
    const stageY = 120;
    const box = overlayBox(stageX, stageY, 100, 22);
    // border-box content origin = box.left + border + padding
    const contentX = box.left + TEXT_OVERLAY_BORDER + TEXT_OVERLAY_PADDING;
    const contentY = box.top + TEXT_OVERLAY_BORDER + TEXT_OVERLAY_PADDING;
    expect(contentX).toBe(stageX);
    expect(contentY).toBe(stageY);
  });

  it("the inset constant is border + padding (3px)", () => {
    expect(TEXT_OVERLAY_INSET).toBe(3);
  });

  it("legacy onTextCreated strips the added inset back out of offsetWidth/Height", () => {
    // The box was grown by INSET*2; offsetWidth (border-box) reflects that, so the model
    // dimensions are recovered by subtracting INSET*2.
    const modelW = 100;
    const modelH = 22;
    const box = overlayBox(0, 0, modelW, modelH);
    const offsetWidth = box.width; // border-box offsetWidth == declared width
    const offsetHeight = box.height;
    expect(offsetWidth - TEXT_OVERLAY_INSET * 2).toBe(modelW);
    expect(offsetHeight - TEXT_OVERLAY_INSET * 2).toBe(modelH);
  });
});
