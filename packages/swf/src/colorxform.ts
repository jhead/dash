/**
 * High-level CXFormWithAlpha encoder that accepts a ColorEffect directly.
 *
 * Uses fixed Nbits=10 with both HasMultTerms and HasAddTerms always set to 1
 * (unused terms are zero). This simplifies encoding compared to the dynamic
 * Nbits approach in cxform.ts. Nbits=10 accommodates the full value range
 * (0..256 for multipliers and -255..255 for offsets).
 *
 * CXFormWithAlpha bit layout:
 *   HasAddTerms:  UB[1]
 *   HasMultTerms: UB[1]
 *   Nbits:        UB[4]  (fixed 10)
 *   if HasMultTerms: RedMult, GreenMult, BlueMult, AlphaMult: SB[8] each
 *   if HasAddTerms:  RedAdd, GreenAdd, BlueAdd, AlphaAdd: SB[8] each
 *   (padded to byte boundary)
 *
 * Multipliers are 8.8 fixed-point (256 = 1.0). Offsets are -255..255.
 */

import { BitWriter } from "./bits.js";
import type { ColorEffect } from "@flash/core";

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

// ---------------------------------------------------------------------------
// Internal 8-channel encoding
// ---------------------------------------------------------------------------

/**
 * Encode 8 CXFormWithAlpha channels into a byte-aligned Uint8Array.
 * Uses fixed Nbits=10, which accommodates the full range:
 *   - Multipliers: 0..256 (256 = 1.0 identity, requires 10 signed bits)
 *   - Offsets: -255..255 (requires 10 signed bits)
 * HasMultTerms=1 and HasAddTerms=1 are always set for consistent encoding.
 */
function encode8Channel(
  redMult: number,
  greenMult: number,
  blueMult: number,
  alphaMult: number,
  redAdd: number,
  greenAdd: number,
  blueAdd: number,
  alphaAdd: number
): Uint8Array {
  const NBITS = 10;
  const bw = new BitWriter();
  // HasAddTerms=1, HasMultTerms=1
  bw.writeBits(1, 1);
  bw.writeBits(1, 1);
  bw.writeBits(NBITS, 4);
  // Mult terms
  bw.writeBits(redMult, NBITS);
  bw.writeBits(greenMult, NBITS);
  bw.writeBits(blueMult, NBITS);
  bw.writeBits(alphaMult, NBITS);
  // Add terms
  bw.writeBits(redAdd, NBITS);
  bw.writeBits(greenAdd, NBITS);
  bw.writeBits(blueAdd, NBITS);
  bw.writeBits(alphaAdd, NBITS);
  bw.flushBits();
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a ColorEffect as a CXFormWithAlpha binary record (byte-aligned).
 *
 * For type='none' this still returns a valid buffer (identity transform).
 *
 * Mapping from Flash 8 color effects to SWF CXFormWithAlpha:
 *
 *   alpha (0..100):
 *     Mult: R=256, G=256, B=256, A=round(alpha/100*256)
 *     Add: all 0
 *
 *   brightness (-100..100):
 *     value > 0: Mult=round((1-value/100)*256), Add=round(value/100*255) for R,G,B
 *     value < 0: Mult=round((1+value/100)*256), Add=0 for R,G,B
 *     Alpha: Mult=256, Add=0
 *
 *   tint (tintColor hex, tintAmount 0..100):
 *     tintMult = 1 - tintAmount/100
 *     Mult: R=G=B=round(tintMult*256), A=256
 *     Add: R=round(r*tintAmount/100), G=round(g*tintAmount/100), B=round(b*tintAmount/100), A=0
 *
 *   advanced: direct 8-channel encoding
 *     redMult/greenMult/blueMult: -100..100 → factor = value/100 → stored as round(factor*256)
 *     redOffset/greenOffset/blueOffset: -255..255 (direct)
 */
export function encodeCXFormWithAlpha(effect: ColorEffect): Uint8Array {
  switch (effect.type) {
    case "none": {
      // Identity: all mults = 256, all adds = 0
      return encode8Channel(256, 256, 256, 256, 0, 0, 0, 0);
    }

    case "alpha": {
      const alpha = effect.alpha ?? 100;
      const aMult = Math.round((alpha / 100) * 256);
      return encode8Channel(256, 256, 256, aMult, 0, 0, 0, 0);
    }

    case "brightness": {
      const value = effect.brightness ?? 0;
      let mult: number;
      let add: number;
      if (value > 0) {
        mult = Math.round((1 - value / 100) * 256);
        add = Math.round((value / 100) * 255);
      } else {
        mult = Math.round((1 + value / 100) * 256);
        add = 0;
      }
      return encode8Channel(mult, mult, mult, 256, add, add, add, 0);
    }

    case "tint": {
      const amount = effect.tintAmount ?? 0;
      const { r, g, b } = parseHexColor(effect.tintColor ?? "#000000");
      const mult = Math.round((1 - amount / 100) * 256);
      const rAdd = Math.round(r * (amount / 100));
      const gAdd = Math.round(g * (amount / 100));
      const bAdd = Math.round(b * (amount / 100));
      return encode8Channel(mult, mult, mult, 256, rAdd, gAdd, bAdd, 0);
    }

    case "advanced": {
      const toMult = (v: number) => Math.round((v / 100) * 256);
      const rMult = toMult(effect.redMult ?? 100);
      const gMult = toMult(effect.greenMult ?? 100);
      const bMult = toMult(effect.blueMult ?? 100);
      // ColorEffect type does not include alphaMult or alphaOffset; default to identity
      const rAdd = effect.redOffset ?? 0;
      const gAdd = effect.greenOffset ?? 0;
      const bAdd = effect.blueOffset ?? 0;
      return encode8Channel(rMult, gMult, bMult, 256, rAdd, gAdd, bAdd, 0);
    }

    default:
      // Fallback: identity
      return encode8Channel(256, 256, 256, 256, 0, 0, 0, 0);
  }
}
