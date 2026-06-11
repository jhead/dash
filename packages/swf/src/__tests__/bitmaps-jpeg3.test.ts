/**
 * Tests for DefineBitsJPEG3 (tag 35) encoding.
 *
 * Covers:
 *  1. encodeDefineBitsJpeg3 returns Uint8Array
 *  2. Tag code in wrapped record is 35
 *  3. First two bytes are CharacterId (UI16 LE)
 *  4. AlphaDataOffset (bytes 2-5) equals jpegBytes.length
 *  5. JPEG bytes appear verbatim at offset 6
 *  6. Alpha bytes are zlib-decompressable and match original alpha
 *  7. Total length = 6 + jpegBytes.length + compressedAlpha.length
 */

import { describe, it, expect } from "vitest";
import { decompressSync, deflateSync } from "fflate";
import { encodeDefineBitsJpeg3 } from "../bitmaps.js";
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
// Tag parsing helpers (shared with bitmaps-lossless tests)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SWFTag[] {
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
  readBits(nBits * 4);
  bitsLeft = 0;

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
    if (tagCode === 0) break;
  }
  return tags;
}

/**
 * Parse a tag record from a standalone Uint8Array (not a full SWF).
 * Returns { tagCode, body }.
 */
function parseTagRecord(tag: Uint8Array): { tagCode: number; body: Uint8Array } {
  const recordHdr = tag[0] | (tag[1] << 8);
  const tagCode = (recordHdr >> 6) & 0x3ff;
  let bodyLength = recordHdr & 0x3f;
  let hdrSize = 2;
  if (bodyLength === 0x3f) {
    bodyLength =
      tag[2] | (tag[3] << 8) | (tag[4] << 16) | (tag[5] << 24);
    hdrSize = 6;
  }
  const body = tag.slice(hdrSize, hdrSize + bodyLength);
  return { tagCode, body };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal fake JPEG bytes (not a real JPEG, but sufficient for encoding tests). */
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0x03, 0x04, 0xff, 0xd9]);

/** Alpha bytes: one per pixel, 2×3 image. */
const FAKE_ALPHA = new Uint8Array([0xff, 0x80, 0x00, 0xcc, 0x10, 0xff]);

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

function makeBitmapItem(overrides?: Partial<BitmapItem>): BitmapItem {
  return {
    id: "bitmap-1",
    name: "test.jpg",
    itemType: "bitmap",
    dataUri: "",
    originalWidth: 2,
    originalHeight: 3,
    allowSmoothing: false,
    compressionType: "photo",
    quality: 80,
    ...overrides,
  };
}

function makeBitmapObj(libraryItemId: string): BitmapDisplayObject {
  return {
    type: "bitmap",
    id: "bmp-obj-1",
    libraryItemId,
    x: 0,
    y: 0,
    width: 2,
    height: 3,
  };
}

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

/** Build ARGB pixel data with some transparent pixels. */
function makeArgbPixels(width: number, height: number, alphaValues: number[]): Uint8Array {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4 + 0] = alphaValues[i] ?? 0xff; // A
    buf[i * 4 + 1] = 0xde; // R
    buf[i * 4 + 2] = 0xad; // G
    buf[i * 4 + 3] = 0xbe; // B
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Unit tests for encodeDefineBitsJpeg3
// ---------------------------------------------------------------------------

describe("encodeDefineBitsJpeg3", () => {
  const charId = 7;
  const jpegBytes = FAKE_JPEG;
  const alphaBytes = FAKE_ALPHA;

  it("returns a Uint8Array", () => {
    const result = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("tag code in the wrapped record is 35 (DefineBitsJPEG3)", () => {
    const tag = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    const { tagCode } = parseTagRecord(tag);
    expect(tagCode).toBe(35);
  });

  it("first two body bytes are CharacterId (UI16 LE)", () => {
    const tag = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    const { body } = parseTagRecord(tag);
    const decodedCharId = body[0] | (body[1] << 8);
    expect(decodedCharId).toBe(charId);
  });

  it("AlphaDataOffset (body bytes 2–5, UI32 LE) equals jpegBytes.length", () => {
    const tag = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    const { body } = parseTagRecord(tag);
    const alphaDataOffset =
      body[2] |
      (body[3] << 8) |
      (body[4] << 16) |
      (body[5] << 24);
    expect(alphaDataOffset).toBe(jpegBytes.length);
  });

  it("JPEG bytes appear verbatim at body offset 6", () => {
    const tag = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    const { body } = parseTagRecord(tag);
    const embeddedJpeg = body.slice(6, 6 + jpegBytes.length);
    expect(embeddedJpeg).toEqual(jpegBytes);
  });

  it("trailing compressed alpha bytes are zlib-decompressable and match original alpha", () => {
    const tag = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    const { body } = parseTagRecord(tag);
    const compressedAlphaPart = body.slice(6 + jpegBytes.length);
    expect(compressedAlphaPart.length).toBeGreaterThan(0);
    const decompressed = decompressSync(compressedAlphaPart);
    expect(decompressed).toEqual(alphaBytes);
  });

  it("total tag body length equals 6 + jpegBytes.length + compressedAlpha.length", () => {
    const tag = encodeDefineBitsJpeg3(charId, jpegBytes, alphaBytes);
    const { body } = parseTagRecord(tag);
    const compressedAlpha = deflateSync(alphaBytes);
    const expectedBodyLength = 6 + jpegBytes.length + compressedAlpha.length;
    expect(body.length).toBe(expectedBodyLength);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: compileDocument uses tag 35 for photo bitmaps with alpha
// ---------------------------------------------------------------------------

describe("compileDocument with DefineBitsJPEG3", () => {
  // Minimal valid JPEG data URI (1x1 grey pixel)
  const minJpegBase64 =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAAR" +
    "CAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=";
  const jpegDataUri = `data:image/jpeg;base64,${minJpegBase64}`;

  it("emits tag 35 (DefineBitsJPEG3) when photo bitmap with transparent pixels is provided", () => {
    const bitmapItem = makeBitmapItem({
      compressionType: "photo",
      dataUri: jpegDataUri,
      originalWidth: 1,
      originalHeight: 1,
    });
    const bmpObj: BitmapDisplayObject = {
      ...makeBitmapObj(bitmapItem.id),
      width: 1,
      height: 1,
    };
    const doc = makeDoc(bitmapItem, bmpObj);

    // Pixel data with alpha = 128 (semi-transparent)
    const pixels = makeArgbPixels(1, 1, [128]);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: 1, height: 1, pixels }],
    ]);

    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(35);
    expect(tagCodes).not.toContain(21);
  });

  it("emits tag 21 (DefineBitsJPEG2) when photo bitmap with fully opaque pixels is provided", () => {
    const bitmapItem = makeBitmapItem({
      compressionType: "photo",
      dataUri: jpegDataUri,
      originalWidth: 1,
      originalHeight: 1,
    });
    const bmpObj: BitmapDisplayObject = {
      ...makeBitmapObj(bitmapItem.id),
      width: 1,
      height: 1,
    };
    const doc = makeDoc(bitmapItem, bmpObj);

    // All pixels fully opaque (alpha = 255)
    const pixels = makeArgbPixels(1, 1, [255]);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: 1, height: 1, pixels }],
    ]);

    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(21);
    expect(tagCodes).not.toContain(35);
  });
});
