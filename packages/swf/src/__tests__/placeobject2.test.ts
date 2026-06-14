/**
 * Tests for PlaceObject2 (tag type 26) MATRIX and depth encoding.
 *
 * Covers two levels of verification:
 *
 * 1. Unit-level: `encodePlaceObject2` produces correct bit-packed MATRIX records.
 *    - Translation encoded in twips (px × 20)
 *    - Depth and charId written correctly in the 5-byte fixed header
 *
 * 2. Integration-level: `exportSWF(doc)` with SymbolInstances at known positions
 *    produces PlaceObject2 tags (tag code 26) whose MATRIX records contain the
 *    expected TranslateX/TranslateY twip values.
 *
 * SWF MATRIX record format (bit-packed, MSB-first):
 *   UB[1] HasScale
 *     if HasScale: UB[5] Nbits, SB[Nbits] ScaleX, SB[Nbits] ScaleY (16.16 fixed)
 *   UB[1] HasRotate
 *     if HasRotate: UB[5] Nbits, SB[Nbits] RotateSkew0, SB[Nbits] RotateSkew1
 *   UB[5] TranslateBits  (always present)
 *   SB[TranslateBits] TranslateX  (twips)
 *   SB[TranslateBits] TranslateY  (twips)
 *
 * PlaceObject2 tag body layout:
 *   [0]    flags UI8
 *   [1..2] depth UI16LE
 *   [3..4] charId UI16LE  (when HasCharacter flag set)
 *   [5..]  MATRIX (bit-packed)
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject2 } from "../shapes.js";
import { exportSWF } from "../export.js";
import type { FlashDocument, Frame, Layer, Scene, Symbol, SymbolInstance } from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal bit reader (MSB-first, matches SWF bit-packing convention)
// ---------------------------------------------------------------------------

class BitReader {
  private bytes: Uint8Array;
  private bytePos: number;
  private bitPos: number; // current bit index within byte (0 = MSB)

  constructor(bytes: Uint8Array, startByte: number) {
    this.bytes = bytes;
    this.bytePos = startByte;
    this.bitPos = 0;
  }

  readUB(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.bytePos] ?? 0;
      const bit = (byte >>> (7 - this.bitPos)) & 1;
      result = (result << 1) | bit;
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }
    return result;
  }

  readSB(n: number): number {
    const raw = this.readUB(n);
    if (n > 0 && (raw >>> (n - 1)) & 1) {
      return raw - (1 << n);
    }
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Decode the MATRIX from a PlaceObject2 tag body.
//
// Standard PlaceObject2 body layout (with HasCharacter and HasMatrix flags):
//   byte 0:    flags (1 byte)
//   bytes 1-2: depth (UI16LE)
//   bytes 3-4: charId (UI16LE)  — present when HasCharacter bit is set
//   bytes 5+:  MATRIX (bit-packed)
// ---------------------------------------------------------------------------

interface DecodedMatrix {
  hasScale: boolean;
  scaleX: number;
  scaleY: number;
  hasRotate: boolean;
  skewX: number;
  skewY: number;
  translateX: number; // twips
  translateY: number; // twips
}

/**
 * Decode the MATRIX record starting at a given byte offset in the tag body.
 * For a standard PlaceObject2 with HasCharacter | HasMatrix flags, the MATRIX
 * starts at byte 5 (after 1-byte flags + 2-byte depth + 2-byte charId).
 */
function decodeMatrix(body: Uint8Array, matrixByteOffset = 5): DecodedMatrix {
  const br = new BitReader(body, matrixByteOffset);

  const hasScale = br.readUB(1) === 1;
  let scaleX = 65536; // 1.0 in 16.16 fixed-point
  let scaleY = 65536;
  if (hasScale) {
    const nBits = br.readUB(5);
    scaleX = br.readSB(nBits);
    scaleY = br.readSB(nBits);
  }

  const hasRotate = br.readUB(1) === 1;
  let skewX = 0;
  let skewY = 0;
  if (hasRotate) {
    const nBits = br.readUB(5);
    skewX = br.readSB(nBits);
    skewY = br.readSB(nBits);
  }

  const nTranslBits = br.readUB(5);
  const translateX = br.readSB(nTranslBits);
  const translateY = br.readSB(nTranslBits);

  return { hasScale, scaleX, scaleY, hasRotate, skewX, skewY, translateX, translateY };
}

// ---------------------------------------------------------------------------
// SWF binary parser (minimal — only for tag stream extraction)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

/**
 * Parse SWF header and return the offset of the tag stream.
 * Handles the variable-length bit-packed RECT in the header.
 */
function getTagStreamOffset(bytes: Uint8Array): number {
  // SWF header: 3-byte signature + 1-byte version + 4-byte fileLength = 8 bytes
  // Then RECT (bit-packed), then 2-byte FrameRate + 2-byte FrameCount
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++]!;
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

  // Flush to next byte boundary, then skip FrameRate (2) + FrameCount (2)
  return byteOff + 4;
}

/**
 * Extract all SWF tags from a compiled SWF byte array.
 */
function parseSWFTags(bytes: Uint8Array): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = getTagStreamOffset(bytes);

  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos]! | (bytes[pos + 1]! << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;

    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2]! |
        (bytes[pos + 3]! << 8) |
        (bytes[pos + 4]! << 16) |
        (bytes[pos + 5]! << 24);
      hdrSize = 6;
    }

    const bodyStart = pos + hdrSize;
    tags.push({ code: tagCode, body: bytes.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;

    if (tagCode === 0) break; // End tag
  }

  return tags;
}

const TAG_PLACE_OBJECT2 = 26;

// ---------------------------------------------------------------------------
// Document fixture helpers
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

function makeEmptyFrame(displayObjects: readonly SymbolInstance[] = []): Frame {
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

function makeScene(frames: Frame[]): Scene {
  return {
    id: "scene-1",
    name: "Scene 1",
    timeline: { layers: [makeLayer(frames)] },
  };
}

function makeSymbol(id: string, name: string): Symbol {
  return {
    id,
    name,
    itemType: "symbol",
    symbolType: "movieclip",
    timeline: { layers: [makeLayer([makeEmptyFrame()])] },
    linkage: DEFAULT_LINKAGE,
    scale9Grid: null,
  };
}

function makeInstance(id: string, symbolId: string, x: number, y: number): SymbolInstance {
  return { id, type: "instance", symbolId, x, y };
}

function makeDoc(symbolId: string, symbolName: string, instance: SymbolInstance): FlashDocument {
  const sym = makeSymbol(symbolId, symbolName);
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeEmptyFrame([instance])])],
    library: { items: [sym], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Unit tests: encodePlaceObject2 MATRIX encoding
// ---------------------------------------------------------------------------

describe("PlaceObject2 — unit: encodePlaceObject2 MATRIX encoding", () => {
  it("symbol at (0, 0): TranslateX=0, TranslateY=0 twips", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    const m = decodeMatrix(body);
    expect(m.translateX).toBe(0);
    expect(m.translateY).toBe(0);
  });

  it("symbol at (100, 50): TranslateX=2000 twips, TranslateY=1000 twips", () => {
    const body = encodePlaceObject2(1, 1, 100, 50);
    const m = decodeMatrix(body);
    expect(m.translateX).toBe(100 * 20); // 2000 twips
    expect(m.translateY).toBe(50 * 20);  // 1000 twips
  });

  it("symbol at (0, 0): hasScale=false (identity scale omitted)", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    const m = decodeMatrix(body);
    expect(m.hasScale).toBe(false);
  });

  it("symbol at (0, 0): hasRotate=false (no rotation)", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    const m = decodeMatrix(body);
    expect(m.hasRotate).toBe(false);
  });

  it("depth is encoded as UI16LE at bytes 1-2 of the tag body", () => {
    const depth = 7;
    const body = encodePlaceObject2(1, depth, 0, 0);
    const encodedDepth = body[1]! | (body[2]! << 8);
    expect(encodedDepth).toBe(depth);
  });

  it("charId is encoded as UI16LE at bytes 3-4 of the tag body", () => {
    const charId = 42;
    const body = encodePlaceObject2(charId, 1, 0, 0);
    const encodedCharId = body[3]! | (body[4]! << 8);
    expect(encodedCharId).toBe(charId);
  });

  it("HasCharacter and HasMatrix flags are set (flags byte = 0x06)", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    // bit 1 = HasCharacter (0x02), bit 2 = HasMatrix (0x04) → 0x06
    expect(body[0]).toBe(0x06);
  });

  it("negative translation: (-10, -5) → TranslateX=-200, TranslateY=-100", () => {
    const body = encodePlaceObject2(1, 1, -10, -5);
    const m = decodeMatrix(body);
    expect(m.translateX).toBe(-10 * 20); // -200
    expect(m.translateY).toBe(-5 * 20);  // -100
  });

  it("large translation (500, 300): TranslateX=10000, TranslateY=6000 twips", () => {
    const body = encodePlaceObject2(1, 1, 500, 300);
    const m = decodeMatrix(body);
    expect(m.translateX).toBe(500 * 20); // 10000
    expect(m.translateY).toBe(300 * 20); // 6000
  });

  it("tag body is at least 6 bytes (5-byte header + at least 1 byte of MATRIX)", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    expect(body.length).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: exportSWF produces PlaceObject2 tags with correct MATRIX
// ---------------------------------------------------------------------------

describe("PlaceObject2 — integration: exportSWF MATRIX encoding", () => {
  it("symbol instance at (0, 0) produces a PlaceObject2 tag", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = parseSWFTags(bytes);
    const po2Tags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    expect(po2Tags.length).toBeGreaterThan(0);
  });

  it("symbol at (0, 0): PlaceObject2 MATRIX has TranslateX=0, TranslateY=0", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = parseSWFTags(bytes);

    // Find the PlaceObject2 tag that places the instance (HasCharacter bit set)
    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tag).toBeDefined();

    const m = decodeMatrix(po2Tag!.body);
    expect(m.translateX).toBe(0);
    expect(m.translateY).toBe(0);
  });

  it("symbol at (100, 50): PlaceObject2 MATRIX has TranslateX=2000, TranslateY=1000 twips", () => {
    const inst = makeInstance("inst-1", "sym-1", 100, 50);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = parseSWFTags(bytes);

    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tag).toBeDefined();

    const m = decodeMatrix(po2Tag!.body);
    expect(m.translateX).toBe(100 * 20); // 2000 twips
    expect(m.translateY).toBe(50 * 20);  // 1000 twips
  });

  it("symbol at (200, 150): MATRIX has TranslateX=4000, TranslateY=3000 twips", () => {
    const inst = makeInstance("inst-1", "sym-1", 200, 150);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = parseSWFTags(bytes);

    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tag).toBeDefined();

    const m = decodeMatrix(po2Tag!.body);
    expect(m.translateX).toBe(200 * 20); // 4000 twips
    expect(m.translateY).toBe(150 * 20); // 3000 twips
  });

  it("PlaceObject2 tag for instance at (0, 0) has no scale (identity)", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = parseSWFTags(bytes);

    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tag).toBeDefined();

    const m = decodeMatrix(po2Tag!.body);
    expect(m.hasScale).toBe(false);
    expect(m.hasRotate).toBe(false);
  });

  it("PlaceObject2 depth is encoded correctly: first instance uses depth ≥ 1", () => {
    const inst = makeInstance("inst-1", "sym-1", 0, 0);
    const doc = makeDoc("sym-1", "MyClip", inst);
    const bytes = exportSWF(doc, { compress: false });
    const tags = parseSWFTags(bytes);

    const po2Tag = tags.find(
      (t) => t.code === TAG_PLACE_OBJECT2 && (t.body[0]! & 0x02) !== 0
    );
    expect(po2Tag).toBeDefined();

    // Depth is UI16LE at bytes 1-2
    const depth = po2Tag!.body[1]! | (po2Tag!.body[2]! << 8);
    expect(depth).toBeGreaterThanOrEqual(1);
  });
});
