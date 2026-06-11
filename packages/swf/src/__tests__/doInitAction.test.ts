/**
 * Tests for DoInitAction (tag 59) emission.
 *
 * DoInitAction is emitted in the first SWF frame for every symbol with
 * exportForActionScript=true and a non-empty className (linkage).  Its body
 * starts with a UI16 SpriteID that must match the symbol's DefineSprite
 * character ID, followed by AVM1 bytecode that calls
 * Object.registerClass(linkageId, ClassName).
 *
 * Tag codes:
 *   0   End
 *   1   ShowFrame
 *  39   DefineSprite
 *  43   FrameLabel
 *  56   ExportAssets
 *  59   DoInitAction
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

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

  // After RECT: skip FrameRate(2) + FrameCount(2)
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
    if (tagCode === 0) break;
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

function makeEmptyFrame(script = ""): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none",
    label: "",
    labelType: "name",
    script,
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
  };
}

function makeSymbolLayer(script = ""): Layer {
  return {
    id: "sym-layer-1",
    name: "Layer 1",
    type: "normal" as const,
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [makeEmptyFrame(script)],
    frameCount: 1,
  };
}

function makeSymbol(overrides: Partial<Symbol> = {}, script = ""): Symbol {
  return {
    id: "sym-1",
    name: "MySymbol",
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeSymbolLayer(script)] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
    ...overrides,
  };
}

function makeScene(): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: {
      layers: [
        {
          id: "layer-1",
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
    },
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
// Tests
// ---------------------------------------------------------------------------

describe("DoInitAction (tag 59)", () => {
  // Test 1: Document with exported symbol compiles without error
  it("document with exported symbol compiles without error", () => {
    const sym = makeSymbol(
      {
        id: "sym-1",
        name: "MySymbol",
        linkage: {
          ...DEFAULT_LINKAGE,
          exportForActionScript: true,
          exportInFirstFrame: true,
          linkageIdentifier: "MySymbol",
          className: "MySymbol",
        },
      },
      "trace('init');"
    );
    const doc = makeDoc([sym]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 2: DoInitAction (tag 59) appears in output for exported symbol with className
  it("DoInitAction tag (59) appears for symbol with exportForActionScript=true and className", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MySymbol",
        className: "MySymbol",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBeGreaterThan(0);
  });

  // Test 3: DoInitAction body starts with SpriteID UI16 matching DefineSprite char id
  it("DoInitAction body SpriteID matches DefineSprite character ID", () => {
    const sym = makeSymbol({
      id: "sym-1",
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MySymbol",
        className: "MySymbol",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const defineSpriteTag = tags.find((t) => t.code === TAG_DEFINE_SPRITE);
    expect(defineSpriteTag).toBeDefined();
    const spriteCharId =
      defineSpriteTag!.body[0] | (defineSpriteTag!.body[1] << 8);

    const doInitTag = tags.find((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTag).toBeDefined();
    const doInitSpriteId = doInitTag!.body[0] | (doInitTag!.body[1] << 8);
    expect(doInitSpriteId).toBe(spriteCharId);
  });

  // Test 4: DoInitAction body length > 2 (has action bytes beyond just SpriteID)
  it("DoInitAction body is longer than 2 bytes (contains AVM1 bytecode after SpriteID)", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MySymbol",
        className: "MySymbol",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTag = tags.find((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTag).toBeDefined();
    // 2 bytes for SpriteID + at least 1 ActionEnd byte (0x00)
    expect(doInitTag!.body.length).toBeGreaterThan(2);
  });

  // Test 5: DoInitAction appears before first ShowFrame (within the first frame)
  it("DoInitAction appears before first ShowFrame in the tag stream", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MySymbol",
        className: "MySymbol",
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

  // Test 6: Symbol without exportForActionScript=true does not produce DoInitAction
  it("symbol without exportForActionScript=true does not produce DoInitAction", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: false,
        linkageIdentifier: "MySymbol",
        className: "MySymbol",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(0);
  });

  // Test 7: Multiple exported symbols each get their own DoInitAction tag
  it("multiple exported symbols each produce their own DoInitAction tag", () => {
    const sym1 = makeSymbol({
      id: "sym-1",
      name: "SymbolA",
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "SymbolA",
        className: "SymbolA",
      },
    });
    const sym2: Symbol = {
      id: "sym-2",
      name: "SymbolB",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [makeSymbolLayer()] },
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "SymbolB",
        className: "SymbolB",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([sym1, sym2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(2);
  });

  // Test 8: Symbol with className but exportForActionScript=false produces no DoInitAction
  it("symbol with className but exportForActionScript=false produces no DoInitAction", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: false,
        className: "SomeClass",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(0);
  });

  // Test 9: Symbol with exportForActionScript=true but empty className produces no DoInitAction
  it("symbol with exportForActionScript=true but empty className produces no DoInitAction", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MySymbol",
        className: "", // empty className — no DoInitAction
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(0);
  });

  // Test 10: Each DoInitAction SpriteID appears in the DefineSprite character ID set
  it("each DoInitAction SpriteID corresponds to a DefineSprite character ID", () => {
    const sym1 = makeSymbol({
      id: "sym-1",
      name: "SymbolA",
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "SymbolA",
        className: "SymbolA",
      },
    });
    const sym2: Symbol = {
      id: "sym-2",
      name: "SymbolB",
      itemType: "symbol",
      symbolType: "movieclip",
      timeline: { layers: [makeSymbolLayer()] },
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "SymbolB",
        className: "SymbolB",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([sym1, sym2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Collect all DefineSprite character IDs
    const spriteCharIds = tags
      .filter((t) => t.code === TAG_DEFINE_SPRITE)
      .map((t) => t.body[0] | (t.body[1] << 8));

    // Collect DoInitAction SpriteID fields
    const doInitSpriteIds = tags
      .filter((t) => t.code === TAG_DO_INIT_ACTION)
      .map((t) => t.body[0] | (t.body[1] << 8));

    expect(doInitSpriteIds.length).toBe(2);
    // Each DoInitAction SpriteID must appear in the set of DefineSprite char IDs
    for (const id of doInitSpriteIds) {
      expect(spriteCharIds).toContain(id);
    }
    // The two IDs must be distinct
    expect(new Set(doInitSpriteIds).size).toBe(2);
  });

  // Test 11: Non-exported symbol with no className produces no DoInitAction
  it("non-exported symbol with no className produces no DoInitAction", () => {
    const sym = makeSymbol(
      {
        linkage: {
          ...DEFAULT_LINKAGE,
          exportForActionScript: false,
          exportInFirstFrame: false,
          linkageIdentifier: "",
          className: "",
        },
      },
      "stop();"
    );
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const doInitTags = tags.filter((t) => t.code === TAG_DO_INIT_ACTION);
    expect(doInitTags.length).toBe(0);
  });
});
