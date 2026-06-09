/**
 * Tests for SWF MATRIX bit-packed encoding accuracy.
 *
 * SWF MATRIX format (all fields bit-packed, MSB-first):
 *   UB[1] HasScale
 *     if HasScale: UB[5] Nbits, SB[Nbits] ScaleX, SB[Nbits] ScaleY   (16.16 fixed-point)
 *   UB[1] HasRotate
 *     if HasRotate: UB[5] Nbits, SB[Nbits] SkewX, SB[Nbits] SkewY    (16.16 fixed-point)
 *   UB[5] TranslateBits  (UNCONDITIONAL — no HasTranslate flag)
 *   SB[TranslateBits] TranslateX  (twips = px * 20)
 *   SB[TranslateBits] TranslateY
 *
 * The tests use `encodePlaceObject2` as the source of the bit-packed MATRIX
 * (the MATRIX starts at byte offset 5, after the 1-byte flags, 2-byte depth,
 * and 2-byte charId).
 *
 * A minimal bit reader is included to decode the packed fields without
 * depending on an external parser.
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject2 } from "../shapes.js";
import { toSWFMatrix, identity, translation, scaling, rotationMatrix } from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal bit reader (MSB-first, matches SWF bit-packing convention)
// ---------------------------------------------------------------------------

class BitReader {
  private bytes: Uint8Array;
  private bytePos: number;
  private bitPos: number; // current bit index within the current byte (0=MSB)

  constructor(bytes: Uint8Array, startByte: number) {
    this.bytes = bytes;
    this.bytePos = startByte;
    this.bitPos = 0;
  }

  /** Read `n` unsigned bits (MSB first). */
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

  /** Read `n` signed bits (MSB first, two's-complement). */
  readSB(n: number): number {
    const raw = this.readUB(n);
    // Sign-extend: if the top bit is set, value is negative
    if (n > 0 && (raw >>> (n - 1)) & 1) {
      return raw - (1 << n);
    }
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Helper: decode the MATRIX from a PlaceObject2 tag body.
//
// PlaceObject2 layout (bytes 0..4 are fixed header before MATRIX):
//   [0]    flags (1 byte)
//   [1..2] depth (UI16LE)
//   [3..4] charId (UI16LE)
//   [5..]  MATRIX (bit-packed)
// ---------------------------------------------------------------------------

interface DecodedMatrix {
  hasScale: boolean;
  scaleX: number;   // 16.16 fixed-point integer
  scaleY: number;
  hasRotate: boolean;
  skewX: number;    // 16.16 fixed-point integer (rotateSkew0 = b)
  skewY: number;    // 16.16 fixed-point integer (rotateSkew1 = c)
  translateX: number; // twips
  translateY: number;
}

function decodeMatrix(bytes: Uint8Array): DecodedMatrix {
  // MATRIX starts at byte 5 in a standard PlaceObject2 body
  const br = new BitReader(bytes, 5);

  const hasScale = br.readUB(1) === 1;
  let scaleX = 65536; // 1.0 in 16.16
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
// Tests
// ---------------------------------------------------------------------------

describe("SWF MATRIX encoding", () => {

  // 1. Identity matrix
  it("1. identity matrix (no scale, no rotate, no translate) encodes without error", () => {
    let bytes: Uint8Array | undefined;
    expect(() => {
      bytes = encodePlaceObject2(1, 1, 0, 0);
    }).not.toThrow();
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(5);
  });

  it("1b. identity matrix decodes: hasScale=false, hasRotate=false, translate=0,0", () => {
    const bytes = encodePlaceObject2(1, 1, 0, 0);
    const m = decodeMatrix(bytes);
    expect(m.hasScale).toBe(false);
    expect(m.hasRotate).toBe(false);
    expect(m.translateX).toBe(0);
    expect(m.translateY).toBe(0);
  });

  // 2. Translation-only
  it("2. translation-only: TranslateX/Y encoded as twips (px * 20)", () => {
    // x=10px, y=5px → translateX=200 twips, translateY=100 twips
    const bytes = encodePlaceObject2(1, 1, 10, 5);
    const m = decodeMatrix(bytes);
    expect(m.hasScale).toBe(false);
    expect(m.hasRotate).toBe(false);
    expect(m.translateX).toBe(200); // 10 * 20
    expect(m.translateY).toBe(100); // 5 * 20
  });

  it("2b. negative translation encodes correctly", () => {
    const bytes = encodePlaceObject2(1, 1, -3, -7);
    const m = decodeMatrix(bytes);
    expect(m.translateX).toBe(-60);  // -3 * 20
    expect(m.translateY).toBe(-140); // -7 * 20
  });

  // 3. Scale 2x
  it("3. scale 2x: ScaleX = ScaleY = 2 * 65536 = 131072", () => {
    const bytes = encodePlaceObject2(1, 1, 0, 0, { scaleX: 2, scaleY: 2 });
    const m = decodeMatrix(bytes);
    expect(m.hasScale).toBe(true);
    expect(m.scaleX).toBe(2 * 65536); // 131072
    expect(m.scaleY).toBe(2 * 65536);
  });

  it("3b. non-uniform scale: ScaleX = 3*65536, ScaleY = 0.5*65536", () => {
    const bytes = encodePlaceObject2(1, 1, 0, 0, { scaleX: 3, scaleY: 0.5 });
    const m = decodeMatrix(bytes);
    expect(m.hasScale).toBe(true);
    expect(m.scaleX).toBe(Math.round(3 * 65536));
    expect(m.scaleY).toBe(Math.round(0.5 * 65536));
  });

  // 4. 0° rotation: HasRotate should be false (or skews are 0)
  it("4. 0° rotation: hasRotate=false (no skew components)", () => {
    const bytes = encodePlaceObject2(1, 1, 0, 0, { rotation: 0 });
    const m = decodeMatrix(bytes);
    // No rotation means no skew components
    expect(m.hasRotate).toBe(false);
  });

  // 5. 90° rotation
  it("5. 90° rotation: SkewX (b) ≈ 65536, SkewY (c) ≈ -65536", () => {
    // For a 90° CCW rotation matrix:
    //   a = cos(90°) ≈ 0   → scaleX ≈ 0
    //   b = sin(90°) = 1   → rotateSkew0 = 65536
    //   c = -sin(90°) = -1 → rotateSkew1 = -65536
    //   d = cos(90°) ≈ 0   → scaleY ≈ 0
    const bytes = encodePlaceObject2(1, 1, 0, 0, { rotation: 90 });
    const m = decodeMatrix(bytes);
    expect(m.hasRotate).toBe(true);
    // rotateSkew0 is the b component (sin), rotateSkew1 is the c component (-sin)
    expect(m.skewX).toBeCloseTo(65536, -2);   // sin(90°)*65536 = 65536
    expect(m.skewY).toBeCloseTo(-65536, -2);  // -sin(90°)*65536 = -65536
  });

  // 6. 45° rotation
  it("6. 45° rotation: ScaleX ≈ 46341 (cos(45°)*65536)", () => {
    // cos(45°) * 65536 ≈ 46341
    // sin(45°) * 65536 ≈ 46341
    const bytes = encodePlaceObject2(1, 1, 0, 0, { rotation: 45 });
    const m = decodeMatrix(bytes);
    expect(m.hasScale).toBe(true);
    // ScaleX = cos(45°) * 65536 ≈ 46341
    const expected = Math.round(Math.cos(Math.PI / 4) * 65536); // 46341
    expect(m.scaleX).toBeCloseTo(expected, -1);
    expect(m.scaleY).toBeCloseTo(expected, -1);
  });

  it("6b. 45° rotation: SkewX (b) ≈ 46341, SkewY (c) ≈ -46341", () => {
    const bytes = encodePlaceObject2(1, 1, 0, 0, { rotation: 45 });
    const m = decodeMatrix(bytes);
    expect(m.hasRotate).toBe(true);
    const sinVal = Math.round(Math.sin(Math.PI / 4) * 65536); // 46341
    expect(m.skewX).toBeCloseTo(sinVal, -1);   // rotateSkew0 = b = sin(angle)
    expect(m.skewY).toBeCloseTo(-sinVal, -1);  // rotateSkew1 = c = -sin(angle)
  });

  // 7. Combined translate + scale
  it("7. combined translate + scale: all fields correct", () => {
    // x=100px, y=50px, scaleX=1.5, scaleY=2.0
    const bytes = encodePlaceObject2(1, 1, 100, 50, { scaleX: 1.5, scaleY: 2.0 });
    const m = decodeMatrix(bytes);
    expect(m.hasScale).toBe(true);
    expect(m.hasRotate).toBe(false);
    expect(m.scaleX).toBe(Math.round(1.5 * 65536));
    expect(m.scaleY).toBe(Math.round(2.0 * 65536));
    expect(m.translateX).toBe(100 * 20); // 2000 twips
    expect(m.translateY).toBe(50 * 20);  // 1000 twips
  });
});

// ---------------------------------------------------------------------------
// Direct toSWFMatrix unit tests (no encoding overhead)
// ---------------------------------------------------------------------------

describe("toSWFMatrix value conversion", () => {
  it("identity matrix: hasScale=false, hasRotate=false, all zeros for translate", () => {
    const m = toSWFMatrix(identity());
    expect(m.hasScale).toBe(false);
    expect(m.hasRotate).toBe(false);
    expect(m.translateX).toBe(0);
    expect(m.translateY).toBe(0);
  });

  it("translation: translateX and translateY in twips", () => {
    const m = toSWFMatrix(translation(15, 25));
    expect(m.translateX).toBe(300); // 15 * 20
    expect(m.translateY).toBe(500); // 25 * 20
  });

  it("2x scale: scaleX = scaleY = 2 * 65536", () => {
    const m = toSWFMatrix(scaling(2, 2));
    expect(m.hasScale).toBe(true);
    expect(m.scaleX).toBe(131072);
    expect(m.scaleY).toBe(131072);
  });

  it("45° rotation: rotateSkew0 (b) ≈ 46341, rotateSkew1 (c) ≈ -46341", () => {
    const m = toSWFMatrix(rotationMatrix(45));
    expect(m.hasRotate).toBe(true);
    const sinVal = Math.round(Math.sin(Math.PI / 4) * 65536);
    expect(m.rotateSkew0).toBe(sinVal);   // b = sin(45°)
    expect(m.rotateSkew1).toBe(-sinVal);  // c = -sin(45°)
  });

  it("rotation matrix fields are not confused: scaleX=a, rotateSkew0=b, rotateSkew1=c, scaleY=d", () => {
    // For a 30° rotation:
    //   a = cos(30°), b = sin(30°), c = -sin(30°), d = cos(30°)
    const deg = 30;
    const rad = deg * Math.PI / 180;
    const m = toSWFMatrix(rotationMatrix(deg));
    expect(m.scaleX).toBe(Math.round(Math.cos(rad) * 65536));     // a
    expect(m.rotateSkew0).toBe(Math.round(Math.sin(rad) * 65536)); // b
    expect(m.rotateSkew1).toBe(Math.round(-Math.sin(rad) * 65536));// c
    expect(m.scaleY).toBe(Math.round(Math.cos(rad) * 65536));     // d
  });
});
