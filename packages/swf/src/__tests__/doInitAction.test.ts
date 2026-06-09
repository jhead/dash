/**
 * Tests for DoInitAction (tag 59) emission.
 *
 * Verifies that symbols with exportForActionScript=true and a className
 * cause DoInitAction tags to be emitted in the correct position with
 * correct bytecode.
 *
 * Tag codes:
 *   0  End
 *   1  ShowFrame
 *  39  DefineSprite
 *  56  ExportAssets
 *  59  DoInitAction
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_DEFINE_SPRITE = 39;
const TAG_DO_INIT_ACTION = 59;

// ---------------------------------------------------------------------------
// SWF binary parser helpers
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

function parseSWFHeader(bytes: Uint8Array): number /* tagsOffset */ {
  // Skip 8-byte fixed header
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

  // After all RECT bits are consumed, byteOff is already past the RECT bytes.
  // Skip FrameRate(2) + FrameCount(2) to reach the tag stream.
  return byteOff + 4;
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

function parseSWF(bytes: Uint8Array): SWFTag[] {
  const tagsOffset = parseSWFHeader(bytes);
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

const DEFAULT_LINKAGE = {
  exportForActionScript: false,
  exportInFirstFrame: false,
  linkageIdentifier: "",
  className: "",
  exportForRuntimeSharing: false,
  importForRuntimeSharing: false,
  sharedUrl: "",
};

function makeEmptyFrame(): Frame {
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
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
  };
}

function makeLayer(): Layer {
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
    frames: [makeEmptyFrame()],
    frameCount: 1,
  };
}

function makeScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer()] },
  };
}

function makeSymbol(overrides: Partial<Symbol> = {}): Symbol {
  const defaultTimeline = {
    layers: [
      {
        id: "sym-layer-1",
        name: "Layer 1",
        type: "normal" as const,
        visible: true,
        locked: false,
        outlineMode: false,
        outlineColor: "#ff0000",
        height: 20,
        parentFolderId: null,
        frames: [makeEmptyFrame()],
        frameCount: 1,
      },
    ],
  };
  return {
    id: "sym-1",
    name: "MySymbol",
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: defaultTimeline,
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
    ...overrides,
  };
}

function makeDoc(symbols: Symbol[]): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene()],
    library: { items: symbols, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Helpers for inspecting DoInitAction tag bodies
// ---------------------------------------------------------------------------

/** Extract SpriteId (UI16LE) from a DoInitAction tag body. */
function getSpriteId(body: Uint8Array): number {
  return body[0] | (body[1] << 8);
}

/** Return the action bytes portion of a DoInitAction tag body (after the 2-byte SpriteId). */
function getActionBytes(body: Uint8Array): Uint8Array {
  return body.slice(2);
}

/** Check if a Uint8Array contains a null-terminated string at any position. */
function containsString(bytes: Uint8Array, s: string): boolean {
  const encoded = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - encoded.length; i++) {
    for (let j = 0; j < encoded.length; j++) {
      if (bytes[i + j] !== encoded[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DoInitAction (tag 59)", () => {
  it("emits DoInitAction tag for a symbol with exportForActionScript=true", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "MyClass",
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBeGreaterThan(0);
  });

  it("does NOT emit DoInitAction for a symbol without exportForActionScript", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: false,
        className: "MyClass",
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(0);
  });

  it("DoInitAction SpriteId matches the DefineSprite character ID", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "MyClass",
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Find the DefineSprite tag — the first one belongs to our symbol
    const defineSpriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(defineSpriteTags.length).toBeGreaterThan(0);
    const spriteCharId = defineSpriteTags[0].body[0] | (defineSpriteTags[0].body[1] << 8);

    // Find DoInitAction and compare SpriteId
    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBeGreaterThan(0);
    const doInitSpriteId = getSpriteId(doInitTags[0].body);
    expect(doInitSpriteId).toBe(spriteCharId);
  });

  it("DoInitAction bytecode contains the string 'registerClass'", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "MyClass",
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBeGreaterThan(0);

    const actionBytes = getActionBytes(doInitTags[0].body);
    expect(containsString(actionBytes, "registerClass")).toBe(true);
  });

  it("DoInitAction bytecode contains the className string", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "BallClass",
        linkageIdentifier: "BallLinkage",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBeGreaterThan(0);

    const actionBytes = getActionBytes(doInitTags[0].body);
    expect(containsString(actionBytes, "BallClass")).toBe(true);
  });

  it("DoInitAction appears before ShowFrame in the tag stream (first frame)", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "MyClass",
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitIdx = tags.findIndex((t) => t.code === TAG_DO_INIT_ACTION);
    const showFrameIdx = tags.findIndex((t) => t.code === TAG_SHOW_FRAME);

    expect(doInitIdx).toBeGreaterThanOrEqual(0);
    expect(showFrameIdx).toBeGreaterThanOrEqual(0);
    expect(doInitIdx).toBeLessThan(showFrameIdx);
  });

  it("emits multiple DoInitAction tags when multiple symbols have exportForActionScript=true", () => {
    const sym1 = makeSymbol({
      id: "sym-1",
      name: "Symbol1",
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "ClassA",
        linkageIdentifier: "LinkageA",
      },
    });
    const sym2: Symbol = {
      id: "sym-2",
      name: "Symbol2",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: {
        layers: [
          {
            id: "sym2-layer",
            name: "Layer 1",
            type: "normal",
            visible: true,
            locked: false,
            outlineMode: false,
            outlineColor: "#ff0000",
            height: 20,
            parentFolderId: null,
            frames: [makeEmptyFrame()],
            frameCount: 1,
          },
        ],
      },
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        className: "ClassB",
        linkageIdentifier: "LinkageB",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([sym1, sym2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(2);
  });
});
