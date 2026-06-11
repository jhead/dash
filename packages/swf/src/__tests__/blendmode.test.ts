/**
 * Tests for SWF blend mode encoding for SymbolInstance objects.
 *
 * Tag codes:
 *   26  PlaceObject2
 *   70  PlaceObject3
 *
 * These tests verify:
 *  1. Instance with blendMode='multiply' uses tag 70 (PlaceObject3)
 *  2. Instance with blendMode='normal' uses tag 26 (PlaceObject2)
 *  3. Flags2 has HasBlendMode bit set (0x02)
 *  4. BlendMode byte = 3 for 'multiply'
 *  5. BlendMode byte = 13 for 'overlay'
 *  6. Instance with both filter and blendMode → single PlaceObject3 with both flags set
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject3WithBlendMode, SWF_BLEND_MODE } from "../filters.js";
import { compileDocument } from "../compile.js";
import type { BlurFilter } from "@flash/core";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_PLACE_OBJECT2 = 26;
const TAG_PLACE_OBJECT3 = 70;
const TAG_END = 0;

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
    if (tagCode === TAG_END) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers (mirrored from filters.test.ts)
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

function makeFrame(displayObjects: unknown[] = [], index = 0): Frame {
  return {
    index,
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

function makeLayer(id: string, frames: Frame[]): Layer {
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

function makeSymbol(id: string): Symbol {
  return {
    id,
    name: id,
    itemType: "symbol",
    symbolType: "movieclip",
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
    timeline: {
      layers: [makeLayer("layer", [makeFrame([], 0)])],
    },
  };
}

function makeDoc(scenes: Scene[], symbols: Symbol[] = []): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes,
    library: {
      items: symbols,
      folders: [],
    },
  };
}

function makeBlurFilter(overrides: Partial<BlurFilter> = {}): BlurFilter {
  return {
    type: "blur",
    blurX: 4,
    blurY: 4,
    quality: 1,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF blend mode encoding", () => {
  /**
   * Test 1: Instance with blendMode='multiply' → tag 70 (PlaceObject3)
   */
  it("1. SymbolInstance with blendMode='multiply' uses PlaceObject3 (tag 70)", () => {
    const sym = makeSymbol("sym-blend-1");
    const instanceObj = {
      id: "inst-blend-1",
      type: "instance" as const,
      symbolId: "sym-blend-1",
      x: 0,
      y: 0,
      blendMode: "multiply" as const,
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(placeObject3Tags.length).toBeGreaterThan(0);
  });

  /**
   * Test 2: Instance with blendMode='normal' → tag 26 (PlaceObject2, no PlaceObject3 needed)
   */
  it("2. SymbolInstance with blendMode='normal' uses PlaceObject2 (tag 26)", () => {
    const sym = makeSymbol("sym-blend-2");
    const instanceObj = {
      id: "inst-blend-2",
      type: "instance" as const,
      symbolId: "sym-blend-2",
      x: 0,
      y: 0,
      blendMode: "normal" as const,
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    const placeObject2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    expect(placeObject2Tags.length).toBeGreaterThan(0);
    expect(placeObject3Tags.length).toBe(0);
  });

  /**
   * Test 3: Flags2 has HasBlendMode bit set (0x02) when blend mode is non-normal
   */
  it("3. PlaceObject3 Flags2 has HasBlendMode bit set (0x02) for non-normal blend mode", () => {
    const body = encodePlaceObject3WithBlendMode(1, 1, 0, 0, "multiply");

    // Flags2 is at byte index 1
    const flags2 = body[1];
    expect(flags2 & 0x02).toBe(0x02); // bit 1 = HasBlendMode
  });

  /**
   * Test 4: BlendMode byte = 3 for 'multiply'
   */
  it("4. BlendMode byte value is 3 for 'multiply'", () => {
    expect(SWF_BLEND_MODE["multiply"]).toBe(3);

    // Also verify by encoding and checking the last byte
    const body = encodePlaceObject3WithBlendMode(1, 1, 0, 0, "multiply");
    // BlendMode is the last byte in the body (after matrix, no filters)
    const blendByte = body[body.length - 1];
    expect(blendByte).toBe(3);
  });

  /**
   * Test 5: BlendMode byte = 13 for 'overlay'
   */
  it("5. BlendMode byte value is 13 for 'overlay'", () => {
    expect(SWF_BLEND_MODE["overlay"]).toBe(13);

    const body = encodePlaceObject3WithBlendMode(1, 1, 0, 0, "overlay");
    const blendByte = body[body.length - 1];
    expect(blendByte).toBe(13);
  });

  /**
   * Test 6: Instance with both filter AND blendMode → single PlaceObject3
   * with both HasFilterList (0x10) and HasBlendMode (0x02) bits set in Flags2
   */
  it("6. Instance with filter + blendMode produces PlaceObject3 with both Flags2 bits set", () => {
    const blur = makeBlurFilter();
    const body = encodePlaceObject3WithBlendMode(1, 1, 0, 0, "screen", [blur]);

    // Flags2 is at byte index 1
    const flags2 = body[1];
    expect(flags2 & 0x02).toBe(0x02); // HasBlendMode
    expect(flags2 & 0x10).toBe(0x10); // HasFilterList

    // Also verify via compileDocument that a single PlaceObject3 is emitted
    const sym = makeSymbol("sym-blend-6");
    const instanceObj = {
      id: "inst-blend-6",
      type: "instance" as const,
      symbolId: "sym-blend-6",
      x: 0,
      y: 0,
      blendMode: "screen" as const,
      filters: [blur],
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    const placeObject2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);

    // Should produce exactly one PlaceObject3, no PlaceObject2 for this instance
    expect(placeObject3Tags.length).toBe(1);
    expect(placeObject2Tags.length).toBe(0);

    // Check the tag body Flags2 has both bits
    const tagFlags2 = placeObject3Tags[0].body[1];
    expect(tagFlags2 & 0x02).toBe(0x02); // HasBlendMode
    expect(tagFlags2 & 0x10).toBe(0x10); // HasFilterList
  });
});
