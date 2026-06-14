/**
 * DefineSprite (tag 39) — dedicated test suite.
 *
 * Verifies that Symbol library items with symbolType='movieclip' are encoded as
 * DefineSprite (SWF tag 39), that SymbolInstances are placed via PlaceObject2
 * referencing the sprite's character ID, and that multi-frame symbol timelines
 * are encoded correctly.
 *
 * SWF tag codes used:
 *   0   End
 *   1   ShowFrame
 *  26   PlaceObject2
 *  39   DefineSprite
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
import type { Shape, ShapeDisplayObject, SymbolInstance, TextDisplayObject } from "@flash/core";
import { alignXOffsetTwips } from "../text.js";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_DEFINE_SHAPE4 = 83;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SPRITE = 39;
const TAG_DEFINE_TEXT = 11;

// ---------------------------------------------------------------------------
// SWF binary parser helpers
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

/**
 * Parse the SWF header to find where the tag stream starts.
 * Uses the bit-packed RECT field length formula from the SWF spec.
 */
function findTagsOffset(bytes: Uint8Array): number {
  // RECT starts at byte 8. The first 5 bits are Nbits, then 4 * Nbits data bits.
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // After RECT: 2 bytes FrameRate + 2 bytes FrameCount
  return 8 + rectBytes + 4;
}

/**
 * Parse SWF tag records from the tag stream.
 * Stops at End tag (code 0) or end of buffer.
 */
function parseTags(bytes: Uint8Array): SWFTag[] {
  const offset = findTagsOffset(bytes);
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
    });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

/**
 * Decode a DefineSprite tag body into its constituent fields and inner tags.
 */
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

/**
 * Decode a PlaceObject2 body to extract the character ID and depth.
 * Flags byte: bit 0 = Move, bit 1 = HasCharacter, bit 2 = HasMatrix, ...
 */
interface DecodedPlaceObject2 {
  flagMove: boolean;
  hasCharacter: boolean;
  depth: number;
  charId: number | null;
}

function decodePlaceObject2(body: Uint8Array): DecodedPlaceObject2 {
  const flags = body[0];
  const flagMove = (flags & 0x01) !== 0;
  const hasCharacter = (flags & 0x02) !== 0;
  const depth = body[1] | (body[2] << 8);
  let charId: number | null = null;
  if (hasCharacter) {
    charId = body[3] | (body[4] << 8);
  }
  return { flagMove, hasCharacter, depth, charId };
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

function makeDoc(overrides?: Partial<FlashDocument>): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("scene-1", "Scene 1", [makeLayer("Layer 1", [{ isEmpty: true }])])],
    library: { items: [], folders: [] },
    ...overrides,
  };
}

function makeLayer(name: string, frames: Partial<Frame>[]): Layer {
  const fullFrames: Frame[] = frames.map((f, i) => ({
    index: i,
    isKeyframe: true,
    isEmpty: true,
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
  return {
    id,
    name,
    timeline: { layers },
  };
}

/** Build a simple rectangle ShapeDisplayObject. */
function makeShapeObj(id: string, x: number, y: number, w: number, h: number): ShapeDisplayObject {
  const shape: Shape = {
    id: `shape-${id}`,
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x, y: y + h } },
        ],
        closed: true,
        fill: { type: "solid", color: { r: 200, g: 100, b: 50, a: 255 } },
      },
    ],
  };
  return {
    id,
    type: "shape",
    shape,
    x,
    y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
}

/** Build a library Symbol (movieclip) with the given inner layers. */
function makeSymbol(id: string, name: string, layers?: Layer[]): Symbol {
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

/** Build a SymbolInstance display object. */
function makeInstance(id: string, symbolId: string, x = 0, y = 0): SymbolInstance {
  return { id, type: "instance", symbolId, x, y };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineSprite (tag 39) — Symbol library items", () => {

  // -------------------------------------------------------------------------
  // 1. A Symbol in the library produces a DefineSprite tag (code 39)
  // -------------------------------------------------------------------------
  it("Symbol in library with symbolType='movieclip' → DefineSprite tag (code 39) emitted", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 2. DefineSprite body starts with the sprite's character ID (positive UI16)
  // -------------------------------------------------------------------------
  it("DefineSprite body starts with a positive UI16 sprite character ID", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const { spriteId } = decodeDefineSprite(spriteTag!.body);
    expect(spriteId).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 3. Single-frame symbol → DefineSprite contains exactly 1 ShowFrame tag
  // -------------------------------------------------------------------------
  it("single-frame symbol → DefineSprite inner stream has 1 ShowFrame tag", () => {
    const sym = makeSymbol("sym-1", "SingleFrame", [
      makeLayer("Layer 1", [{ isKeyframe: true, isEmpty: true }]),
    ]);
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const { innerTags, frameCount } = decodeDefineSprite(spriteTag!.body);
    const showFrames = innerTags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(1);
    expect(frameCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 4. Multi-frame symbol → frameCount and ShowFrame count match
  // -------------------------------------------------------------------------
  it("3-frame symbol → DefineSprite frameCount=3 and 3 inner ShowFrame tags", () => {
    // Layer with keyframe at 0 and 2 non-keyframe cells following it
    const shape = makeShapeObj("inner-shape", 0, 0, 40, 40);
    const sym = makeSymbol("sym-1", "ThreeFrames", [
      makeLayer("Layer 1", [
        { isKeyframe: true, isEmpty: false, displayObjects: [shape] },
        { isKeyframe: false, isEmpty: false, displayObjects: [shape] },
        { isKeyframe: false, isEmpty: false, displayObjects: [shape] },
      ]),
    ]);
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const { frameCount, innerTags } = decodeDefineSprite(spriteTag!.body);
    const showFrames = innerTags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(frameCount).toBe(3);
    expect(showFrames.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 5. DefineSprite inner stream ends with End tag (code 0)
  // -------------------------------------------------------------------------
  it("DefineSprite inner tag stream ends with End tag (code 0)", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const { innerTags } = decodeDefineSprite(spriteTag!.body);
    expect(innerTags.length).toBeGreaterThan(0);
    expect(innerTags[innerTags.length - 1].code).toBe(TAG_END);
  });

  // -------------------------------------------------------------------------
  // 6. SymbolInstance on stage → PlaceObject2 referencing the sprite's charId
  // -------------------------------------------------------------------------
  it("SymbolInstance on stage → PlaceObject2 charId matches the DefineSprite charId", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const inst = makeInstance("inst-1", "sym-1", 100, 50);
    const doc = makeDoc({
      scenes: [
        makeScene("s1", "Scene 1", [
          makeLayer("Layer 1", [
            { isKeyframe: true, isEmpty: false, displayObjects: [inst] },
          ]),
        ]),
      ],
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const { spriteId } = decodeDefineSprite(spriteTag!.body);

    const placeTag = tags.find((t) => t.code === TAG_PLACE_OBJECT2);
    expect(placeTag).toBeDefined();
    const { charId } = decodePlaceObject2(placeTag!.body);

    expect(charId).toBe(spriteId);
  });

  // -------------------------------------------------------------------------
  // 7. DefineSprite appears before the PlaceObject2 that references it
  // -------------------------------------------------------------------------
  it("DefineSprite tag appears before the PlaceObject2 that references it", () => {
    const sym = makeSymbol("sym-1", "MyClip");
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc({
      scenes: [
        makeScene("s1", "Scene 1", [
          makeLayer("Layer 1", [
            { isKeyframe: true, isEmpty: false, displayObjects: [inst] },
          ]),
        ]),
      ],
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    const defineSpriteIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SPRITE);
    const placeObjectIdx = tags.findIndex((t) => t.code === TAG_PLACE_OBJECT2);

    expect(defineSpriteIdx).toBeGreaterThanOrEqual(0);
    expect(placeObjectIdx).toBeGreaterThanOrEqual(0);
    expect(defineSpriteIdx).toBeLessThan(placeObjectIdx);
  });

  // -------------------------------------------------------------------------
  // 8. Two symbols → two DefineSprite tags with distinct character IDs
  // -------------------------------------------------------------------------
  it("two library symbols → two DefineSprite tags with distinct character IDs", () => {
    const sym1 = makeSymbol("sym-1", "ClipA");
    const sym2 = makeSymbol("sym-2", "ClipB");
    const doc = makeDoc({
      library: { items: [sym1, sym2], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBe(2);

    const id1 = decodeDefineSprite(spriteTags[0].body).spriteId;
    const id2 = decodeDefineSprite(spriteTags[1].body).spriteId;
    expect(id1).not.toBe(id2);
    expect(id1).toBeGreaterThanOrEqual(1);
    expect(id2).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 9. Symbol with inner shape: DefineShape4 hoisted to top level (not inside sprite)
  // -------------------------------------------------------------------------
  it("shape inside symbol is hoisted as DefineShape4 at top level, before DefineSprite", () => {
    const innerShape = makeShapeObj("inner-shape", 0, 0, 50, 50);
    const sym = makeSymbol("sym-1", "ClipWithShape", [
      makeLayer("Layer 1", [
        { isKeyframe: true, isEmpty: false, displayObjects: [innerShape] },
      ]),
    ]);
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    // DefineShape4 must be present at top level
    const shapeIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SHAPE4);
    const spriteIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SPRITE);
    expect(shapeIdx).toBeGreaterThanOrEqual(0);
    expect(spriteIdx).toBeGreaterThanOrEqual(0);
    // Hoisted definition must appear BEFORE its enclosing DefineSprite
    expect(shapeIdx).toBeLessThan(spriteIdx);
  });

  // -------------------------------------------------------------------------
  // 10. Symbol with inner shape: PlaceObject2 inside sprite references inner shape
  // -------------------------------------------------------------------------
  it("symbol with inner shape: DefineSprite inner stream contains PlaceObject2 for the shape", () => {
    const innerShape = makeShapeObj("inner-shape", 10, 20, 60, 30);
    const sym = makeSymbol("sym-1", "ClipWithShape", [
      makeLayer("Layer 1", [
        { isKeyframe: true, isEmpty: false, displayObjects: [innerShape] },
      ]),
    ]);
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const { innerTags } = decodeDefineSprite(spriteTag!.body);

    const innerPlaceTags = innerTags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(innerPlaceTags.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 11. Nested symbol instance: sprite body contains PlaceObject2 with nested sprite ID
  // -------------------------------------------------------------------------
  it("symbol containing another symbol instance: inner sprite's PlaceObject2 references nested sprite charId", () => {
    // Inner symbol
    const innerSym = makeSymbol("inner-sym", "InnerClip");
    // Outer symbol that places inner symbol
    const nestedInst = makeInstance("nested-inst", "inner-sym", 5, 5);
    const outerSym = makeSymbol("outer-sym", "OuterClip", [
      makeLayer("Layer 1", [
        { isKeyframe: true, isEmpty: false, displayObjects: [nestedInst] },
      ]),
    ]);
    const doc = makeDoc({
      library: { items: [innerSym, outerSym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    // Both inner and outer symbols should produce DefineSprite tags
    expect(spriteTags.length).toBe(2);

    // Inner sprite should be defined before outer sprite (topological order)
    const innerSpriteId = decodeDefineSprite(spriteTags[0].body).spriteId;
    const outerSprite = decodeDefineSprite(spriteTags[1].body);

    // The outer sprite's inner tags should contain a PlaceObject2 with innerSpriteId
    const innerPlaceTags = outerSprite.innerTags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(innerPlaceTags.length).toBeGreaterThanOrEqual(1);
    const placeDecoded = decodePlaceObject2(innerPlaceTags[0].body);
    expect(placeDecoded.charId).toBe(innerSpriteId);
  });

  // -------------------------------------------------------------------------
  // 12. Graphic-type symbol also produces a DefineSprite (symbolType='graphic')
  // -------------------------------------------------------------------------
  it("symbol with symbolType='graphic' also produces a DefineSprite tag", () => {
    const sym: Symbol = {
      id: "sym-g",
      name: "GraphicClip",
      itemType: "symbol",
      symbolType: "graphic",
      timeline: {
        layers: [makeLayer("Layer 1", [{ isEmpty: true }])],
      },
      linkage: DEFAULT_SYMBOL_LINKAGE,
      scale9Grid: null,
    };
    const doc = makeDoc({
      library: { items: [sym], folders: [] },
    });
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);
    const spriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTags.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 13. Symbol-internal static text bakes alignment XOffset (task 1199).
  //     Centered static text inside a symbol must carry the same TEXTRECORD
  //     XOffset that the scene/main-timeline path emits — previously sprite.ts
  //     and buttons.ts hardcoded XOffset=0, so symbol labels rendered
  //     left-of-center (golden 'Click to Play' button: 0 vs golden 280).
  // -------------------------------------------------------------------------
  describe("symbol-internal static text → baked alignment XOffset (task 1199)", () => {
    /** Read the first TEXTRECORD's signed XOffset from a DefineText body. */
    function firstXOffset(body: Uint8Array): number {
      const flagIdx = body.indexOf(0x8f);
      expect(flagIdx).toBeGreaterThan(0);
      const off = flagIdx + 1 + 2 + 3; // skip flag, FontID(2), RGB(3)
      const v = body[off] | (body[off + 1] << 8);
      return v & 0x8000 ? v - 0x10000 : v;
    }

    function makeCenteredText(): TextDisplayObject {
      return {
        id: "sym-text-1",
        type: "text",
        x: 0,
        y: 0,
        width: 200,
        height: 30,
        text: "Click to Play",
        textType: "static",
        fontFamily: "Arial",
        fontSize: 18,
        bold: false,
        italic: false,
        color: { r: 0, g: 0, b: 0, a: 255 },
        align: "center",
        multiline: false,
        wordWrap: false,
      };
    }

    function compileSymbolTextXOffset(symbolType: "movieclip" | "graphic"): number {
      const textObj = makeCenteredText();
      const sym: Symbol = {
        id: "sym-with-text",
        name: "LabelClip",
        itemType: "symbol",
        symbolType,
        timeline: {
          layers: [makeLayer("Layer 1", [{ isEmpty: false, displayObjects: [textObj] }])],
        },
        linkage: DEFAULT_SYMBOL_LINKAGE,
        scale9Grid: null,
      };
      const doc = makeDoc({
        scenes: [
          makeScene("scene-1", "Scene 1", [
            makeLayer("Layer 1", [{ isEmpty: false, displayObjects: [makeInstance("inst-1", "sym-with-text")] }]),
          ]),
        ],
        library: { items: [sym], folders: [] },
      });
      const bytes = compileDocument(doc);
      const tags = parseTags(bytes);
      // Symbol-internal character definitions are hoisted to top level; the
      // sprite body only carries the PlaceObject2 that references them.
      const textTag = tags.find((t) => t.code === TAG_DEFINE_TEXT);
      expect(textTag).toBeDefined();
      return firstXOffset(textTag!.body);
    }

    it("movieclip-internal centered static text has a positive (non-zero) XOffset", () => {
      const xoff = compileSymbolTextXOffset("movieclip");
      // 200px box (4000 twips), "Click to Play" at 18px is narrower → centered
      // start offset is a meaningful positive value, NOT the old hardcoded 0.
      expect(xoff).toBeGreaterThan(0);
    });

    it("graphic-internal centered static text has a positive (non-zero) XOffset", () => {
      const xoff = compileSymbolTextXOffset("graphic");
      expect(xoff).toBeGreaterThan(0);
    });

    it("the baked XOffset matches the shared alignXOffsetTwips helper", () => {
      const obj = makeCenteredText();
      const expected = alignXOffsetTwips(obj.align, obj.width, obj.text, Math.round(obj.fontSize * 20), false);
      expect(expected).toBeGreaterThan(0);
      expect(compileSymbolTextXOffset("movieclip")).toBe(expected);
    });

    it("alignXOffsetTwips: left/justify → 0; center < right; absent box → 0", () => {
      const fs = 360; // 18px in twips
      expect(alignXOffsetTwips("left", 200, "Click to Play", fs)).toBe(0);
      expect(alignXOffsetTwips("justify", 200, "Click to Play", fs)).toBe(0);
      const c = alignXOffsetTwips("center", 200, "Click to Play", fs);
      const r = alignXOffsetTwips("right", 200, "Click to Play", fs);
      expect(c).toBeGreaterThan(0);
      expect(r).toBeGreaterThan(c);
      // No box width (or text wider than box) → no offset, never negative.
      expect(alignXOffsetTwips("center", 0, "Click to Play", fs)).toBe(0);
    });
  });
});
