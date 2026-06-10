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
  /** true if HasText flag (bit 7) is set */
  hasText: boolean;
  /** true if ReadOnly flag (bit 3) is set */
  readOnly: boolean;
  /** true if HasTextColor flag (bit 2) is set */
  hasTextColor: boolean;
  /** true if HasFont flag (bit 0) is set — font ID + height present */
  hasFont: boolean;
  /** true if UseOutlines flag (bit 8) is set — embedded glyph outlines used */
  useOutlines: boolean;
  /** true if NoSelect flag (bit 12) is set */
  noSelect: boolean;
  /** true if WasStatic flag (bit 10) is set */
  wasStatic: boolean;
  /** initial text string if HasText is set, otherwise undefined */
  initialText: string | undefined;
  /** HasLayout LeftMargin in twips (UI16) — undefined when HasLayout not set */
  leftMarginTwips?: number;
  /** HasLayout RightMargin in twips (UI16) — undefined when HasLayout not set */
  rightMarginTwips?: number;
  /** HasLayout Indent in twips (UI16) — undefined when HasLayout not set */
  indentTwips?: number;
  /** HasLayout Leading in twips (SI16) — undefined when HasLayout not set */
  leadingTwips?: number;
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

  // Bit positions per SWF spec / Ruffle EditTextFlag.
  const hasFont = (flags & (1 << 0)) !== 0;
  const hasMaxLength = (flags & (1 << 1)) !== 0;
  const hasTextColor = (flags & (1 << 2)) !== 0;
  const readOnly = (flags & (1 << 3)) !== 0;
  const hasText = (flags & (1 << 7)) !== 0;
  const useOutlines = (flags & (1 << 8)) !== 0;
  const wasStatic = (flags & (1 << 10)) !== 0;
  const noSelect = (flags & (1 << 12)) !== 0;
  const hasLayout = (flags & (1 << 13)) !== 0;

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

  // HasLayout: Align UI8, LeftMargin UI16, RightMargin UI16, Indent UI16, Leading SI16
  let leftMarginTwips: number | undefined;
  let rightMarginTwips: number | undefined;
  let indentTwips: number | undefined;
  let leadingTwips: number | undefined;
  if (hasLayout) {
    byteOff += 1; // Align UI8 (skip)
    leftMarginTwips = body[byteOff] | (body[byteOff + 1] << 8);
    byteOff += 2;
    rightMarginTwips = body[byteOff] | (body[byteOff + 1] << 8);
    byteOff += 2;
    indentTwips = body[byteOff] | (body[byteOff + 1] << 8);
    byteOff += 2;
    // Leading: SI16 (sign-extend)
    const rawLeading = body[byteOff] | (body[byteOff + 1] << 8);
    leadingTwips = rawLeading >= 0x8000 ? rawLeading - 0x10000 : rawLeading;
    byteOff += 2;
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

  return { charId, flags, hasText, readOnly, hasTextColor, hasFont, useOutlines, noSelect, wasStatic, initialText, leftMarginTwips, rightMarginTwips, indentTwips, leadingTwips };
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

// All text types now use DefineEditText (tag 37) with device fonts (no embedded
// font outlines). This makes static text render identically to MC text (both use
// Ruffle's device-font path), fixing the "mangled" 5×7 pixel-art appearance that
// occurred when UseOutlines + DefineFont3 was enabled.
describe("Static text — emits DefineEditText (tag 37), device fonts", () => {
  it("static text: emits DefineEditText tag (code 37)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBeGreaterThanOrEqual(1);
  });

  it("static text: does NOT emit DefineText tag (code 11)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const textTags = tags.filter((t) => t.code === TAG_DEFINE_TEXT);
    expect(textTags.length).toBe(0);
  });

  it("static text: HasFont flag (bit 0) IS set (for size), UseOutlines (bit 8) is NOT set (device fonts)", () => {
    const doc = makeDoc([makeText({ textType: "static", text: "Hello" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTag = tags.find((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTag).toBeDefined();
    const decoded = decodeDefineEditText(editTag!.body);
    // HasFont is set so Ruffle knows the font size; UseOutlines is NOT set so
    // Ruffle renders with device fonts instead of the custom embedded glyphs.
    expect(decoded.hasFont).toBe(true);
    expect(decoded.useOutlines).toBe(false);
  });

  it("static text: WasStatic flag (bit 10) is set", () => {
    const decoded = compileAndDecode(makeText({ textType: "static", text: "Hello" }));
    expect(decoded.wasStatic).toBe(true);
  });

  it("static text: NoSelect flag (bit 12) is set (not selectable)", () => {
    const decoded = compileAndDecode(makeText({ textType: "static", text: "Hello" }));
    expect(decoded.noSelect).toBe(true);
  });

  it("static text: initial text is encoded in DefineEditText body", () => {
    const decoded = compileAndDecode(makeText({ textType: "static", text: "Hello World" }));
    expect(decoded.initialText).toBe("Hello World");
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

describe("DefineEditText — UseOutlines NOT set (device fonts, correct size)", () => {
  it("dynamic text: HasFont IS set (for size) but UseOutlines is NOT set (device font rendering)", () => {
    // HasFont is set so Ruffle gets the font size. UseOutlines is NOT set so
    // Ruffle renders with device fonts rather than the custom pixel-art embedded glyphs.
    const decoded = compileAndDecode(makeText({ textType: "dynamic" }));
    expect(decoded.hasFont).toBe(true);
    expect(decoded.useOutlines).toBe(false);
  });

  it("static text: HasFont IS set (for size) but UseOutlines is NOT set (device font rendering)", () => {
    const decoded = compileAndDecode(makeText({ textType: "static" }));
    expect(decoded.hasFont).toBe(true);
    expect(decoded.useOutlines).toBe(false);
  });
});

describe("DefineEditText — HasLayout paragraph fields (leading, margins, indent)", () => {
  it("default text (no paragraph fields set): leading=0, leftMargin=0, rightMargin=0, indent=0 twips", () => {
    const decoded = compileAndDecode(makeText());
    expect(decoded.leadingTwips).toBe(0);
    expect(decoded.leftMarginTwips).toBe(0);
    expect(decoded.rightMarginTwips).toBe(0);
    expect(decoded.indentTwips).toBe(0);
  });

  it("leading=20px → 400 twips in HasLayout Leading field", () => {
    const decoded = compileAndDecode(makeText({ leading: 20 }));
    expect(decoded.leadingTwips).toBe(400); // 20 * 20 = 400
  });

  it("leading=2px → 40 twips", () => {
    const decoded = compileAndDecode(makeText({ leading: 2 }));
    expect(decoded.leadingTwips).toBe(40); // 2 * 20 = 40
  });

  it("leftMargin=10px → 200 twips in HasLayout LeftMargin field", () => {
    const decoded = compileAndDecode(makeText({ leftMargin: 10 }));
    expect(decoded.leftMarginTwips).toBe(200); // 10 * 20 = 200
  });

  it("rightMargin=15px → 300 twips in HasLayout RightMargin field", () => {
    const decoded = compileAndDecode(makeText({ rightMargin: 15 }));
    expect(decoded.rightMarginTwips).toBe(300); // 15 * 20 = 300
  });

  it("indent=5px → 100 twips in HasLayout Indent field", () => {
    const decoded = compileAndDecode(makeText({ indent: 5 }));
    expect(decoded.indentTwips).toBe(100); // 5 * 20 = 100
  });

  it("all four paragraph fields combined", () => {
    const decoded = compileAndDecode(makeText({
      leading: 20,
      leftMargin: 10,
      rightMargin: 15,
      indent: 5,
    }));
    expect(decoded.leadingTwips).toBe(400);
    expect(decoded.leftMarginTwips).toBe(200);
    expect(decoded.rightMarginTwips).toBe(300);
    expect(decoded.indentTwips).toBe(100);
  });

  it("paragraph fields apply to all text types (dynamic)", () => {
    const decoded = compileAndDecode(makeText({ textType: "dynamic", leading: 8, leftMargin: 4 }));
    expect(decoded.leadingTwips).toBe(160); // 8 * 20
    expect(decoded.leftMarginTwips).toBe(80); // 4 * 20
  });

  it("paragraph fields apply to all text types (input)", () => {
    const decoded = compileAndDecode(makeText({ textType: "input", text: "", indent: 12 }));
    expect(decoded.indentTwips).toBe(240); // 12 * 20
  });
});

// ---------------------------------------------------------------------------
// letterSpacing — DoAction emission tests
// ---------------------------------------------------------------------------

const TAG_DO_ACTION = 12;

/** Check whether a byte array contains a given UTF-8 string as a substring. */
function bodyContainsString(body: Uint8Array, str: string): boolean {
  const needle = new TextEncoder().encode(str);
  outer: for (let i = 0; i <= body.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (body[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("letterSpacing → DoAction setTextFormat", () => {
  it("text with instanceName and letterSpacing=5 produces a DoAction tag", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBeGreaterThanOrEqual(1);
  });

  it("DoAction body contains 'letterSpacing' string", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasLetterSpacing = doActionTags.some((t) =>
      bodyContainsString(t.body, "letterSpacing")
    );
    expect(hasLetterSpacing).toBe(true);
  });

  it("DoAction body contains 'setTextFormat' string", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasSetTextFormat = doActionTags.some((t) =>
      bodyContainsString(t.body, "setTextFormat")
    );
    expect(hasSetTextFormat).toBe(true);
  });

  it("DoAction body contains 'TextFormat' string (ActionNewObject class name)", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasTextFormat = doActionTags.some((t) =>
      bodyContainsString(t.body, "TextFormat")
    );
    expect(hasTextFormat).toBe(true);
  });

  it("DoAction body contains ActionNewObject opcode (0x40)", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasNewObject = doActionTags.some((t) =>
      Array.from(t.body).includes(0x40)
    );
    expect(hasNewObject).toBe(true);
  });

  it("DoAction body contains ActionSetMember opcode (0x4f)", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasSetMember = doActionTags.some((t) =>
      Array.from(t.body).includes(0x4f)
    );
    expect(hasSetMember).toBe(true);
  });

  it("text WITHOUT instanceName does NOT produce a letter-spacing DoAction", () => {
    // Anonymous text fields can't be addressed by AS2, so no DoAction should be emitted.
    const doc = makeDoc([
      makeText({ textType: "dynamic", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasLetterSpacing = doActionTags.some((t) =>
      bodyContainsString(t.body, "letterSpacing")
    );
    expect(hasLetterSpacing).toBe(false);
  });

  it("text with letterSpacing=0 does NOT produce a letter-spacing DoAction", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 0 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const hasLetterSpacing = doActionTags.some((t) =>
      bodyContainsString(t.body, "letterSpacing")
    );
    expect(hasLetterSpacing).toBe(false);
  });

  it("DoAction ends with ActionEnd (0x00)", () => {
    const doc = makeDoc([
      makeText({ textType: "dynamic", instanceName: "scoreText", letterSpacing: 5 }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    const lsDoAction = doActionTags.find((t) =>
      bodyContainsString(t.body, "letterSpacing")
    );
    expect(lsDoAction).toBeDefined();
    expect(lsDoAction!.body[lsDoAction!.body.length - 1]).toBe(0x00);
  });
});

// ---------------------------------------------------------------------------
// CSMTextSettings (tag 74) — FlashType anti-alias mode
// ---------------------------------------------------------------------------

const TAG_CSM_TEXT_SETTINGS = 74;

describe("CSMTextSettings (tag 74) — anti-alias mode", () => {
  it("antiAlias='readability': emits a CSMTextSettings tag (code 74)", () => {
    const doc = makeDoc([makeText({ antiAlias: "readability" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTags = tags.filter((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTags.length).toBe(1);
  });

  it("antiAlias='readability': CSMTextSettings body is 12 bytes", () => {
    const doc = makeDoc([makeText({ antiAlias: "readability" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTag = tags.find((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTag).toBeDefined();
    expect(csmTag!.body.length).toBe(12);
  });

  it("antiAlias='readability': UseFlashType=1 and GridFit=1 in flags byte", () => {
    const doc = makeDoc([makeText({ antiAlias: "readability" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTag = tags.find((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTag).toBeDefined();
    // flags byte at offset 2: UseFlashType=1 (bits 7-5 = 0b001 → 0x20) | GridFit=1 (bits 4-2 = 0b001 → 0x04)
    expect(csmTag!.body[2]).toBe(0x24);
  });

  it("antiAlias='readability': thickness and sharpness are both 0.0", () => {
    const doc = makeDoc([makeText({ antiAlias: "readability" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTag = tags.find((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTag).toBeDefined();
    const view = new DataView(csmTag!.body.buffer, csmTag!.body.byteOffset);
    const thickness = view.getFloat32(3, true /* LE */);
    const sharpness = view.getFloat32(7, true /* LE */);
    expect(thickness).toBe(0);
    expect(sharpness).toBe(0);
  });

  it("antiAlias='readability': CSMTextSettings textID matches the DefineEditText charId", () => {
    const doc = makeDoc([makeText({ antiAlias: "readability" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTag = tags.find((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    const csmTag = tags.find((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(editTag).toBeDefined();
    expect(csmTag).toBeDefined();
    // charId from DefineEditText body
    const editCharId = editTag!.body[0] | (editTag!.body[1] << 8);
    // textID from CSMTextSettings body
    const csmTextId = csmTag!.body[0] | (csmTag!.body[1] << 8);
    expect(csmTextId).toBe(editCharId);
  });

  it("antiAlias='custom': emits CSMTextSettings with provided sharpness/thickness", () => {
    const doc = makeDoc([makeText({ antiAlias: "custom", csm: { sharpness: 100, thickness: 50 } })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTag = tags.find((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTag).toBeDefined();
    const view = new DataView(csmTag!.body.buffer, csmTag!.body.byteOffset);
    const thickness = view.getFloat32(3, true /* LE */);
    const sharpness = view.getFloat32(7, true /* LE */);
    expect(thickness).toBeCloseTo(50);
    expect(sharpness).toBeCloseTo(100);
  });

  it("antiAlias='animation' (default): NO CSMTextSettings tag emitted", () => {
    const doc = makeDoc([makeText({ antiAlias: "animation" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTags = tags.filter((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTags.length).toBe(0);
  });

  it("antiAlias unset (default): NO CSMTextSettings tag emitted", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTags = tags.filter((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTags.length).toBe(0);
  });

  it("antiAlias='device': NO CSMTextSettings tag emitted", () => {
    const doc = makeDoc([makeText({ antiAlias: "device" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTags = tags.filter((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTags.length).toBe(0);
  });

  it("antiAlias='bitmap': NO CSMTextSettings tag emitted", () => {
    const doc = makeDoc([makeText({ antiAlias: "bitmap" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const csmTags = tags.filter((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(csmTags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DefineFontAlignZones (tag 73) — per-glyph zone approximation
// ---------------------------------------------------------------------------

const TAG_DEFINE_FONT_ALIGN_ZONES = 73;
const TAG_DEFINE_FONT3 = 75;

describe("DefineFontAlignZones (tag 73) — emitted for all embedded fonts", () => {
  it("emits a DefineFontAlignZones tag (code 73) when text is present", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTags = tags.filter((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTags.length).toBe(1);
  });

  it("DefineFontAlignZones body: fontID matches the DefineFont3 charId", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const font3Tag = tags.find((t) => t.code === TAG_DEFINE_FONT3);
    const alignTag = tags.find((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(font3Tag).toBeDefined();
    expect(alignTag).toBeDefined();
    // fontID in DefineFont3 body is at bytes 0-1 (UI16LE)
    const font3CharId = font3Tag!.body[0] | (font3Tag!.body[1] << 8);
    // fontID in DefineFontAlignZones is at bytes 0-1 (UI16LE)
    const alignFontId = alignTag!.body[0] | (alignTag!.body[1] << 8);
    expect(alignFontId).toBe(font3CharId);
  });

  it("DefineFontAlignZones body: CSMTableHint byte (offset 2) is medium (0x40)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTag = tags.find((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTag).toBeDefined();
    // CSMTableHint: bits[7:6] = 1 (medium) → 0b01000000 = 0x40
    expect(alignTag!.body[2]).toBe(0x40);
  });

  it("DefineFontAlignZones body: correct size (3 + 10 * 95 = 953 bytes)", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTag = tags.find((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTag).toBeDefined();
    // 2 (fontID) + 1 (thickness) + 95 * 10 (zones) = 953 bytes
    expect(alignTag!.body.length).toBe(953);
  });

  it("DefineFontAlignZones body: first glyph's zone has ZoneCount=2 at offset 3", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTag = tags.find((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTag).toBeDefined();
    // First zone record starts at byte 3: ZoneCount = 2
    expect(alignTag!.body[3]).toBe(2);
  });

  it("DefineFontAlignZones body: first glyph ZoneMask (last byte of first zone) = 0x03", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTag = tags.find((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTag).toBeDefined();
    // ZoneMask at offset 3 + 1 + 8 = 12 (ZoneCount + 4×SI16)
    expect(alignTag!.body[12]).toBe(0x03);
  });

  it("DefineFontAlignZones tag precedes CSMTextSettings (tag 74) in the stream", () => {
    const doc = makeDoc([makeText({ antiAlias: "readability" })]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignIdx = tags.findIndex((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    const csmIdx = tags.findIndex((t) => t.code === TAG_CSM_TEXT_SETTINGS);
    expect(alignIdx).toBeGreaterThanOrEqual(0);
    expect(csmIdx).toBeGreaterThanOrEqual(0);
    // DefineFontAlignZones is emitted with the font definition (before text chars),
    // CSMTextSettings is emitted with the DefineEditText — so align < csm
    expect(alignIdx).toBeLessThan(csmIdx);
  });

  it("DefineFontAlignZones tag follows DefineFont3 (tag 75) in the stream", () => {
    const doc = makeDoc([makeText()]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const font3Idx = tags.findIndex((t) => t.code === TAG_DEFINE_FONT3);
    const alignIdx = tags.findIndex((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(font3Idx).toBeGreaterThanOrEqual(0);
    expect(alignIdx).toBeGreaterThanOrEqual(0);
    expect(alignIdx).toBe(font3Idx + 1);
  });

  it("two distinct fonts produce two DefineFontAlignZones tags", () => {
    const doc = makeDoc([
      makeText({ id: "text-1", fontFamily: "Arial", bold: false, italic: false }),
      makeText({ id: "text-2", fontFamily: "Times New Roman", bold: false, italic: false }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTags = tags.filter((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTags.length).toBe(2);
  });

  it("same font used by multiple text fields produces only one DefineFontAlignZones tag", () => {
    const doc = makeDoc([
      makeText({ id: "text-1", fontFamily: "Arial" }),
      makeText({ id: "text-2", fontFamily: "Arial" }),
    ]);
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const alignTags = tags.filter((t) => t.code === TAG_DEFINE_FONT_ALIGN_ZONES);
    expect(alignTags.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Input text extra properties: password, maxChars, hasBorder
// ---------------------------------------------------------------------------

/**
 * Extended decoder that also checks the Password, HasMaxLength, Border flags
 * and reads the MaxLength field when present.
 */
interface ExtendedDecodedEditText extends DecodedEditText {
  password: boolean;
  hasMaxLength: boolean;
  border: boolean;
  maxLength?: number;
}

function decodeDefineEditTextExtended(body: Uint8Array): ExtendedDecodedEditText {
  const base = decodeDefineEditText(body);

  // Parse extra flags from the flags UI16
  const password = (base.flags & (1 << 4)) !== 0;
  const hasMaxLength = (base.flags & (1 << 1)) !== 0;
  const border = (base.flags & (1 << 11)) !== 0;

  // If hasMaxLength is set, find MaxLength in the body. Field order:
  //   CharacterId (2) + RECT + flags (2) + [Font (4)] + [Color (4)] + [MaxLength (2)] + ...
  // We need to skip to the right position.
  let maxLength: number | undefined;
  if (hasMaxLength) {
    // Re-parse body to find MaxLength at the right offset
    let byteOff = 2;
    let bitBuf = 0;
    let bitsLeft = 0;

    function readBits2(n: number): number {
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

    const nBits = readBits2(5);
    readBits2(nBits); // xMin
    readBits2(nBits); // xMax
    readBits2(nBits); // yMin
    readBits2(nBits); // yMax
    bitsLeft = 0;

    // flags
    byteOff += 2;

    // HasFont: skip FontID (2) + FontHeight (2)
    if ((base.flags & (1 << 0)) !== 0) byteOff += 4;

    // HasTextColor: skip RGBA (4)
    if ((base.flags & (1 << 2)) !== 0) byteOff += 4;

    // MaxLength is here
    maxLength = body[byteOff] | (body[byteOff + 1] << 8);
  }

  return { ...base, password, hasMaxLength, border, maxLength };
}

function compileAndDecodeExtended(obj: TextDisplayObject): ExtendedDecodedEditText {
  const doc = makeDoc([obj]);
  const bytes = compileDocument(doc);
  const tags = parseSWFTags(bytes);
  const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
  expect(editTags.length).toBeGreaterThanOrEqual(1);
  return decodeDefineEditTextExtended(editTags[0].body);
}

describe("DefineEditText — input text password/maxChars/hasBorder", () => {
  it("input text with password=true: Password bit (bit 4) is set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "", password: true })
    );
    expect(decoded.password).toBe(true);
  });

  it("input text with password=false: Password bit (bit 4) is NOT set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "" })
    );
    expect(decoded.password).toBe(false);
  });

  it("static text with password=true: Password bit is NOT set (only applies to input)", () => {
    // password is input-only; encoder guards on textType
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "static", text: "hello", password: true })
    );
    expect(decoded.password).toBe(false);
  });

  it("input text with maxChars=100: HasMaxLength bit (bit 1) is set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "", maxChars: 100 })
    );
    expect(decoded.hasMaxLength).toBe(true);
  });

  it("input text with maxChars=100: MaxLength field value is 100", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "", maxChars: 100 })
    );
    expect(decoded.maxLength).toBe(100);
  });

  it("input text with maxChars=0: HasMaxLength bit is NOT set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "", maxChars: 0 })
    );
    expect(decoded.hasMaxLength).toBe(false);
  });

  it("input text with maxChars undefined: HasMaxLength bit is NOT set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "" })
    );
    expect(decoded.hasMaxLength).toBe(false);
  });

  it("input text with hasBorder=true: Border bit (bit 11) is set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "", hasBorder: true })
    );
    expect(decoded.border).toBe(true);
  });

  it("input text without hasBorder: Border bit (bit 11) is NOT set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "" })
    );
    expect(decoded.border).toBe(false);
  });

  it("dynamic text with hasBorder=true: Border bit is set", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "dynamic", hasBorder: true })
    );
    expect(decoded.border).toBe(true);
  });

  it("password + maxChars + hasBorder combined on input text", () => {
    const decoded = compileAndDecodeExtended(
      makeText({ textType: "input", text: "", password: true, maxChars: 50, hasBorder: true })
    );
    expect(decoded.password).toBe(true);
    expect(decoded.hasMaxLength).toBe(true);
    expect(decoded.maxLength).toBe(50);
    expect(decoded.border).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTML flag (bit 9) — rich text multi-run support
// ---------------------------------------------------------------------------

interface HtmlDecodedEditText extends DecodedEditText {
  isHtml: boolean;
}

function decodeHtmlFlag(body: Uint8Array): HtmlDecodedEditText {
  const base = decodeDefineEditText(body);
  const isHtml = (base.flags & (1 << 9)) !== 0;
  return { ...base, isHtml };
}

function compileAndDecodeHtml(obj: TextDisplayObject): HtmlDecodedEditText {
  const doc = makeDoc([obj]);
  const bytes = compileDocument(doc);
  const tags = parseSWFTags(bytes);
  const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
  expect(editTags.length).toBeGreaterThanOrEqual(1);
  return decodeHtmlFlag(editTags[0].body);
}

describe("DefineEditText — HTML flag (bit 9) for rich text", () => {
  it("html=false (default): HTML flag (bit 9) is NOT set", () => {
    const decoded = compileAndDecodeHtml(makeText({ textType: "dynamic", text: "plain text" }));
    expect(decoded.isHtml).toBe(false);
  });

  it("html=true: HTML flag (bit 9) IS set", () => {
    const decoded = compileAndDecodeHtml(
      makeText({ textType: "dynamic", html: true, htmlText: '<font face="Arial" size="12" color="#ff0000">Hello</font>' })
    );
    expect(decoded.isHtml).toBe(true);
  });

  it("html=true: initial text content is the htmlText string, not plain text", () => {
    const htmlContent = '<font face="Arial" size="12" color="#ff0000"><b>Hello</b></font><font face="Arial" size="12" color="#0000ff"> World</font>';
    const decoded = compileAndDecodeHtml(
      makeText({ textType: "dynamic", text: "Hello World", html: true, htmlText: htmlContent })
    );
    expect(decoded.initialText).toBe(htmlContent);
  });

  it("html=true: HasText flag (bit 7) is set when htmlText is non-empty", () => {
    const decoded = compileAndDecodeHtml(
      makeText({ textType: "dynamic", html: true, htmlText: '<font face="Arial">text</font>' })
    );
    expect(decoded.hasText).toBe(true);
  });

  it("html=false with plain text: initial text is the plain text string", () => {
    const decoded = compileAndDecodeHtml(
      makeText({ textType: "dynamic", text: "plain content" })
    );
    expect(decoded.initialText).toBe("plain content");
    expect(decoded.isHtml).toBe(false);
  });
});
