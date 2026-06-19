/**
 * DefineScalingGrid (tag 78) — 9-slice scaling test suite.
 *
 * Verifies that:
 * 1. A symbol with scale9Grid: null does NOT produce a tag 78
 * 2. A symbol with a non-null scale9Grid compiles without error
 * 3. When tag 78 is emitted, its body starts with the correct DefineSprite character ID (UI16)
 * 4. When tag 78 is emitted, its body contains a RECT encoding the grid boundaries
 *
 * SWF tag codes used:
 *   0   End
 *  39   DefineSprite
 *  78   DefineScalingGrid
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

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_DEFINE_SPRITE = 39;
const TAG_DEFINE_SCALING_GRID = 78;

// ---------------------------------------------------------------------------
// SWF binary parser helpers
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
  /** byte offset in the raw SWF buffer where this tag's record header starts */
  offset: number;
}

function findTagsOffset(bytes: Uint8Array): number {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  return 8 + rectBytes + 4;
}

function parseTags(bytes: Uint8Array): SWFTag[] {
  const startOffset = findTagsOffset(bytes);
  const tags: SWFTag[] = [];
  let pos = startOffset;
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
 * Read a SWF RECT from a bit-packed byte array at byteOffset.
 * Returns the four bounds in twips and the number of bytes consumed.
 */
function readRect(
  bytes: Uint8Array,
  byteOffset: number
): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  bytesConsumed: number;
} {
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
    if (bits === 0) return 0;
    const signBit = 1 << (bits - 1);
    return raw & signBit ? raw - (signBit << 1) : raw;
  }

  const nBits = readBits(5);
  const xMinRaw = readBits(nBits);
  const xMaxRaw = readBits(nBits);
  const yMinRaw = readBits(nBits);
  const yMaxRaw = readBits(nBits);

  return {
    xMin: toSigned(xMinRaw, nBits),
    xMax: toSigned(xMaxRaw, nBits),
    yMin: toSigned(yMinRaw, nBits),
    yMax: toSigned(yMaxRaw, nBits),
    bytesConsumed: byteOff - byteOffset,
  };
}

// ---------------------------------------------------------------------------
// Document/symbol fixture helpers
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

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    index: 0,
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
    ...overrides,
  };
}

function makeLayer(name: string): Layer {
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
    frames: [makeFrame()],
    frameCount: 1,
  };
}

function makeScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer("Layer 1")] },
  };
}

function makeSymbol(id: string, scale9Grid: Symbol["scale9Grid"]): Symbol {
  return {
    id,
    name: `Symbol_${id}`,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer("Layer 1")] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid,
  };
}

function makeDoc(symbols: Symbol[]): FlashDocument {
  return {
    id: "test-doc",
    properties: BASE_PROPS,
    scenes: [makeScene()],
    library: { items: symbols, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineScalingGrid (tag 78) — 9-slice scaling", () => {

  // -------------------------------------------------------------------------
  // Test 1: symbol with scale9Grid: null — no tag 78 emitted
  // -------------------------------------------------------------------------

  it("symbol with scale9Grid: null does NOT emit a DefineScalingGrid tag (78)", () => {
    const sym = makeSymbol("sym-no-grid", null);
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    const gridTags = tags.filter((t) => t.code === TAG_DEFINE_SCALING_GRID);
    expect(gridTags.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: symbol with non-null scale9Grid — compiles without error
  // -------------------------------------------------------------------------

  it("symbol with scale9Grid: {x:10,y:10,width:30,height:30} compiles without error", () => {
    const sym = makeSymbol("sym-with-grid", { x: 10, y: 10, width: 30, height: 30 });
    const doc = makeDoc([sym]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Test 3: if tag 78 is emitted, its body starts with the correct sprite charId
  // -------------------------------------------------------------------------

  it("if DefineScalingGrid (tag 78) is emitted, its body starts with the DefineSprite character ID", () => {
    const sym = makeSymbol("sym-with-grid", { x: 10, y: 10, width: 30, height: 30 });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    // Hard assertion: exactly one DefineScalingGrid (tag 78) must be emitted.
    const gridTags = tags.filter((t) => t.code === TAG_DEFINE_SCALING_GRID);
    expect(gridTags.length).toBe(1);

    // Find the DefineSprite tag and extract its character ID
    const spriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteTag).toBeDefined();
    const spriteCharId = spriteTag!.body[0] | (spriteTag!.body[1] << 8);
    expect(spriteCharId).toBeGreaterThanOrEqual(1);

    // The first two bytes of the DefineScalingGrid body must match the sprite's charId
    const gridBody = gridTags[0].body;
    expect(gridBody.length).toBeGreaterThanOrEqual(2);
    const gridCharId = gridBody[0] | (gridBody[1] << 8);
    expect(gridCharId).toBe(spriteCharId);
  });

  // -------------------------------------------------------------------------
  // Test 4: if tag 78 is emitted, its body contains a RECT encoding the grid
  // -------------------------------------------------------------------------

  it("if DefineScalingGrid (tag 78) is emitted, its body contains a RECT with the grid boundaries", () => {
    // grid: x=10, y=10, width=30, height=30 → in twips: xMin=200, xMax=800, yMin=200, yMax=800
    const grid = { x: 10, y: 10, width: 30, height: 30 };
    const sym = makeSymbol("sym-with-grid", grid);
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    // Hard assertion: exactly one DefineScalingGrid (tag 78) must be emitted.
    const gridTags = tags.filter((t) => t.code === TAG_DEFINE_SCALING_GRID);
    expect(gridTags.length).toBe(1);

    const gridBody = gridTags[0].body;
    // Skip charId (2 bytes) then read the RECT
    expect(gridBody.length).toBeGreaterThan(2);
    const rect = readRect(gridBody, 2);

    // x=10px → xMin=200 twips; x+width=40px → xMax=800 twips
    // y=10px → yMin=200 twips; y+height=40px → yMax=800 twips
    expect(rect.xMin).toBe(grid.x * 20);
    expect(rect.xMax).toBe((grid.x + grid.width) * 20);
    expect(rect.yMin).toBe(grid.y * 20);
    expect(rect.yMax).toBe((grid.y + grid.height) * 20);

    // The RECT must consume the entire remainder of the body (charId + RECT, no
    // trailing/padding bytes beyond the byte-aligned RECT).
    expect(2 + rect.bytesConsumed).toBe(gridBody.length);
  });

  // -------------------------------------------------------------------------
  // Test 5: tag 78 appears immediately after tag 39 for the same symbol
  // -------------------------------------------------------------------------

  it("DefineScalingGrid (tag 78) appears immediately after the DefineSprite (tag 39) it references", () => {
    const sym = makeSymbol("sym-with-grid", { x: 5, y: 5, width: 40, height: 40 });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseTags(bytes);

    // Hard assertion: exactly one DefineScalingGrid (tag 78) must be emitted.
    const gridTags = tags.filter((t) => t.code === TAG_DEFINE_SCALING_GRID);
    expect(gridTags.length).toBe(1);

    // Find index of DefineSprite and verify DefineScalingGrid follows it
    const spriteIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SPRITE);
    expect(spriteIdx).toBeGreaterThanOrEqual(0);
    expect(tags[spriteIdx + 1]?.code).toBe(TAG_DEFINE_SCALING_GRID);
  });
});
