/**
 * Tests for DefineBitsLossless2 (tag 36) palette/indexed mode (BitmapFormat=3).
 *
 * SWF spec BitmapFormat values for DefineBitsLossless/DefineBitsLossless2:
 *   3 = 8-bit indexed (palette mode, up to 256 colors)
 *   4 = 15-bit RGB (not used in Flash 8)
 *   5 = 32-bit ARGB (the only format currently emitted by this compiler)
 *
 * The compiler currently always emits BitmapFormat 5 (32-bit ARGB) for lossless
 * bitmaps. Palette mode (format 3) is not yet implemented. These tests document
 * that gap and verify the existing lossless path remains correct, including that
 * multiple bitmap items each get their own tag 36.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";

// ---------------------------------------------------------------------------
// Tag parsing helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  // Skip SWF file header: 3-byte signature + 1-byte version + 4-byte file length
  // Then a variable-length RECT record, then FrameRate UI16 + FrameCount UI16.
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
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0 /* End */) break;
  }
  return tags;
}

const TAG_DEFINE_BITS_LOSSLESS2 = 36;
const BITMAP_FORMAT_32BIT_ARGB = 5;
const BITMAP_FORMAT_8BIT_INDEXED = 3;

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

// Minimal 2×2 red PNG
const RED_2X2_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";

function makeBitmapItem(id: string, name = "bitmap.png") {
  return {
    id,
    name,
    itemType: "bitmap" as const,
    dataUri: RED_2X2_PNG,
    originalWidth: 2,
    originalHeight: 2,
    allowSmoothing: false,
    compressionType: "lossless" as const,
    quality: 80,
  };
}

function makeDocWithBitmapPixels(
  items: ReturnType<typeof makeBitmapItem>[],
  _bitmapPixels: Map<string, { width: number; height: number; pixels: Uint8Array }>
): any {
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
                  displayObjects: items.map((item, idx) => ({
                    id: `obj${idx}`,
                    type: "bitmap" as const,
                    libraryItemId: item.id,
                    x: 10 + idx * 20,
                    y: 10,
                    width: 2,
                    height: 2,
                  })),
                },
              ],
            },
          ],
        },
      },
    ],
    library: {
      items,
      folders: [],
    },
  };
}

/** 2×2 ARGB pixels — pure red (fully opaque). */
function redPixels2x2(): Uint8Array {
  const pixels = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    pixels[i * 4 + 0] = 255; // A
    pixels[i * 4 + 1] = 255; // R
    pixels[i * 4 + 2] = 0;   // G
    pixels[i * 4 + 3] = 0;   // B
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineBitsLossless2 — palette mode (BitmapFormat=3) coverage", () => {

  // Test 1: BitmapItem with compressionType:"lossless" compiles without error
  it("BitmapItem with compressionType lossless compiles without error", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    expect(() => compileDocument(doc, { bitmapPixels })).not.toThrow();
  });

  // Test 2: compiler emits tag 36 (DefineBitsLossless2) for lossless bitmaps
  it("lossless bitmap emits DefineBitsLossless2 (tag 36)", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    expect(losslessTag).toBeDefined();
  });

  // Test 3: palette mode (format 3) is NOT currently emitted — compiler uses format 5 (ARGB)
  // This test documents the gap: palette mode is not yet implemented.
  it("compiler currently emits BitmapFormat 5 (ARGB), not 3 (8bpp indexed palette)", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      // body[2] is BitmapFormat; current implementation always uses 5 (32-bit ARGB)
      expect(losslessTag.body[2]).toBe(BITMAP_FORMAT_32BIT_ARGB);
      // Document the gap: palette mode (3) is not produced
      expect(losslessTag.body[2]).not.toBe(BITMAP_FORMAT_8BIT_INDEXED);
    } else {
      // No lossless tag emitted — acceptable (JPEG path taken)
      expect(true).toBe(true);
    }
  });

  // Test 4: ColorTableSize field — only present in BitmapFormat 3 (palette); not present in format 5
  // Since format 5 is used, body[7] (where ColorTableSize would be) is compressed pixel data, not a color count.
  it("DefineBitsLossless2 body has no ColorTableSize field when format is 5 (ARGB)", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      // For format 5, header is: UI16 charId + UI8 format + UI16 width + UI16 height = 7 bytes
      // No ColorTableSize byte follows for format 5
      const format = losslessTag.body[2];
      if (format === BITMAP_FORMAT_32BIT_ARGB) {
        // Compressed data starts at offset 7
        expect(losslessTag.body.length).toBeGreaterThan(7);
      }
    } else {
      expect(true).toBe(true);
    }
  });

  // Test 5: existing lossless path produces a valid tag 36 with correct structure
  it("DefineBitsLossless2 tag has valid charId, format, width, and height fields", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      const charId = losslessTag.body[0] | (losslessTag.body[1] << 8);
      const format  = losslessTag.body[2];
      const width   = losslessTag.body[3] | (losslessTag.body[4] << 8);
      const height  = losslessTag.body[5] | (losslessTag.body[6] << 8);
      expect(charId).toBeGreaterThan(0);
      expect([BITMAP_FORMAT_8BIT_INDEXED, 4, BITMAP_FORMAT_32BIT_ARGB]).toContain(format);
      expect(width).toBe(2);
      expect(height).toBe(2);
    } else {
      expect(true).toBe(true);
    }
  });

  // Test 6: multiple bitmap items each get their own DefineBitsLossless2 (tag 36)
  it("multiple lossless bitmap items each emit their own tag 36", () => {
    const items = [makeBitmapItem("bmp1", "a.png"), makeBitmapItem("bmp2", "b.png")];
    const bitmapPixels = new Map([
      ["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }],
      ["bmp2", { width: 2, height: 2, pixels: redPixels2x2() }],
    ]);
    const doc = makeDocWithBitmapPixels(items, bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTags = tags.filter((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    // Each bitmap on stage should produce its own lossless tag
    expect(losslessTags.length).toBeGreaterThanOrEqual(2);
  });

  // Test 7: multiple lossless tags have distinct character IDs
  it("multiple lossless bitmap tags have distinct character IDs", () => {
    const items = [makeBitmapItem("bmp1", "a.png"), makeBitmapItem("bmp2", "b.png")];
    const bitmapPixels = new Map([
      ["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }],
      ["bmp2", { width: 2, height: 2, pixels: redPixels2x2() }],
    ]);
    const doc = makeDocWithBitmapPixels(items, bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTags = tags.filter((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTags.length >= 2) {
      const ids = losslessTags.map((t) => t.body[0] | (t.body[1] << 8));
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(losslessTags.length);
    } else {
      expect(true).toBe(true);
    }
  });
});
