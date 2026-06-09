/**
 * Tests for DefineBitsLossless2 (tag 36) encoding.
 *
 * Covers:
 *  1. Tag code is 36
 *  2. BitmapFormat byte is 5 (32-bit ARGB)
 *  3. Width and height fields are correct
 *  4. ZlibBitmapData is ZLIB-decompressable and matches original pixels
 *  5. compileSWF with lossless pixel data → tag 36 in output
 *  6. compileSWF without pixel data → tag 21 (DefineBitsJPEG2) fallback
 */

import { describe, it, expect } from "vitest";
import { decompressSync } from "fflate";
import { encodeDefineBitsLossless2 } from "../bitmaps.js";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  BitmapItem,
  Frame,
  Layer,
  Scene,
} from "@flash/core";
import type { BitmapDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag parsing helpers
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SWFTag[] {
  // Skip SWF file header to find tags offset
  // Header: 3 signature + 1 version + 4 fileLength = 8 bytes
  // Then RECT (bit-packed), then FrameRate UI16 + FrameCount UI16
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }

  const nBits = readBits(5);
  readBits(nBits * 4); // skip xMin, xMax, yMin, yMax

  // flush to byte boundary
  bitsLeft = 0;

  // skip FrameRate (2) + FrameCount (2)
  const tagsOffset = byteOff + 4;

  const tags: SWFTag[] = [];
  let pos = tagsOffset;
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos] | (bytes[pos + 1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({
      code: tagCode,
      body: bytes.slice(bodyStart, bodyStart + bodyLength),
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break; // End
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Fixtures
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

/** Build a 2×2 ARGB pixel buffer (opaque red, green, blue, transparent) */
function makeTestPixels(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4 + 0] = 0xff; // A
    buf[i * 4 + 1] = 0xde; // R
    buf[i * 4 + 2] = 0xad; // G
    buf[i * 4 + 3] = 0xbe; // B
  }
  return buf;
}

/** Create a minimal BitmapItem. */
function makeBitmapItem(overrides?: Partial<BitmapItem>): BitmapItem {
  return {
    id: "bitmap-1",
    name: "test.png",
    itemType: "bitmap",
    dataUri: "",
    originalWidth: 4,
    originalHeight: 4,
    allowSmoothing: false,
    compressionType: "lossless",
    quality: 100,
    ...overrides,
  };
}

/** Create a minimal BitmapDisplayObject referencing the given library item. */
function makeBitmapObj(libraryItemId: string): BitmapDisplayObject {
  return {
    type: "bitmap",
    id: "bmp-obj-1",
    libraryItemId,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
  };
}

/** Create a minimal Frame containing the given display objects. */
function makeFrame(displayObjects: readonly BitmapDisplayObject[]): Frame {
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
    displayObjects,
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
    frameCount: frames.length,
    frames,
  };
}

function makeScene(layers: Layer[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers },
  };
}

function makeDoc(bitmapItem: BitmapItem, bmpObj: BitmapDisplayObject): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeLayer([makeFrame([bmpObj])])])],
    library: { items: [bitmapItem], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests for encodeDefineBitsLossless2 (unit tests)
// ---------------------------------------------------------------------------

describe("encodeDefineBitsLossless2", () => {
  const WIDTH = 4;
  const HEIGHT = 4;
  const pixels = makeTestPixels(WIDTH, HEIGHT);

  function encodeAndParseHeader(charId: number): { tagCode: number; body: Uint8Array } {
    const tag = encodeDefineBitsLossless2(charId, WIDTH, HEIGHT, pixels);
    // Parse the tag record header
    const recordHdr = tag[0] | (tag[1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let hdrSize = 2;
    let bodyLength = recordHdr & 0x3f;
    if (bodyLength === 0x3f) {
      bodyLength =
        tag[2] | (tag[3] << 8) | (tag[4] << 16) | (tag[5] << 24);
      hdrSize = 6;
    }
    const body = tag.slice(hdrSize, hdrSize + bodyLength);
    return { tagCode, body };
  }

  it("produces tag code 36 (DefineBitsLossless2)", () => {
    const { tagCode } = encodeAndParseHeader(1);
    expect(tagCode).toBe(36);
  });

  it("sets BitmapFormat byte to 5 (32-bit ARGB)", () => {
    const { body } = encodeAndParseHeader(1);
    // body[0..1] = BitmapId UI16, body[2] = BitmapFormat
    expect(body[2]).toBe(5);
  });

  it("encodes width and height correctly", () => {
    const { body } = encodeAndParseHeader(1);
    // body[3..4] = BitmapWidth UI16 LE, body[5..6] = BitmapHeight UI16 LE
    const width = body[3] | (body[4] << 8);
    const height = body[5] | (body[6] << 8);
    expect(width).toBe(WIDTH);
    expect(height).toBe(HEIGHT);
  });

  it("encodes charId correctly in the body", () => {
    const charId = 42;
    const { body } = encodeAndParseHeader(charId);
    const decodedCharId = body[0] | (body[1] << 8);
    expect(decodedCharId).toBe(charId);
  });

  it("ZlibBitmapData is ZLIB-decompressable and matches original pixels", () => {
    const { body } = encodeAndParseHeader(1);
    // body[7..] = ZLIB-compressed pixel data
    const zlibData = body.slice(7);
    expect(zlibData.length).toBeGreaterThan(0);

    const decompressed = decompressSync(zlibData);
    expect(decompressed.length).toBe(pixels.length);
    expect(decompressed).toEqual(pixels);
  });

  it("produces a non-empty byte array for 1x1 pixel input", () => {
    const singlePixel = new Uint8Array([0xff, 0x00, 0x00, 0xff]); // opaque red ARGB
    const tag = encodeDefineBitsLossless2(2, 1, 1, singlePixel);
    expect(tag.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for compileSWF integration (tag 36 vs tag 21)
// ---------------------------------------------------------------------------

describe("compileDocument with lossless bitmaps", () => {
  it("emits tag 36 (DefineBitsLossless2) when bitmapPixels provided and compressionType=lossless", () => {
    const bitmapItem = makeBitmapItem({ compressionType: "lossless" });
    const bmpObj = makeBitmapObj(bitmapItem.id);
    const doc = makeDoc(bitmapItem, bmpObj);

    const pixels = makeTestPixels(4, 4);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: 4, height: 4, pixels }],
    ]);

    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(36);
    expect(tagCodes).not.toContain(21);
  });

  it("falls back to tag 21 (DefineBitsJPEG2) when no bitmapPixels provided for lossless bitmap with dataUri", () => {
    // Minimal valid PNG as base64 (1x1 transparent)
    // This is a real minimal PNG binary
    const minPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bitmapItem = makeBitmapItem({
      compressionType: "lossless",
      dataUri: `data:image/png;base64,${minPngBase64}`,
    });
    const bmpObj = makeBitmapObj(bitmapItem.id);
    const doc = makeDoc(bitmapItem, bmpObj);

    // No bitmapPixels passed → falls back to DefineBitsJPEG2
    const swf = compileDocument(doc);
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(21);
    expect(tagCodes).not.toContain(36);
  });

  it("still uses tag 21 (DefineBitsJPEG2) for photo-compression bitmaps even when pixel data provided", () => {
    const bitmapItem = makeBitmapItem({ compressionType: "photo" });
    const bmpObj = makeBitmapObj(bitmapItem.id);
    const doc = makeDoc(bitmapItem, bmpObj);

    const pixels = makeTestPixels(4, 4);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: 4, height: 4, pixels }],
    ]);

    // compressionType "photo" → should use DefineBitsJPEG2 path (no dataUri = no tag emitted)
    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    // No tag 36 since compressionType is "photo"
    expect(tagCodes).not.toContain(36);
  });

  it("tag 36 body has correct BitmapFormat=5 in the compiled output", () => {
    const bitmapItem = makeBitmapItem({ compressionType: "lossless" });
    const bmpObj = makeBitmapObj(bitmapItem.id);
    const doc = makeDoc(bitmapItem, bmpObj);

    const pixels = makeTestPixels(4, 4);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: 4, height: 4, pixels }],
    ]);

    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tag36 = tags.find((t) => t.code === 36);

    expect(tag36).toBeDefined();
    // body[2] = BitmapFormat
    expect(tag36!.body[2]).toBe(5);
  });

  it("tag 36 body has correct width and height in the compiled output", () => {
    const W = 8;
    const H = 6;
    const bitmapItem = makeBitmapItem({
      compressionType: "lossless",
      originalWidth: W,
      originalHeight: H,
    });
    const bmpObj: BitmapDisplayObject = {
      ...makeBitmapObj(bitmapItem.id),
      width: W,
      height: H,
    };
    const doc = makeDoc(bitmapItem, bmpObj);

    const pixels = makeTestPixels(W, H);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: W, height: H, pixels }],
    ]);

    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tag36 = tags.find((t) => t.code === 36);

    expect(tag36).toBeDefined();
    const width = tag36!.body[3] | (tag36!.body[4] << 8);
    const height = tag36!.body[5] | (tag36!.body[6] << 8);
    expect(width).toBe(W);
    expect(height).toBe(H);
  });
});
