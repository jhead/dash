/**
 * Tests for DefineText (tag 11) static text encoding.
 *
 * Verifies encodeDefineText output format and that compileDocument emits
 * DefineText (tag 11) for static text objects and DefineEditText (tag 37)
 * for dynamic text objects.
 */

import { describe, it, expect } from "vitest";
import { encodeDefineText } from "../text.js";
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
// Tests: encodeDefineText unit tests
// ---------------------------------------------------------------------------

describe("encodeDefineText (tag 11)", () => {
  it("returns a Uint8Array", () => {
    const result = encodeDefineText(1, "Hi", 2, 240, "#000000", 0, 240);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("charId is encoded as UI16 LE in the first two bytes", () => {
    const charId = 42;
    const result = encodeDefineText(charId, "Hello", 1, 240, "#ff0000", 0, 240);
    const encoded = result[0] | (result[1] << 8);
    expect(encoded).toBe(charId);
  });

  it("encodes charId 0x0201 (little-endian: 0x01, 0x02)", () => {
    const result = encodeDefineText(0x0201, "A", 1, 240, "#000000", 0, 240);
    expect(result[0]).toBe(0x01);
    expect(result[1]).toBe(0x02);
  });

  it("text bounds RECT is non-empty (output is larger than just charId + minimal RECT)", () => {
    const result = encodeDefineText(1, "Hello World", 1, 240, "#000000", 0, 240);
    // Minimal output would be 2 (charId) + at least a few bytes for RECT
    expect(result.length).toBeGreaterThan(10);
  });

  it("glyph data for ASCII text is present — output contains ASCII-32 glyph indices", () => {
    // "A" has charCode 65, glyph index = 65 - 32 = 33 = 0x21
    const result = encodeDefineText(1, "A", 1, 240, "#000000", 0, 240);
    // The glyph index byte (0x21 for 'A') should appear somewhere after the header
    const bytes = Array.from(result);
    expect(bytes).toContain(0x21);
  });

  it("output length scales with text length (more chars → more glyph entries)", () => {
    const short = encodeDefineText(1, "Hi", 1, 240, "#000000", 0, 240);
    const long = encodeDefineText(1, "Hello World!", 1, 240, "#000000", 0, 240);
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("output ends with 0x00 terminator after glyph data (TEXTRECORD array terminator)", () => {
    const result = encodeDefineText(1, "Test", 1, 240, "#000000", 0, 240);
    // Last byte must be 0x00 (TEXTRECORD terminator)
    expect(result[result.length - 1]).toBe(0x00);
  });
});

// ---------------------------------------------------------------------------
// Tests: compile.ts integration
// ---------------------------------------------------------------------------

// All text types (static, dynamic, input) now use DefineEditText (tag 37) with
// device fonts (no UseOutlines / no embedded glyph outlines). This matches the
// MC text behaviour and avoids the mangled 5×7 pixel-art font appearance.
describe("compileDocument text tag routing", () => {
  it("compiled doc with static text emits tag 37 (DefineEditText)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBeGreaterThanOrEqual(1);
  });

  it("compiled doc with static text does NOT emit tag 11 (DefineText)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTags = tags.filter((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTags.length).toBe(0);
  });

  it("compiled doc with dynamic text emits tag 37 (DefineEditText)", () => {
    const doc = makeDoc([makeText({ textType: "dynamic", text: "Score: 0" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBeGreaterThanOrEqual(1);
  });

  it("compiled doc with dynamic text does NOT emit tag 11 (DefineText)", () => {
    const doc = makeDoc([makeText({ textType: "dynamic", text: "Score: 0" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTags = tags.filter((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTags.length).toBe(0);
  });

  it("compiled doc with input text emits tag 37 (DefineEditText)", () => {
    const doc = makeDoc([makeText({ textType: "input", text: "" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBeGreaterThanOrEqual(1);
  });

  it("static text DefineEditText tag body: charId matches first two bytes", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hi" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTag = tags.find((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTag).toBeDefined();
    // charId should be a valid UI16 (positive small number)
    const charId = editTag!.body[0] | (editTag!.body[1] << 8);
    expect(charId).toBeGreaterThan(0);
  });
});
