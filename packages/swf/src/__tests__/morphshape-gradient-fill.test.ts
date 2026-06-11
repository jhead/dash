/**
 * Tests for DefineMorphShape2 (tag 84) gradient and bitmap fill encoding.
 *
 * Verifies:
 * 1. Linear gradient fill produces type byte 0x10 in MORPHFILLSTYLEARRAY
 * 2. Radial gradient fill produces type byte 0x12
 * 3. Focal radial gradient fill produces type byte 0x13
 * 4. Bitmap fill produces type byte 0x40/0x41/0x42/0x43 followed by bitmapId UI16
 * 5. Gradient fill count byte reflects gradient paths
 * 6. Solid fill still encodes correctly (regression)
 * 7. Mixed solid + gradient paths produce correct fill count
 */

import { describe, it, expect } from "vitest";
import { encodeDefineMorphShape2 } from "../morphshape.js";
import type { ShapePath, LinearGradientFill, RadialGradientFill, BitmapFill } from "@flash/core";

// ---------------------------------------------------------------------------
// Binary reader helpers
// ---------------------------------------------------------------------------

/**
 * Skip a bit-packed RECT from a byte array.
 * Returns the number of bytes consumed (rounded up to byte boundary).
 */
function skipRect(bytes: Uint8Array, startOffset: number): number {
  let byteOff = startOffset;
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

  return byteOff - startOffset;
}

/**
 * Find the byte offset of the MORPHFILLSTYLEARRAY in a DefineMorphShape2 body.
 *
 * Layout:
 *   [0..1]  CharacterId (UI16LE)
 *   [2..]   StartBounds (RECT)
 *   [..]    EndBounds (RECT)
 *   [..]    StartEdgeBounds (RECT)  ← extra in tag 84
 *   [..]    EndEdgeBounds (RECT)    ← extra in tag 84
 *   [..]    Flags UI8
 *   [..]    Offset (UI32LE, 4 bytes)
 *   [..]    MORPHFILLSTYLEARRAY  ← we want this offset
 */
function fillArrayOffset2(body: Uint8Array): number {
  let off = 2; // skip charId
  off += skipRect(body, off); // StartBounds
  off += skipRect(body, off); // EndBounds
  off += skipRect(body, off); // StartEdgeBounds (tag 84 extra)
  off += skipRect(body, off); // EndEdgeBounds   (tag 84 extra)
  off += 1; // Flags UI8
  off += 4; // Offset UI32LE
  return off;
}

// ---------------------------------------------------------------------------
// Shape path builders
// ---------------------------------------------------------------------------

function makeRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  fill?: ShapePath["fill"]
): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x, y: y + h } },
    ],
    closed: true,
    fill,
  };
}

const SOLID_RED = { type: "solid" as const, color: { r: 255, g: 0, b: 0, a: 255 } };

const LINEAR_GRADIENT: LinearGradientFill = {
  type: "linear-gradient",
  angle: 0,
  stops: [
    { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
    { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
  ],
};

const RADIAL_GRADIENT: RadialGradientFill = {
  type: "radial-gradient",
  focalPoint: 0,
  stops: [
    { ratio: 0, color: { r: 0, g: 255, b: 0, a: 255 } },
    { ratio: 255, color: { r: 0, g: 0, b: 0, a: 255 } },
  ],
};

const FOCAL_GRADIENT: RadialGradientFill = {
  type: "radial-gradient",
  focalPoint: 0.5,
  stops: [
    { ratio: 0, color: { r: 255, g: 255, b: 0, a: 255 } },
    { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
  ],
};

const BITMAP_FILL: BitmapFill = {
  type: "bitmap",
  bitmapId: "bitmap-1",
  repeat: false,
  smooth: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefineMorphShape2 gradient and bitmap fill encoding", () => {
  // -------------------------------------------------------------------------
  // Test 1: Linear gradient fill → type byte 0x10
  // -------------------------------------------------------------------------

  it("linear gradient fill produces fill type byte 0x10", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, LINEAR_GRADIENT)];
    const endPaths = [makeRectPath(0, 0, 150, 150, LINEAR_GRADIENT)];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    // Fill count should be 1
    expect(body[off]).toBe(1);
    // Fill type byte: 0x10 = linear gradient
    expect(body[off + 1]).toBe(0x10);
  });

  // -------------------------------------------------------------------------
  // Test 2: Radial gradient fill → type byte 0x12
  // -------------------------------------------------------------------------

  it("radial gradient fill produces fill type byte 0x12", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, RADIAL_GRADIENT)];
    const endPaths = [makeRectPath(0, 0, 150, 150, RADIAL_GRADIENT)];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    expect(body[off]).toBe(1);
    expect(body[off + 1]).toBe(0x12);
  });

  // -------------------------------------------------------------------------
  // Test 3: Focal radial gradient fill → type byte 0x13
  // -------------------------------------------------------------------------

  it("focal radial gradient fill produces fill type byte 0x13", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, FOCAL_GRADIENT)];
    const endPaths = [makeRectPath(0, 0, 150, 150, FOCAL_GRADIENT)];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    expect(body[off]).toBe(1);
    expect(body[off + 1]).toBe(0x13);
  });

  // -------------------------------------------------------------------------
  // Test 4: Bitmap fill → type byte 0x43 (clipped, no smoothing)
  // -------------------------------------------------------------------------

  it("bitmap fill (clipped, no smoothing) produces fill type byte 0x43", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, BITMAP_FILL)];
    const endPaths = [makeRectPath(0, 0, 150, 150, BITMAP_FILL)];

    const bitmapCharIdMap = new Map<string, number>([["bitmap-1", 42]]);
    const body = encodeDefineMorphShape2(1, startPaths, endPaths, null, null, bitmapCharIdMap);
    const off = fillArrayOffset2(body);

    expect(body[off]).toBe(1);
    expect(body[off + 1]).toBe(0x43); // clipped, no smoothing
  });

  // -------------------------------------------------------------------------
  // Test 5: Bitmap fill bitmapId is written as UI16 after type byte
  // -------------------------------------------------------------------------

  it("bitmap fill encodes bitmapCharId as UI16LE after the type byte", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, BITMAP_FILL)];
    const endPaths = [makeRectPath(0, 0, 150, 150, BITMAP_FILL)];

    const bitmapCharIdMap = new Map<string, number>([["bitmap-1", 42]]);
    const body = encodeDefineMorphShape2(1, startPaths, endPaths, null, null, bitmapCharIdMap);
    const off = fillArrayOffset2(body);

    // off+0 = count, off+1 = type byte (0x41), off+2..+3 = bitmapId UI16LE
    const bitmapId = body[off + 2] | (body[off + 3] << 8);
    expect(bitmapId).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Test 6: Bitmap fill with unknown bitmapId uses 0xffff placeholder
  // -------------------------------------------------------------------------

  it("bitmap fill with no bitmapCharIdMap uses 0xffff for bitmapId", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, BITMAP_FILL)];
    const endPaths = [makeRectPath(0, 0, 150, 150, BITMAP_FILL)];

    // No bitmapCharIdMap provided
    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    const bitmapId = body[off + 2] | (body[off + 3] << 8);
    expect(bitmapId).toBe(0xffff);
  });

  // -------------------------------------------------------------------------
  // Test 7: Fill count reflects gradient fills (not dropped as 0)
  // -------------------------------------------------------------------------

  it("gradient paths produce non-zero fill count (not silently dropped)", () => {
    const startPaths = [makeRectPath(0, 0, 100, 100, LINEAR_GRADIENT)];
    const endPaths = [makeRectPath(0, 0, 200, 200, LINEAR_GRADIENT)];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    // Fill count must NOT be 0 (the previous bug was to produce 0 here)
    expect(body[off]).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 8: Solid fill still encodes correctly (regression)
  // -------------------------------------------------------------------------

  it("solid fill still encodes type 0x00 and RGBA correctly", () => {
    const startPaths = [makeRectPath(0, 0, 50, 50, SOLID_RED)];
    const endPaths = [makeRectPath(0, 0, 100, 100, SOLID_RED)];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    expect(body[off]).toBe(1);       // count = 1
    expect(body[off + 1]).toBe(0x00); // solid type
    // Start RGBA = red
    expect(body[off + 2]).toBe(255);  // R
    expect(body[off + 3]).toBe(0);    // G
    expect(body[off + 4]).toBe(0);    // B
    expect(body[off + 5]).toBe(255);  // A
  });

  // -------------------------------------------------------------------------
  // Test 9: Mixed solid + gradient paths → fill count = 2
  // -------------------------------------------------------------------------

  it("two paths (solid + gradient) produce fill count of 2", () => {
    const startPaths = [
      makeRectPath(0, 0, 50, 50, SOLID_RED),
      makeRectPath(60, 0, 50, 50, LINEAR_GRADIENT),
    ];
    const endPaths = [
      makeRectPath(0, 0, 100, 100, SOLID_RED),
      makeRectPath(60, 0, 100, 100, LINEAR_GRADIENT),
    ];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    expect(body[off]).toBe(2);
    // First fill should be solid (0x00)
    expect(body[off + 1]).toBe(0x00);
  });

  // -------------------------------------------------------------------------
  // Test 10: Bitmap fill with repeat+smooth → type byte 0x40
  // -------------------------------------------------------------------------

  it("bitmap fill with repeat=true and smooth=true produces type byte 0x40", () => {
    const smoothRepeatBitmap: BitmapFill = {
      type: "bitmap",
      bitmapId: "bitmap-2",
      repeat: true,
      smooth: true,
    };
    const startPaths = [makeRectPath(0, 0, 100, 100, smoothRepeatBitmap)];
    const endPaths = [makeRectPath(0, 0, 150, 150, smoothRepeatBitmap)];

    const body = encodeDefineMorphShape2(1, startPaths, endPaths);
    const off = fillArrayOffset2(body);

    expect(body[off + 1]).toBe(0x40); // repeating, smoothed
  });

  // -------------------------------------------------------------------------
  // Test 11: Output does not throw for any fill type
  // -------------------------------------------------------------------------

  it("encodeDefineMorphShape2 does not throw for gradient fills", () => {
    const fills = [LINEAR_GRADIENT, RADIAL_GRADIENT, FOCAL_GRADIENT, BITMAP_FILL];
    for (const fill of fills) {
      const startPaths = [makeRectPath(0, 0, 100, 100, fill)];
      const endPaths = [makeRectPath(0, 0, 150, 150, fill)];
      expect(() => encodeDefineMorphShape2(1, startPaths, endPaths)).not.toThrow();
    }
  });
});
