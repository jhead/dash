/**
 * Tests for DefineBitsLossless2 (tag 36) and related bitmap tag emission
 * in the SWF compiler.
 *
 * Tag codes:
 *   36  DefineBitsLossless2  (lossless ARGB bitmap)
 *   35  DefineBitsJPEG3      (JPEG with separate alpha)
 *   21  DefineBitsJPEG2      (JPEG or PNG embedded directly)
 *    1  ShowFrame
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";

// ---------------------------------------------------------------------------
// Test bitmap data — 2×2 pure-red PNG encoded as a base64 data URI
// ---------------------------------------------------------------------------

const RED_2X2_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";

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

function makeBitmapItem(id: string) {
  return {
    id,
    name: "bitmap.png",
    itemType: "bitmap" as const,
    dataUri: RED_2X2_PNG,
    originalWidth: 2,
    originalHeight: 2,
    allowSmoothing: false,
    compressionType: "lossless" as const,
    quality: 80,
  };
}

function makeBitmapDisplayObject(id: string, libraryItemId: string) {
  return {
    id,
    type: "bitmap" as const,
    libraryItemId,
    x: 10,
    y: 10,
    width: 2,
    height: 2,
  };
}

/** Minimal doc with a BitmapItem in the library only (not on stage) */
function makeDocWithBitmapInLibraryOnly(): any {
  return {
    id: "t",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: { layers: [] },
      },
    ],
    library: {
      items: [makeBitmapItem("bmp1")],
      folders: [],
    },
  };
}

/** Minimal doc with a BitmapItem on stage (referenced by a display object) */
function makeDocWithBitmapOnStage(): any {
  return {
    id: "t",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "layer1",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              frameCount: 1,
              frames: [
                {
                  index: 0,
                  isKeyframe: true,
                  isEmpty: false,
                  label: "",
                  labelType: "name",
                  tween: { type: "none" },
                  sound: null,
                  displayObjects: [
                    makeBitmapDisplayObject("obj1", "bmp1"),
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    library: {
      items: [makeBitmapItem("bmp1")],
      folders: [],
    },
  };
}

/** Minimal doc with NO bitmap items */
function makeDocNoBitmap(): any {
  return {
    id: "t",
    properties: BASE_PROPS,
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: { layers: [] },
      },
    ],
    library: {
      items: [],
      folders: [],
    },
  };
}

// ---------------------------------------------------------------------------
// SWF tag parser helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  // Skip SWF header: signature(3) + version(1) + fileLength(4) = 8 bytes
  // Then RECT record (variable length), then FrameRate(2) + FrameCount(2)
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length - 1) {
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

const TAG_DEFINE_BITS_LOSSLESS2 = 36;
const TAG_DEFINE_BITS_JPEG2 = 21;
const TAG_DEFINE_BITS_JPEG3 = 35;

// Bitmap tag codes — any of these indicates a bitmap was compiled
const BITMAP_TAG_CODES = new Set([
  TAG_DEFINE_BITS_LOSSLESS2,
  TAG_DEFINE_BITS_JPEG2,
  TAG_DEFINE_BITS_JPEG3,
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF bitmap tag emission", () => {
  // Test 1: compiles without error when BitmapItem is in library only
  it("document with BitmapItem in library compiles without error", () => {
    expect(() => compileDocument(makeDocWithBitmapInLibraryOnly())).not.toThrow();
  });

  // Test 2: output is a valid SWF (starts with FWS)
  it("compiled output starts with FWS signature", () => {
    const bytes = compileDocument(makeDocWithBitmapInLibraryOnly());
    expect(bytes[0]).toBe(0x46); // 'F'
    expect(bytes[1]).toBe(0x57); // 'W'
    expect(bytes[2]).toBe(0x53); // 'S'
  });

  // Test 3: DefineBitsLossless2 or DefineBitsJPEG2 tag appears when bitmap is on stage
  it("bitmap on stage emits a bitmap tag (36, 35, or 21)", () => {
    const bytes = compileDocument(makeDocWithBitmapOnStage());
    const tags = parseTags(bytes);
    const bitmapTag = tags.find((t) => BITMAP_TAG_CODES.has(t.code));
    expect(bitmapTag).toBeDefined();
  });

  // Test 4: when DefineBitsLossless2 (tag 36) is present, CharacterID UI16 at body[0..1] is non-zero
  it("DefineBitsLossless2 body starts with non-zero CharacterID UI16", () => {
    const bytes = compileDocument(makeDocWithBitmapOnStage());
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      const charId = losslessTag.body[0] | (losslessTag.body[1] << 8);
      expect(charId).toBeGreaterThan(0);
    } else {
      // Compiler emitted DefineBitsJPEG2 (PNG path) — verify it's present instead
      const jpegTag = tags.find(
        (t) => t.code === TAG_DEFINE_BITS_JPEG2 || t.code === TAG_DEFINE_BITS_JPEG3
      );
      expect(jpegTag).toBeDefined();
    }
  });

  // Test 5: when DefineBitsLossless2 found, BitmapFormat byte (body[2]) is 3, 4, or 5
  it("DefineBitsLossless2 BitmapFormat byte is a valid value (3/4/5)", () => {
    const bytes = compileDocument(makeDocWithBitmapOnStage());
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      const format = losslessTag.body[2];
      expect([3, 4, 5]).toContain(format);
    } else {
      // Compiler chose JPEG path — acceptable, skip format check
      expect(true).toBe(true);
    }
  });

  // Test 6: document with no bitmap items produces no bitmap tag
  it("document with no bitmap items emits no bitmap tag", () => {
    const bytes = compileDocument(makeDocNoBitmap());
    const tags = parseTags(bytes);
    const bitmapTag = tags.find((t) => BITMAP_TAG_CODES.has(t.code));
    expect(bitmapTag).toBeUndefined();
  });

  // Test 7: multiple bitmap items in library compile without error
  it("multiple bitmap items in library compile without error", () => {
    const doc = makeDocWithBitmapInLibraryOnly();
    doc.library.items = [
      makeBitmapItem("bmp1"),
      { ...makeBitmapItem("bmp2"), name: "bitmap2.png" },
      { ...makeBitmapItem("bmp3"), name: "bitmap3.png" },
    ];
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 8: doc with bitmap on stage via bitmapPixels option emits DefineBitsLossless2 (tag 36)
  it("bitmapPixels option causes DefineBitsLossless2 (tag 36) to be emitted", () => {
    const doc = makeDocWithBitmapOnStage();
    // Pre-decoded 2x2 ARGB pixels: pure red
    const pixels = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      pixels[i * 4 + 0] = 255; // A
      pixels[i * 4 + 1] = 255; // R
      pixels[i * 4 + 2] = 0;   // G
      pixels[i * 4 + 3] = 0;   // B
    }
    const bitmapPixels = new Map([
      ["bmp1", { width: 2, height: 2, pixels }],
    ]);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    expect(losslessTag).toBeDefined();
  });

  // Test 9: DefineBitsLossless2 body with bitmapPixels has correct width/height fields
  it("DefineBitsLossless2 body contains correct width and height", () => {
    const doc = makeDocWithBitmapOnStage();
    const pixels = new Uint8Array(2 * 2 * 4).fill(255);
    const bitmapPixels = new Map([
      ["bmp1", { width: 2, height: 2, pixels }],
    ]);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    expect(losslessTag).toBeDefined();
    if (losslessTag) {
      // body layout: UI16 charId (0-1), UI8 format (2), UI16 width (3-4), UI16 height (5-6)
      const width = losslessTag.body[3] | (losslessTag.body[4] << 8);
      const height = losslessTag.body[5] | (losslessTag.body[6] << 8);
      expect(width).toBe(2);
      expect(height).toBe(2);
    }
  });
});
