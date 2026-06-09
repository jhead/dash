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
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  ShapeDisplayObject,
  SymbolInstance,
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
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
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
          fill: { type: "solid", color: "#ff0000" },
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

  it.todo(
    "motion tween with per-keyframe colorEffect produces HasColorTransform on tween-interpolated frames"
  );

  it.todo(
    "shape tween (tweenType=shape) does not emit HasColorTransform (shapes have no colorEffect)"
  );
});
