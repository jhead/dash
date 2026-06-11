/**
 * Tests for DefineFont3 (tag 75) and FontItem library embedding.
 *
 * Verifies that:
 *  1. A SWF with no FontItem in library emits no tag 75 (DefineFont3)
 *  2. A SWF with a FontItem in library compiles without error
 *  3. When tag 75 is emitted, font name is encoded as a counted string (first byte = length)
 *  4. When tag 75 is emitted, the bold flag (FontFlagsBold = 0x01) is set correctly
 *  5. A SWF with a DefineEditText referencing a font compiles without error
 */
import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, FontItem, Frame, Layer, Scene, TextDisplayObject } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_DEFINE_FONT3 = 75;

// ---------------------------------------------------------------------------
// SWF binary parser (minimal)
// ---------------------------------------------------------------------------

function findTags(bytes: Uint8Array): Array<{ type: number; body: Uint8Array }> {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<{ type: number; body: Uint8Array }> = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len = bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
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

function makeEmptyDoc(): FlashDocument {
  return {
    id: "doc-empty",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [makeFrame([])])],
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

function makeDocWithText(textObjects: TextDisplayObject[]): FlashDocument {
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

describe("DefineFont3 (tag 75) — no FontItem → no tag 75", () => {
  it("a SWF with no FontItem and no text objects emits no tag 75", () => {
    const doc = makeEmptyDoc();
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(0);
  });

  it("a SWF with only non-font library items emits no tag 75", () => {
    const doc = makeDocWithFontItems([]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBe(0);
  });
});

describe("DefineFont3 (tag 75) — FontItem in library compiles without error", () => {
  it("a doc with one FontItem compiles without throwing", () => {
    const doc = makeDocWithFontItems([makeFontItem()]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("a doc with a bold FontItem compiles without throwing", () => {
    const doc = makeDocWithFontItems([makeFontItem({ bold: true })]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("a doc with an italic FontItem compiles without throwing", () => {
    const doc = makeDocWithFontItems([makeFontItem({ italic: true })]);
    expect(() => compileDocument(doc)).not.toThrow();
  });
});

describe("DefineFont3 (tag 75) — font name encoded as counted string", () => {
  it("font name first byte is the length of the name string", () => {
    const fontName = "Verdana";
    const doc = makeDocWithFontItems([makeFontItem({ fontName })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    // body: FontID(2) + flags(1) + langCode(1) + nameLen(1) + name bytes
    const nameLen = body[4];
    expect(nameLen).toBe(fontName.length);
  });

  it("font name bytes decode correctly to the font family name", () => {
    const fontName = "Times New Roman";
    const doc = makeDocWithFontItems([makeFontItem({ fontName, name: fontName, linkageIdentifier: "Times" })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    const nameLen = body[4];
    const nameBytes = body.slice(5, 5 + nameLen);
    const decodedName = new TextDecoder().decode(nameBytes);
    expect(decodedName).toBe(fontName);
  });

  it("font name length byte matches the byte count of the encoded name", () => {
    const fontName = "Arial";
    const doc = makeDocWithFontItems([makeFontItem({ fontName })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    const nameLen = body[4];
    // nameLen should equal new TextEncoder().encode(fontName).length
    const encoded = new TextEncoder().encode(fontName);
    expect(nameLen).toBe(encoded.length);
  });
});

describe("DefineFont3 (tag 75) — bold flag (FontFlagsBold = 0x01)", () => {
  it("bold FontItem sets FontFlagsBold bit (0x01) in flags byte", () => {
    const doc = makeDocWithFontItems([makeFontItem({ bold: true })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    // body: FontID(2) + flags(1)
    const flags = body[2];
    // FontFlagsBold = bit 0 = 0x01
    expect(flags & 0x01).toBe(1);
  });

  it("non-bold FontItem does NOT set FontFlagsBold bit (0x01)", () => {
    const doc = makeDocWithFontItems([makeFontItem({ bold: false })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    const flags = body[2];
    expect(flags & 0x01).toBe(0);
  });

  it("italic FontItem sets FontFlagsItalic bit (0x02) in flags byte", () => {
    const doc = makeDocWithFontItems([makeFontItem({ italic: true })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);

    const body = font3Tags[0].body;
    const flags = body[2];
    // FontFlagsItalic = bit 1 = 0x02
    expect(flags & 0x02).toBe(2);
  });
});

describe("DefineFont3 (tag 75) — DefineEditText referencing a font compiles", () => {
  it("a dynamic text object (DefineEditText) compiles without error", () => {
    const doc = makeDocWithText([makeText({ textType: "dynamic" })]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("a doc with an input text object compiles without error", () => {
    const doc = makeDocWithText([makeText({ textType: "input" })]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("a doc with a dynamic text object also emits a DefineFont3 tag", () => {
    const doc = makeDocWithText([makeText({ textType: "dynamic", fontFamily: "Arial" })]);
    const tags = findTags(compileDocument(doc));
    const font3Tags = tags.filter((t) => t.type === TAG_DEFINE_FONT3);
    // A font tag should be emitted for the referenced font
    expect(font3Tags.length).toBeGreaterThanOrEqual(1);
  });
});
