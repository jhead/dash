/**
 * Tests for ImportAssets2 (tag 71) and ExportAssets runtime-sharing emission.
 *
 * ImportAssets2 (tag 71): emitted when a symbol has importForRuntimeSharing=true,
 * a non-empty sharedUrl, and a non-empty linkageIdentifier.
 *
 * ExportAssets (tag 56): also tested here for exportForRuntimeSharing=true scenario
 * (distinct from exportForActionScript).
 *
 * Tag codes:
 *   0  End
 *   1  ShowFrame
 *  39  DefineSprite
 *  56  ExportAssets
 *  71  ImportAssets2
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag code constants
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_EXPORT_ASSETS = 56;
const TAG_IMPORT_ASSETS2 = 71;

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
    if (tagCode === TAG_END) break;
  }
  return tags;
}

function parseSWF(bytes: Uint8Array): SWFTag[] {
  const tagsOffset = parseSWFHeader(bytes);
  return parseTags(bytes, tagsOffset);
}

// ---------------------------------------------------------------------------
// ImportAssets2 tag body parser
// ---------------------------------------------------------------------------

interface ImportEntry {
  charId: number;
  name: string;
}

/**
 * Parse an ImportAssets2 (tag 71) tag body.
 *
 * Format (SWF spec):
 *   STRING  URL (null-terminated)
 *   UI8     Reserved (= 1)
 *   UI8     Reserved (= 0)
 *   UI16    Count
 *   For each:
 *     UI16    CharacterId
 *     STRING  Name (null-terminated)
 */
function parseImportAssets2(body: Uint8Array): { url: string; entries: ImportEntry[] } {
  let pos = 0;
  // Read null-terminated URL string
  let urlEnd = pos;
  while (urlEnd < body.length && body[urlEnd] !== 0) urlEnd++;
  const url = new TextDecoder().decode(body.slice(pos, urlEnd));
  pos = urlEnd + 1; // skip NUL

  // Skip two reserved bytes
  pos += 2;

  if (pos + 2 > body.length) return { url, entries: [] };
  const count = body[pos] | (body[pos + 1] << 8);
  pos += 2;

  const entries: ImportEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (pos + 2 > body.length) break;
    const charId = body[pos] | (body[pos + 1] << 8);
    pos += 2;
    let nameEnd = pos;
    while (nameEnd < body.length && body[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(body.slice(pos, nameEnd));
    pos = nameEnd + 1; // skip NUL
    entries.push({ charId, name });
  }
  return { url, entries };
}

// ---------------------------------------------------------------------------
// ExportAssets tag body parser
// ---------------------------------------------------------------------------

interface ExportEntry {
  charId: number;
  name: string;
}

function parseExportAssets(body: Uint8Array): ExportEntry[] {
  const entries: ExportEntry[] = [];
  if (body.length < 2) return entries;
  const count = body[0] | (body[1] << 8);
  let pos = 2;
  for (let i = 0; i < count; i++) {
    if (pos + 2 > body.length) break;
    const charId = body[pos] | (body[pos + 1] << 8);
    pos += 2;
    let nameEnd = pos;
    while (nameEnd < body.length && body[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(body.slice(pos, nameEnd));
    pos = nameEnd + 1;
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
    name: "SharedClip",
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
// Tests: ImportAssets2 (tag 71)
// ---------------------------------------------------------------------------

describe("ImportAssets2 (tag 71) — importForRuntimeSharing", () => {
  // Test 1: SWF compiles without error for a symbol with importForRuntimeSharing=true.
  it("SWF compiles without error for importForRuntimeSharing=true symbol", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        importForRuntimeSharing: true,
        sharedUrl: "http://example.com/shared.swf",
        linkageIdentifier: "SharedClip",
      },
    });
    const doc = makeDoc([sym]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 2: ImportAssets2 (tag 71) IS emitted and its body is byte-exact per the
  // SWF spec: STRING url (NUL-term), UI8 reserved=1, UI8 reserved=0, UI16 count,
  // then {UI16 charId, STRING name(NUL-term)} per imported symbol.
  it("emits a byte-exact ImportAssets2 (tag 71) body for an importForRuntimeSharing symbol", () => {
    const sharedUrl = "http://example.com/shared.swf";
    const linkageIdentifier = "SharedClip";

    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        importForRuntimeSharing: true,
        sharedUrl,
        linkageIdentifier,
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Exactly one ImportAssets2 tag must be present.
    const importTags = tags.filter((t) => t.code === TAG_IMPORT_ASSETS2);
    expect(importTags.length).toBe(1);
    const body = importTags[0].body;

    // --- Build the expected body byte-for-byte and compare exactly. ---
    const urlBytes = Array.from(new TextEncoder().encode(sharedUrl));
    const nameBytes = Array.from(new TextEncoder().encode(linkageIdentifier));
    // We don't hard-code the charId here (it is allocation-order dependent), so
    // read it back and assert it round-trips, then assemble the expected bytes
    // around it.
    const charIdLo = body[urlBytes.length + 1 /*NUL*/ + 2 /*reserved*/ + 2 /*count*/];
    const charIdHi = body[urlBytes.length + 1 + 2 + 2 + 1];
    const charId = charIdLo | (charIdHi << 8);
    expect(charId).toBeGreaterThanOrEqual(1);

    const expected = [
      ...urlBytes, 0, // STRING url + NUL
      1, 0, // reserved bytes (1, 0)
      1, 0, // UI16 count = 1 (LE)
      charId & 0xff, (charId >> 8) & 0xff, // UI16 charId (LE)
      ...nameBytes, 0, // STRING name + NUL
    ];
    expect(Array.from(body)).toEqual(expected);

    // And the structural parser agrees on the decoded values.
    const parsed = parseImportAssets2(body);
    expect(parsed.url).toBe(sharedUrl);
    expect(parsed.entries.length).toBe(1);
    expect(parsed.entries[0].name).toBe(linkageIdentifier);
    expect(parsed.entries[0].charId).toBe(charId);
  });

  // Test 3: When ImportAssets2 is NOT emitted, compile still produces a valid SWF.
  it("SWF bytes are non-empty for importForRuntimeSharing=true symbol", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        importForRuntimeSharing: true,
        sharedUrl: "http://example.com/shared.swf",
        linkageIdentifier: "SharedClip",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    expect(bytes.length).toBeGreaterThan(0);
    // SWF signature should be present
    const sig = new TextDecoder().decode(bytes.slice(0, 3));
    expect(["FWS", "CWS", "ZWS"]).toContain(sig);
  });

  // Test 4 (conditional): If ImportAssets2 IS emitted, verify URL and identifier content.
  it("if ImportAssets2 tag is emitted, it contains the sharedUrl and linkageIdentifier", () => {
    const sharedUrl = "http://example.com/shared.swf";
    const linkageIdentifier = "SharedClip";

    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        importForRuntimeSharing: true,
        sharedUrl,
        linkageIdentifier,
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Hard assertion: ImportAssets2 IS emitted (no skip fallback).
    const importTags = tags.filter((t) => t.code === TAG_IMPORT_ASSETS2);
    expect(importTags.length).toBe(1);
    const parsed = parseImportAssets2(importTags[0].body);
    expect(parsed.url).toBe(sharedUrl);
    const names = parsed.entries.map((e) => e.name);
    expect(names).toContain(linkageIdentifier);
  });

  // Test 5: Symbol with importForRuntimeSharing=false does NOT produce ImportAssets2.
  it("symbol with importForRuntimeSharing=false does NOT produce ImportAssets2", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        importForRuntimeSharing: false,
        sharedUrl: "http://example.com/shared.swf",
        linkageIdentifier: "SharedClip",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const importTags = tags.filter((t) => t.code === TAG_IMPORT_ASSETS2);
    expect(importTags.length).toBe(0);
  });

  // Test 6: Symbol with empty sharedUrl does NOT produce ImportAssets2.
  it("symbol with empty sharedUrl does NOT produce ImportAssets2", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        importForRuntimeSharing: true,
        sharedUrl: "",
        linkageIdentifier: "SharedClip",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const importTags = tags.filter((t) => t.code === TAG_IMPORT_ASSETS2);
    expect(importTags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: ExportAssets runtime sharing (exportForRuntimeSharing=true)
// ---------------------------------------------------------------------------

describe("ExportAssets (tag 56) — exportForRuntimeSharing", () => {
  // Test 1: SWF compiles without error for exportForRuntimeSharing=true.
  it("SWF compiles without error for exportForRuntimeSharing=true symbol", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForRuntimeSharing: true,
        linkageIdentifier: "SharedClip",
        sharedUrl: "http://example.com/shared.swf",
      },
    });
    const doc = makeDoc([sym]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 2: ExportAssets (tag 56) IS emitted for an exportForRuntimeSharing symbol,
  // and its body is byte-exact per the SWF spec: UI16 count, then {UI16 charId,
  // STRING name(NUL-term)} per exported symbol.
  it("emits a byte-exact ExportAssets (tag 56) body for an exportForRuntimeSharing symbol", () => {
    const linkageIdentifier = "SharedClip";
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForRuntimeSharing: true,
        linkageIdentifier,
        sharedUrl: "http://example.com/shared.swf",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    // Exactly one ExportAssets tag must be present (hard — no non-emission fallback).
    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBe(1);
    const body = exportTags[0].body;

    // count is the first UI16; charId follows.
    const count = body[0] | (body[1] << 8);
    expect(count).toBe(1);
    const charId = body[2] | (body[3] << 8);
    expect(charId).toBeGreaterThanOrEqual(1);

    const nameBytes = Array.from(new TextEncoder().encode(linkageIdentifier));
    const expected = [
      1, 0, // UI16 count = 1 (LE)
      charId & 0xff, (charId >> 8) & 0xff, // UI16 charId (LE)
      ...nameBytes, 0, // STRING name + NUL
    ];
    expect(Array.from(body)).toEqual(expected);

    // And the structural parser agrees.
    const entries = parseExportAssets(body);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe(linkageIdentifier);
    expect(entries[0].charId).toBe(charId);
  });

  // Test 3: exportForRuntimeSharing=false does not produce ExportAssets (unless exportForActionScript is also set).
  it("exportForRuntimeSharing=false alone does not produce ExportAssets", () => {
    const sym = makeSymbol({
      linkage: {
        ...DEFAULT_LINKAGE,
        exportForRuntimeSharing: false,
        linkageIdentifier: "SharedClip",
        sharedUrl: "http://example.com/shared.swf",
      },
    });
    const doc = makeDoc([sym]);
    const bytes = compileDocument(doc);
    const tags = parseSWF(bytes);

    const exportTags = tags.filter((t) => t.code === TAG_EXPORT_ASSETS);
    expect(exportTags.length).toBe(0);
  });
});
