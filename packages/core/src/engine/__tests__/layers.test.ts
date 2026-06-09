/**
 * Unit tests for engine/layers.ts — layer management functions.
 */

import { describe, it, expect } from "vitest";
import {
  addLayer,
  deleteLayer,
  reorderLayer,
  renameLayer,
  duplicateLayer,
} from "../layers.js";
import { createDocument } from "../../model/document.js";
import { createLayer, createTimeline } from "../../model/timeline.js";
import type { FlashDocument } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a simple one-scene document with the given layer names. */
function makeDoc(...layerNames: string[]): FlashDocument {
  const layers =
    layerNames.length > 0
      ? layerNames.map((name) => createLayer(name))
      : [createLayer("Layer 1")];
  const doc = createDocument();
  return {
    ...doc,
    scenes: [
      {
        ...doc.scenes[0],
        timeline: createTimeline({ layers }),
      },
    ],
  };
}

/** Return scene 0's layers array. */
function layers(doc: FlashDocument) {
  return doc.scenes[0].timeline.layers;
}

/** Return layer at index in scene 0. */
function getLayer(doc: FlashDocument, idx: number) {
  return layers(doc)[idx];
}

// ---------------------------------------------------------------------------
// addLayer
// ---------------------------------------------------------------------------

describe("addLayer", () => {
  it("appends a new layer at the end by default", () => {
    const doc = makeDoc("Layer 1", "Layer 2");
    const result = addLayer(doc, 0);
    expect(layers(result)).toHaveLength(3);
    expect(getLayer(result, 2).name).toBe("Layer 3");
  });

  it("inserts a new layer after afterLayerIdx", () => {
    const doc = makeDoc("Layer 1", "Layer 2", "Layer 3");
    // Insert after index 0 → new layer should be at index 1
    const result = addLayer(doc, 0, 0);
    expect(layers(result)).toHaveLength(4);
    expect(getLayer(result, 0).name).toBe("Layer 1");
    expect(getLayer(result, 1).name).toBe("Layer 4"); // auto-named by count
    expect(getLayer(result, 2).name).toBe("Layer 2");
  });

  it("uses provided name and type", () => {
    const doc = makeDoc("Layer 1");
    const result = addLayer(doc, 0, undefined, "guide", "My Guide");
    const newL = getLayer(result, 1);
    expect(newL.name).toBe("My Guide");
    expect(newL.type).toBe("guide");
  });

  it("new layer has correct defaults", () => {
    const doc = makeDoc("Layer 1");
    const result = addLayer(doc, 0);
    const newL = getLayer(result, 1);
    expect(newL.visible).toBe(true);
    expect(newL.locked).toBe(false);
    expect(newL.outlineMode).toBe(false);
    expect(newL.height).toBe(20);
    expect(newL.parentFolderId).toBeNull();
    expect(newL.frames).toHaveLength(1);
    expect(newL.frames[0].index).toBe(0);
    expect(newL.frames[0].isKeyframe).toBe(true);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Layer 1");
    const original = layers(doc);
    addLayer(doc, 0);
    expect(layers(doc)).toBe(original);
  });

  it("clamps afterLayerIdx to valid range (beyond end = append)", () => {
    const doc = makeDoc("Layer 1");
    const result = addLayer(doc, 0, 99);
    expect(layers(result)).toHaveLength(2);
    expect(getLayer(result, 1).name).toBe("Layer 2");
  });
});

// ---------------------------------------------------------------------------
// deleteLayer
// ---------------------------------------------------------------------------

describe("deleteLayer", () => {
  it("removes a layer by index", () => {
    const doc = makeDoc("Layer 1", "Layer 2", "Layer 3");
    const result = deleteLayer(doc, 0, 1);
    expect(layers(result)).toHaveLength(2);
    expect(getLayer(result, 0).name).toBe("Layer 1");
    expect(getLayer(result, 1).name).toBe("Layer 3");
  });

  it("does NOT remove the last remaining layer", () => {
    const doc = makeDoc("Layer 1");
    const result = deleteLayer(doc, 0, 0);
    expect(result).toBe(doc); // same reference — no change
    expect(layers(result)).toHaveLength(1);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Layer 1", "Layer 2");
    const original = layers(doc);
    deleteLayer(doc, 0, 0);
    expect(layers(doc)).toBe(original);
  });

  it("is a no-op for out-of-range index", () => {
    const doc = makeDoc("Layer 1", "Layer 2");
    const result = deleteLayer(doc, 0, 99);
    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// reorderLayer
// ---------------------------------------------------------------------------

describe("reorderLayer", () => {
  it("moves a layer from fromIdx to toIdx", () => {
    const doc = makeDoc("A", "B", "C", "D");
    // Move layer at index 3 ("D") to index 1
    const result = reorderLayer(doc, 0, 3, 1);
    expect(layers(result).map((l) => l.name)).toEqual(["A", "D", "B", "C"]);
  });

  it("moves a layer forward in the list", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderLayer(doc, 0, 0, 2);
    expect(layers(result).map((l) => l.name)).toEqual(["B", "C", "A"]);
  });

  it("clamps toIdx to valid range", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderLayer(doc, 0, 0, 99);
    expect(layers(result).map((l) => l.name)).toEqual(["B", "C", "A"]);
  });

  it("is a no-op when fromIdx equals clamped toIdx", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderLayer(doc, 0, 1, 1);
    expect(result).toBe(doc);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("A", "B", "C");
    const original = layers(doc);
    reorderLayer(doc, 0, 0, 2);
    expect(layers(doc)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// renameLayer
// ---------------------------------------------------------------------------

describe("renameLayer", () => {
  it("changes the layer name", () => {
    const doc = makeDoc("Layer 1", "Layer 2");
    const result = renameLayer(doc, 0, 0, "Background");
    expect(getLayer(result, 0).name).toBe("Background");
    expect(getLayer(result, 1).name).toBe("Layer 2");
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Layer 1");
    const original = layers(doc);
    renameLayer(doc, 0, 0, "New Name");
    expect(layers(doc)).toBe(original);
    expect(getLayer(doc, 0).name).toBe("Layer 1");
  });

  it("is a no-op for out-of-range index", () => {
    const doc = makeDoc("Layer 1");
    const result = renameLayer(doc, 0, 99, "Ghost");
    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// duplicateLayer
// ---------------------------------------------------------------------------

describe("duplicateLayer", () => {
  it("creates a copy with a new layer ID", () => {
    const doc = makeDoc("Layer 1");
    const result = duplicateLayer(doc, 0, 0);
    expect(layers(result)).toHaveLength(2);
    expect(getLayer(result, 0).id).not.toBe(getLayer(result, 1).id);
  });

  it("preserves the original layer's name", () => {
    const doc = makeDoc("Background");
    const result = duplicateLayer(doc, 0, 0);
    expect(getLayer(result, 1).name).toBe("Background");
  });

  it("inserts duplicate immediately after the source", () => {
    const doc = makeDoc("A", "B", "C");
    const result = duplicateLayer(doc, 0, 1); // duplicate "B"
    expect(layers(result).map((l) => l.name)).toEqual(["A", "B", "B", "C"]);
  });

  it("gives display objects new IDs", () => {
    // Build a doc with a display object on the layer's frame 0
    let doc = makeDoc("Layer 1");
    const originalLayer = getLayer(doc, 0);
    const withObj: typeof doc = {
      ...doc,
      scenes: [
        {
          ...doc.scenes[0],
          timeline: {
            ...doc.scenes[0].timeline,
            layers: [
              {
                ...originalLayer,
                frames: [
                  {
                    ...originalLayer.frames[0],
                    isEmpty: false,
                    displayObjects: [
                      {
                        type: "shape" as const,
                        id: "obj-original",
                        x: 0,
                        y: 0,
                        scaleX: 1,
                        scaleY: 1,
                        rotation: 0,
                        skewX: 0,
                        skewY: 0,
                        visible: true,
                        alpha: 1,
                        blendMode: "normal" as const,
                        filters: [],
                        colorEffect: null,
                        shape: {
                          paths: [],
                          fills: [],
                          strokes: [],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const result = duplicateLayer(withObj, 0, 0);
    const srcObjs = getLayer(withObj, 0).frames[0].displayObjects;
    const dupObjs = getLayer(result, 1).frames[0].displayObjects;
    expect(dupObjs).toHaveLength(1);
    expect(dupObjs[0].id).not.toBe(srcObjs[0].id);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Layer 1");
    const original = layers(doc);
    duplicateLayer(doc, 0, 0);
    expect(layers(doc)).toBe(original);
  });
});
