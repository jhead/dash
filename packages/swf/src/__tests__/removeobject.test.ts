/**
 * Tests for RemoveObject2 (tag 28) emission in the SWF compiler.
 *
 * SWF display list semantics:
 *   PlaceObject2 (isMove=false + HasCharacter) → places new character at depth
 *   PlaceObject2 (isMove=true) → modifies existing character at depth
 *   RemoveObject2 (depth) → removes whatever is at that depth
 *
 * Tag codes used:
 *   28  RemoveObject2
 *   26  PlaceObject2
 *   70  PlaceObject3
 *    1  ShowFrame
 *   83  DefineShape4
 *   43  FrameLabel
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";
import type { Shape, SymbolInstance } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

/**
 * Parse all tag records from a compiled SWF binary.
 * Stops at the End tag (code 0) or end of file.
 */
function parseTags(swf: Uint8Array): SwfTag[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos] | (swf[pos + 1] << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2] |
        (swf[pos + 3] << 8) |
        (swf[pos + 4] << 16) |
        (swf[pos + 5] << 24);
      headerSize = 6;
    }
    const bodyStart = pos + headerSize;
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0 /* End */) break;
  }
  return tags;
}

/**
 * Group tag indices by frame. Returns an array of arrays where each inner
 * array contains the indices (into `tags`) of the tags that belong to
 * frame N (0-indexed), where frame N ends with the (N+1)th ShowFrame tag.
 */
function groupByFrame(tags: SwfTag[]): number[][] {
  const frames: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].code === 1 /* ShowFrame */) {
      frames.push(current);
      current = [];
    } else {
      current.push(i);
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999999",
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

/** Build a minimal shape. */
function makeShape(id = "shape-1"): Shape {
  return {
    id,
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 10, y: 0 } },
          { type: "line", to: { x: 10, y: 10 } },
          { type: "line", to: { x: 0, y: 10 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
      },
    ],
  };
}

/** Build a shape display object. */
function makeShapeObj(id: string) {
  return {
    id,
    type: "shape" as const,
    shape: makeShape(id),
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    visible: true,
    filters: [],
    blendMode: "normal" as const,
    cacheAsBitmap: false,
  };
}

const DEFAULT_SYMBOL_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

/** Build a library Symbol (movieclip) with a single blank layer. */
function makeSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [
        {
          id: `sym-layer-${id}`,
          name: "Layer 1",
          type: "normal",
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#ff0000",
          height: 20,
          parentFolderId: null,
          frames: [makeBlankFrame(0)],
          frameCount: 1,
        },
      ],
    },
    linkage: DEFAULT_SYMBOL_LINKAGE,
    scale9Grid: null,
  };
}

/** Build a SymbolInstance display object. */
function makeInstanceObj(id: string, symbolId: string): SymbolInstance {
  return {
    id,
    type: "instance",
    symbolId,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    alpha: 1,
    filters: [],
  };
}

/** Build a blank keyframe. */
function makeBlankFrame(index: number): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects: [],
  };
}

/** Build a keyframe with a single shape display object. */
function makeShapeFrame(index: number, objId: string): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: false,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive",
    displayObjects: [makeShapeObj(objId)],
  };
}

/**
 * Build a layer with the provided frames.
 * frameCount should equal the total number of frames covered by the layer.
 */
function makeLayerWithFrames(id: string, frames: Frame[], frameCount: number): Layer {
  return {
    id,
    name: id,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount,
  };
}

/** Build a minimal scene with the given layers. */
function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return {
    id,
    name,
    timeline: { layers },
  };
}

/** Build a minimal FlashDocument with one scene and optional library items. */
function makeDoc(scenes: Scene[], libraryItems: import("@flash/core").LibraryItem[] = []): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: { items: libraryItems, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RemoveObject2 (tag 28) emission", () => {
  // Test 1: Tag 28 constant exists in tags.ts
  it("Tag.RemoveObject2 equals 28", () => {
    expect(Tag.RemoveObject2).toBe(28);
  });

  // Test 2: Object that exists for 2 frames then disappears: tag 28 appears after frame 2
  it("emits RemoveObject2 when an object span ends (2-frame span then blank)", () => {
    // Layer has: frame 0 (shape), frame 1 (shape), frame 2 (blank)
    // Total maxFrames = 3 because we have a blank keyframe at index 2.
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrame(0, "obj-a"),
        // frame 1 is a non-keyframe continuation of the keyframe at 0
        // frame 2 is a blank keyframe → object disappears
        makeBlankFrame(2),
      ],
      3 // layerFrameCount
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // frame index 2 (3rd ShowFrame) should contain a RemoveObject2
    expect(frames.length).toBeGreaterThanOrEqual(3);
    const frame2Tags = frames[2].map((i) => tags[i]);
    const removes = frame2Tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(removes.length).toBeGreaterThan(0);
  });

  // Test 3: Multi-scene: tag 28 appears between scene 1 and scene 2 for all active depths
  it("emits RemoveObject2 between scenes to clear all occupied depths", () => {
    // Scene 1: one layer with a shape on frame 0
    const scene1Layer = makeLayerWithFrames(
      "l1",
      [makeShapeFrame(0, "obj-s1")],
      1
    );
    const scene1 = makeScene("s1", "Scene 1", [scene1Layer]);

    // Scene 2: blank
    const scene2Layer = makeLayerWithFrames("l2", [makeBlankFrame(0)], 1);
    const scene2 = makeScene("s2", "Scene 2", [scene2Layer]);

    const doc = makeDoc([scene1, scene2]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // Scene names are no longer emitted as FrameLabel (Flash 8 behavior).
    // Locate scene boundary via ShowFrame indices instead.
    const showFrameIndices = tags
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.code === Tag.ShowFrame)
      .map(({ i }) => i);

    // scene1 has 1 frame, scene2 has 1 frame => 2 ShowFrames
    expect(showFrameIndices.length).toBe(2);

    // RemoveObject2 tags for scene 2 appear after showFrameIndices[0] and
    // before showFrameIndices[1].
    const sceneStartSegment = tags.slice(
      showFrameIndices[0] + 1,
      showFrameIndices[1]
    );
    const removes = sceneStartSegment.filter(
      (t) => t.code === Tag.RemoveObject2
    );
    expect(removes.length).toBeGreaterThan(0);
  });

  // Test 4: Object that exists throughout all frames: tag 28 does NOT appear mid-stream
  it("does NOT emit RemoveObject2 mid-stream when object persists every frame", () => {
    // Layer has one keyframe at 0 that runs for 3 frames (no blank keyframes).
    const layer = makeLayerWithFrames(
      "l1",
      [makeShapeFrame(0, "obj-persistent")],
      3
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    // For all frames except potentially the final cleanup (end of SWF):
    // none of the per-frame tag sets should contain RemoveObject2
    for (let fi = 0; fi < frames.length; fi++) {
      const frameTags = frames[fi].map((i) => tags[i]);
      const removes = frameTags.filter((t) => t.code === Tag.RemoveObject2);
      expect(removes.length).toBe(0);
    }
  });

  // Test 5: Empty layer: tag 28 is NOT emitted (nothing was ever placed)
  it("does NOT emit RemoveObject2 for a layer that never had any object", () => {
    // Layer is entirely blank across 3 frames
    const layer = makeLayerWithFrames(
      "l1",
      [makeBlankFrame(0), makeBlankFrame(1), makeBlankFrame(2)],
      3
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    // No RemoveObject2 anywhere in the file
    const removes = tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(removes.length).toBe(0);
  });

  // Test 6a: Object added in frame 2 → PlaceObject2 but no RemoveObject2 in frame 2
  it("does NOT emit RemoveObject2 when an object first appears in frame 2", () => {
    // Layer: blank at frame 0, shape keyframe at frame 1
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeBlankFrame(0),
        makeShapeFrame(1, "obj-late"),
      ],
      2
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 1 (index 1): must have PlaceObject2, must NOT have RemoveObject2
    const frame1Tags = frames[1].map((i) => tags[i]);
    const places = frame1Tags.filter(
      (t) => t.code === Tag.PlaceObject2 || t.code === Tag.PlaceObject3
    );
    const removes = frame1Tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(places.length).toBeGreaterThan(0);
    expect(removes.length).toBe(0);
  });

  // Test 6b: Multiple objects removed in same frame → multiple RemoveObject2 tags
  it("emits multiple RemoveObject2 tags when multiple objects disappear in the same frame", () => {
    // Two layers, each with a shape on frame 0 that goes blank on frame 1
    const layer1 = makeLayerWithFrames(
      "l1",
      [makeShapeFrame(0, "obj-a"), makeBlankFrame(1)],
      2
    );
    const layer2 = makeLayerWithFrames(
      "l2",
      [makeShapeFrame(0, "obj-b"), makeBlankFrame(1)],
      2
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer1, layer2])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    // Frame 1 (index 1): must have 2 RemoveObject2 tags (one per removed object)
    const frame1Tags = frames[1].map((i) => tags[i]);
    const removes = frame1Tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(removes.length).toBe(2);
  });

  // Test 7: Frame 0 has object, frame 1 is blank, frame 2 has object again:
  //   tag 28 at frame 1, then tag 26 (PlaceObject2) at frame 2
  it("emits RemoveObject2 then PlaceObject2 when object disappears and reappears", () => {
    // Layer: keyframe at 0 (shape), blank at 1, keyframe at 2 (shape again)
    // Note: uses a different objId for the re-appearing object to ensure a fresh Place
    const layer = makeLayerWithFrames(
      "l1",
      [
        makeShapeFrame(0, "obj-a"),
        makeBlankFrame(1),
        makeShapeFrame(2, "obj-b"),
      ],
      3
    );
    const doc = makeDoc([makeScene("s1", "Scene 1", [layer])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(3);

    // Frame 1 (index 1): must have RemoveObject2
    const frame1Tags = frames[1].map((i) => tags[i]);
    const removes1 = frame1Tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(removes1.length).toBeGreaterThan(0);

    // Frame 2 (index 2): must have PlaceObject2 (or PlaceObject3) — new placement
    const frame2Tags = frames[2].map((i) => tags[i]);
    const places2 = frame2Tags.filter(
      (t) => t.code === Tag.PlaceObject2 || t.code === Tag.PlaceObject3
    );
    expect(places2.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SymbolInstance-based RemoveObject2 tests
// ---------------------------------------------------------------------------
// These tests verify the exact task requirement: a SymbolInstance placed on
// frame 0 that disappears on frame 1 must trigger RemoveObject2 (tag 28),
// and every RemoveObject2 body must be exactly 2 bytes (a uint16 depth field).
// ---------------------------------------------------------------------------

describe("RemoveObject2 — SymbolInstance placed on frame 0, absent on frame 1", () => {
  // Build a doc with:
  //   frame 0: SymbolInstance of a library symbol
  //   frame 1: blank keyframe (symbol no longer present)
  function makeInstanceDoc() {
    const sym = makeSymbol("sym-mc", "MyClip");
    const instanceFrame: Frame = {
      index: 0,
      isKeyframe: true,
      isEmpty: false,
      tweenType: "none",
      label: "",
      labelType: "name",
      script: "",
      sound: null,
      motionEase: 0,
      motionEaseType: "none",
      motionRotate: "none",
      motionRotateCount: 0,
      motionOrientToPath: false,
      motionSync: false,
      motionSnap: false,
      motionScale: false,
      shapeEase: 0,
      shapeEaseType: "none",
      shapeBlend: "distributive",
      displayObjects: [makeInstanceObj("inst-1", sym.id)],
    };
    const blankFrame: Frame = makeBlankFrame(1);
    const layer = makeLayerWithFrames("l1", [instanceFrame, blankFrame], 2);
    const scene = makeScene("s1", "Scene 1", [layer]);
    return makeDoc([scene], [sym]);
  }

  it("compiles to SWF without error", () => {
    const doc = makeInstanceDoc();
    expect(() => compileDocument(doc)).not.toThrow();
    const swf = compileDocument(doc);
    expect(swf).toBeInstanceOf(Uint8Array);
    expect(swf.length).toBeGreaterThan(0);
  });

  it("emits RemoveObject2 (tag 28) on frame 1 after the instance disappears", () => {
    const doc = makeInstanceDoc();
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frames = groupByFrame(tags);

    expect(frames.length).toBeGreaterThanOrEqual(2);

    const frame1Tags = frames[1].map((i) => tags[i]);
    const removes = frame1Tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(removes.length).toBeGreaterThan(0);
  });

  it("every RemoveObject2 body is exactly 2 bytes (uint16 depth)", () => {
    // RemoveObject2 SWF spec: body = UI16 Depth — always 2 bytes.
    const doc = makeInstanceDoc();
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const allRemoves = tags.filter((t) => t.code === Tag.RemoveObject2);
    expect(allRemoves.length).toBeGreaterThan(0);
    for (const tag of allRemoves) {
      expect(tag.body.length).toBe(2);
    }
  });

  it("RemoveObject2 depth field is a positive uint16", () => {
    const doc = makeInstanceDoc();
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const removes = tags.filter((t) => t.code === Tag.RemoveObject2);
    for (const tag of removes) {
      const depth = tag.body[0] | (tag.body[1] << 8);
      expect(depth).toBeGreaterThan(0);
      expect(depth).toBeLessThanOrEqual(0xffff);
    }
  });
});
