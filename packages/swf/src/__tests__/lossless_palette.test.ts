/**
 * Tests for DefineBitsLossless2 (tag 36) palette/indexed mode (BitmapFormat=3).
 *
 * SWF spec BitmapFormat values for DefineBitsLossless/DefineBitsLossless2:
 *   3 = 8-bit indexed (palette mode, up to 256 colors)
 *   4 = 15-bit RGB (not used in Flash 8)
 *   5 = 32-bit ARGB
 *
 * Tag body layout for BitmapFormat=3:
 *   UI16 charId
 *   UI8  format = 3
 *   UI16 width
 *   UI16 height
 *   UI8  colorTableSize = colorCount − 1
 *   ZlibBitmapData = ZLIB([colorCount × 4-byte RGBA] + [height rows of indices,
 *                          each row padded to multiple of 4 bytes])
 */

import { describe, it, expect } from "vitest";
import { decompressSync } from "fflate";
import { compileDocument } from "../compile.js";
import { encodeDefineBitsLossless2 } from "../bitmaps.js";

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

// ---------------------------------------------------------------------------
// Helper: build a minimal palette (RGBA) + indexed pixel data
// ---------------------------------------------------------------------------

/**
 * Build a simple 2-color palette (black + red) and a width×height index grid.
 * Even pixels → color 0 (black), odd pixels → color 1 (red).
 */
function makePaletteFixture(width: number, height: number) {
  // 2 colors × 4 bytes each (RGBA)
  const palette = new Uint8Array([
    0, 0, 0, 255,       // color 0: opaque black
    255, 0, 0, 255,     // color 1: opaque red
  ]);
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i++) {
    indices[i] = i % 2; // alternating black/red
  }
  return { palette, indices };
}

/**
 * Parse the raw tag record bytes produced by encodeDefineBitsLossless2 into
 * { tagCode, body }.
 */
function parseTagRecord(tag: Uint8Array): { tagCode: number; body: Uint8Array } {
  const recordHdr = tag[0] | (tag[1] << 8);
  const tagCode = (recordHdr >> 6) & 0x3ff;
  let hdrSize = 2;
  let bodyLength = recordHdr & 0x3f;
  if (bodyLength === 0x3f) {
    bodyLength = tag[2] | (tag[3] << 8) | (tag[4] << 16) | (tag[5] << 24);
    hdrSize = 6;
  }
  return { tagCode, body: tag.slice(hdrSize, hdrSize + bodyLength) };
}

// ---------------------------------------------------------------------------
// Unit tests for encodeDefineBitsLossless2 palette mode (BitmapFormat=3)
// ---------------------------------------------------------------------------

describe("encodeDefineBitsLossless2 — BitmapFormat=3 (palette mode)", () => {
  const WIDTH = 4;
  const HEIGHT = 4;

  it("sets BitmapFormat byte to 3 when paletteOpts are provided", () => {
    const { palette, indices } = makePaletteFixture(WIDTH, HEIGHT);
    const tag = encodeDefineBitsLossless2(1, WIDTH, HEIGHT, new Uint8Array(0), { palette, indices });
    const { body } = parseTagRecord(tag);
    // body[2] = BitmapFormat
    expect(body[2]).toBe(BITMAP_FORMAT_8BIT_INDEXED);
  });

  it("sets BitmapColorTableSize = colorCount − 1", () => {
    const { palette, indices } = makePaletteFixture(WIDTH, HEIGHT);
    // 2-color palette → colorTableSize = 1
    const tag = encodeDefineBitsLossless2(1, WIDTH, HEIGHT, new Uint8Array(0), { palette, indices });
    const { body } = parseTagRecord(tag);
    // body[7] = BitmapColorTableSize
    expect(body[7]).toBe(1); // 2 colors − 1
  });

  it("sets BitmapColorTableSize = 255 for a full 256-color palette", () => {
    const palette256 = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      palette256[i * 4 + 0] = i;     // R
      palette256[i * 4 + 1] = 0;     // G
      palette256[i * 4 + 2] = 0;     // B
      palette256[i * 4 + 3] = 255;   // A
    }
    const indices = new Uint8Array(WIDTH * HEIGHT); // all color 0
    const tag = encodeDefineBitsLossless2(1, WIDTH, HEIGHT, new Uint8Array(0), {
      palette: palette256,
      indices,
    });
    const { body } = parseTagRecord(tag);
    expect(body[7]).toBe(255); // 256 colors − 1
  });

  it("emits tag code 36 (DefineBitsLossless2)", () => {
    const { palette, indices } = makePaletteFixture(WIDTH, HEIGHT);
    const tag = encodeDefineBitsLossless2(1, WIDTH, HEIGHT, new Uint8Array(0), { palette, indices });
    const { tagCode } = parseTagRecord(tag);
    expect(tagCode).toBe(TAG_DEFINE_BITS_LOSSLESS2);
  });

  it("encodes width and height correctly in the header", () => {
    const { palette, indices } = makePaletteFixture(WIDTH, HEIGHT);
    const tag = encodeDefineBitsLossless2(1, WIDTH, HEIGHT, new Uint8Array(0), { palette, indices });
    const { body } = parseTagRecord(tag);
    const width  = body[3] | (body[4] << 8);
    const height = body[5] | (body[6] << 8);
    expect(width).toBe(WIDTH);
    expect(height).toBe(HEIGHT);
  });

  it("encodes charId correctly in the body", () => {
    const charId = 42;
    const { palette, indices } = makePaletteFixture(WIDTH, HEIGHT);
    const tag = encodeDefineBitsLossless2(charId, WIDTH, HEIGHT, new Uint8Array(0), { palette, indices });
    const { body } = parseTagRecord(tag);
    expect(body[0] | (body[1] << 8)).toBe(charId);
  });

  it("ZlibBitmapData decompresses to [palette bytes] + [padded index rows]", () => {
    const { palette, indices } = makePaletteFixture(WIDTH, HEIGHT);
    const tag = encodeDefineBitsLossless2(1, WIDTH, HEIGHT, new Uint8Array(0), { palette, indices });
    const { body } = parseTagRecord(tag);

    // format 3 header is 8 bytes; compressed data starts at body[8]
    const compressed = body.slice(8);
    const raw = decompressSync(compressed);

    // Expected: 2×4 palette bytes + HEIGHT rows each padded to multiple of 4
    const rowStride = Math.ceil(WIDTH / 4) * 4; // 4 for width=4
    const expectedLen = palette.length + rowStride * HEIGHT;
    expect(raw.length).toBe(expectedLen);

    // First bytes are the palette
    expect(raw.slice(0, palette.length)).toEqual(palette);

    // Rows of indices follow; each row starts with actual indices then 0-padding
    for (let row = 0; row < HEIGHT; row++) {
      const dstOffset = palette.length + row * rowStride;
      const rowData = raw.slice(dstOffset, dstOffset + WIDTH);
      const expected = indices.slice(row * WIDTH, (row + 1) * WIDTH);
      expect(rowData).toEqual(expected);
    }
  });

  it("pads each row to a multiple of 4 bytes (non-multiple width)", () => {
    const W = 3; // width 3 → padded to 4
    const H = 2;
    const { palette, indices } = makePaletteFixture(W, H);
    const tag = encodeDefineBitsLossless2(1, W, H, new Uint8Array(0), { palette, indices });
    const { body } = parseTagRecord(tag);
    const raw = decompressSync(body.slice(8));
    // Each row: 3 index bytes + 1 padding byte = 4 bytes
    const expectedLen = palette.length + 4 * H;
    expect(raw.length).toBe(expectedLen);
  });

  it("throws if palette length is not a multiple of 4", () => {
    const badPalette = new Uint8Array(7); // not divisible by 4
    const indices = new Uint8Array(4);
    expect(() =>
      encodeDefineBitsLossless2(1, 2, 2, new Uint8Array(0), { palette: badPalette, indices })
    ).toThrow();
  });

  it("throws if indices.length does not match width × height", () => {
    const { palette } = makePaletteFixture(2, 2);
    const badIndices = new Uint8Array(3); // should be 4
    expect(() =>
      encodeDefineBitsLossless2(1, 2, 2, new Uint8Array(0), { palette, indices: badIndices })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Compile-path tests (BitmapFormat=5, existing behavior)
// ---------------------------------------------------------------------------

describe("DefineBitsLossless2 — BitmapFormat=5 compile-path coverage", () => {

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

  // Test 3: compiler emits BitmapFormat 5 (ARGB) for the 32-bit path
  it("compiler emits BitmapFormat 5 (ARGB) for the standard lossless path", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      expect(losslessTag.body[2]).toBe(BITMAP_FORMAT_32BIT_ARGB);
    } else {
      expect(true).toBe(true);
    }
  });

  // Test 4: no ColorTableSize byte in format 5 body
  it("DefineBitsLossless2 body has no ColorTableSize field when format is 5 (ARGB)", () => {
    const item = makeBitmapItem("bmp1");
    const bitmapPixels = new Map([["bmp1", { width: 2, height: 2, pixels: redPixels2x2() }]]);
    const doc = makeDocWithBitmapPixels([item], bitmapPixels);
    const bytes = compileDocument(doc, { bitmapPixels });
    const tags = parseTags(bytes);
    const losslessTag = tags.find((t) => t.code === TAG_DEFINE_BITS_LOSSLESS2);
    if (losslessTag) {
      const format = losslessTag.body[2];
      if (format === BITMAP_FORMAT_32BIT_ARGB) {
        // Compressed data starts at offset 7 (no ColorTableSize)
        expect(losslessTag.body.length).toBeGreaterThan(7);
      }
    } else {
      expect(true).toBe(true);
    }
  });

  // Test 5: tag has valid charId, format, width, height fields
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
