/**
 * SWF parse-back verification harness.
 *
 * Compiles fixture FlashDocuments via compileDocument() and parses the
 * resulting SWF binary deeply — decoding tag body fields (CharacterId, RECT
 * bounds, depth, flags, strings, etc.) — to verify compiler correctness.
 *
 * Every test:
 *   1. Builds a canonical fixture document.
 *   2. Compiles it to binary via compileDocument().
 *   3. Parses the binary fully using the improved tag-body decoders below.
 *   4. Asserts on decoded field values.
 *
 * Tag codes used:
 *    0  End
 *    1  ShowFrame
 *    9  SetBackgroundColor
 *   12  DoAction
 *   14  DefineSound
 *   26  PlaceObject2
 *   28  RemoveObject2
 *   34  DefineButton2
 *   37  DefineEditText
 *   39  DefineSprite
 *   43  FrameLabel
 *   48  DefineFont2
 *   83  DefineShape4
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type {
  FlashDocument,
  Frame,
  Layer,
  Scene,
  Symbol,
  SoundItem,
} from "@flash/core";
import type {
  Shape,
  ShapeDisplayObject,
  TextDisplayObject,
  SymbolInstance,
} from "@flash/core";

// ===========================================================================
// Tag-code constants
// ===========================================================================

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_DO_ACTION = 12;
const TAG_DEFINE_SOUND = 14;
const TAG_PLACE_OBJECT2 = 26;
const TAG_REMOVE_OBJECT2 = 28;
const TAG_DEFINE_BUTTON2 = 34;
const TAG_DEFINE_EDIT_TEXT = 37;
const TAG_DEFINE_SPRITE = 39;
const TAG_FRAME_LABEL = 43;
const TAG_DEFINE_SHAPE4 = 83;

// ===========================================================================
// SWF binary parser
// ===========================================================================

interface SWFTag {
  code: number;
  body: Uint8Array;
}

/**
 * Parse all SWF tag records from a compiled binary.
 * Handles both short (2-byte header) and long (6-byte header) forms.
 */
function parseSWFTags(bytes: Uint8Array): SWFTag[] {
  // Skip the SWF header (signature 3, version 1, fileLength 4, RECT variable,
  // frameRate 2, frameCount 2).  Find end of RECT first.
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4; // past frameRate and frameCount

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
    if (code === TAG_END) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// RECT decoder (SWF bit-packed format)
// ---------------------------------------------------------------------------

interface SWFRect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function decodeRect(bytes: Uint8Array, byteOffset = 0): { rect: SWFRect; bytesConsumed: number } {
  let byteOff = byteOffset;
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
  const bytesConsumed = byteOff - byteOffset;

  return {
    rect: {
      xMin: toSigned(xMinRaw, nBits),
      xMax: toSigned(xMaxRaw, nBits),
      yMin: toSigned(yMinRaw, nBits),
      yMax: toSigned(yMaxRaw, nBits),
    },
    bytesConsumed,
  };
}

// ---------------------------------------------------------------------------
// DefineShape4 body decoder
// ---------------------------------------------------------------------------

interface DecodedShape4 {
  charId: number;
  shapeBounds: SWFRect;
}

function decodeDefineShape4(body: Uint8Array): DecodedShape4 {
  const charId = body[0] | (body[1] << 8);
  const { rect: shapeBounds } = decodeRect(body, 2);
  return { charId, shapeBounds };
}

// ---------------------------------------------------------------------------
// PlaceObject2 body decoder
// ---------------------------------------------------------------------------

interface DecodedPlaceObject2 {
  /** bit 0 = Move */
  flagMove: boolean;
  /** bit 1 = HasCharacter */
  hasCharacter: boolean;
  /** bit 2 = HasMatrix */
  hasMatrix: boolean;
  depth: number;
  charId: number | undefined;
}

function decodePlaceObject2(body: Uint8Array): DecodedPlaceObject2 {
  const flags = body[0];
  const flagMove = (flags & 0x01) !== 0;
  const hasCharacter = (flags & 0x02) !== 0;
  const hasMatrix = (flags & 0x04) !== 0;
  const depth = body[1] | (body[2] << 8);
  let charId: number | undefined;
  if (hasCharacter) {
    charId = body[3] | (body[4] << 8);
  }
  return { flagMove, hasCharacter, hasMatrix, depth, charId };
}

// ---------------------------------------------------------------------------
// RemoveObject2 body decoder
// ---------------------------------------------------------------------------

function decodeRemoveObject2(body: Uint8Array): { depth: number } {
  return { depth: body[0] | (body[1] << 8) };
}

// ---------------------------------------------------------------------------
// DefineSprite body decoder
// ---------------------------------------------------------------------------

interface DecodedSprite {
  spriteId: number;
  frameCount: number;
  innerTags: SWFTag[];
}

function decodeDefineSprite(body: Uint8Array): DecodedSprite {
  const spriteId = body[0] | (body[1] << 8);
  const frameCount = body[2] | (body[3] << 8);

  // Parse inner tags starting at byte 4
  let pos = 4;
  const innerTags: SWFTag[] = [];
  while (pos + 2 <= body.length) {
    const hdr = body[pos] | (body[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let hdrSize = 2;
    if (len === 0x3f) {
      len =
        body[pos + 2] |
        (body[pos + 3] << 8) |
        (body[pos + 4] << 16) |
        (body[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    innerTags.push({ code, body: body.slice(bodyStart, bodyStart + len) });
    pos = bodyStart + len;
    if (code === TAG_END) break;
  }

  return { spriteId, frameCount, innerTags };
}

// ---------------------------------------------------------------------------
// DefineEditText body decoder
// ---------------------------------------------------------------------------

interface DecodedEditText {
  charId: number;
  bounds: SWFRect;
  /** Raw UI16LE flags word */
  flags: number;
  hasFontFlag: boolean;
}

function decodeDefineEditText(body: Uint8Array): DecodedEditText {
  const charId = body[0] | (body[1] << 8);
  const { rect: bounds, bytesConsumed } = decodeRect(body, 2);
  const flagsOffset = 2 + bytesConsumed;
  const flags = body[flagsOffset] | (body[flagsOffset + 1] << 8);
  const hasFontFlag = (flags & 0x80) !== 0; // bit 7
  return { charId, bounds, flags, hasFontFlag };
}

// ---------------------------------------------------------------------------
// SetBackgroundColor decoder
// ---------------------------------------------------------------------------

function decodeSetBackgroundColor(body: Uint8Array): { r: number; g: number; b: number } {
  return { r: body[0], g: body[1], b: body[2] };
}

// ---------------------------------------------------------------------------
// DefineFont2 body decoder (minimal: FontId + flags byte + name)
// ---------------------------------------------------------------------------

// ===========================================================================
// Fixture document builders
// ===========================================================================

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

function makeLayer(name: string, frames: Partial<Frame>[]): Layer {
  const fullFrames: Frame[] = frames.map((f, i) => ({
    index: i,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none" as const,
    label: "",
    labelType: "name" as const,
    script: "",
    sound: null,
    motionEase: 0,
    motionEaseType: "none",
    motionRotate: "none" as const,
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
    shapeBlend: "distributive" as const,
    displayObjects: [],
    ...f,
  }));
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

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return { id, name, timeline: { layers } };
}

function makeDoc(overrides?: Partial<FlashDocument>): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [
      makeScene("s1", "Scene 1", [makeLayer("Layer 1", [{ isEmpty: true }])]),
    ],
    library: { items: [], folders: [] },
    ...overrides,
  };
}

function makeRectShape(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color = { r: 255, g: 0, b: 0, a: 255 }
): Shape {
  return {
    id,
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x, y: y + h } },
        ],
        closed: true,
        fill: { type: "solid", color },
      },
    ],
  };
}

function makeShapeObj(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number
): ShapeDisplayObject {
  return {
    id,
    type: "shape",
    shape: makeRectShape(`shape-${id}`, x, y, w, h),
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

function makeTextObj(
  id: string,
  text: string,
  x = 10,
  y = 10,
  w = 100,
  h = 30
): TextDisplayObject {
  return {
    id,
    type: "text",
    x,
    y,
    width: w,
    height: h,
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

function makeInstanceObj(
  id: string,
  symbolId: string,
  x: number,
  y: number
): SymbolInstance {
  return { id, type: "instance", symbolId, x, y };
}

function makeSymbol(
  id: string,
  name: string,
  layers?: Layer[]
): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: {
      layers: layers ?? [makeLayer("Layer 1", [{ isEmpty: true }])],
    },
    linkage: DEFAULT_SYMBOL_LINKAGE,
    scale9Grid: null,
  };
}

// ---------------------------------------------------------------------------
// Fixture doc factories (one per feature axis)
// ---------------------------------------------------------------------------

/** Doc with a single rectangle shape on stage. */
function makeRectDoc(): FlashDocument {
  const obj = makeShapeObj("rect-obj", 10, 20, 100, 50);
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [
        makeLayer("Layer 1", [
          { isKeyframe: true, isEmpty: false, displayObjects: [obj] },
        ]),
      ]),
    ],
  });
}

/** Doc with a linear gradient fill shape. */
function makeGradientDoc(): FlashDocument {
  const shape: Shape = {
    id: "grad-shape",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 50 } },
          { type: "line", to: { x: 0, y: 50 } },
        ],
        closed: true,
        fill: {
          type: "linear-gradient",
          stops: [
            { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
            { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
          ],
          angle: 0,
        },
      },
    ],
  };
  const obj: ShapeDisplayObject = {
    id: "grad-obj",
    type: "shape",
    shape,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [
        makeLayer("Layer 1", [
          { isKeyframe: true, isEmpty: false, displayObjects: [obj] },
        ]),
      ]),
    ],
  });
}

/** Doc with a library symbol + one instance on stage. */
function makeSymbolDoc(): FlashDocument {
  const sym = makeSymbol("sym-1", "MyClip", [
    makeLayer("Layer 1", [
      { isKeyframe: true, isEmpty: false, displayObjects: [makeShapeObj("inner-rect", 0, 0, 40, 40)] },
      { isKeyframe: false, isEmpty: false, displayObjects: [] },
      { isKeyframe: false, isEmpty: false, displayObjects: [] },
    ]),
  ]);
  const inst = makeInstanceObj("inst-1", "sym-1", 100, 150);
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [
        makeLayer("Layer 1", [
          { isKeyframe: true, isEmpty: false, displayObjects: [inst] },
        ]),
      ]),
    ],
    library: { items: [sym], folders: [] },
  });
}

/** Doc with a motion tween spanning 5 frames (2 keyframes at 0 and 4). */
function makeTweenDoc(): FlashDocument {
  const obj1 = makeShapeObj("tween-obj", 0, 0, 50, 50);
  const obj2: ShapeDisplayObject = { ...obj1, x: 200, y: 0 };
  const frames: Partial<Frame>[] = [
    {
      index: 0,
      isKeyframe: true,
      isEmpty: false,
      tweenType: "motion",
      displayObjects: [obj1],
    },
    { index: 1, isKeyframe: false, isEmpty: false, displayObjects: [obj1] },
    { index: 2, isKeyframe: false, isEmpty: false, displayObjects: [obj1] },
    { index: 3, isKeyframe: false, isEmpty: false, displayObjects: [obj1] },
    {
      index: 4,
      isKeyframe: true,
      isEmpty: false,
      tweenType: "none",
      displayObjects: [obj2],
    },
  ];
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [makeLayer("Layer 1", frames)]),
    ],
  });
}

/** Doc with 3 layers, each containing one rectangle. */
function makeMultiLayerDoc(): FlashDocument {
  const layers = [0, 1, 2].map((i) =>
    makeLayer(`Layer ${i + 1}`, [
      {
        isKeyframe: true,
        isEmpty: false,
        displayObjects: [makeShapeObj(`rect-${i}`, i * 60, 0, 50, 50)],
      },
    ])
  );
  return makeDoc({
    scenes: [makeScene("s1", "Scene 1", layers)],
  });
}

/**
 * Doc with a dynamic text object.
 * Used for DefineEditText parse-back tests; static text now emits DefineText (tag 11).
 */
function makeDynamicTextDoc(): FlashDocument {
  const textObj: import("@flash/core").TextDisplayObject = {
    ...makeTextObj("text-obj", "Hello Flash"),
    textType: "dynamic",
  };
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [
        makeLayer("Layer 1", [
          { isKeyframe: true, isEmpty: false, displayObjects: [textObj] },
        ]),
      ]),
    ],
  });
}

/** Doc with a sound item in the library (no audio data — just structural). */
function makeSoundDoc(): FlashDocument {
  const sound: SoundItem = {
    id: "snd-1",
    name: "MySound",
    itemType: "sound",
    dataUri: "", // empty — no actual audio data, just library presence
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: true,
    durationSeconds: 1.0,
    compressionType: "mp3",
  };
  return makeDoc({
    library: { items: [sound], folders: [] },
  });
}

/** Doc with a button symbol in the library. */
function makeButtonDoc(): FlashDocument {
  const sym: Symbol = {
    id: "btn-1",
    name: "MyButton",
    itemType: "symbol",
    symbolType: "button",
    timeline: {
      layers: [
        makeLayer("Layer 1", [
          { isKeyframe: true, isEmpty: false, displayObjects: [makeShapeObj("btn-shape", 0, 0, 60, 30)] },
        ]),
      ],
    },
    linkage: DEFAULT_SYMBOL_LINKAGE,
    scale9Grid: null,
  };
  return makeDoc({ library: { items: [sym], folders: [] } });
}

/** Doc with a frame script containing "stop();". */
function makeScriptDoc(): FlashDocument {
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [
        makeLayer("Layer 1", [
          {
            isKeyframe: true,
            isEmpty: false,
            script: "stop();",
            displayObjects: [],
          },
        ]),
      ]),
    ],
  });
}

/** Doc with a frame script containing a push expression ("gotoAndPlay(2);"). */
function makeGotoDoc(): FlashDocument {
  return makeDoc({
    scenes: [
      makeScene("s1", "Scene 1", [
        makeLayer("Layer 1", [
          {
            isKeyframe: true,
            isEmpty: false,
            script: 'gotoAndPlay(2);',
            displayObjects: [],
          },
        ]),
      ]),
    ],
  });
}

// ===========================================================================
// Tests
// ===========================================================================

describe("SWF parse-back verification", () => {
  // -------------------------------------------------------------------------
  // Group 1: SetBackgroundColor field decoding
  // -------------------------------------------------------------------------

  it("SetBackgroundColor: R/G/B bytes decode correctly for #ff8800", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, backgroundColor: "#ff8800" },
    });
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    const { r, g, b } = decodeSetBackgroundColor(bgTag!.body);
    expect(r).toBe(0xff);
    expect(g).toBe(0x88);
    expect(b).toBe(0x00);
  });

  it("SetBackgroundColor: white background #ffffff → R=255, G=255, B=255", () => {
    const doc = makeDoc({
      properties: { ...BASE_PROPS, backgroundColor: "#ffffff" },
    });
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    const { r, g, b } = decodeSetBackgroundColor(bgTag!.body);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  // -------------------------------------------------------------------------
  // Group 2: DefineShape4 field decoding
  // -------------------------------------------------------------------------

  it("DefineShape4: charId is a positive UI16 ≥ 1", () => {
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThanOrEqual(1);
    const { charId } = decodeDefineShape4(shapeTags[0].body);
    expect(charId).toBeGreaterThanOrEqual(1);
  });

  it("DefineShape4: shapeBounds xMax > xMin (non-degenerate shape)", () => {
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThanOrEqual(1);
    const { shapeBounds } = decodeDefineShape4(shapeTags[0].body);
    expect(shapeBounds.xMax).toBeGreaterThan(shapeBounds.xMin);
    expect(shapeBounds.yMax).toBeGreaterThan(shapeBounds.yMin);
  });

  it("DefineShape4: rect 10,20,100×50 → bounds in twips match (xMin=200, xMax=2200, yMin=400, yMax=1400)", () => {
    // Shape is drawn from (10,20) to (110, 70) in pixels → twips = px * 20
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThanOrEqual(1);
    const { shapeBounds } = decodeDefineShape4(shapeTags[0].body);
    expect(shapeBounds.xMin).toBe(10 * 20);   // 200
    expect(shapeBounds.xMax).toBe((10 + 100) * 20); // 2200
    expect(shapeBounds.yMin).toBe(20 * 20);   // 400
    expect(shapeBounds.yMax).toBe((20 + 50) * 20);  // 1400
  });

  it("DefineShape4: gradient fill doc produces a DefineShape4 with charId ≥ 1", () => {
    const doc = makeGradientDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBeGreaterThanOrEqual(1);
    const { charId } = decodeDefineShape4(shapeTags[0].body);
    expect(charId).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Group 3: PlaceObject2 field decoding
  // -------------------------------------------------------------------------

  it("PlaceObject2: first placement has HasCharacter flag set (bit 1 = 1)", () => {
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThanOrEqual(1);
    const decoded = decodePlaceObject2(placeTags[0].body);
    expect(decoded.hasCharacter).toBe(true);
  });

  it("PlaceObject2: first placement has depth ≥ 1", () => {
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThanOrEqual(1);
    const decoded = decodePlaceObject2(placeTags[0].body);
    expect(decoded.depth).toBeGreaterThanOrEqual(1);
  });

  it("PlaceObject2: charId in PlaceObject2 matches charId in DefineShape4", () => {
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const shapeTag = tags.find((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTag).toBeDefined();
    const { charId: shapeCharId } = decodeDefineShape4(shapeTag!.body);

    const placeTag = tags.find((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTag).toBeDefined();
    const { charId: placeCharId } = decodePlaceObject2(placeTag!.body);

    expect(placeCharId).toBe(shapeCharId);
  });

  it("PlaceObject2: multi-layer doc — 3 PlaceObject2 tags with distinct depths", () => {
    const doc = makeMultiLayerDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThanOrEqual(3);

    const depths = placeTags.slice(0, 3).map((t) => decodePlaceObject2(t.body).depth);
    const uniqueDepths = new Set(depths);
    expect(uniqueDepths.size).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Group 4: DefineSprite field decoding
  // -------------------------------------------------------------------------

  it("DefineSprite: spriteId decoded from body matches a positive UI16", () => {
    const doc = makeSymbolDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBeGreaterThanOrEqual(1);
    const { spriteId } = decodeDefineSprite(spriteTags[0].body);
    expect(spriteId).toBeGreaterThanOrEqual(1);
  });

  it("DefineSprite: frameCount in body matches the symbol timeline frame count (3)", () => {
    // makeSymbolDoc builds a symbol with 3 frames (indices 0, 1, 2)
    const doc = makeSymbolDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBeGreaterThanOrEqual(1);
    const { frameCount } = decodeDefineSprite(spriteTags[0].body);
    expect(frameCount).toBe(3);
  });

  it("DefineSprite: inner tag stream ends with End tag (code 0)", () => {
    const doc = makeSymbolDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBeGreaterThanOrEqual(1);
    const { innerTags } = decodeDefineSprite(spriteTags[0].body);
    expect(innerTags.length).toBeGreaterThan(0);
    expect(innerTags[innerTags.length - 1].code).toBe(TAG_END);
  });

  it("DefineSprite: inner ShowFrame count matches frameCount field", () => {
    const doc = makeSymbolDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBeGreaterThanOrEqual(1);
    const { frameCount, innerTags } = decodeDefineSprite(spriteTags[0].body);
    const showFrames = innerTags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(frameCount);
  });

  // -------------------------------------------------------------------------
  // Group 5: DefineEditText field decoding
  // -------------------------------------------------------------------------

  it("DefineEditText: charId decoded from body ≥ 1", () => {
    // Static text uses DefineText (tag 11); use dynamic text to test DefineEditText.
    const doc = makeDynamicTextDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBeGreaterThanOrEqual(1);
    const { charId } = decodeDefineEditText(editTags[0].body);
    expect(charId).toBeGreaterThanOrEqual(1);
  });

  it("DefineEditText: bounds xMax > 0 (non-zero width)", () => {
    // Static text uses DefineText (tag 11); use dynamic text to test DefineEditText.
    const doc = makeDynamicTextDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const editTags = tags.filter((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTags.length).toBeGreaterThanOrEqual(1);
    const { bounds } = decodeDefineEditText(editTags[0].body);
    expect(bounds.xMax).toBeGreaterThan(0);
    expect(bounds.yMax).toBeGreaterThan(0);
  });

  it("DefineEditText: charId in PlaceObject2 matches DefineEditText charId", () => {
    // Static text uses DefineText (tag 11); use dynamic text to test DefineEditText.
    const doc = makeDynamicTextDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);

    const editTag = tags.find((t) => t.code === TAG_DEFINE_EDIT_TEXT);
    expect(editTag).toBeDefined();
    const { charId: editCharId } = decodeDefineEditText(editTag!.body);

    const placeTag = tags.find((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTag).toBeDefined();
    const { charId: placeCharId } = decodePlaceObject2(placeTag!.body);

    expect(placeCharId).toBe(editCharId);
  });

  // -------------------------------------------------------------------------
  // Group 6: DoAction field decoding
  // -------------------------------------------------------------------------

  it("DoAction: stop() script → body first byte is ActionStop (0x07)", () => {
    const doc = makeScriptDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBeGreaterThan(0);
    // stop() compiles to ActionStop (0x07) + EndAction (0x00)
    expect(doActionTags[0].body[0]).toBe(0x07);
  });

  it("DoAction: gotoAndPlay(2) script → body first byte is ActionPush (0x96)", () => {
    const doc = makeGotoDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBeGreaterThan(0);
    // gotoAndPlay(2) pushes args first → ActionPush (0x96)
    expect(doActionTags[0].body[0]).toBe(0x96);
  });

  it("DoAction: body length > 1 (at minimum opcode + EndAction 0x00)", () => {
    const doc = makeScriptDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const doActionTags = tags.filter((t) => t.code === TAG_DO_ACTION);
    expect(doActionTags.length).toBeGreaterThan(0);
    expect(doActionTags[0].body.length).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // Group 7: FrameLabel decoding
  // -------------------------------------------------------------------------

  it("FrameLabel: scene name is NOT emitted as FrameLabel (Flash 8 behavior)", () => {
    const doc = makeDoc({
      scenes: [
        makeScene("s1", "MainScene", [
          makeLayer("Layer 1", [{ isEmpty: true }]),
        ]),
      ],
    });
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    // Scene names are suppressed; no user labels defined => zero FrameLabel tags
    const frameLabelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    expect(frameLabelTags.length).toBe(0);
  });

  it("FrameLabel: no FrameLabel tags for doc with no user labels", () => {
    const doc = makeRectDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    // makeRectDoc has no user-defined frame labels => zero FrameLabel tags
    const labelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    expect(labelTags.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Group 8: Tween animation — ShowFrame count and PlaceObject2 Move flag
  // -------------------------------------------------------------------------

  it("makeTweenDoc: exactly 5 ShowFrame tags for a 5-frame tween", () => {
    const doc = makeTweenDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(5);
  });

  it("makeTweenDoc: PlaceObject2 with Move flag (bit 0 set) present for frame updates", () => {
    const doc = makeTweenDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    // First frame is a new placement (Move=0), subsequent frames use Move=1
    const moveTags = placeTags.filter((t) => decodePlaceObject2(t.body).flagMove);
    expect(moveTags.length).toBeGreaterThan(0);
  });

  it("makeTweenDoc: first PlaceObject2 is NOT a Move (new placement at frame 0)", () => {
    const doc = makeTweenDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTags.length).toBeGreaterThanOrEqual(1);
    const first = decodePlaceObject2(placeTags[0].body);
    expect(first.flagMove).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Group 9: RemoveObject2 — depth encoding
  // -------------------------------------------------------------------------

  it("RemoveObject2: depth field decodes to a positive number ≥ 1", () => {
    // Two-frame doc: object on frame 0, gone on frame 1 → RemoveObject2 on frame 1
    const obj = makeShapeObj("rem-obj", 0, 0, 50, 50);
    const doc = makeDoc({
      scenes: [
        makeScene("s1", "Scene 1", [
          makeLayer("Layer 1", [
            { isKeyframe: true, isEmpty: false, displayObjects: [obj] },
            { isKeyframe: true, isEmpty: true, displayObjects: [] },
          ]),
        ]),
      ],
    });
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const removeTags = tags.filter((t) => t.code === TAG_REMOVE_OBJECT2);
    expect(removeTags.length).toBeGreaterThanOrEqual(1);
    const { depth } = decodeRemoveObject2(removeTags[0].body);
    expect(depth).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Group 10: DefineButton2 tag
  // -------------------------------------------------------------------------

  it("makeButtonDoc: DefineButton2 tag (code 34) emitted for button symbol", () => {
    const doc = makeButtonDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const buttonTags = tags.filter((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(buttonTags.length).toBe(1);
  });

  it("makeButtonDoc: DefineButton2 charId ≥ 1", () => {
    const doc = makeButtonDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const buttonTag = tags.find((t) => t.code === TAG_DEFINE_BUTTON2);
    expect(buttonTag).toBeDefined();
    // First two bytes of DefineButton2 body = ButtonId UI16LE
    const buttonId = buttonTag!.body[0] | (buttonTag!.body[1] << 8);
    expect(buttonId).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Group 11: Sound item structural test
  // -------------------------------------------------------------------------

  it("makeSoundDoc: empty sound dataUri → no DefineSound tag emitted", () => {
    // A SoundItem with empty dataUri should NOT produce a DefineSound tag
    const doc = makeSoundDoc();
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const soundTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(soundTags.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Group 12: Multi-scene structural tests
  // -------------------------------------------------------------------------

  it("two-scene doc: zero FrameLabel tags (no user labels, scene names suppressed)", () => {
    const doc: FlashDocument = {
      id: "doc-1",
      properties: BASE_PROPS,
      scenes: [
        makeScene("s1", "Scene 1", [makeLayer("Layer 1", [{ isEmpty: true }])]),
        makeScene("s2", "Scene 2", [makeLayer("Layer 1", [{ isEmpty: true }])]),
      ],
      library: { items: [], folders: [] },
    };
    const bytes = compileDocument(doc);
    const tags = parseSWFTags(bytes);
    const labelTags = tags.filter((t) => t.code === TAG_FRAME_LABEL);
    // Scene names are no longer emitted as FrameLabel (Flash 8 behavior).
    expect(labelTags.length).toBe(0);
  });
});
