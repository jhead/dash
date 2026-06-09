/**
 * Tests for DefineMorphShape (tag 46) fill style encoding.
 *
 * Tests:
 * 1. Fill style count byte is present after the RECT headers
 * 2. Start fill (solid color RGBA) is encoded in the fill style record
 * 3. End fill (different color RGBA) is encoded immediately after start fill
 * 4. Fill type byte (0x00 = solid) is present in MorphFillStyle records
 */

import { describe, it, expect } from "vitest";
import { encodeDefineMorphShape } from "../morphshape.js";
import type { ShapePath } from "@flash/core";

// ---------------------------------------------------------------------------
// Binary helpers
// ---------------------------------------------------------------------------

/**
 * Read a bit-packed RECT from bytes starting at byteOffset.
 * Returns the number of bytes consumed.
 */
function skipRect(bytes: Uint8Array, byteOffset: number): number {
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

  const nBits = readBits(5);
  readBits(nBits); // xMin
  readBits(nBits); // xMax
  readBits(nBits); // yMin
  readBits(nBits); // yMax

  // Align to byte boundary
  return byteOff - byteOffset;
}

/**
 * Find the byte offset of the MORPHFILLSTYLEARRAY in an encodeDefineMorphShape body.
 *
 * Layout:
 *   [0..1]  CharacterId (UI16LE)
 *   [2..]   StartBounds (RECT)
 *   [..]    EndBounds (RECT)
 *   [..]    Offset (UI32LE, 4 bytes)
 *   [..]    MORPHFILLSTYLEARRAY  ← we want this offset
 */
function fillArrayOffset(body: Uint8Array): number {
  let off = 2; // skip charId
  off += skipRect(body, off); // skip StartBounds
  off += skipRect(body, off); // skip EndBounds
  off += 4; // skip Offset (UI32LE)
  return off;
}

// ---------------------------------------------------------------------------
// Shape path helpers
// ---------------------------------------------------------------------------

function makeRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  color: { r: number; g: number; b: number; a: number }
): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x, y: y + h } },
    ],
    closed: true,
    fill: { type: "solid", color },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineMorphShape fill style encoding", () => {
  const RED = { r: 255, g: 0, b: 0, a: 255 };
  const BLUE = { r: 0, g: 0, b: 255, a: 200 };

  const startPaths = [makeRectPath(0, 0, 50, 50, RED)];
  const endPaths = [makeRectPath(0, 0, 100, 100, BLUE)];

  // -------------------------------------------------------------------------
  // Test 1: Fill style count byte equals 1 for a single-path shape
  // -------------------------------------------------------------------------

  it("fill style count byte is 1 for a single-path shape", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const off = fillArrayOffset(body);
    // First byte of MORPHFILLSTYLEARRAY is the fill count (UI8 when < 0xff)
    const fillCount = body[off];
    expect(fillCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: Fill style count is 2 for a two-path shape
  // -------------------------------------------------------------------------

  it("fill style count byte is 2 for a two-path shape", () => {
    const GREEN = { r: 0, g: 255, b: 0, a: 255 };
    const YELLOW = { r: 255, g: 255, b: 0, a: 255 };
    const start2 = [
      makeRectPath(0, 0, 50, 50, RED),
      makeRectPath(60, 0, 50, 50, GREEN),
    ];
    const end2 = [
      makeRectPath(0, 0, 100, 100, BLUE),
      makeRectPath(60, 0, 100, 100, YELLOW),
    ];
    const body = encodeDefineMorphShape(1, start2, end2);
    const off = fillArrayOffset(body);
    expect(body[off]).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 3: Fill type byte (0x00 = solid MorphFillStyle) is present
  // -------------------------------------------------------------------------

  it("fill type byte 0x00 (solid) is at offset fillArray+1", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const off = fillArrayOffset(body);
    // off+0 = count (1)
    // off+1 = MorphFillStyle type byte (0x00 = solid)
    expect(body[off + 1]).toBe(0x00);
  });

  // -------------------------------------------------------------------------
  // Test 4: Start fill RGBA is encoded after the type byte
  // -------------------------------------------------------------------------

  it("start fill color RGBA is encoded at fillArray+2..+5", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const off = fillArrayOffset(body);
    // Layout: [off+0]=count [off+1]=type [off+2..+5]=startRGBA [off+6..+9]=endRGBA
    expect(body[off + 2]).toBe(RED.r); // R
    expect(body[off + 3]).toBe(RED.g); // G
    expect(body[off + 4]).toBe(RED.b); // B
    expect(body[off + 5]).toBe(RED.a); // A
  });

  // -------------------------------------------------------------------------
  // Test 5: End fill RGBA is encoded after start fill RGBA
  // -------------------------------------------------------------------------

  it("end fill color RGBA is encoded at fillArray+6..+9", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const off = fillArrayOffset(body);
    expect(body[off + 6]).toBe(BLUE.r); // R
    expect(body[off + 7]).toBe(BLUE.g); // G
    expect(body[off + 8]).toBe(BLUE.b); // B
    expect(body[off + 9]).toBe(BLUE.a); // A
  });

  // -------------------------------------------------------------------------
  // Test 6: Start and end fills are distinct when colors differ
  // -------------------------------------------------------------------------

  it("start fill and end fill encode different colors", () => {
    const body = encodeDefineMorphShape(1, startPaths, endPaths);
    const off = fillArrayOffset(body);
    const startR = body[off + 2];
    const endR = body[off + 6];
    // RED.r=255 vs BLUE.r=0 — they must differ
    expect(startR).not.toBe(endR);
  });

  // -------------------------------------------------------------------------
  // Test 7: When start and end colors are the same, both halves are identical
  // -------------------------------------------------------------------------

  it("encodes identical start/end colors when colors match", () => {
    const sameColorPaths = [makeRectPath(0, 0, 50, 50, RED)];
    const sameColorEndPaths = [makeRectPath(0, 0, 100, 100, RED)];
    const body = encodeDefineMorphShape(1, sameColorPaths, sameColorEndPaths);
    const off = fillArrayOffset(body);
    // start RGBA should equal end RGBA
    for (let i = 0; i < 4; i++) {
      expect(body[off + 2 + i]).toBe(body[off + 6 + i]);
    }
  });

  // -------------------------------------------------------------------------
  // Test 8: Fill count byte is 0 when paths have no fill
  // -------------------------------------------------------------------------

  it("fill count byte is 0 for paths without fill", () => {
    const noFillPaths: ShapePath[] = [
      {
        start: { x: 0, y: 0 },
        segments: [{ type: "line", to: { x: 50, y: 0 } }],
        closed: false,
        fill: undefined,
      },
    ];
    const body = encodeDefineMorphShape(1, noFillPaths, noFillPaths);
    const off = fillArrayOffset(body);
    expect(body[off]).toBe(0);
  });
});
