/**
 * End-to-end SWF export integration test suite.
 *
 * Tests compile a FlashDocument via compileDocument() and parse the resulting
 * binary to verify structure, tag ordering, and correctness of key fields.
 *
 * SWF tag codes used:
 *   0   End
 *   1   ShowFrame
 *   9   SetBackgroundColor
 *  12   DoAction
 *  26   PlaceObject2
 *  37   DefineEditText
 *  39   DefineSprite
 *  43   FrameLabel
 *  83   DefineShape4
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
} from "@flash/core";
import type { Shape, ShapeDisplayObject, TextDisplayObject, SymbolInstance } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_DO_ACTION = 12;
const TAG_DEFINE_SHAPE4 = 83;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SPRITE = 39;

// ---------------------------------------------------------------------------
// SWF binary parser
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

interface SWFHeader {
  signature: string;   // "FWS" or "CWS"
  version: number;
  fileLength: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  frameRate: number;   // raw UI16LE value (fps * 256)
  frameCount: number;
  tagsOffset: number;  // byte offset at which the tag stream begins
}

/**
 * Parse the SWF header and return structured fields plus the tag-stream offset.
 */
function parseSWFHeader(bytes: Uint8Array): SWFHeader {
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  const version = bytes[3];
  const fileLength =
    bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);

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

  /** Interpret an n-bit two's-complement value as a signed integer. */
  function toSigned(raw: number, bits: number): number {
    const signBit = 1 << (bits - 1);
    return raw & signBit ? raw - (signBit << 1) : raw;
  }

  const nBits = readBits(5);
  const xMinRaw = readBits(nBits);
  const xMaxRaw = readBits(nBits);
  const yMinRaw = readBits(nBits);
  const yMaxRaw = readBits(nBits);

  // Flush to byte boundary
  bitsLeft = 0;

  // After RECT: 2 bytes FrameRate + 2 bytes FrameCount
  const frameRate = bytes[byteOff] | (bytes[byteOff + 1] << 8);
  const frameCount = bytes[byteOff + 2] | (bytes[byteOff + 3] << 8);
  const tagsOffset = byteOff + 4;

  return {
    signature,
    version,
    fileLength,
    xMin: toSigned(xMinRaw, nBits),
    xMax: toSigned(xMaxRaw, nBits),
    yMin: toSigned(yMinRaw, nBits),
    yMax: toSigned(yMaxRaw, nBits),
    frameRate,
    frameCount,
    tagsOffset,
  };
}

/**
 * Parse SWF tag records starting at `offset` within `bytes`.
 * Stops at End tag (code 0) or end of buffer.
 */
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
    tags.push({
      code: tagCode,
      body: bytes.slice(bodyStart, bodyStart + bodyLength),
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

/**
 * Parse a full SWF: header + tag stream.
 */
function parseSWF(bytes: Uint8Array): { header: SWFHeader; tags: SWFTag[] } {
  const header = parseSWFHeader(bytes);
  const tags = parseTags(bytes, header.tagsOffset);
  return { header, tags };
}

// ---------------------------------------------------------------------------
// Test fixture helpers
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

const DEFAULT_SYMBOL_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

/** Create a minimal valid FlashDocument with optional overrides. */
function makeDoc(overrides?: Partial<FlashDocument>): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [makeFrame([])])],
    library: { items: [], folders: [] },
    ...overrides,
  };
}

/** Build a minimal Frame containing `displayObjects` and optional script. */
function makeFrame(
  displayObjects: readonly (ShapeDisplayObject | TextDisplayObject | SymbolInstance)[],
  script = ""
): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0 && !script,
    tweenType: "none",
    label: "",
    labelType: "name",
    script,
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

/** Build a layer with an explicit list of frames (preserving each frame's index). */
function makeLayer(name: string, frames: Partial<Frame>[]): Layer {
  const fullFrames: Frame[] = frames.map((f, i) => {
    const { index: _ignored, ...rest } = f as Partial<Frame> & { index?: number };
    return {
      index: i,
      isKeyframe: true,
      isEmpty: true,
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
      displayObjects: [],
      ...rest,
    };
  });
  return {
    id: `layer-${name}`,
    name,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: fullFrames,
    frameCount: fullFrames.length,
  };
}

/** Build a Scene with a single layer containing the given frames. */
function makeScene(id: string, name: string, frames: Partial<Frame>[]): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer("Layer 1", frames)],
    },
  };
}

/** Build a minimal rectangle ShapeDisplayObject. */
function makeRect(
  x: number,
  y: number,
  w: number,
  h: number
): ShapeDisplayObject {
  const shape: Shape = {
    id: `shape-${x}-${y}-${w}-${h}`,
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x, y: y + h } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
      },
    ],
  };
  return {
    id: "rect-obj-1",
    type: "shape",
    shape,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/** Build a minimal TextDisplayObject. */
function makeText(text = "Hello"): TextDisplayObject {
  return {
    id: "text-obj-1",
    type: "text",
    x: 10,
    y: 10,
    width: 100,
    height: 30,
    text,
    textType: "static",
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    multiline: false,
    wordWrap: false,
  };
}

/** Build a minimal library Symbol with an optional inner layer. */
function makeSymbol(id: string, name: string, frames?: Partial<Frame>[]): Symbol {
  const innerFrames = frames ?? [makeFrame([])];
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: [makeLayer("Layer 1", innerFrames)],
    },
    linkage: DEFAULT_SYMBOL_LINKAGE,
    scale9Grid: null,
  };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("SWF export — integration", () => {
  // -------------------------------------------------------------------------
  // Test 1: Well-formed SWF
  // -------------------------------------------------------------------------
  it("empty doc compiles to bytes starting with FWS and ending with End tag (code 0)", () => {
    const doc = makeDoc();
    const bytes = compileDocument(doc);

    // Signature must be "FWS"
    expect(bytes[0]).toBe(0x46); // F
    expect(bytes[1]).toBe(0x57); // W
    expect(bytes[2]).toBe(0x53); // S

    // FileLength in header must match actual byte count
    const { header, tags } = parseSWF(bytes);
    expect(header.fileLength).toBe(bytes.length);

    // Last tag in stream must be End (code 0)
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[tags.length - 1].code).toBe(TAG_END);
  });

  // -------------------------------------------------------------------------
  // Test 2: SWF version byte = 8
  // -------------------------------------------------------------------------
  it("compiled SWF has version byte = 8", () => {
    const doc = makeDoc();
    const bytes = compileDocument(doc);
    expect(bytes[3]).toBe(8);
  });

  // -------------------------------------------------------------------------
  // Test 3: Stage dimensions in RECT (twips)
  // -------------------------------------------------------------------------
  it("stage 550x400 → RECT Xmax=11000, Ymax=8000 twips (20 twips/px)", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, width: 550, height: 400 },
    });
    const bytes = compileDocument(doc);
    const { header } = parseSWF(bytes);

    expect(header.xMin).toBe(0);
    expect(header.xMax).toBe(550 * 20); // 11000
    expect(header.yMin).toBe(0);
    expect(header.yMax).toBe(400 * 20); // 8000
  });

  // -------------------------------------------------------------------------
  // Test 4: Frame rate encoded as 8.8 fixed-point UI16LE
  // -------------------------------------------------------------------------
  it("frameRate=24 → FrameRate UI16LE = 0x1800 (24 * 256 = 6144)", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, frameRate: 24 },
    });
    const bytes = compileDocument(doc);
    const { header } = parseSWF(bytes);

    // 24 fps × 256 = 6144 = 0x1800
    expect(header.frameRate).toBe(24 * 256);
  });

  // -------------------------------------------------------------------------
  // Test 5: SetBackgroundColor tag (code 9) with correct RGB
  // -------------------------------------------------------------------------
  it("SetBackgroundColor tag (code 9) is present with RGB matching backgroundColor", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, backgroundColor: "#3366cc" },
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();

    // Body is 3 bytes: R G B
    expect(bgTag!.body.length).toBe(3);
    expect(bgTag!.body[0]).toBe(0x33); // R = 0x33
    expect(bgTag!.body[1]).toBe(0x66); // G = 0x66
    expect(bgTag!.body[2]).toBe(0xcc); // B = 0xcc
  });

  // -------------------------------------------------------------------------
  // Test 6: DefineShape4 tag present for a shape
  // -------------------------------------------------------------------------
  it("doc with a rectangle shape → DefineShape4 tag (code 83) present", () => {
    const rectObj = makeRect(10, 10, 100, 50);
    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [makeFrame([rectObj])])],
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 7: DefineShape4 appears before PlaceObject2 for the same shape
  // -------------------------------------------------------------------------
  it("DefineShape4 appears before PlaceObject2 for the same shape", () => {
    const rectObj = makeRect(0, 0, 50, 50);
    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [makeFrame([rectObj])])],
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const defineShapeIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SHAPE4);
    const placeObjectIdx = tags.findIndex((t) => t.code === TAG_PLACE_OBJECT2);

    expect(defineShapeIdx).toBeGreaterThanOrEqual(0);
    expect(placeObjectIdx).toBeGreaterThanOrEqual(0);
    expect(defineShapeIdx).toBeLessThan(placeObjectIdx);
  });

  // -------------------------------------------------------------------------
  // Test 8: Multiple frames → multiple ShowFrame tags (code 1)
  // -------------------------------------------------------------------------
  it("doc with 3-frame layer → exactly 3 ShowFrame tags (code 1)", () => {
    const doc = makeDoc({
      scenes: [
        makeScene("s1", "Scene 1", [
          makeFrame([]),
          makeFrame([]),
          makeFrame([]),
        ]),
      ],
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 9: FrameCount in SWF header matches number of ShowFrame tags
  // -------------------------------------------------------------------------
  it("FrameCount in SWF header equals the number of ShowFrame tags", () => {
    const doc = makeDoc({
      scenes: [
        makeScene("s1", "Scene 1", [
          makeFrame([]),
          makeFrame([]),
          makeFrame([]),
          makeFrame([]),
          makeFrame([]),
        ]),
      ],
    });
    const bytes = compileDocument(doc);
    const { header, tags } = parseSWF(bytes);

    const showFrameCount = tags.filter((t) => t.code === TAG_SHOW_FRAME).length;
    expect(header.frameCount).toBe(showFrameCount);
    expect(header.frameCount).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Test 10: DefineSprite appears before PlaceObject2 that references a symbol
  // -------------------------------------------------------------------------
  it("DefineSprite (code 39) appears before PlaceObject2 that references the symbol", () => {
    const sym = makeSymbol("sym-1", "MyClip");

    const instance: SymbolInstance = {
      id: "inst-1",
      type: "instance",
      symbolId: "sym-1",
      x: 100,
      y: 100,
    };

    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [makeFrame([instance])])],
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const defineSpriteIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SPRITE);
    const placeObjectIdx = tags.findIndex((t) => t.code === TAG_PLACE_OBJECT2);

    expect(defineSpriteIdx).toBeGreaterThanOrEqual(0);
    expect(placeObjectIdx).toBeGreaterThanOrEqual(0);
    expect(defineSpriteIdx).toBeLessThan(placeObjectIdx);
  });

  // -------------------------------------------------------------------------
  // Test 11: DefineEditText tag present for a static TextDisplayObject
  // All text types now use DefineEditText (tag 37) with device fonts,
  // matching MC text behaviour and avoiding the custom pixel-art embedded glyphs.
  // -------------------------------------------------------------------------
  it("doc with a static TextDisplayObject → DefineEditText tag (code 37) present", () => {
    const textObj = makeText("Hello World");
    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [makeFrame([textObj])])],
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const TAG_DEFINE_EDIT_TEXT = 37;
    const editTextTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTextTags.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 12: DoAction tag present for a frame with a script
  // -------------------------------------------------------------------------
  it('frame with script "stop();" → DoAction tag (code 12) present with non-empty body', () => {
    const frameWithScript: Partial<Frame> = {
      isKeyframe: true,
      isEmpty: false,
      script: "stop();",
      displayObjects: [],
    };

    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [frameWithScript])],
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBeGreaterThan(0);
    // DoAction body must be non-empty (at minimum the EndAction 0x00 byte)
    expect(doActionTags[0].body.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Additional: FileLength exactly matches actual byte count
  // -------------------------------------------------------------------------
  it("FileLength field in SWF header exactly equals the byte array length", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, width: 800, height: 600 },
      scenes: [makeScene("s1", "Scene 1", [makeFrame([makeRect(0, 0, 100, 100)])])],
    });
    const bytes = compileDocument(doc);
    const { header } = parseSWF(bytes);
    expect(header.fileLength).toBe(bytes.length);
  });

  // -------------------------------------------------------------------------
  // Additional: Background color tag (#000000) encodes R=0, G=0, B=0
  // -------------------------------------------------------------------------
  it("backgroundColor #000000 → SetBackgroundColor body is [0, 0, 0]", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, backgroundColor: "#000000" },
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body[0]).toBe(0);
    expect(bgTag!.body[1]).toBe(0);
    expect(bgTag!.body[2]).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Additional: Two symbols both get DefineSprite tags
  // -------------------------------------------------------------------------
  it("two library symbols → two DefineSprite tags emitted", () => {
    const sym1 = makeSymbol("sym-1", "ClipA");
    const sym2 = makeSymbol("sym-2", "ClipB");

    const doc = makeDoc({
      scenes: [makeScene("s1", "Scene 1", [makeFrame([])])],
      library: { items: [sym1, sym2], folders: [] },
    });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Additional: Empty doc still has at least 1 ShowFrame
  // -------------------------------------------------------------------------
  it("doc with no scenes still has at least 1 ShowFrame tag", () => {
    const doc = makeDoc({ scenes: [] });
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);

    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBeGreaterThanOrEqual(1);
  });
});
