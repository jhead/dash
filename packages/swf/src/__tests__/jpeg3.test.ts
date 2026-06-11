/**
 * Task 0603 — SWF DefineBitsJPEG3 tag and image encoding tests.
 *
 * Verifies that the compiler correctly selects DefineBitsJPEG3 (tag 35)
 * or DefineBitsJPEG2 (tag 21) based on pixel transparency, and that
 * compressionType:"lossless" always selects DefineBitsLossless2 (tag 36).
 *
 * Tag codes:
 *   21  DefineBitsJPEG2    (JPEG, no alpha)
 *   35  DefineBitsJPEG3    (JPEG + compressed alpha)
 *   36  DefineBitsLossless2
 */

import { describe, it, expect } from "vitest";
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
// Tag codes
// ---------------------------------------------------------------------------

const TAG_DEFINE_BITS_JPEG2 = 21;
const TAG_DEFINE_BITS_JPEG3 = 35;
const TAG_DEFINE_BITS_LOSSLESS2 = 36;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SwfTag[] {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
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
    tags.push({ code: tagCode, body: bytes.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
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

function makeBitmapFrame(displayObjects: readonly BitmapDisplayObject[]): Frame {
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
  return { id: "scene-1", name: "Scene 1", timeline: { layers } };
}

function makeDoc(items: BitmapItem[], displayObjects: BitmapDisplayObject[]): FlashDocument {
  const frame = makeBitmapFrame(displayObjects);
  const layer = makeLayer("layer-1", [frame]);
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS },
    scenes: [makeScene([layer])],
    library: { items, folders: [] },
  };
}

function makeEmptyDoc(): FlashDocument {
  return {
    id: "doc-empty",
    properties: { ...BASE_PROPS },
    scenes: [{ id: "s1", name: "Scene 1", timeline: { layers: [makeLayer("l1", [makeBlankFrame(0)])] } }],
    library: { items: [], folders: [] },
  };
}

function makeBitmapItem(id: string, overrides?: Partial<BitmapItem>): BitmapItem {
  return {
    id,
    name: `${id}.jpg`,
    itemType: "bitmap",
    dataUri: "",
    originalWidth: 1,
    originalHeight: 1,
    allowSmoothing: false,
    compressionType: "photo",
    quality: 80,
    ...overrides,
  };
}

function makeBitmapObj(id: string, libraryItemId: string): BitmapDisplayObject {
  return { type: "bitmap", id, libraryItemId, x: 0, y: 0, width: 1, height: 1 };
}

/** Build ARGB pixels for a 1x1 image with a given alpha value. */
function makeArgbPixels(alpha: number): Uint8Array {
  return new Uint8Array([alpha, 0xde, 0xad, 0xbe]);
}

// Minimal 1x1 JPEG data URI (valid structure for the compiler).
const JPEG_DATA_URI =
  "data:image/jpeg;base64," +
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineBitsJPEG3 tag encoding (task 0603)", () => {
  it("1. doc with compressionType:'photo' bitmap compiles without error", () => {
    const item = makeBitmapItem("bmp1", { dataUri: JPEG_DATA_URI });
    const obj = makeBitmapObj("obj1", "bmp1");
    const doc = makeDoc([item], [obj]);
    const pixels = new Map([["bmp1", { width: 1, height: 1, pixels: makeArgbPixels(128) }]]);
    expect(() => compileDocument(doc, { bitmapPixels: pixels })).not.toThrow();
  });

  it("2. compressionType:'photo' with semi-transparent pixel emits tag 35 (DefineBitsJPEG3)", () => {
    const item = makeBitmapItem("bmp1", { dataUri: JPEG_DATA_URI });
    const obj = makeBitmapObj("obj1", "bmp1");
    const doc = makeDoc([item], [obj]);
    const pixels = new Map([["bmp1", { width: 1, height: 1, pixels: makeArgbPixels(128) }]]);
    const swf = compileDocument(doc, { bitmapPixels: pixels });
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_DEFINE_BITS_JPEG3)).toBe(true);
  });

  it("3. DefineBitsJPEG3 tag body starts with a non-zero CharacterId UI16", () => {
    const item = makeBitmapItem("bmp1", { dataUri: JPEG_DATA_URI });
    const obj = makeBitmapObj("obj1", "bmp1");
    const doc = makeDoc([item], [obj]);
    const pixels = new Map([["bmp1", { width: 1, height: 1, pixels: makeArgbPixels(128) }]]);
    const swf = compileDocument(doc, { bitmapPixels: pixels });
    const tags = parseSWFTags(swf);
    const jpeg3Tag = tags.find((t) => t.code === TAG_DEFINE_BITS_JPEG3);
    expect(jpeg3Tag).toBeDefined();
    const charId = jpeg3Tag!.body[0] | (jpeg3Tag!.body[1] << 8);
    expect(charId).toBeGreaterThan(0);
  });

  it("4. compressionType:'lossless' with pixel data emits tag 36 (DefineBitsLossless2)", () => {
    const item = makeBitmapItem("bmp1", {
      compressionType: "lossless",
      dataUri: "",
      originalWidth: 1,
      originalHeight: 1,
    });
    const obj = makeBitmapObj("obj1", "bmp1");
    const doc = makeDoc([item], [obj]);
    const pixels = new Map([["bmp1", { width: 1, height: 1, pixels: makeArgbPixels(255) }]]);
    const swf = compileDocument(doc, { bitmapPixels: pixels });
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2)).toBe(true);
    expect(tags.some((t) => t.code === TAG_DEFINE_BITS_JPEG3)).toBe(false);
  });

  it("5. doc with no bitmaps produces no bitmap tags (21, 35, or 36)", () => {
    const doc = makeEmptyDoc();
    const swf = compileDocument(doc);
    const tags = parseSWFTags(swf);
    const bitmapCodes = new Set([TAG_DEFINE_BITS_JPEG2, TAG_DEFINE_BITS_JPEG3, TAG_DEFINE_BITS_LOSSLESS2]);
    expect(tags.some((t) => bitmapCodes.has(t.code))).toBe(false);
  });

  it("6. output SWF has valid FWS magic bytes", () => {
    const item = makeBitmapItem("bmp1", { dataUri: JPEG_DATA_URI });
    const obj = makeBitmapObj("obj1", "bmp1");
    const doc = makeDoc([item], [obj]);
    const pixels = new Map([["bmp1", { width: 1, height: 1, pixels: makeArgbPixels(128) }]]);
    const swf = compileDocument(doc, { bitmapPixels: pixels });
    expect(swf[0]).toBe(0x46); // 'F'
    expect(swf[1]).toBe(0x57); // 'W'
    expect(swf[2]).toBe(0x53); // 'S'
  });

  it("7. compressionType:'photo' with fully-opaque pixel emits tag 21 (DefineBitsJPEG2), not tag 35", () => {
    const item = makeBitmapItem("bmp1", { dataUri: JPEG_DATA_URI });
    const obj = makeBitmapObj("obj1", "bmp1");
    const doc = makeDoc([item], [obj]);
    const pixels = new Map([["bmp1", { width: 1, height: 1, pixels: makeArgbPixels(255) }]]);
    const swf = compileDocument(doc, { bitmapPixels: pixels });
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_DEFINE_BITS_JPEG2)).toBe(true);
    expect(tags.some((t) => t.code === TAG_DEFINE_BITS_JPEG3)).toBe(false);
  });
});
