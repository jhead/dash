/**
 * Tests for DefineFont2 HasLayout flag and AdvanceTable.
 *
 * Verifies that the font layout block (Ascent, Descent, Leading, AdvanceTable)
 * is correctly emitted in DefineFont2 tag bodies.
 */
import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, TextDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_FONT2 = 48;

// ---------------------------------------------------------------------------
// SWF binary parser (minimal)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFHeader(bytes: Uint8Array): { tagsOffset: number } {
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
  readBits(nBits); // xMin
  readBits(nBits); // xMax
  readBits(nBits); // yMin
  readBits(nBits); // yMax
  bitsLeft = 0;

  const tagsOffset = byteOff + 4;
  return { tagsOffset };
}

function parseTags(bytes: Uint8Array, offset: number): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = offset;
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
    if (tagCode === TAG_END) break;
  }
  return tags;
}

function parseSWF(bytes: Uint8Array): SWFTag[] {
  const { tagsOffset } = parseSWFHeader(bytes);
  return parseTags(bytes, tagsOffset);
}

// ---------------------------------------------------------------------------
// Helpers to parse DefineFont2 body
// ---------------------------------------------------------------------------

interface Font2Layout {
  fontFlags: number;
  hasLayout: boolean;
  glyphCount: number;
  ascent: number;
  descent: number;
  leading: number;
  advances: number[];
}

/**
 * Parse the DefineFont2 body and extract layout information.
 *
 * Body structure:
 *   FontID:         UI16
 *   FontFlags:      UI8  (bit7 = HasLayout, bit3 = WideOffsets, bit2 = WideCodes, etc.)
 *   LanguageCode:   UI8
 *   FontNameLen:    UI8
 *   FontName:       FontNameLen bytes
 *   NumGlyphs:      UI16
 *   OffsetTable:    NumGlyphs UI32 entries  (WideOffsets=1)
 *   CodeTableOffset UI32                    (last offset entry)
 *   GlyphShapeTable ...
 *   CodeTable:      NumGlyphs UI16 entries  (WideCodes=1)
 *   [if HasLayout]:
 *     Ascent:       SI16
 *     Descent:      SI16
 *     Leading:      SI16
 *     AdvanceTable: NumGlyphs SI16 entries
 */
function parseFont2Layout(body: Uint8Array): Font2Layout {
  // FontID: 2 bytes
  // FontFlags: 1 byte
  const fontFlags = body[2];
  const hasLayout = (fontFlags & 0x80) !== 0;
  const wideOffsets = (fontFlags & 0x08) !== 0;
  const wideCodes = (fontFlags & 0x04) !== 0;

  // LanguageCode: 1 byte
  // FontNameLen: 1 byte (at offset 4)
  const nameLen = body[4];

  // NumGlyphs at: 2(id) + 1(flags) + 1(lang) + 1(nameLen) + nameLen = 5 + nameLen
  const glyphCountOffset = 5 + nameLen;
  const glyphCount = body[glyphCountOffset] | (body[glyphCountOffset + 1] << 8);

  // OffsetTable starts right after NumGlyphs (2 bytes)
  const offsetTableStart = glyphCountOffset + 2;

  // CodeTableOffset is the last entry in the offset table.
  // With WideOffsets=1: each entry is UI32 (4 bytes); glyphCount entries + 1 = (glyphCount+1) entries.
  // The last UI32 in OffsetTable is at index glyphCount (0-based).
  let codeTableOffsetValue: number;
  if (wideOffsets) {
    const idx = offsetTableStart + glyphCount * 4;
    codeTableOffsetValue =
      body[idx] |
      (body[idx + 1] << 8) |
      (body[idx + 2] << 16) |
      (body[idx + 3] << 24);
  } else {
    const idx = offsetTableStart + glyphCount * 2;
    codeTableOffsetValue = body[idx] | (body[idx + 1] << 8);
  }

  // The CodeTableOffset value is relative to the start of the OffsetTable.
  // CodeTable starts at: offsetTableStart + codeTableOffsetValue
  const codeTableStart = offsetTableStart + codeTableOffsetValue;

  // After CodeTable (glyphCount * 2 bytes), the layout block begins.
  const codeTableSize = glyphCount * (wideCodes ? 2 : 1);
  const layoutStart = codeTableStart + codeTableSize;

  // Read layout values (SI16 LE)
  function readSI16(off: number): number {
    const u = body[off] | (body[off + 1] << 8);
    return u >= 0x8000 ? u - 0x10000 : u;
  }

  const ascent = readSI16(layoutStart);
  const descent = readSI16(layoutStart + 2);
  const leading = readSI16(layoutStart + 4);

  // AdvanceTable: glyphCount SI16 entries
  const advances: number[] = [];
  for (let i = 0; i < glyphCount; i++) {
    advances.push(readSI16(layoutStart + 6 + i * 2));
  }

  return { fontFlags, hasLayout, glyphCount, ascent, descent, leading, advances };
}

// ---------------------------------------------------------------------------
// Fixture helpers
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

function makeText(overrides: Partial<TextDisplayObject> = {}): TextDisplayObject {
  return {
    id: "text-1",
    type: "text",
    x: 10,
    y: 10,
    width: 100,
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
    ...overrides,
  };
}

function makeFrame(displayObjects: readonly TextDisplayObject[]): Frame {
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
    frames,
    frameCount: frames.length,
  };
}

function makeScene(id: string, name: string, frames: Frame[]): Scene {
  return {
    id,
    name,
    timeline: { layers: [makeLayer(frames)] },
  };
}

function makeDoc(textObjects: TextDisplayObject[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [makeFrame(textObjects)])],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineFont2 advance table and layout metrics", () => {
  it("DefineFont2 tag body HasLayout flag (bit 7 of FontFlags) is set to 1", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const layout = parseFont2Layout(font2Tags[0].body);
    expect(layout.hasLayout).toBe(true);
    expect(layout.fontFlags & 0x80).toBe(0x80);
  });

  it("AdvanceTable has at least 95 entries (ASCII 32-126)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const layout = parseFont2Layout(font2Tags[0].body);
    expect(layout.glyphCount).toBeGreaterThanOrEqual(95);
    expect(layout.advances.length).toBeGreaterThanOrEqual(95);
  });

  it("each advance value is > 0 (non-zero glyph widths)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const layout = parseFont2Layout(font2Tags[0].body);
    for (let i = 0; i < layout.advances.length; i++) {
      expect(layout.advances[i]).toBeGreaterThan(0);
    }
  });

  it("Ascent value is positive", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const layout = parseFont2Layout(font2Tags[0].body);
    expect(layout.ascent).toBeGreaterThan(0);
  });

  it("Descent value is non-negative (stored as positive distance below baseline)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const layout = parseFont2Layout(font2Tags[0].body);
    expect(layout.descent).toBeGreaterThanOrEqual(0);
  });

  it("Leading value is >= 0", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const layout = parseFont2Layout(font2Tags[0].body);
    expect(layout.leading).toBeGreaterThanOrEqual(0);
  });
});
