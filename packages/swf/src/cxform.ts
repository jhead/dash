/**
 * CXFORMWITHALPHA encoder for SWF PlaceObject2 color transform.
 *
 * CXFORMWITHALPHA SWF structure (bit-packed, no byte alignment before it):
 *   HasAddTerms:  UB[1]  (1 if any Add != 0)
 *   HasMultTerms: UB[1]  (1 if any Mult != 256, i.e. != 1.0x)
 *   Nbits:        UB[4]  (number of bits per channel value, 1-15)
 *   if HasMultTerms: RedMultTerm, GreenMultTerm, BlueMultTerm, AlphaMultTerm: SB[Nbits]
 *   if HasAddTerms:  RedAddTerm, GreenAddTerm, BlueAddTerm, AlphaAddTerm: SB[Nbits]
 *   (pad to byte boundary)
 *
 * Mult values: 256 = 1.0x (no change), 0 = fully transparent/zero
 * Add values: signed offset added after multiply (-255..255 typical)
 */
import { BitWriter } from "./bits.js";
import { edgeNumBits } from "./helpers.js";
import type { ColorEffect } from "@flash/core";

// ---------------------------------------------------------------------------
// CXForm data structure
// ---------------------------------------------------------------------------

/**
 * Internal representation of a color transform (CXFORMWITHALPHA).
 *
 * Mult fields: 256 = 1.0 (no change), 128 = 0.5, 0 = zero.
 * Add fields: signed offset applied after multiply. Range roughly -255..255.
 */
export interface CXForm {
  redMult: number;
  greenMult: number;
  blueMult: number;
  alphaMult: number;
  redAdd: number;
  greenAdd: number;
  blueAdd: number;
  alphaAdd: number;
}

// ---------------------------------------------------------------------------
// ColorEffect → CXForm conversion
// ---------------------------------------------------------------------------

/**
 * Convert a ColorEffect (from a SymbolInstance) to a CXForm for encoding.
 *
 * Returns null when the effect is 'none' (no transform needed).
 *
 * Range conventions (from types.ts ColorEffect):
 *   brightness: -100..100  (−100 = black, 0 = no change, 100 = white)
 *   tintAmount:  0..100    (0 = no tint, 100 = full tint)
 *   alpha:       0..100    (0 = fully transparent, 100 = fully opaque)
 *   redMult/greenMult/blueMult: -100..100 (−100 = zero channel, 0 = no change, 100 = double)
 *   redOffset/greenOffset/blueOffset: -255..255
 */
export function colorEffectToCXForm(effect: ColorEffect): CXForm | null {
  switch (effect.type) {
    case "none":
      return null;

    case "brightness": {
      // brightness: -100..100 → normalize to -1..1
      const b = (effect.brightness ?? 0) / 100;
      // Flash brightness formula:
      //   mult = clamp(1 - |b|, 0, 1) * 256  (dims the original color)
      //   add  = clamp(b, 0, 1) * 255         (adds white when b > 0)
      const mult = Math.round(Math.max(0, 1 - Math.abs(b)) * 256);
      const add = Math.round(Math.max(0, b) * 255);
      return {
        redMult: mult, greenMult: mult, blueMult: mult, alphaMult: 256,
        redAdd: add, greenAdd: add, blueAdd: add, alphaAdd: 0,
      };
    }

    case "tint": {
      // tintAmount: 0..100 → p = 0..1
      const p = (effect.tintAmount ?? 0) / 100;
      const hex = effect.tintColor ?? "#000000";
      const clean = hex.replace(/^#/, "");
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      // mult = (1 - p) * 256: original color scaled down
      const mult = Math.round((1 - p) * 256);
      return {
        redMult: mult, greenMult: mult, blueMult: mult, alphaMult: 256,
        redAdd: Math.round(r * p), greenAdd: Math.round(g * p),
        blueAdd: Math.round(b * p), alphaAdd: 0,
      };
    }

    case "alpha": {
      // alpha: 0..100 → 0..1 → alphaMult = 0..256
      const a = Math.round(((effect.alpha ?? 100) / 100) * 256);
      return {
        redMult: 256, greenMult: 256, blueMult: 256, alphaMult: a,
        redAdd: 0, greenAdd: 0, blueAdd: 0, alphaAdd: 0,
      };
    }

    case "advanced": {
      // redMult/greenMult/blueMult: -100..100 → multiplier factor
      // Flash advanced: mult factor of 100 means "100% of original" = 1.0 = 256 in SWF
      //   so factor = value / 100, stored as round(factor * 256)
      const toMult = (v: number) => Math.round((v / 100) * 256);
      return {
        redMult: toMult(effect.redMult ?? 100),
        greenMult: toMult(effect.greenMult ?? 100),
        blueMult: toMult(effect.blueMult ?? 100),
        alphaMult: 256, // no alpha multiplier in this type
        redAdd: effect.redOffset ?? 0,
        greenAdd: effect.greenOffset ?? 0,
        blueAdd: effect.blueOffset ?? 0,
        alphaAdd: 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// CXForm → binary encoding
// ---------------------------------------------------------------------------

/**
 * Encode a CXForm struct into a CXFORMWITHALPHA binary record.
 */
export function encodeCXFormWithAlpha(cx: CXForm): Uint8Array {
  return encodeCxformWithAlpha(
    cx.redMult, cx.greenMult, cx.blueMult, cx.alphaMult,
    cx.redAdd, cx.greenAdd, cx.blueAdd, cx.alphaAdd
  );
}

/**
 * Encode a CXFORMWITHALPHA record.
 *
 * @param redMult    Red multiply term   (256 = 1.0x, no change)
 * @param greenMult  Green multiply term (256 = 1.0x)
 * @param blueMult   Blue multiply term  (256 = 1.0x)
 * @param alphaMult  Alpha multiply term (256 = fully opaque, 0 = transparent)
 * @param redAdd     Red add term    (0 = no change; range -32768..32767)
 * @param greenAdd   Green add term
 * @param blueAdd    Blue add term
 * @param alphaAdd   Alpha add term
 */
export function encodeCxformWithAlpha(
  redMult: number,
  greenMult: number,
  blueMult: number,
  alphaMult: number,
  redAdd: number,
  greenAdd: number,
  blueAdd: number,
  alphaAdd: number
): Uint8Array {
  const hasMultTerms =
    redMult !== 256 || greenMult !== 256 || blueMult !== 256 || alphaMult !== 256;
  const hasAddTerms =
    redAdd !== 0 || greenAdd !== 0 || blueAdd !== 0 || alphaAdd !== 0;

  // Determine minimum bits needed to represent all signed channel values
  const multValues = hasMultTerms
    ? [redMult, greenMult, blueMult, alphaMult]
    : [];
  const addValues = hasAddTerms
    ? [redAdd, greenAdd, blueAdd, alphaAdd]
    : [];

  const allValues = [...multValues, ...addValues];
  // Must fit all values in nBits signed bits; minimum 1 bit
  const nBits = allValues.length > 0
    ? Math.max(edgeNumBits(allValues), 1)
    : 1;

  const bw = new BitWriter();
  bw.writeBits(hasAddTerms ? 1 : 0, 1);
  bw.writeBits(hasMultTerms ? 1 : 0, 1);
  bw.writeBits(nBits, 4);

  if (hasMultTerms) {
    bw.writeBits(redMult, nBits);
    bw.writeBits(greenMult, nBits);
    bw.writeBits(blueMult, nBits);
    bw.writeBits(alphaMult, nBits);
  }

  if (hasAddTerms) {
    bw.writeBits(redAdd, nBits);
    bw.writeBits(greenAdd, nBits);
    bw.writeBits(blueAdd, nBits);
    bw.writeBits(alphaAdd, nBits);
  }

  bw.flushBits();
  return bw.getBytes();
}
