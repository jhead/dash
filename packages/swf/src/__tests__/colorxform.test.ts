/**
 * Tests for colorxform.ts — high-level ColorEffect → CXFormWithAlpha encoder.
 *
 * The encodeCXFormWithAlpha function in colorxform.ts accepts a ColorEffect
 * and returns a byte-aligned CXFormWithAlpha binary record.
 */

import { describe, it, expect } from "vitest";
import { encodeCXFormWithAlpha } from "../colorxform.js";

// ---------------------------------------------------------------------------
// Helpers to decode the encoded binary back to channel values
// ---------------------------------------------------------------------------

/**
 * Parse a CXFormWithAlpha binary record produced by encodeCXFormWithAlpha.
 * Returns the 8 channel values decoded from the bit-packed record.
 *
 * Bit layout (MSB-first within each byte):
 *   HasAddTerms:  1 bit
 *   HasMultTerms: 1 bit
 *   Nbits:        4 bits
 *   if HasMult: RedMult, GreenMult, BlueMult, AlphaMult: Nbits signed bits each
 *   if HasAdd:  RedAdd, GreenAdd, BlueAdd, AlphaAdd: Nbits signed bits each
 */
function parseCXForm(buf: Uint8Array): {
  hasAddTerms: boolean;
  hasMultTerms: boolean;
  nBits: number;
  redMult: number;
  greenMult: number;
  blueMult: number;
  alphaMult: number;
  redAdd: number;
  greenAdd: number;
  blueAdd: number;
  alphaAdd: number;
} {
  // Read bits MSB-first from the byte array
  let bitPos = 0;

  function readBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = 7 - (bitPos % 8);
      const bit = (buf[byteIdx] >> bitIdx) & 1;
      value = (value << 1) | bit;
      bitPos++;
    }
    return value;
  }

  function readSignedBits(n: number): number {
    const raw = readBits(n);
    // Sign-extend: if the top bit is set, it's negative
    if (raw & (1 << (n - 1))) {
      return raw - (1 << n);
    }
    return raw;
  }

  const hasAddTerms = readBits(1) === 1;
  const hasMultTerms = readBits(1) === 1;
  const nBits = readBits(4);

  let redMult = 256, greenMult = 256, blueMult = 256, alphaMult = 256;
  let redAdd = 0, greenAdd = 0, blueAdd = 0, alphaAdd = 0;

  if (hasMultTerms) {
    redMult = readSignedBits(nBits);
    greenMult = readSignedBits(nBits);
    blueMult = readSignedBits(nBits);
    alphaMult = readSignedBits(nBits);
  }

  if (hasAddTerms) {
    redAdd = readSignedBits(nBits);
    greenAdd = readSignedBits(nBits);
    blueAdd = readSignedBits(nBits);
    alphaAdd = readSignedBits(nBits);
  }

  return {
    hasAddTerms,
    hasMultTerms,
    nBits,
    redMult,
    greenMult,
    blueMult,
    alphaMult,
    redAdd,
    greenAdd,
    blueAdd,
    alphaAdd,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("encodeCXFormWithAlpha (colorxform.ts)", () => {
  it("type=none returns a non-empty Uint8Array", () => {
    const result = encodeCXFormWithAlpha({ type: "none" });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("type=none encodes as identity (all mults=256, all adds=0)", () => {
    const result = encodeCXFormWithAlpha({ type: "none" });
    const parsed = parseCXForm(result);
    expect(parsed.redMult).toBe(256);
    expect(parsed.greenMult).toBe(256);
    expect(parsed.blueMult).toBe(256);
    expect(parsed.alphaMult).toBe(256);
    expect(parsed.redAdd).toBe(0);
    expect(parsed.greenAdd).toBe(0);
    expect(parsed.blueAdd).toBe(0);
    expect(parsed.alphaAdd).toBe(0);
  });

  it("type=alpha, alpha=50 → alphaMult ≈ 128 (50% of 256), RGB mults=256", () => {
    const result = encodeCXFormWithAlpha({ type: "alpha", alpha: 50 });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    const parsed = parseCXForm(result);
    // alpha=50 → round(50/100 * 256) = round(128) = 128
    expect(parsed.alphaMult).toBe(128);
    expect(parsed.redMult).toBe(256);
    expect(parsed.greenMult).toBe(256);
    expect(parsed.blueMult).toBe(256);
    expect(parsed.redAdd).toBe(0);
    expect(parsed.greenAdd).toBe(0);
    expect(parsed.blueAdd).toBe(0);
    expect(parsed.alphaAdd).toBe(0);
  });

  it("type=alpha, alpha=0 → alphaMult=0 (fully transparent)", () => {
    const result = encodeCXFormWithAlpha({ type: "alpha", alpha: 0 });
    const parsed = parseCXForm(result);
    expect(parsed.alphaMult).toBe(0);
    expect(parsed.redMult).toBe(256);
  });

  it("type=alpha, alpha=100 → alphaMult=256 (fully opaque)", () => {
    const result = encodeCXFormWithAlpha({ type: "alpha", alpha: 100 });
    const parsed = parseCXForm(result);
    expect(parsed.alphaMult).toBe(256);
  });

  it("type=brightness, value=50 → mult ≈ 128, add ≈ 127", () => {
    const result = encodeCXFormWithAlpha({ type: "brightness", brightness: 50 });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    const parsed = parseCXForm(result);
    // value=50 → mult = round((1 - 0.5) * 256) = round(128) = 128
    expect(parsed.redMult).toBe(128);
    expect(parsed.greenMult).toBe(128);
    expect(parsed.blueMult).toBe(128);
    expect(parsed.alphaMult).toBe(256);
    // add = round(0.5 * 255) = round(127.5) = 128
    expect(parsed.redAdd).toBe(128);
    expect(parsed.greenAdd).toBe(128);
    expect(parsed.blueAdd).toBe(128);
    expect(parsed.alphaAdd).toBe(0);
  });

  it("type=brightness, value=100 → mult=0 (black), add=255 (white)", () => {
    const result = encodeCXFormWithAlpha({ type: "brightness", brightness: 100 });
    const parsed = parseCXForm(result);
    expect(parsed.redMult).toBe(0);
    expect(parsed.greenMult).toBe(0);
    expect(parsed.blueMult).toBe(0);
    expect(parsed.redAdd).toBe(255);
    expect(parsed.greenAdd).toBe(255);
    expect(parsed.blueAdd).toBe(255);
    expect(parsed.alphaMult).toBe(256);
  });

  it("type=brightness, value=-50 → mult ≈ 128, add=0", () => {
    const result = encodeCXFormWithAlpha({ type: "brightness", brightness: -50 });
    const parsed = parseCXForm(result);
    // value=-50 → mult = round((1 + (-50)/100) * 256) = round(0.5 * 256) = 128
    expect(parsed.redMult).toBe(128);
    expect(parsed.redAdd).toBe(0);
  });

  it("type=tint, color=#FF0000, amount=100 → G,B mult near 0, R add ≈ 255", () => {
    const result = encodeCXFormWithAlpha({
      type: "tint",
      tintColor: "#FF0000",
      tintAmount: 100,
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    const parsed = parseCXForm(result);
    // amount=100 → tintMult = 0 → mult = round(0 * 256) = 0
    expect(parsed.redMult).toBe(0);
    expect(parsed.greenMult).toBe(0);
    expect(parsed.blueMult).toBe(0);
    expect(parsed.alphaMult).toBe(256);
    // R=0xFF=255 → redAdd = round(255 * 1.0) = 255
    expect(parsed.redAdd).toBe(255);
    // G=0, B=0 → adds = 0
    expect(parsed.greenAdd).toBe(0);
    expect(parsed.blueAdd).toBe(0);
    expect(parsed.alphaAdd).toBe(0);
  });

  it("type=tint, color=#0000FF, amount=50 → blue add ≈ 128, B mult ≈ 128", () => {
    const result = encodeCXFormWithAlpha({
      type: "tint",
      tintColor: "#0000FF",
      tintAmount: 50,
    });
    const parsed = parseCXForm(result);
    // amount=50 → tintMult=0.5 → mult = round(0.5 * 256) = 128
    expect(parsed.redMult).toBe(128);
    expect(parsed.blueMult).toBe(128);
    // B=0xFF=255 → blueAdd = round(255 * 0.5) = 128 (round 127.5)
    expect(parsed.blueAdd).toBe(128);
    expect(parsed.redAdd).toBe(0);
    expect(parsed.greenAdd).toBe(0);
  });

  it("type=advanced passes all 8 values through", () => {
    const result = encodeCXFormWithAlpha({
      type: "advanced",
      redMult: 50,     // round(50/100 * 256) = 128
      greenMult: 100,  // round(100/100 * 256) = 256
      blueMult: 0,     // round(0/100 * 256) = 0
      redOffset: 10,
      greenOffset: -20,
      blueOffset: 127,
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    const parsed = parseCXForm(result);
    expect(parsed.redMult).toBe(128);
    expect(parsed.greenMult).toBe(256);
    expect(parsed.blueMult).toBe(0);
    expect(parsed.alphaMult).toBe(256); // default (100% → 256)
    expect(parsed.redAdd).toBe(10);
    expect(parsed.greenAdd).toBe(-20);
    expect(parsed.blueAdd).toBe(127);
    expect(parsed.alphaAdd).toBe(0);
  });

  it("type=advanced with all defaults → identity", () => {
    const result = encodeCXFormWithAlpha({ type: "advanced" });
    const parsed = parseCXForm(result);
    expect(parsed.redMult).toBe(256);
    expect(parsed.greenMult).toBe(256);
    expect(parsed.blueMult).toBe(256);
    expect(parsed.alphaMult).toBe(256);
    expect(parsed.redAdd).toBe(0);
    expect(parsed.greenAdd).toBe(0);
    expect(parsed.blueAdd).toBe(0);
    expect(parsed.alphaAdd).toBe(0);
  });
});
