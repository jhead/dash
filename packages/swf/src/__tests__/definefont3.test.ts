/**
 * Tests for DefineFont3 (tag 75) font embedding.
 *
 * DefineFont3 (tag 75) is the Flash 8 font tag with UTF-16 encoding. Its body
 * format is identical to DefineFont2 (tag 48) — only the tag code differs.
 * For SWF v8 output, DefineFont3 is preferred and is the default.
 */
import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, TextDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_FONT2 = 48;
const TAG_DEFINE_FONT3 = 75;

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineFont3 (tag 75) embedding", () => {
  it("emits DefineFont3 (tag 75) by default for a document with a text object", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(1);
  });

  it("does NOT emit DefineFont2 (tag 48) when useFont3 defaults to true", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    expect(font2Tags.length).toBe(0);
  });

  it("emits DefineFont3 (tag 75) when useFont3 is explicitly true", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: true });
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(1);
  });

  it("emits DefineFont2 (tag 48) when useFont3 is false", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc, { useFont3: false });
    const tags = parseSWF(bytes);
    const font2Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT2);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font2Tags.length).toBe(1);
    expect(font3Tags.length).toBe(0);
  });

  it("DefineFont3 body has valid uint16 glyph count (95 for ASCII 32-126)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    // body layout: FontID(2) + flags(1) + langCode(1) + nameLen(1) + name bytes + GlyphCount(2)
    const nameLen = body[4];
    const glyphCountOffset = 5 + nameLen;
    const glyphCount = body[glyphCountOffset] | (body[glyphCountOffset + 1] << 8);
    expect(glyphCount).toBe(95);
  });

  it("DefineFont3 body has correct FontName", () => {
    const doc = makeDoc([makeText({ fontFamily: "Verdana" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    const nameLen = body[4];
    const nameBytes = body.slice(5, 5 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    expect(name).toBe("Verdana");
  });

  it("DefineFont3 body CodeTable covers Unicode code points 32-126", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    const nameLen = body[4];
    const glyphCountOffset = 5 + nameLen;
    const glyphCount = body[glyphCountOffset] | (body[glyphCountOffset + 1] << 8);

    // OffsetTable: (glyphCount+1) * 4 bytes (WideOffsets=1)
    // The last UI32 entry = CodeTableOffset (relative to start of OffsetTable)
    const offsetTableStart = glyphCountOffset + 2;
    const lastEntryOff = offsetTableStart + glyphCount * 4;
    const codeTableOffsetValue =
      body[lastEntryOff] |
      (body[lastEntryOff + 1] << 8) |
      (body[lastEntryOff + 2] << 16) |
      (body[lastEntryOff + 3] << 24);

    const codeTableStart = offsetTableStart + codeTableOffsetValue;
    const codes: number[] = [];
    for (let i = 0; i < glyphCount; i++) {
      const off = codeTableStart + i * 2;
      codes.push(body[off] | (body[off + 1] << 8));
    }
    expect(codes[0]).toBe(32);    // space
    expect(codes[94]).toBe(126);  // tilde (~)
  });

  it("two text objects with different fonts produce two DefineFont3 tags", () => {
    const t1 = makeText({ id: "text-1", fontFamily: "Arial" });
    const t2 = makeText({ id: "text-2", fontFamily: "Times New Roman", text: "World" });
    const doc = makeDoc([t1, t2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(2);
  });

  it("two text objects with the same font produce only one DefineFont3 tag", () => {
    const t1 = makeText({ id: "text-1", fontFamily: "Arial" });
    const t2 = makeText({ id: "text-2", fontFamily: "Arial", text: "World" });
    const doc = makeDoc([t1, t2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);
    const font3Tags = tags.filter((t) => t.code === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(1);
  });
});
