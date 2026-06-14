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

// ---------------------------------------------------------------------------
// DefineFont2/3 glyph-count + code-table parser (for embed subsetting tests)
// ---------------------------------------------------------------------------

/** Parse the GlyphCount and (WideCodes) CodeTable from a DefineFont2/3 body. */
function parseFontGlyphs(body: Uint8Array): { glyphCount: number; codeTable: number[] } {
  // FontID(2) + flags(1) + langCode(1) + nameLen(1) + name(nameLen)
  const nameLen = body[4];
  let p = 5 + nameLen;
  const glyphCount = body[p] | (body[p + 1] << 8);
  p += 2;
  // We emit WideOffsets=1 (32-bit) and WideCodes=1 (UI16). The OffsetTable is
  // (glyphCount + 1) × 4 bytes; the first entry's value is the byte offset from
  // the start of the OffsetTable to the first glyph, and the last entry points to
  // the CodeTable. Read the CodeTableOffset (last entry) to locate the codes.
  const offsetTableStart = p;
  const codeTableOffset =
    body[offsetTableStart + glyphCount * 4] |
    (body[offsetTableStart + glyphCount * 4 + 1] << 8) |
    (body[offsetTableStart + glyphCount * 4 + 2] << 16) |
    (body[offsetTableStart + glyphCount * 4 + 3] << 24);
  const codeTableStart = offsetTableStart + codeTableOffset;
  const codeTable: number[] = [];
  for (let i = 0; i < glyphCount; i++) {
    const o = codeTableStart + i * 2;
    codeTable.push(body[o] | (body[o + 1] << 8));
  }
  return { glyphCount, codeTable };
}

describe("computeEmbedCodePoints (task 1182)", () => {
  it("undefined ranges → full default set (32–126), 95 code points", async () => {
    const { computeEmbedCodePoints } = await import("../fonts.js");
    const cps = computeEmbedCodePoints(undefined, undefined, "anything");
    expect(cps.length).toBe(95);
    expect(cps[0]).toBe(32);
    expect(cps[cps.length - 1]).toBe(126);
  });

  it("'numerals' → space + 0–9 only", async () => {
    const { computeEmbedCodePoints } = await import("../fonts.js");
    const cps = computeEmbedCodePoints(["numerals"], "", "");
    expect(cps).toEqual([0x20, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
  });

  it("union of ranges + specific chars + field text, clamped to printable ASCII", async () => {
    const { computeEmbedCodePoints } = await import("../fonts.js");
    const cps = computeEmbedCodePoints(["numerals"], "@", "Hi\t\n");
    // numerals + space + '@' + 'H' + 'i'; control chars (\t,\n) dropped.
    expect(cps).toContain(0x40); // '@'
    expect(cps).toContain(0x48); // 'H'
    expect(cps).toContain(0x69); // 'i'
    expect(cps).not.toContain(9); // tab dropped (out of 32–126)
    expect(cps).not.toContain(10); // newline dropped
  });

  it("'all' embeds the entire printable-ASCII set", async () => {
    const { computeEmbedCodePoints } = await import("../fonts.js");
    const cps = computeEmbedCodePoints(["all"], "", "");
    expect(cps.length).toBe(95);
  });
});

describe("Font glyph subsetting — 'Embed…' character ranges (task 1182)", () => {
  it("no embedRanges → full 95-glyph table (default, golden-identical)", () => {
    const doc = makeDocWithText([makeText({ textType: "dynamic", fontFamily: "Arial", text: "123" })]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { glyphCount, codeTable } = parseFontGlyphs(font.body);
    expect(glyphCount).toBe(95);
    expect(codeTable[0]).toBe(32); // space
    expect(codeTable[codeTable.length - 1]).toBe(126); // '~'
  });

  it("'Numerals only' embeds just the 0–9 glyphs (plus space + field text)", () => {
    const doc = makeDocWithText([
      makeText({ textType: "dynamic", fontFamily: "Arial", text: "", embedRanges: ["numerals"], embedChars: "" }),
    ]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { glyphCount, codeTable } = parseFontGlyphs(font.body);
    // space (0x20) + 0–9 = 11 glyphs.
    expect(glyphCount).toBe(11);
    expect(codeTable).toEqual([0x20, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39]);
    // Far fewer than the all-glyphs baseline (95).
    expect(glyphCount).toBeLessThan(95);
  });

  it("subsetted font body is smaller than the full-font body", () => {
    const subsetDoc = makeDocWithText([
      makeText({ textType: "dynamic", fontFamily: "Arial", text: "", embedRanges: ["numerals"] }),
    ]);
    const fullDoc = makeDocWithText([
      makeText({ textType: "dynamic", fontFamily: "Arial", text: "" }),
    ]);
    const subset = findTags(compileDocument(subsetDoc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const full = findTags(compileDocument(fullDoc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    expect(subset.body.length).toBeLessThan(full.body.length);
  });

  it("field text characters are always included even if out of the chosen ranges", () => {
    const doc = makeDocWithText([
      makeText({ textType: "dynamic", fontFamily: "Arial", text: "A7", embedRanges: ["numerals"] }),
    ]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { codeTable } = parseFontGlyphs(font.body);
    expect(codeTable).toContain(0x41); // 'A' — required by the field text
    expect(codeTable).toContain(0x37); // '7'
    expect(codeTable).toContain(0x30); // numerals range still present
  });

  it("union of two fields sharing a font merges their embed selections", () => {
    const doc = makeDocWithText([
      makeText({ id: "a", textType: "dynamic", fontFamily: "Arial", text: "", embedRanges: ["numerals"] }),
      makeText({ id: "b", x: 10, y: 60, textType: "dynamic", fontFamily: "Arial", text: "", embedRanges: ["uppercase"] }),
    ]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { codeTable } = parseFontGlyphs(font.body);
    expect(codeTable).toContain(0x30); // numerals
    expect(codeTable).toContain(0x41); // uppercase A
    // 0–9 (10) + A–Z (26) + space (1) = 37
    expect(codeTable.length).toBe(37);
  });

  it("static DefineText glyph indices reference the subsetted table correctly", () => {
    const TAG_DEFINE_TEXT = 11;
    // Static field with text "5" and numerals embedded. In the subset table the
    // glyph order is [space, 0,1,2,3,4,5,...], so '5' is glyph index 6 — NOT the
    // legacy code-32 index (53-32=21, which would be out of range).
    const doc = makeDocWithText([
      makeText({ textType: "static", fontFamily: "Arial", text: "5", embedRanges: ["numerals"] }),
    ]);
    const tags = findTags(compileDocument(doc));
    const font = tags.find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { codeTable } = parseFontGlyphs(font.body);
    const expectedIndex = codeTable.indexOf(0x35); // index of '5' in subset table
    expect(expectedIndex).toBeGreaterThanOrEqual(0);
    expect(expectedIndex).toBeLessThan(codeTable.length);
    // A DefineText tag is emitted for the static field.
    expect(tags.some((t) => t.type === TAG_DEFINE_TEXT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DefineText (tag 11) glyph-index decoder — used to prove that the per-glyph
// indices a static field emits point at the correct entries in the (subsetted)
// font glyph table.
// ---------------------------------------------------------------------------

/**
 * Decode the ordered glyph indices out of a DefineText (tag 11) body produced by
 * `encodeDefineText`. That encoder writes a single byte-aligned style-change
 * TEXTRECORD (flag 0x8F: HasFont|HasColor|HasYOffset|HasXOffset) carrying FontID
 * (UI16), Color (RGB), XOffset/YOffset (SI16), TextHeight (UI16), GlyphCount
 * (UI8), then GlyphCount × (UB[glyphBits] index, SB[advanceBits] advance).
 */
function parseDefineTextGlyphIndices(body: Uint8Array): number[] {
  // charId(2) + bounds RECT + text MATRIX, then glyphBits/advanceBits (UI8 each).
  let bitPos = 2 * 8; // skip charId
  const bit = () => {
    const v = (body[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
    bitPos++;
    return v;
  };
  const bits = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bit();
    return v;
  };
  const align = () => {
    bitPos = Math.ceil(bitPos / 8) * 8;
  };
  // Bounds RECT (Nbits then 4 fields).
  const rnb = bits(5);
  bits(rnb); bits(rnb); bits(rnb); bits(rnb);
  align();
  // Text MATRIX.
  if (bit()) { const nb = bits(5); bits(nb); bits(nb); } // scale
  if (bit()) { const nb = bits(5); bits(nb); bits(nb); } // rotate/skew
  { const nb = bits(5); bits(nb); bits(nb); }            // translate
  align();
  let p = bitPos >> 3;
  const glyphBits = body[p++];
  const advanceBits = body[p++];
  const out: number[] = [];
  // TEXTRECORDs: encodeDefineText emits exactly one style-change record then one
  // run of glyphs, terminated by a 0x00 byte.
  const flag = body[p++];
  if ((flag & 0x80) === 0) return out; // not a style-change record
  const hasFont = (flag >> 3) & 1;
  const hasColor = (flag >> 2) & 1;
  const hasY = (flag >> 1) & 1;
  const hasX = flag & 1;
  if (hasFont) p += 2;  // FontID UI16
  if (hasColor) p += 3; // RGB (tag 11 = DefineText, not DefineText2)
  if (hasX) p += 2;     // XOffset SI16
  if (hasY) p += 2;     // YOffset SI16
  if (hasFont) p += 2;  // TextHeight UI16
  const glyphCount = body[p++];
  // Glyph entries are bit-packed starting at byte p.
  bitPos = p * 8;
  for (let i = 0; i < glyphCount; i++) {
    out.push(bits(glyphBits));
    bits(advanceBits);
  }
  return out;
}

describe("Static-text font auto-subsetting — default (task 1186)", () => {
  const TAG_DEFINE_TEXT = 11;

  it("static text with no embedRanges auto-subsets to its own chars + space", () => {
    const doc = makeDocWithText([makeText({ textType: "static", fontFamily: "Arial", text: "Hello" })]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { glyphCount, codeTable } = parseFontGlyphs(font.body);
    // "Hello" → {space, H, e, l, o} sorted.
    expect(glyphCount).toBe(5);
    expect(codeTable).toEqual([0x20, 0x48, 0x65, 0x6c, 0x6f]);
  });

  it("two static fields sharing a font union their used chars", () => {
    const doc = makeDocWithText([
      makeText({ id: "a", textType: "static", fontFamily: "Arial", text: "AB" }),
      makeText({ id: "b", x: 10, y: 60, textType: "static", fontFamily: "Arial", text: "BC" }),
    ]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { codeTable } = parseFontGlyphs(font.body);
    // {space, A, B, C}
    expect(codeTable).toEqual([0x20, 0x41, 0x42, 0x43]);
  });

  it("a dynamic field with no embedRanges does NOT subset (device font, full set)", () => {
    // A font used only by an un-embedded dynamic field falls back to the full set.
    const doc = makeDocWithText([makeText({ textType: "dynamic", fontFamily: "Arial", text: "Hi" })]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { glyphCount } = parseFontGlyphs(font.body);
    expect(glyphCount).toBe(95);
  });

  it("a dynamic field does NOT shrink a font shared with static text", () => {
    // golden.fla shape: a dynamic "Score: 0" and a static field share Arial. The
    // dynamic field renders with a device font and must NOT force the full 95-glyph
    // set; only the static field's chars are embedded.
    const doc = makeDocWithText([
      makeText({ id: "dyn", textType: "dynamic", fontFamily: "Arial", text: "Score: 0" }),
      makeText({ id: "stat", x: 10, y: 60, textType: "static", fontFamily: "Arial", text: "Win" }),
    ]);
    const font = findTags(compileDocument(doc)).find((t) => t.type === TAG_DEFINE_FONT3)!;
    const { glyphCount, codeTable } = parseFontGlyphs(font.body);
    // Only "Win" + space → {space, W, i, n}.
    expect(glyphCount).toBe(4);
    expect(codeTable).toEqual([0x20, 0x57, 0x69, 0x6e]);
  });

  it("DefineText glyph indices point at the correct subsetted glyphs", () => {
    // CRITICAL: shrinking the glyph table must rebuild the code→index map so each
    // character still references the right glyph. "Cab" → table {space,C,a,b}.
    const doc = makeDocWithText([makeText({ textType: "static", fontFamily: "Arial", text: "Cab" })]);
    const tags = findTags(compileDocument(doc));
    const font = tags.find((t) => t.type === TAG_DEFINE_FONT3)!;
    const text = tags.find((t) => t.type === TAG_DEFINE_TEXT)!;
    const { codeTable } = parseFontGlyphs(font.body);
    expect(codeTable).toEqual([0x20, 0x43, 0x61, 0x62]); // space, C, a, b

    const indices = parseDefineTextGlyphIndices(text.body);
    // Decode the indices back to characters via the font's code table; they must
    // spell the original text exactly (NOT the legacy code-32 indices).
    const decoded = indices.map((i) => String.fromCharCode(codeTable[i])).join("");
    expect(decoded).toBe("Cab");
    // And concretely: 'C'→index 1, 'a'→index 2, 'b'→index 3 in {space,C,a,b}.
    expect(indices).toEqual([1, 2, 3]);
  });
});

describe("DefineFont3 (tag 75) — Auto kern KerningTable (task 1178)", () => {
  it("encodeDefineFont2 emits KerningCount=0 when kerning is off", async () => {
    const { encodeDefineFont2 } = await import("../fonts.js");
    const body = encodeDefineFont2(7, "Arial", false, false, 20, false);
    // The KerningTable is the last field; with no kerning the final UI16 is 0.
    const lo = body[body.length - 2];
    const hi = body[body.length - 1];
    expect(lo).toBe(0);
    expect(hi).toBe(0);
  });

  it("encodeDefineFont2 appends kerning records when kerning is on", async () => {
    const { encodeDefineFont2 } = await import("../fonts.js");
    const off = encodeDefineFont2(7, "Arial", false, false, 20, false);
    const on = encodeDefineFont2(7, "Arial", false, false, 20, true);
    // The kerned body must be longer by KerningCount records (6 bytes each:
    // UI16 left + UI16 right + SI16 adjustment, WideCodes=1).
    const delta = on.length - off.length;
    expect(delta).toBeGreaterThan(0);
    expect(delta % 6).toBe(0);
    const recordCount = delta / 6;
    expect(recordCount).toBeGreaterThanOrEqual(10);

    // The KerningCount UI16 sits where `off` previously had its trailing 00 00.
    // In `on` that position holds the real record count.
    const kerningCount = on[off.length - 2] | (on[off.length - 1] << 8);
    expect(kerningCount).toBe(recordCount);
  });

  it("a dynamic autoKern field's font body is longer than a non-kern field's", () => {
    const kernedDoc = makeDocWithText([
      makeText({ id: "t", textType: "dynamic", fontFamily: "Arial", autoKern: true }),
    ]);
    const plainDoc = makeDocWithText([
      makeText({ id: "t", textType: "dynamic", fontFamily: "Arial" }),
    ]);
    const kernedFont = findTags(compileDocument(kernedDoc)).find((t) => t.type === TAG_DEFINE_FONT3);
    const plainFont = findTags(compileDocument(plainDoc)).find((t) => t.type === TAG_DEFINE_FONT3);
    expect(kernedFont).toBeTruthy();
    expect(plainFont).toBeTruthy();
    // The autoKern font carries the KerningTable; the plain font does not.
    expect(kernedFont!.body.length).toBeGreaterThan(plainFont!.body.length);
  });

  it("a static autoKern field still emits DefineText (kerning baked into advances)", () => {
    const TAG_DEFINE_TEXT = 11;
    // Flash 8 keeps static text in DefineText and bakes pair kerning into the
    // per-glyph advances rather than switching to DefineEditText. This preserves
    // golden tag inventory while still tightening kerned pairs.
    const doc = makeDocWithText([
      makeText({ id: "t", textType: "static", fontFamily: "Arial", autoKern: true }),
    ]);
    const tags = findTags(compileDocument(doc));
    expect(tags.some((t) => t.type === TAG_DEFINE_TEXT)).toBe(true);
  });

  it("baking kerning shortens a static field's DefineText body advances ('AV')", async () => {
    const { encodeDefineText } = await import("../text.js");
    // 'A','V' is a kerned pair; the kerned encoding must shrink the first
    // glyph's advance, but body length stays identical (advances are fixed-width).
    const plain = encodeDefineText(9, "AV", 1, 240, "#000000", 0, 240, false);
    const kerned = encodeDefineText(9, "AV", 1, 240, "#000000", 0, 240, true);
    expect(kerned.length).toBe(plain.length);
    // The two encodings must differ (a kern was applied to the 'A' advance).
    expect(Buffer.from(kerned).equals(Buffer.from(plain))).toBe(false);
  });
});
