/**
 * Unit tests for Movie Explorer tree building and filtering.
 *
 * Tests:
 *   1. buildExplorerTree — empty document produces scene node with no children
 *   2. buildExplorerTree — 2 layers in a scene appear as layer nodes
 *   3. buildExplorerTree — frame scripts appear under the right frame node
 *   4. buildExplorerTree — display objects (text, shape, instance) appear under frames
 *   5. buildExplorerTree — library items appear in a Library section
 *   6. filterExplorerTree — search by text hides non-matching branches
 *   7. filterExplorerTree — filter toggle hides script nodes when showScripts=false
 */

import { describe, it, expect } from "vitest";
import { buildExplorerTree, filterExplorerTree } from "../MovieExplorerPanel.js";
import type { ExplorerFilter } from "../MovieExplorerPanel.js";
import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal document builder
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<FlashDocument> = {}): FlashDocument {
  const baseFrame = {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none" as const,
    label: "",
    labelType: "name" as const,
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseCurve: null,
    motionRotate: "none" as const,
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive" as const,
    displayObjects: [],
  };

  const baseLayer = {
    id: "layer-1",
    name: "Layer 1",
    type: "normal" as const,
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frameCount: 1,
    frames: [baseFrame],
  };

  const baseDoc: FlashDocument = {
    id: "doc-1",
    properties: {
      width: 550,
      height: 400,
      frameRate: 24,
      backgroundColor: "#ffffff",
      rulerUnits: "px",
      grid: { showGrid: false, snapToGrid: false, gridWidth: 18, gridHeight: 18, gridColor: "#cccccc" },
      guides: [],
      snapToObjects: false,
      snapToPixels: false,
      snapToGuides: false,
    },
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        timeline: { layers: [baseLayer] },
      },
    ],
    library: { items: [], folders: [] },
    ...overrides,
  };

  return baseDoc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildExplorerTree", () => {
  it("empty document has a scene node with no frame children", () => {
    const doc = makeDoc();
    const tree = buildExplorerTree(doc);

    expect(tree.length).toBe(1); // only scene, no Library section (empty lib)
    const scene = tree[0];
    expect(scene.type).toBe("scene");
    if (scene.type === "scene") {
      expect(scene.label).toBe("Scene 1");
      // The single layer should appear but no frames (frame is empty keyframe)
      expect(scene.children.length).toBe(1);
      const layer = scene.children[0];
      expect(layer.type).toBe("layer");
      if (layer.type === "layer") {
        // isEmpty=false but no displayObjects and no script → frame node has no children
        // → frame node is not included
        expect(layer.children.length).toBe(0);
      }
    }
  });

  it("two layers in a scene produce two layer nodes", () => {
    const doc = makeDoc({
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "l1", name: "Background", type: "normal", visible: true, locked: false,
                outlineMode: false, outlineColor: "#ff0000", height: 20, parentFolderId: null,
                frameCount: 1,
                frames: [],
              },
              {
                id: "l2", name: "Foreground", type: "normal", visible: true, locked: false,
                outlineMode: false, outlineColor: "#00ff00", height: 20, parentFolderId: null,
                frameCount: 1,
                frames: [],
              },
            ],
          },
        },
      ],
    });

    const tree = buildExplorerTree(doc);
    expect(tree[0].type).toBe("scene");
    if (tree[0].type === "scene") {
      expect(tree[0].children.length).toBe(2);
      expect(tree[0].children[0].type).toBe("layer");
      expect(tree[0].children[1].type).toBe("layer");
      if (tree[0].children[0].type === "layer") {
        expect(tree[0].children[0].label).toBe("Background");
      }
      if (tree[0].children[1].type === "layer") {
        expect(tree[0].children[1].label).toBe("Foreground");
      }
    }
  });

  it("frame script appears as a script node under the frame", () => {
    const doc = makeDoc({
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "l1", name: "Layer 1", type: "normal", visible: true, locked: false,
                outlineMode: false, outlineColor: "#ff0000", height: 20, parentFolderId: null,
                frameCount: 1,
                frames: [
                  {
                    index: 0,
                    isKeyframe: true,
                    isEmpty: false,
                    tweenType: "none",
                    label: "",
                    labelType: "name",
                    script: "stop();",
                    sound: null,
                    motionEase: 0,
                    motionEaseCurve: null,
                    motionRotate: "none",
                    motionRotateCount: 0,
                    motionOrientToPath: false,
                    motionSync: false,
                    motionScale: false,
                    shapeEase: 0,
                    shapeBlend: "distributive",
                    displayObjects: [],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const tree = buildExplorerTree(doc);
    const scene = tree[0];
    expect(scene.type).toBe("scene");
    if (scene.type === "scene") {
      const layer = scene.children[0];
      expect(layer.type).toBe("layer");
      if (layer.type === "layer") {
        expect(layer.children.length).toBe(1);
        const frame = layer.children[0];
        expect(frame.type).toBe("frame");
        if (frame.type === "frame") {
          expect(frame.frameIndex).toBe(0);
          expect(frame.children.length).toBe(1);
          const scriptNode = frame.children[0];
          expect(scriptNode.type).toBe("script");
          if (scriptNode.type === "script") {
            expect(scriptNode.code).toBe("stop();");
          }
        }
      }
    }
  });

  it("text display object appears under its frame", () => {
    const textObj = {
      type: "text" as const,
      id: "txt-1",
      x: 10, y: 10, width: 100, height: 20,
      text: "Hello World",
      textType: "static" as const,
      fontFamily: "Arial", fontSize: 12, bold: false, italic: false,
      color: { r: 0, g: 0, b: 0, a: 255 },
      align: "left" as const,
      multiline: false, wordWrap: false,
    };

    const doc = makeDoc({
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "l1", name: "Layer 1", type: "normal", visible: true, locked: false,
                outlineMode: false, outlineColor: "#ff0000", height: 20, parentFolderId: null,
                frameCount: 1,
                frames: [
                  {
                    index: 0,
                    isKeyframe: true,
                    isEmpty: false,
                    tweenType: "none",
                    label: "",
                    labelType: "name",
                    script: "",
                    sound: null,
                    motionEase: 0,
                    motionEaseCurve: null,
                    motionRotate: "none",
                    motionRotateCount: 0,
                    motionOrientToPath: false,
                    motionSync: false,
                    motionScale: false,
                    shapeEase: 0,
                    shapeBlend: "distributive",
                    displayObjects: [textObj],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const tree = buildExplorerTree(doc);
    const scene = tree[0];
    if (scene.type === "scene") {
      const layer = scene.children[0];
      if (layer.type === "layer") {
        const frame = layer.children[0];
        if (frame.type === "frame") {
          const textNode = frame.children[0];
          expect(textNode.type).toBe("text");
          if (textNode.type === "text") {
            expect(textNode.content).toBe("Hello World");
            expect(textNode.label).toBe("Hello World");
          }
        }
      }
    }
  });

  it("library items appear in a Library section", () => {
    const symbolItem = {
      id: "sym-1",
      name: "MyClip",
      itemType: "symbol" as const,
      symbolType: "movieclip" as const,
      timeline: { layers: [] },
      linkage: {
        exportForActionScript: false,
        exportInFirstFrame: false,
        linkageIdentifier: "",
        className: "",
        exportForRuntimeSharing: false,
        importForRuntimeSharing: false,
        sharedUrl: "",
      },
      scale9Grid: null,
    };

    const doc = makeDoc({
      library: { items: [symbolItem], folders: [] },
    });

    const tree = buildExplorerTree(doc);
    // Should have: scene + library section
    expect(tree.length).toBe(2);
    const libSection = tree[1];
    expect(libSection.type).toBe("library-section");
    if (libSection.type === "library-section") {
      expect(libSection.children.length).toBe(1);
      const libItem = libSection.children[0];
      expect(libItem.type).toBe("library-item");
      if (libItem.type === "library-item") {
        expect(libItem.item.name).toBe("MyClip");
        expect(libItem.label).toBe("MyClip (movieclip)");
      }
    }
  });
});

describe("filterExplorerTree", () => {
  const ALL_ON: ExplorerFilter = {
    showText: true,
    showScripts: true,
    showMovieClips: true,
    showGraphics: true,
    showSounds: true,
    showBitmaps: true,
  };

  it("search by label hides non-matching branches", () => {
    const doc = makeDoc({
      scenes: [
        {
          id: "scene-1",
          name: "Main Scene",
          timeline: { layers: [] },
        },
        {
          id: "scene-2",
          name: "Other Scene",
          timeline: { layers: [] },
        },
      ],
    });

    const tree = buildExplorerTree(doc);
    const filtered = filterExplorerTree(tree, ALL_ON, "Main");

    // Only "Main Scene" should survive
    expect(filtered.length).toBe(1);
    expect(filtered[0].type).toBe("scene");
    if (filtered[0].type === "scene") {
      expect(filtered[0].label).toBe("Main Scene");
    }
  });

  it("showScripts=false removes script nodes", () => {
    const doc = makeDoc({
      scenes: [
        {
          id: "scene-1",
          name: "Scene 1",
          timeline: {
            layers: [
              {
                id: "l1", name: "Layer 1", type: "normal", visible: true, locked: false,
                outlineMode: false, outlineColor: "#ff0000", height: 20, parentFolderId: null,
                frameCount: 1,
                frames: [
                  {
                    index: 0,
                    isKeyframe: true,
                    isEmpty: false,
                    tweenType: "none",
                    label: "",
                    labelType: "name",
                    script: "stop();",
                    sound: null,
                    motionEase: 0,
                    motionEaseCurve: null,
                    motionRotate: "none",
                    motionRotateCount: 0,
                    motionOrientToPath: false,
                    motionSync: false,
                    motionScale: false,
                    shapeEase: 0,
                    shapeBlend: "distributive",
                    displayObjects: [],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    const tree = buildExplorerTree(doc);

    // With scripts ON
    const withScripts = filterExplorerTree(tree, ALL_ON, "");
    const scene = withScripts[0];
    if (scene.type === "scene") {
      const layer = scene.children[0];
      if (layer.type === "layer") {
        expect(layer.children.length).toBe(1); // frame with script child
      }
    }

    // With scripts OFF — the script node is filtered out, leaving the frame empty.
    // Empty frames and layers are pruned as content-only containers.
    const noScripts: ExplorerFilter = { ...ALL_ON, showScripts: false };
    const withoutScripts = filterExplorerTree(tree, noScripts, "");
    const scene2 = withoutScripts[0];
    expect(scene2.type).toBe("scene");
    if (scene2.type === "scene") {
      // The layer had only one frame with one script child; when script is filtered,
      // the frame is empty → frame is pruned → layer is empty → layer is pruned.
      expect(scene2.children.length).toBe(0);
    }
  });
});
