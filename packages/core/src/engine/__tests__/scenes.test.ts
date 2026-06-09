/**
 * Unit tests for engine/scenes.ts — scene management functions.
 */

import { describe, it, expect } from "vitest";
import {
  addScene,
  deleteScene,
  reorderScene,
  renameScene,
  duplicateScene,
} from "../scenes.js";
import { createDocument } from "../../model/document.js";
import { createScene } from "../../model/scene.js";
import type { FlashDocument } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a document with the given scene names. */
function makeDoc(...sceneNames: string[]): FlashDocument {
  const doc = createDocument();
  if (sceneNames.length === 0) return doc;
  const scenes = sceneNames.map((name) => createScene(name));
  return { ...doc, scenes };
}

/** Return the scenes array from a document. */
function scenes(doc: FlashDocument) {
  return doc.scenes;
}

/** Return scene at index. */
function getScene(doc: FlashDocument, idx: number) {
  return doc.scenes[idx];
}

// ---------------------------------------------------------------------------
// addScene
// ---------------------------------------------------------------------------

describe("addScene", () => {
  it("appends a new scene with default name", () => {
    const doc = makeDoc("Scene 1");
    const result = addScene(doc);
    expect(scenes(result)).toHaveLength(2);
    expect(getScene(result, 1).name).toBe("Scene 2");
  });

  it("appends with correct auto-name when multiple scenes exist", () => {
    const doc = makeDoc("Scene 1", "Scene 2");
    const result = addScene(doc);
    expect(scenes(result)).toHaveLength(3);
    expect(getScene(result, 2).name).toBe("Scene 3");
  });

  it("inserts scene after afterIdx", () => {
    const doc = makeDoc("Scene 1", "Scene 2", "Scene 3");
    // Insert after index 0 → new scene should be at index 1
    const result = addScene(doc, 0);
    expect(scenes(result)).toHaveLength(4);
    expect(getScene(result, 0).name).toBe("Scene 1");
    expect(getScene(result, 2).name).toBe("Scene 2");
    expect(getScene(result, 3).name).toBe("Scene 3");
  });

  it("uses provided name", () => {
    const doc = makeDoc("Scene 1");
    const result = addScene(doc, undefined, "Intro");
    expect(getScene(result, 1).name).toBe("Intro");
  });

  it("new scene has default timeline with one layer and one keyframe", () => {
    const doc = makeDoc("Scene 1");
    const result = addScene(doc);
    const newScene = getScene(result, 1);
    expect(newScene.timeline.layers).toHaveLength(1);
    const layer = newScene.timeline.layers[0];
    expect(layer.name).toBe("Layer 1");
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(layer.frames).toHaveLength(1);
    expect(layer.frames[0].index).toBe(0);
    expect(layer.frames[0].isKeyframe).toBe(true);
    expect(layer.frames[0].isEmpty).toBe(true);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Scene 1");
    const original = scenes(doc);
    addScene(doc);
    expect(scenes(doc)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// deleteScene
// ---------------------------------------------------------------------------

describe("deleteScene", () => {
  it("removes the scene at the given index", () => {
    const doc = makeDoc("Scene 1", "Scene 2", "Scene 3");
    const result = deleteScene(doc, 1);
    expect(scenes(result)).toHaveLength(2);
    expect(getScene(result, 0).name).toBe("Scene 1");
    expect(getScene(result, 1).name).toBe("Scene 3");
  });

  it("is a no-op when only 1 scene remains", () => {
    const doc = makeDoc("Scene 1");
    const result = deleteScene(doc, 0);
    expect(result).toBe(doc);
    expect(scenes(result)).toHaveLength(1);
  });

  it("is a no-op for out-of-range index", () => {
    const doc = makeDoc("Scene 1", "Scene 2");
    const result = deleteScene(doc, 99);
    expect(result).toBe(doc);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Scene 1", "Scene 2");
    const original = scenes(doc);
    deleteScene(doc, 0);
    expect(scenes(doc)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// reorderScene
// ---------------------------------------------------------------------------

describe("reorderScene", () => {
  it("moves a scene from fromIdx to toIdx", () => {
    const doc = makeDoc("A", "B", "C", "D");
    const result = reorderScene(doc, 3, 1);
    expect(scenes(result).map((s) => s.name)).toEqual(["A", "D", "B", "C"]);
  });

  it("moves a scene forward in the list", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderScene(doc, 0, 2);
    expect(scenes(result).map((s) => s.name)).toEqual(["B", "C", "A"]);
  });

  it("clamps toIdx to valid range", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderScene(doc, 0, 99);
    expect(scenes(result).map((s) => s.name)).toEqual(["B", "C", "A"]);
  });

  it("is a no-op when fromIdx equals clamped toIdx", () => {
    const doc = makeDoc("A", "B", "C");
    const result = reorderScene(doc, 1, 1);
    expect(result).toBe(doc);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("A", "B", "C");
    const original = scenes(doc);
    reorderScene(doc, 0, 2);
    expect(scenes(doc)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// renameScene
// ---------------------------------------------------------------------------

describe("renameScene", () => {
  it("changes the scene name", () => {
    const doc = makeDoc("Scene 1", "Scene 2");
    const result = renameScene(doc, 0, "Intro");
    expect(getScene(result, 0).name).toBe("Intro");
    expect(getScene(result, 1).name).toBe("Scene 2");
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Scene 1");
    const original = scenes(doc);
    renameScene(doc, 0, "New Name");
    expect(scenes(doc)).toBe(original);
    expect(getScene(doc, 0).name).toBe("Scene 1");
  });

  it("is a no-op for out-of-range index", () => {
    const doc = makeDoc("Scene 1");
    const result = renameScene(doc, 99, "Ghost");
    expect(result).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// duplicateScene
// ---------------------------------------------------------------------------

describe("duplicateScene", () => {
  it("creates a copy with a new scene ID", () => {
    const doc = makeDoc("Scene 1");
    const result = duplicateScene(doc, 0);
    expect(scenes(result)).toHaveLength(2);
    expect(getScene(result, 0).id).not.toBe(getScene(result, 1).id);
  });

  it("preserves the original scene name", () => {
    const doc = makeDoc("Intro");
    const result = duplicateScene(doc, 0);
    expect(getScene(result, 1).name).toBe("Intro");
  });

  it("inserts duplicate immediately after the source", () => {
    const doc = makeDoc("A", "B", "C");
    const result = duplicateScene(doc, 1); // duplicate "B"
    expect(scenes(result).map((s) => s.name)).toEqual(["A", "B", "B", "C"]);
  });

  it("gives layers new IDs in the duplicate", () => {
    const doc = makeDoc("Scene 1");
    const result = duplicateScene(doc, 0);
    const srcLayer = getScene(doc, 0).timeline.layers[0];
    const dupLayer = getScene(result, 1).timeline.layers[0];
    expect(dupLayer.id).not.toBe(srcLayer.id);
  });

  it("gives display objects new IDs in the duplicate", () => {
    // Build a doc with a display object on a layer frame
    const doc = makeDoc("Scene 1");
    const originalLayer = getScene(doc, 0).timeline.layers[0];
    const withObj: FlashDocument = {
      ...doc,
      scenes: [
        {
          ...doc.scenes[0],
          timeline: {
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

    const result = duplicateScene(withObj, 0);
    const srcObjs = getScene(withObj, 0).timeline.layers[0].frames[0].displayObjects;
    const dupObjs = getScene(result, 1).timeline.layers[0].frames[0].displayObjects;
    expect(dupObjs).toHaveLength(1);
    expect(dupObjs[0].id).not.toBe(srcObjs[0].id);
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc("Scene 1");
    const original = scenes(doc);
    duplicateScene(doc, 0);
    expect(scenes(doc)).toBe(original);
  });
});
