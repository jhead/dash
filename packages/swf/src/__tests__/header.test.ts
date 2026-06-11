/**
 * Tests for the SWF binary file header.
 *
 * SWF v8 header layout:
 *   bytes 0-2: signature "FWS" = [0x46, 0x57, 0x53] (uncompressed)
 *   byte  3:   version byte = 0x08 (Flash 8)
 *   bytes 4-7: file length as uint32 LE (equals total byte array length)
 *   bytes 8+:  RECT (frame size in TWIPS, bit-packed)
 *              then FrameRate as uint16 LE (fps * 256)
 *              then FrameCount as uint16 LE
 *
 * RECT encoding (SWF spec):
 *   UB[5] Nbits, SB[Nbits] Xmin, SB[Nbits] Xmax, SB[Nbits] Ymin, SB[Nbits] Ymax
 *   1 pixel = 20 twips
 *
 * The RECT is bit-packed and byte-aligned (padded to a byte boundary).
 * Total RECT bits = 5 + 4 * Nbits.
 * The first 5 bits of byte 8 give Nbits (shift right by 3 to read them).
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Document factory helpers
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

function makeBlankFrame(index: number): Frame {
  return {
    index,
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

function makeLayer(id: string, frameCount: number): Layer {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push(makeBlankFrame(i));
  }
  return {
    id,
    name: id,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount,
  };
}

function makeScene(id: string, name: string, frameCount = 1): Scene {
  return {
    id,
    name,
    timeline: {
      layers: [makeLayer(`${id}-layer`, frameCount)],
    },
  };
}

function makeDoc(
  scenes: Scene[],
  overrides: Partial<typeof BASE_PROPS> = {}
): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS, ...overrides },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// RECT parser helper
// ---------------------------------------------------------------------------

/**
 * Read a SWF RECT structure from a byte array at the given byte offset.
 * Returns { xMin, xMax, yMin, yMax, byteLength }.
 *
 * Format: UB[5] Nbits, SB[Nbits] Xmin, SB[Nbits] Xmax, SB[Nbits] Ymin, SB[Nbits] Ymax
 * Then padded to the next byte boundary.
 */
function parseRect(
  data: Uint8Array,
  byteOffset: number
): { xMin: number; xMax: number; yMin: number; yMax: number; byteLength: number } {
  // Read bits from the data starting at byteOffset
  function readBit(bitIndex: number): number {
    const byte = data[byteOffset + Math.floor(bitIndex / 8)];
    const shift = 7 - (bitIndex % 8);
    return (byte >> shift) & 1;
  }

  function readUB(start: number, n: number): number {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | readBit(start + i);
    }
    return val;
  }

  function readSB(start: number, n: number): number {
    const raw = readUB(start, n);
    // Sign-extend: if high bit is set, it's negative
    if (n > 0 && (raw >> (n - 1)) & 1) {
      return raw - (1 << n);
    }
    return raw;
  }

  const nBits = readUB(0, 5);
  const xMin = readSB(5, nBits);
  const xMax = readSB(5 + nBits, nBits);
  const yMin = readSB(5 + 2 * nBits, nBits);
  const yMax = readSB(5 + 3 * nBits, nBits);

  const totalBits = 5 + 4 * nBits;
  const byteLength = Math.ceil(totalBits / 8);

  return { xMin, xMax, yMin, yMax, byteLength };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF binary header", () => {
  it('bytes 0-2 are "FWS" signature [0x46, 0x57, 0x53]', () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    expect(buf[0]).toBe(0x46); // 'F'
    expect(buf[1]).toBe(0x57); // 'W'
    expect(buf[2]).toBe(0x53); // 'S'
  });

  it("byte 3 is version byte 0x08 (Flash 8)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    expect(buf[3]).toBe(0x08);
  });

  it("bytes 4-7 (uint32 LE) equal the total byte length of the SWF", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const fileLength = new DataView(buf.buffer).getUint32(4, true);
    expect(fileLength).toBe(buf.length);
  });

  it("file length field matches actual output for a multi-frame doc", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 5)]);
    const buf = compileDocument(doc);
    const fileLength = new DataView(buf.buffer).getUint32(4, true);
    expect(fileLength).toBe(buf.length);
  });

  it("RECT at offset 8: a 550×400 doc has Xmax=11000 twips and Ymax=8000 twips", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], {
      width: 550,
      height: 400,
    });
    const buf = compileDocument(doc);
    const rect = parseRect(buf, 8);
    expect(rect.xMin).toBe(0);
    expect(rect.xMax).toBe(11000); // 550 * 20
    expect(rect.yMin).toBe(0);
    expect(rect.yMax).toBe(8000); // 400 * 20
  });

  it("RECT values for a 320×240 doc: Xmax=6400 twips, Ymax=4800 twips", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], {
      width: 320,
      height: 240,
    });
    const buf = compileDocument(doc);
    const rect = parseRect(buf, 8);
    expect(rect.xMin).toBe(0);
    expect(rect.xMax).toBe(6400); // 320 * 20
    expect(rect.yMin).toBe(0);
    expect(rect.yMax).toBe(4800); // 240 * 20
  });

  it("FrameRate field encodes fps*256 as uint16 LE after the RECT (12fps → 3072)", () => {
    // 12 fps → Math.round(12 * 256) = 3072 = 0x0C00
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], { frameRate: 12 });
    const buf = compileDocument(doc);

    // Find where RECT ends to locate the FrameRate field
    const rect = parseRect(buf, 8);
    const frameRateOffset = 8 + rect.byteLength;

    const frameRateRaw = new DataView(buf.buffer).getUint16(frameRateOffset, true);
    expect(frameRateRaw).toBe(12 * 256); // 3072
  });

  it("FrameRate field encodes 24fps → 6144 (0x1800)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], { frameRate: 24 });
    const buf = compileDocument(doc);

    const rect = parseRect(buf, 8);
    const frameRateOffset = 8 + rect.byteLength;
    const frameRateRaw = new DataView(buf.buffer).getUint16(frameRateOffset, true);
    expect(frameRateRaw).toBe(24 * 256); // 6144
  });

  it("FrameCount field (uint16 LE after FrameRate) equals the number of frames in the doc", () => {
    const frameCount = 7;
    const doc = makeDoc([makeScene("s1", "Scene 1", frameCount)]);
    const buf = compileDocument(doc);

    const rect = parseRect(buf, 8);
    const frameRateOffset = 8 + rect.byteLength;
    const frameCountOffset = frameRateOffset + 2;

    const encodedFrameCount = new DataView(buf.buffer).getUint16(frameCountOffset, true);
    expect(encodedFrameCount).toBe(frameCount);
  });

  it("FrameCount sums frames across multiple scenes", () => {
    // 3 frames in scene 1 + 2 frames in scene 2 = 5 total frames
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 2),
    ]);
    const buf = compileDocument(doc);

    const rect = parseRect(buf, 8);
    const frameRateOffset = 8 + rect.byteLength;
    const frameCountOffset = frameRateOffset + 2;

    const encodedFrameCount = new DataView(buf.buffer).getUint16(frameCountOffset, true);
    expect(encodedFrameCount).toBe(5);
  });
});
