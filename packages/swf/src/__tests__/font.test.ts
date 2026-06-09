/**
 * Tests for DefineFont2 (tag 48) font embedding and DefineEditText HasFont wiring.
 */
import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, FontItem, Frame, Layer, Scene, TextDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_EDIT_TEXT = 37;
const TAG_DEFINE_FONT2 = 48;
const TAG_DEFINE_FONT3 = 75;

// ---------------------------------------------------------------------------
// SWF binary parser (minimal, reused pattern from integration.test.ts)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFHeader(bytes: Uint8Array): { tagsOffset: number } {
  // RECT starts at byte 8 — bit-packed
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

  // Flush to byte boundary (discard remaining bits in current byte — byteOff
  // is already past the last consumed byte, so no extra increment needed)
  bitsLeft = 0;

  // After RECT: 2 bytes FrameRate + 2 bytes FrameCount
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

function makeFontItem(overrides: Partial<FontItem> = {}): FontItem {
  return {
    id: "font-1",
    name: "Arial",
    itemType: "font",
    fontName: "Arial",
    bold: false,
    italic: false,
    linkageIdentifier: "Arial",
    ...overrides,
  };
}

function makeDocWithFontItems(fontItems: FontItem[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [makeFrame([])])],
    library: { items: fontItems, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineFont2 embedding", () => {
  it("emits DefineFont2 (tag 48) for a document with one text object when useFont3 is false", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBe(1);
  });

  it("FontName bytes match the fontFamily with no null terminator in the name field", () => {
    const doc = makeDoc([makeText({ fontFamily: "Helvetica" })]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const body = font2Tags[0].body;
    // body layout: FontID(2) + flags(1) + langCode(1) + nameLen(1) + name bytes
    const nameLen = body[4];
    const nameBytes = body.slice(5, 5 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    expect(name).toBe("Helvetica");
    // No null terminator inside the name field (nameLen should match string length)
    expect(nameLen).toBe("Helvetica".length);
    // The byte after the name should NOT be 0x00 as part of nameLen
    expect(nameBytes.includes(0)).toBe(false);
  });

  it("GlyphCount is 95 (ASCII 32–126)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const body = font2Tags[0].body;
    // GlyphCount comes after: FontID(2) + flags(1) + langCode(1) + nameLen(1) + name
    const nameLen = body[4];
    const glyphCountOffset = 5 + nameLen;
    const glyphCount = body[glyphCountOffset] | (body[glyphCountOffset + 1] << 8);
    expect(glyphCount).toBe(95);
  });

  it("CodeTable has 95 entries covering ASCII 32–126", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBeGreaterThanOrEqual(1);

    const body = font2Tags[0].body;
    const nameLen = body[4];
    const glyphCountOffset = 5 + nameLen;
    const glyphCount = body[glyphCountOffset] | (body[glyphCountOffset + 1] << 8);
    expect(glyphCount).toBe(95);

    // OffsetTable starts right after GlyphCount
    // With WideOffsets=1: (glyphCount+1)*4 bytes of offsets
    // CodeTableOffset = last offset entry value → offset from OffsetTable start to CodeTable
    const offsetTableStart = glyphCountOffset + 2;
    // The last UI32 in the OffsetTable is the CodeTableOffset
    const codeTableOffsetInOffsetTable = (glyphCount) * 4; // index of last entry
    const codeTableOffsetValue =
      body[offsetTableStart + codeTableOffsetInOffsetTable] |
      (body[offsetTableStart + codeTableOffsetInOffsetTable + 1] << 8) |
      (body[offsetTableStart + codeTableOffsetInOffsetTable + 2] << 16) |
      (body[offsetTableStart + codeTableOffsetInOffsetTable + 3] << 24);

    // CodeTable starts at: offsetTableStart + codeTableOffsetValue
    const codeTableStart = offsetTableStart + codeTableOffsetValue;
    // Read 95 UI16 entries
    const codes: number[] = [];
    for (let i = 0; i < glyphCount; i++) {
      const off = codeTableStart + i * 2;
      codes.push(body[off] | (body[off + 1] << 8));
    }
    expect(codes.length).toBe(95);
    expect(codes[0]).toBe(32);   // space
    expect(codes[94]).toBe(126); // tilde (~)
  });

  it("DefineEditText HasFont flag (bit 7 of flags byte) is set when font is embedded", () => {
    // Static text uses DefineText (tag 11); use dynamic text to test DefineEditText HasFont flag.
    const doc = makeDoc([makeText({ textType: "dynamic" })]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const editTextTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTextTags.length).toBeGreaterThanOrEqual(1);

    const body = editTextTags[0].body;
    // DefineEditText body: CharacterId(2) + Bounds RECT (variable) + flags UI16
    // We need to skip past the RECT — read it manually.
    // The RECT starts at offset 2. First 5 bits = nBits, then 4*nBits bits.
    let byteOff = 2;
    let bitBuf2 = 0;
    let bitsLeft2 = 0;
    function rb(n: number): number {
      let r = 0;
      for (let i = 0; i < n; i++) {
        if (bitsLeft2 === 0) { bitBuf2 = body[byteOff++]; bitsLeft2 = 8; }
        r = (r << 1) | ((bitBuf2 >> (bitsLeft2 - 1)) & 1);
        bitsLeft2--;
      }
      return r;
    }
    const nb = rb(5);
    rb(nb); rb(nb); rb(nb); rb(nb); // xMin xMax yMin yMax
    // Flush to byte boundary: byteOff is already past the last consumed byte,
    // so just discard the remaining bits without an extra increment.
    bitsLeft2 = 0;

    // flags UI16 LE
    const flagsLo = body[byteOff];
    const flagsHi = body[byteOff + 1];
    const flags = flagsLo | (flagsHi << 8);

    // bit 7 = HasFont
    expect(flags & (1 << 7)).toBeTruthy();
  });

  it("two text objects with the same font produce only one DefineFont2 tag", () => {
    const t1 = makeText({ id: "text-1", fontFamily: "Arial", bold: false, italic: false });
    const t2 = makeText({ id: "text-2", fontFamily: "Arial", bold: false, italic: false, text: "World" });
    const doc = makeDoc([t1, t2]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBe(1);
  });

  it("two text objects with different fonts produce two DefineFont2 tags", () => {
    const t1 = makeText({ id: "text-1", fontFamily: "Arial" });
    const t2 = makeText({ id: "text-2", fontFamily: "Times New Roman", text: "World" });
    const doc = makeDoc([t1, t2]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// FontItem library items → DefineFont3 / DefineFont2 tag emission
// ---------------------------------------------------------------------------

describe("FontItem library items compile to font tags", () => {
  it("a doc with one FontItem compiles to a SWF that contains tag 75 (DefineFont3) by default", () => {
    const doc = makeDocWithFontItems([makeFontItem()]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(1);
  });

  it("a doc with one FontItem and useFont3:false emits tag 48 (DefineFont2)", () => {
    const doc = makeDocWithFontItems([makeFontItem()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font2Tags.length).toBe(1);
    expect(font3Tags.length).toBe(0);
  });

  it("the DefineFont3 tag body includes the font name from the FontItem", () => {
    const doc = makeDocWithFontItems([makeFontItem({ fontName: "Verdana" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    // body layout: FontID(2) + flags(1) + langCode(1) + nameLen(1) + name bytes
    const nameLen = body[4];
    const nameBytes = body.slice(5, 5 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    expect(name).toBe("Verdana");
    expect(nameLen).toBe("Verdana".length);
  });

  it("two FontItems with different names produce two DefineFont3 tags", () => {
    const f1 = makeFontItem({ id: "font-1", fontName: "Arial", name: "Arial" });
    const f2 = makeFontItem({ id: "font-2", fontName: "Times New Roman", name: "Times New Roman", linkageIdentifier: "Times" });
    const doc = makeDocWithFontItems([f1, f2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(2);
  });

  it("FontItem and matching TextDisplayObject produce only one font tag (deduplication)", () => {
    // A FontItem for "Arial" plus a text object using "Arial" should result in
    // only one DefineFont3 tag — the font pre-pass from text objects runs first,
    // so the library FontItem pass skips the duplicate.
    const fontItem = makeFontItem({ fontName: "Arial" });
    const textObj = makeText({ fontFamily: "Arial" });
    const doc: FlashDocument = {
      id: "doc-1",
      properties: BASE_PROPS,
      scenes: [makeScene("scene-1", "Scene 1", [makeFrame([textObj])])],
      library: { items: [fontItem], folders: [] },
    };
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(1);
  });

  it("a doc with no FontItems and no text objects emits no font tags", () => {
    const doc = makeDocWithFontItems([]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font3Tags.length).toBe(0);
    expect(font2Tags.length).toBe(0);
  });
});
