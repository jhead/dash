/**
 * Tests for PlaceObject2 HasColorTransform flag behaviour.
 *
 * Tag codes:
 *   26  PlaceObject2
 *
 * PlaceObject2 flags byte:
 *   bit 0: HasMove           (0x01)
 *   bit 1: HasCharacter      (0x02)
 *   bit 2: HasMatrix         (0x04)
 *   bit 3: HasColorTransform (0x08)
 *   bit 4: HasRatio          (0x10)
 *   bit 5: HasName           (0x20)
 *   bit 6: HasClipDepth      (0x40)
 *   bit 7: HasClipActions    (0x80)
 *
 * ShapeDisplayObject does NOT have a colorEffect/colorTransform field; only
 * SymbolInstance carries a colorEffect.  The tests here verify:
 *   1. A basic SWF with a shape compiles without error.
 *   2. The PlaceObject2 flags byte is readable from the compiled SWF.
 *   3. A shape (no colorEffect support) does NOT set HasColorTransform (0x08).
 *   4. A symbol instance with colorEffect set DOES set HasColorTransform (0x08).
 *   5. A symbol instance without colorEffect does NOT set HasColorTransform.
 * Unimplemented tween-level color transform is marked todo.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  ShapeDisplayObject,
  SymbolInstance,
  TextDisplayObject,
} from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

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
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document fixture helpers
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

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(displayObjects: readonly unknown[] = []): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
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
    displayObjects: displayObjects as Frame["displayObjects"],
  };
}

function makeLayer(frames: Frame[]): Layer {
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
    frames,
    frameCount: frames.length,
  };
}

function makeScene(layers: Layer[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers },
  };
}

function makeSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    scale9Grid: null,
    timeline: { layers: [makeLayer([makeFrame([])])] },
    linkage: DEFAULT_LINKAGE,
  };
}

function makeDoc(scenes: Scene[], symbols: Symbol[] = []): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: { items: symbols, folders: [] },
  };
}

/** Minimal solid-fill ShapeDisplayObject for use in tests. */
function makeShape(id: string): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: {
      id: "shape-obj-1",
      paths: [
        {
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          stroke: undefined,
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 100, y: 0 } },
            { type: "line", to: { x: 100, y: 100 } },
            { type: "line", to: { x: 0, y: 100 } },
          ],
          closed: true,
        },
      ],
    },
  };
}

const TAG_PLACE_OBJECT2 = 26;
const FLAG_HAS_COLOR_TRANSFORM = 0x08;

// ---------------------------------------------------------------------------
// Multi-frame document helpers
// ---------------------------------------------------------------------------

/**
 * Build a Frame with explicit index/keyframe/isEmpty/tweenType overrides.
 * Used for constructing tween layers.
 */
function makeFrameAt(
  index: number,
  overrides: Partial<Frame> = {}
): Frame {
  return {
    index,
    isKeyframe: false,
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
    ...overrides,
  };
}

function makeLayerWithFrameCount(frames: Frame[], frameCount: number): Layer {
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
    frames,
    frameCount,
  };
}

/**
 * Group PlaceObject2 tags by SWF frame (separated by ShowFrame tags).
 * Returns an array where index N is the list of PlaceObject2 tags in frame N.
 */
function groupPlaceByFrame(swf: Uint8Array): Uint8Array[][] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const frames: Uint8Array[][] = [];
  let currentFrame: Uint8Array[] = [];

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
    const body = swf.slice(bodyStart, bodyStart + bodyLength);

    if (tagCode === Tag.PlaceObject2) {
      currentFrame.push(body);
    } else if (tagCode === Tag.ShowFrame) {
      frames.push(currentFrame);
      currentFrame = [];
    }

    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaceObject2 HasColorTransform flag", () => {
  it("basic SWF with a shape display object compiles without error", () => {
    const shape = makeShape("shape-1");
    const doc = makeDoc([
      makeScene([makeLayer([makeFrame([shape])])]),
    ]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("PlaceObject2 flags byte is present and readable in compiled SWF", () => {
    const sym = makeSymbol("sym-1", "Symbol 1");
    const instance: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
    };
    const doc = makeDoc(
      [makeScene([makeLayer([makeFrame([instance])])])],
      [sym]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThan(0);
    // flags byte is always present as byte 0 of the body
    for (const tag of placeTags) {
      expect(tag.body.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("shape display object (no colorEffect field) does NOT set HasColorTransform (0x08)", () => {
    const shape = makeShape("shape-1");
    const doc = makeDoc([
      makeScene([makeLayer([makeFrame([shape])])]),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    // No PlaceObject2 tag for a shape should have HasColorTransform set
    const withCxform = placeTags.find(
      (t) => (t.body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(withCxform).toBeUndefined();
  });

  it("symbol instance with colorEffect alpha=50 DOES set HasColorTransform (0x08)", () => {
    const sym = makeSymbol("sym-1", "Symbol 1");
    const instance: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      colorEffect: { type: "alpha", alpha: 50 },
    };
    const doc = makeDoc(
      [makeScene([makeLayer([makeFrame([instance])])])],
      [sym]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThan(0);

    const instanceTag = placeTags.find(
      (t) => (t.body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(instanceTag).toBeDefined();
    // HasCharacter (0x02) and HasMatrix (0x04) should also be set
    expect(instanceTag!.body[0] & 0x06).toBe(0x06);
  });

  it("symbol instance without colorEffect does NOT set HasColorTransform (0x08)", () => {
    const sym = makeSymbol("sym-1", "Symbol 1");
    const instance: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
    };
    const doc = makeDoc(
      [makeScene([makeLayer([makeFrame([instance])])])],
      [sym]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const withCxform = placeTags.find(
      (t) => (t.body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(withCxform).toBeUndefined();
  });

  it("text field with tint colorEffect emits CXFormWithAlpha (HasColorTransform) in PlaceObject2", () => {
    const textObj: TextDisplayObject = {
      type: "text",
      id: "text-1",
      x: 10,
      y: 10,
      width: 200,
      height: 30,
      text: "Hello",
      textType: "static",
      fontFamily: "Arial",
      fontSize: 12,
      bold: false,
      italic: false,
      color: { r: 0, g: 0, b: 0, a: 255 },
      align: "left",
      multiline: false,
      wordWrap: false,
      colorEffect: { type: "tint", tintColor: "#ff0000", tintAmount: 100 },
    };
    const doc = makeDoc([makeScene([makeLayer([makeFrame([textObj])])])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThan(0);
    const withCxform = placeTags.find(
      (t) => (t.body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(withCxform).toBeDefined();
    // HasCharacter (0x02) and HasMatrix (0x04) should also be set
    expect(withCxform!.body[0] & 0x06).toBe(0x06);
  });

  it("text field without colorEffect does NOT set HasColorTransform (0x08)", () => {
    const textObj: TextDisplayObject = {
      type: "text",
      id: "text-2",
      x: 10,
      y: 10,
      width: 200,
      height: 30,
      text: "Hello",
      textType: "static",
      fontFamily: "Arial",
      fontSize: 12,
      bold: false,
      italic: false,
      color: { r: 0, g: 0, b: 0, a: 255 },
      align: "left",
      multiline: false,
      wordWrap: false,
      // no colorEffect
    };
    const doc = makeDoc([makeScene([makeLayer([makeFrame([textObj])])])]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const withCxform = placeTags.find(
      (t) => (t.body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(withCxform).toBeUndefined();
  });

  it("motion tween with per-keyframe colorEffect produces HasColorTransform on tween-interpolated frames", () => {
    // Build a 3-frame motion tween: keyframe 0 (alpha=50) → keyframe 2 (alpha=0).
    // Frame 1 is tween-interpolated; at t=0.5 the alpha is ~25, well below 100,
    // so the compiler must emit encodePlaceObject2WithCXForm (HasColorTransform=0x08).
    const sym = makeSymbol("sym-1", "Symbol 1");

    const startInstance: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-1",
      x: 0,
      y: 0,
      colorEffect: { type: "alpha", alpha: 50 },
    };
    const endInstance: SymbolInstance = {
      type: "instance",
      id: "inst-1",
      symbolId: "sym-1",
      x: 100,
      y: 0,
      colorEffect: { type: "alpha", alpha: 0 },
    };

    const frames: Frame[] = [
      makeFrameAt(0, {
        isKeyframe: true,
        isEmpty: false,
        tweenType: "motion",
        displayObjects: [startInstance],
      }),
      makeFrameAt(1, {
        isKeyframe: false,
        isEmpty: false,
        tweenType: "motion",
      }),
      makeFrameAt(2, {
        isKeyframe: true,
        isEmpty: false,
        tweenType: "none",
        displayObjects: [endInstance],
      }),
    ];

    const layer = makeLayerWithFrameCount(frames, 3);
    const doc = makeDoc([makeScene([layer])], [sym]);
    const swf = compileDocument(doc);

    // Group PlaceObject2 tags by SWF frame.
    // Frame 0 (initial placement) should have HasColorTransform because alpha=50.
    // Frame 1 (tween-interpolated) should also have HasColorTransform (interpolated alpha<100).
    const frameGroups = groupPlaceByFrame(swf);
    expect(frameGroups.length).toBeGreaterThanOrEqual(2);

    // The tween-interpolated frame (frame index 1) must have a PlaceObject2
    // with HasColorTransform (0x08) set.
    const frame1Tags = frameGroups[1] ?? [];
    expect(frame1Tags.length).toBeGreaterThan(0);

    const withCxform = frame1Tags.find(
      (body) => (body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(withCxform).toBeDefined();
  });

  it("shape tween (tweenType=shape) does not emit HasColorTransform (shapes have no colorEffect)", () => {
    // ShapeDisplayObject has no colorEffect field; shape tweens interpolate
    // geometry only.  No PlaceObject2 tag should ever set HasColorTransform.
    const startShape = makeShape("shape-1");
    // Second keyframe shape (different position so the tween actually moves)
    const endShape: ShapeDisplayObject = {
      ...makeShape("shape-1"),
      x: 100,
      y: 0,
    };

    const frames: Frame[] = [
      makeFrameAt(0, {
        isKeyframe: true,
        isEmpty: false,
        tweenType: "shape",
        displayObjects: [startShape],
      }),
      makeFrameAt(1, {
        isKeyframe: false,
        isEmpty: false,
        tweenType: "shape",
      }),
      makeFrameAt(2, {
        isKeyframe: true,
        isEmpty: false,
        tweenType: "none",
        displayObjects: [endShape],
      }),
    ];

    const layer = makeLayerWithFrameCount(frames, 3);
    const doc = makeDoc([makeScene([layer])]);
    const swf = compileDocument(doc);

    // Verify: no PlaceObject2 across all frames has HasColorTransform set.
    const tags = parseTags(swf);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    const withCxform = placeTags.find(
      (t) => (t.body[0] & FLAG_HAS_COLOR_TRANSFORM) !== 0
    );
    expect(withCxform).toBeUndefined();
  });
});
