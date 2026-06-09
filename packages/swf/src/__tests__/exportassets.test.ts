/**
 * Tests for ExportAssets (tag 56) emission.
 *
 * Verifies that symbols with exportForActionScript=true and a non-empty
 * linkageIdentifier produce a correct ExportAssets tag (56) in compiled SWF
 * output, with correct structure, ordering, and character ID matching.
 *
 * Tag codes:
 *   0  End
 *   1  ShowFrame
 *  39  DefineSprite
 *  43  FrameLabel
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
const TAG_EXPORT_ASSETS = 56;
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
    if (tagCode === TAG_END) break;
  }
  return tags;
}

function parseSWF(bytes: Uint8Array): SWFTag[] {
  const tagsOffset = parseSWFHeader(bytes);
  return parseTags(bytes, tagsOffset);
}

// ---------------------------------------------------------------------------
// ExportAssets tag body parser
// ---------------------------------------------------------------------------

interface ExportEntry {
  charId: number;
  name: string;
}

/**
 * Parse an ExportAssets (tag 56) tag body into an array of {charId, name} entries.
 *
 * Format:
 *   UI16  Count
 *   For each:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated)
 */
function parseExportAssets(body: Uint8Array): ExportEntry[] {
  const entries: ExportEntry[] = [];
  if (body.length < 2) return entries;
  const count = body[0] | (body[1] << 8);
  let pos = 2;
  for (let i = 0; i < count; i++) {
    if (pos + 2 > body.length) break;
    const charId = body[pos] | (body[pos + 1] << 8);
    pos += 2;
    // Read null-terminated string
    let nameEnd = pos;
    while (nameEnd < body.length && body[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(body.slice(pos, nameEnd));
    pos = nameEnd + 1; // skip NUL
    entries.push({ charId, name });
  }
  return entries;
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

function makeLayer(id = "layer-1"): Layer {
  return {
    id,
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
// Tests
// ---------------------------------------------------------------------------

describe("ExportAssets (tag 56)", () => {
  // Test 1: Symbol with exportForActionScript=true and non-empty linkageIdentifier
  // produces ExportAssets tag (56) in compiled output.
  it("symbol with exportForActionScript=true and non-empty linkageIdentifier produces ExportAssets tag", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBeGreaterThan(0);
  });

  // Test 2: Symbol with exportForActionScript=false does NOT produce ExportAssets.
  it("symbol with exportForActionScript=false does NOT produce ExportAssets", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: false,
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBe(0);
  });

  // Test 3: Symbol with empty linkageIdentifier does NOT produce ExportAssets.
  it("symbol with empty linkageIdentifier does NOT produce ExportAssets", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBe(0);
  });

  // Test 4: Multiple linked symbols produce ONE ExportAssets tag (not multiple).
  it("multiple linked symbols produce exactly one ExportAssets tag containing all entries", () => {
    const sym1 = makeSymbol({
      id: "sym-1",
      name: "Symbol1",
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
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
        linkageIdentifier: "LinkageB",
      },
      scale9Grid: null,
    };
    const doc = makeDoc([sym1, sym2]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Must be exactly one ExportAssets tag
    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBe(1);

    // That single tag must contain both entries
    const entries = parseExportAssets(exportTags[0].body);
    expect(entries.length).toBe(2);
    const names = entries.map((e) => e.name);
    expect(names).toContain("LinkageA");
    expect(names).toContain("LinkageB");
  });

  // Test 5: ExportAssets appears before DoInitAction in the byte stream.
  it("ExportAssets appears before DoInitAction in the tag stream", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MyLinkageId",
        className: "MyClass",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exportIdx = tags.findIndex((t) => t.code === TAG_EXPORT_ASSETS);
    const doInitIdx = tags.findIndex((t) => t.code === TAG_DO_INIT_ACTION);

    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(doInitIdx).toBeGreaterThanOrEqual(0);
    expect(exportIdx).toBeLessThan(doInitIdx);
  });

  // Test 6: CharacterId in ExportAssets matches the symbol's DefineSprite character ID.
  it("CharacterId in ExportAssets matches the symbol's DefineSprite character ID", () => {
    const sym = makeSymbol({
      id: "sym-1",
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Get the DefineSprite tag — first one belongs to our symbol
    const defineSpriteTags = tags.filter((t) => t.code === TAG_DEFINE_SPRITE);
    expect(defineSpriteTags.length).toBeGreaterThan(0);
    const spriteCharId =
      defineSpriteTags[0].body[0] | (defineSpriteTags[0].body[1] << 8);

    // Parse ExportAssets and verify character ID matches
    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBe(1);
    const entries = parseExportAssets(exportTags[0].body);
    expect(entries.length).toBe(1);
    expect(entries[0].charId).toBe(spriteCharId);
    expect(entries[0].name).toBe("MyLinkageId");
  });

  // Extra: ExportAssets appears before ShowFrame (within the first frame)
  it("ExportAssets appears before ShowFrame in the tag stream", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForActionScript: true,
        linkageIdentifier: "MyLinkageId",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exportIdx = tags.findIndex((t) => t.code === TAG_EXPORT_ASSETS);
    const showFrameIdx = tags.findIndex((t) => t.code === TAG_SHOW_FRAME);

    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(showFrameIdx).toBeGreaterThanOrEqual(0);
    expect(exportIdx).toBeLessThan(showFrameIdx);
  });
});
