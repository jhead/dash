/**
 * Tests for DefineEditText (tag 37) flag encoding and initial text content.
 *
 * Verifies that static, dynamic, and input text fields produce the correct
 * SWF flags and initial text bytes.
 *
 * DefineEditText flags (UI16LE):
 *   bit 0: HasText       — initial text string follows VariableName
 *   bit 1: WordWrap
 *   bit 2: Multiline
 *   bit 3: Password
 *   bit 4: ReadOnly      — set for static and dynamic; NOT for input
 *   bit 5: HasTextColor
 *   bit 6: HasMaxLength
 *   bit 7: HasFont
 *   bit 8: HasFontClass
 *   bit 9: AutoSize
 *   bit 10: HasLayout
 *   bit 11: NoSelect     — set for static only (not selectable)
 *   bit 12: Border
 *   bit 13: StoreInDict
 *   bit 14: WasStatic    — Flash 8+: set for static text
 *   bit 15: HTML
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, TextDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_DEFINE_TEXT = 11;
const TAG_DEFINE_EDIT_TEXT = 37;

// ---------------------------------------------------------------------------
// SWF binary parser (minimal)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SWFTag[] {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SWFTag[] = [];
  while (pos + 2 <= bytes.length) {
    const hdr = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code, body: bytes.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// DefineEditText body decoder
// ---------------------------------------------------------------------------

interface DecodedEditText {
  charId: number;
  flags: number;
  /** true if HasText flag (bit 0) is set */
  hasText: boolean;
  /** true if ReadOnly flag (bit 4) is set */
  readOnly: boolean;
  /** true if HasTextColor flag (bit 5) is set */
  hasTextColor: boolean;
  /** true if HasFont flag (bit 7) is set */
  hasFont: boolean;
  /** true if NoSelect flag (bit 11) is set */
  noSelect: boolean;
  /** true if WasStatic flag (bit 14) is set */
  wasStatic: boolean;
  /** initial text string if HasText is set, otherwise undefined */
  initialText: string | undefined;
}

/**
 * Decode a DefineEditText tag body.
 *
 * Body layout:
 *   [0..1]  CharacterId UI16LE
 *   [2..]   Bounds RECT (bit-packed)
 *   [n..n+1] flags UI16LE
 *   if HasFont: FontID UI16LE + FontHeight UI16LE
 *   if HasTextColor: RGBA (4 bytes)
 *   if HasMaxLength: MaxLength UI16LE
 *   if HasLayout: Align UI8 + LeftMargin UI16LE + RightMargin UI16LE + Indent UI16LE + Leading SI16LE
 *   VariableName: null-terminated string
 *   if HasText: InitialText: null-terminated string
 */
function decodeDefineEditText(body: Uint8Array): DecodedEditText {
  const charId = body[0] | (body[1] << 8);

  // Skip the RECT
  let byteOff = 2;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = body[byteOff++];
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
  // Flush remaining bits in partial byte
  bitsLeft = 0;

  // flags UI16LE
  const flags = body[byteOff] | (body[byteOff + 1] << 8);
  byteOff += 2;

  const hasText = (flags & (1 << 0)) !== 0;
  const readOnly = (flags & (1 << 4)) !== 0;
  const hasTextColor = (flags & (1 << 5)) !== 0;
  const hasFont = (flags & (1 << 7)) !== 0;
  const hasMaxLength = (flags & (1 << 6)) !== 0;
  const hasLayout = (flags & (1 << 10)) !== 0;
  const noSelect = (flags & (1 << 11)) !== 0;
  const wasStatic = (flags & (1 << 14)) !== 0;

  // Skip optional fields to reach VariableName
  if (hasFont) {
    byteOff += 4; // FontID UI16 + FontHeight UI16
  }
  if (hasTextColor) {
    byteOff += 4; // RGBA
  }
  if (hasMaxLength) {
    byteOff += 2; // MaxLength UI16
  }
  if (hasLayout) {
    byteOff += 9; // Align UI8 + LeftMargin UI16 + RightMargin UI16 + Indent UI16 + Leading SI16
  }

  // VariableName: null-terminated string (skip it)
  while (byteOff < body.length && body[byteOff] !== 0) byteOff++;
  byteOff++; // skip null terminator

  // InitialText: null-terminated string (only if HasText)
  let initialText: string | undefined;
  if (hasText) {
    let end = byteOff;
    while (end < body.length && body[end] !== 0) end++;
    initialText = new TextDecoder().decode(body.slice(byteOff, end));
  }

  return { charId, flags, hasText, readOnly, hasTextColor, hasFont, noSelect, wasStatic, initialText };
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

/** Compile a single text object and return the decoded DefineEditText. */
function compileAndDecode(obj: TextDisplayObject): DecodedEditText {
  const doc = makeDoc([obj]);
  const bytes = compileDocument(doc);
  const tags = parseSWFTags(bytes);
  const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
  expect(editTags.length).toBeGreaterThanOrEqual(1);
  return decodeDefineEditText(editTags[0].body);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Static text now uses DefineText (tag 11), not DefineEditText (tag 37).
// These tests verify the routing change.
describe("Static text — emits DefineText (tag 11), not DefineEditText (tag 37)", () => {
  it("static text: emits DefineText tag (code 11)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTags = tags.filter((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTags.length).toBeGreaterThanOrEqual(1);
  });

  it("static text: does NOT emit DefineEditText tag (code 37)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBe(0);
  });

  it("static text: DefineText body starts with correct charId (UI16 LE)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTag = tags.find((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTag).toBeDefined();
    const charId = textTag!.body[0] | (textTag!.body[1] << 8);
    expect(charId).toBeGreaterThan(0);
  });

  it("static text: DefineText body is non-trivially sized (contains RECT, MATRIX, glyph data)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hi" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTag = tags.find((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTag).toBeDefined();
    expect(textTag!.body.length).toBeGreaterThan(10);
  });

  it("static text: DefineText body ends with 0x00 (TEXTRECORD terminator)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hi" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTag = tags.find((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTag).toBeDefined();
    const body = textTag!.body;
    expect(body[body.length - 1]).toBe(0x00);
  });

  it("static text: longer text produces a larger DefineText body (more glyph entries)", () => {
    const docShort = makeDoc([makeText({ textType: "static", text: "Hi" })]);
    const docLong = makeDoc([makeText({ textType: "static", text: "Hello World!" })]);
    const bytesShort = compileDocument(docShort);
    const bytesLong = compileDocument(docLong);
    const tagsShort = parseSWFTags(bytesShort);
    const tagsLong = parseSWFTags(bytesLong);
    const shortTag = tagsShort.find((t) => t.code === TAG_DEFINE_TEXT);
    const longTag = tagsLong.find((t) => t.code === TAG_DEFINE_TEXT);
    expect(shortTag).toBeDefined();
    expect(longTag).toBeDefined();
    expect(longTag!.body.length).toBeGreaterThan(shortTag!.body.length);
  });
});

describe("DefineEditText flags — dynamic text", () => {
  it("dynamic text: HasText flag (bit 0) is set", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic", text: "Score: 0" }));
    expect(decoded.hasText).toBe(true);
  });

  it("dynamic text: ReadOnly flag (bit 4) is set", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic" }));
    expect(decoded.readOnly).toBe(true);
  });

  it("dynamic text: NoSelect flag (bit 11) is NOT set", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic" }));
    expect(decoded.noSelect).toBe(false);
  });

  it("dynamic text: WasStatic flag (bit 14) is NOT set", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic" }));
    expect(decoded.wasStatic).toBe(false);
  });

  it("dynamic text: initial text is encoded", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic", text: "Score: 0" }));
    expect(decoded.initialText).toBe("Score: 0");
  });
});

describe("DefineEditText flags — input text", () => {
  it("input text: ReadOnly flag (bit 4) is NOT set", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "" }));
    expect(decoded.readOnly).toBe(false);
  });

  it("input text: NoSelect flag (bit 11) is NOT set", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "" }));
    expect(decoded.noSelect).toBe(false);
  });

  it("input text: WasStatic flag (bit 14) is NOT set", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "" }));
    expect(decoded.wasStatic).toBe(false);
  });

  it("input text with empty text: HasText flag (bit 0) is NOT set", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "" }));
    expect(decoded.hasText).toBe(false);
  });

  it("input text with non-empty initial value: HasText flag is set and text is encoded", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "placeholder" }));
    expect(decoded.hasText).toBe(true);
    expect(decoded.initialText).toBe("placeholder");
  });
});

describe("DefineEditText — HasTextColor always set", () => {
  it("dynamic text: HasTextColor flag (bit 5) is always set", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic" }));
    expect(decoded.hasTextColor).toBe(true);
  });

  it("input text: HasTextColor flag (bit 5) is always set", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "" }));
    expect(decoded.hasTextColor).toBe(true);
  });
});

describe("DefineEditText — HasFont wiring", () => {
  it("dynamic text with embedded font: HasFont flag (bit 7) is set", () => {
    // Static text uses DefineText (tag 11); use dynamic to test DefineEditText HasFont flag.
    const decoded = compileAndDecode(makeText({ textType: "dynamic" }));
    // compileDocument always embeds fonts → HasFont should be set
    expect(decoded.hasFont).toBe(true);
  });
});
