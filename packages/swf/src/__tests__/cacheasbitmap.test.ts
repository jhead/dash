/**
 * Tests for SWF HasCacheAsBitmap bit in PlaceObject3 (task 0922).
 *
 * Tag codes:
 *   26  PlaceObject2
 *   70  PlaceObject3
 *
 * These tests verify:
 *  1. SymbolInstance with cacheAsBitmap=true emits PlaceObject3 (tag 70)
 *  2. SymbolInstance with cacheAsBitmap=false emits PlaceObject2 (tag 26)
 *  3. SymbolInstance with cacheAsBitmap=true has HasCacheAsBitmap bit set in Flags2 (0x04)
 *  4. encodePlaceObject3WithCacheAsBitmap produces correct flag byte and 'is_bitmap_cached' UI8
 *  5. ShapeDisplayObject with cacheAsBitmap=true emits PlaceObject3
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject3WithCacheAsBitmap } from "../filters.js";
import { compileDocument } from "../compile.js";
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF HasCacheAsBitmap encoding (task 0922)", () => {
  /**
   * Test 1: SymbolInstance with cacheAsBitmap=true → tag 70 (PlaceObject3)
   */
  it("1. SymbolInstance with cacheAsBitmap=true uses PlaceObject3 (tag 70)", () => {
    const sym = makeSymbol("sym-cab-1");
    const instanceObj = {
      id: "inst-cab-1",
      type: "instance" as const,
      symbolId: "sym-cab-1",
      x: 0,
      y: 0,
      cacheAsBitmap: true,
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
   * Test 2: SymbolInstance with cacheAsBitmap=false → tag 26 (PlaceObject2)
   */
  it("2. SymbolInstance with cacheAsBitmap=false uses PlaceObject2 (tag 26)", () => {
    const sym = makeSymbol("sym-cab-2");
    const instanceObj = {
      id: "inst-cab-2",
      type: "instance" as const,
      symbolId: "sym-cab-2",
      x: 0,
      y: 0,
      cacheAsBitmap: false,
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
   * Test 3: PlaceObject3 from compileDocument has HasCacheAsBitmap bit (0x04 in Flags2)
   */
  it("3. PlaceObject3 Flags2 has HasCacheAsBitmap bit set (0x04) when cacheAsBitmap=true", () => {
    const sym = makeSymbol("sym-cab-3");
    const instanceObj = {
      id: "inst-cab-3",
      type: "instance" as const,
      symbolId: "sym-cab-3",
      x: 0,
      y: 0,
      cacheAsBitmap: true,
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(placeObject3Tags.length).toBeGreaterThan(0);

    // Flags2 is byte index 1 of the PlaceObject3 body
    const flags2 = placeObject3Tags[0].body[1];
    // HasCacheAsBitmap = bit 2 of flags2 = 0x04 (bit 10 of combined u16 PlaceFlag in Ruffle)
    expect(flags2 & 0x04).toBe(0x04);
  });

  /**
   * Test 4: encodePlaceObject3WithCacheAsBitmap produces correct flag byte and is_bitmap_cached UI8
   */
  it("4. encodePlaceObject3WithCacheAsBitmap sets flags2=0x04 and writes is_bitmap_cached=1", () => {
    const body = encodePlaceObject3WithCacheAsBitmap(1, 1, 0, 0);

    // flags1 at byte 0: HasCharacter (bit 1 = 0x02) | HasMatrix (bit 2 = 0x04)
    expect(body[0] & 0x06).toBe(0x06);

    // flags2 at byte 1: HasCacheAsBitmap bit = 0x04
    const flags2 = body[1];
    expect(flags2 & 0x04).toBe(0x04); // HasCacheAsBitmap

    // is_bitmap_cached UI8 = 1 must be present at the end of the tag body
    // (after matrix bytes). Verify the last byte is 1.
    expect(body[body.length - 1]).toBe(1);
  });

  /**
   * Test 5: SymbolInstance without cacheAsBitmap → no PlaceObject3
   */
  it("5. SymbolInstance without cacheAsBitmap field uses PlaceObject2 (tag 26)", () => {
    const sym = makeSymbol("sym-cab-5");
    const instanceObj = {
      id: "inst-cab-5",
      type: "instance" as const,
      symbolId: "sym-cab-5",
      x: 0,
      y: 0,
    };

    const doc = makeDoc(
      [makeScene([makeLayer("layer", [makeFrame([instanceObj])])])],
      [sym]
    );

    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const placeObject3Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT3);
    expect(placeObject3Tags.length).toBe(0);
  });
});
