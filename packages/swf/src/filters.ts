/**
 * SWF filter encoding — FILTERLIST for PlaceObject3 (tag 70).
 *
 * Supports DropShadow (ID=0), Blur (ID=1), Glow (ID=2), and Bevel (ID=3).
 * Used for objects that have Flash 8 FlashFilter effects applied.
 */
import { BitWriter } from "./bits.js";
import type { FlashFilter, DropShadowFilter, GlowFilter, BlurFilter, BevelFilter, GradientGlowFilter, GradientBevelFilter, AdjustColorFilter } from "@flash/core";
import { toSWFMatrix, composeMatrix } from "@flash/core";
import { edgeNumBits } from "./helpers.js";

// ---------------------------------------------------------------------------
// Individual filter encoders
// ---------------------------------------------------------------------------

/**
 * Encode a DropShadow filter (FilterID = 0).
 * Writes filter params into the BitWriter (after the FilterID byte is written by caller).
 */
function writeDropShadowFilter(bw: BitWriter, f: DropShadowFilter): void {
  // Color: RGBA first (per SWF spec: Color before the fixed-point values)
  bw.writeUI8(f.color.r);
  bw.writeUI8(f.color.g);
  bw.writeUI8(f.color.b);
  // Alpha: from alpha field (0–1) → 0–255
  bw.writeUI8(Math.round(f.alpha * 255));

  // BlurX: FIXED16 (16.16 fixed-point, 4 bytes LE)
  bw.writeFixed16(f.blurX);
  // BlurY: FIXED16
  bw.writeFixed16(f.blurY);
  // Angle: FIXED16 (degrees → radians, stored as 16.16 fixed-point)
  bw.writeFixed16((f.angle * Math.PI) / 180);
  // Distance: FIXED16
  bw.writeFixed16(f.distance);
  // Strength: FIXED8 (2 bytes)
  bw.writeFixed8(f.strength);

  // Flags: UI8
  let flags = 0;
  flags |= 1 << 5; // CompositeSource — always 1
  if (f.inner) flags |= 1 << 7;      // InnerShadow
  if (f.knockout) flags |= 1 << 6;   // Knockout
  if (f.hideObject) flags |= 1 << 4; // OnTop (used for "hide object")
  // bits 0-3: Passes = 0
  bw.writeUI8(flags);
}

/**
 * Encode a Blur filter (FilterID = 1).
 */
function writeBlurFilter(bw: BitWriter, f: BlurFilter): void {
  // BlurX: FIXED16 (16.16 fixed-point, 4 bytes LE)
  bw.writeFixed16(f.blurX);
  // BlurY: FIXED16
  bw.writeFixed16(f.blurY);
  // Flags: UI8 — bits 7-3: Passes (quality), bits 2-0: reserved (0)
  bw.writeUI8((f.quality & 0x1f) << 3);
}

/**
 * Encode a Glow filter (FilterID = 2).
 */
function writeGlowFilter(bw: BitWriter, f: GlowFilter): void {
  // Color: RGBA
  bw.writeUI8(f.color.r);
  bw.writeUI8(f.color.g);
  bw.writeUI8(f.color.b);
  bw.writeUI8(Math.round(f.alpha * 255));

  // BlurX: FIXED16 (16.16 fixed-point, 4 bytes LE)
  bw.writeFixed16(f.blurX);
  // BlurY: FIXED16
  bw.writeFixed16(f.blurY);
  // Strength: FIXED8
  bw.writeFixed8(f.strength);

  // Flags: UI8
  let flags = 0;
  flags |= 1 << 5; // CompositeSource — always 1
  if (f.inner) flags |= 1 << 7;    // InnerGlow
  if (f.knockout) flags |= 1 << 6; // Knockout
  bw.writeUI8(flags);
}

/**
 * Encode a Bevel filter (FilterID = 3).
 *
 * SWF bevel filter layout:
 *   ShadowColor: RGBA
 *   HighlightColor: RGBA
 *   BlurX: FLOAT
 *   BlurY: FLOAT
 *   Angle: FLOAT
 *   Distance: FLOAT
 *   Strength: FIXED8
 *   Flags: UI8
 *     bit 7: InnerBevel
 *     bit 6: Knockout
 *     bit 5: CompositeSource
 *     bit 4: OnTop
 *     bits 0-3: Passes
 */
function writeBevelFilter(bw: BitWriter, f: BevelFilter): void {
  // Note: Ruffle reads HighlightColor first, then ShadowColor (spec ordering is wrong).
  // Per Ruffle swf/src/read.rs: "Note that the color order is wrong in the spec,
  // it's highlight then shadow."
  // HighlightColor: RGBA
  bw.writeUI8(f.highlightColor.r);
  bw.writeUI8(f.highlightColor.g);
  bw.writeUI8(f.highlightColor.b);
  bw.writeUI8(Math.round(f.highlightAlpha * 255));

  // ShadowColor: RGBA
  bw.writeUI8(f.shadowColor.r);
  bw.writeUI8(f.shadowColor.g);
  bw.writeUI8(f.shadowColor.b);
  bw.writeUI8(Math.round(f.shadowAlpha * 255));

  // BlurX: FIXED16 (16.16 fixed-point, 4 bytes LE)
  bw.writeFixed16(f.blurX);
  // BlurY: FIXED16
  bw.writeFixed16(f.blurY);
  // Angle: FIXED16 (degrees → radians, stored as 16.16 fixed-point)
  bw.writeFixed16((f.angle * Math.PI) / 180);
  // Distance: FIXED16
  bw.writeFixed16(f.distance);
  // Strength: FIXED8
  bw.writeFixed8(f.strength);

  // Flags: UI8
  let flags = 0;
  flags |= 1 << 5; // CompositeSource — always 1
  if (f.inner) flags |= 1 << 7;    // InnerBevel
  if (f.knockout) flags |= 1 << 6; // Knockout
  // bits 0-3: Passes = 0
  bw.writeUI8(flags);
}

/**
 * Parse a CSS hex color string (#rrggbb or #rgb) into {r, g, b}.
 */
function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

/**
 * Encode a GradientGlow filter (FilterID = 4).
 * SWF layout:
 *   1 byte:  numColors
 *   N×4 bytes: RGBA for each gradient stop
 *   N bytes:   ratio for each gradient stop
 *   4 bytes:  blurX (FLOAT)
 *   4 bytes:  blurY (FLOAT)
 *   4 bytes:  angle (FLOAT, radians)
 *   4 bytes:  distance (FLOAT)
 *   2 bytes:  strength (FIXED8)
 *   1 byte:   flags (inner, knockout, compositeSource, onTop, passes)
 */
function writeGradientGlowFilter(bw: BitWriter, f: GradientGlowFilter): void {
  const numColors = f.gradient.length;
  bw.writeUI8(numColors);

  // RGBA for each stop (all colors first, matching Ruffle read order)
  for (const stop of f.gradient) {
    const { r, g, b } = hexToRGB(stop.color);
    bw.writeUI8(r);
    bw.writeUI8(g);
    bw.writeUI8(b);
    bw.writeUI8(Math.round(stop.alpha * 255));
  }

  // Ratios for each stop (all ratios after all colors)
  for (const stop of f.gradient) {
    bw.writeUI8(Math.round(stop.ratio) & 0xff);
  }

  bw.writeFixed16(f.blurX);
  bw.writeFixed16(f.blurY);
  bw.writeFixed16((f.angle * Math.PI) / 180);
  bw.writeFixed16(f.distance);
  bw.writeFixed8(f.strength);

  let flags = 0;
  if (f.compositeSource) flags |= 1 << 5;
  if (f.inner) flags |= 1 << 7;
  if (f.knockout) flags |= 1 << 6;
  // bits 0-3: passes (quality), bit 4: onTop
  flags |= (f.quality & 0x0f);
  bw.writeUI8(flags);
}

/**
 * Encode a GradientBevel filter (FilterID = 7).
 * Same layout as GradientGlow.
 */
function writeGradientBevelFilter(bw: BitWriter, f: GradientBevelFilter): void {
  const numColors = f.gradient.length;
  bw.writeUI8(numColors);

  // RGBA for each stop (all colors first, matching Ruffle read order)
  for (const stop of f.gradient) {
    const { r, g, b } = hexToRGB(stop.color);
    bw.writeUI8(r);
    bw.writeUI8(g);
    bw.writeUI8(b);
    bw.writeUI8(Math.round(stop.alpha * 255));
  }

  // Ratios for each stop (all ratios after all colors)
  for (const stop of f.gradient) {
    bw.writeUI8(Math.round(stop.ratio) & 0xff);
  }

  bw.writeFixed16(f.blurX);
  bw.writeFixed16(f.blurY);
  bw.writeFixed16((f.angle * Math.PI) / 180);
  bw.writeFixed16(f.distance);
  bw.writeFixed8(f.strength);

  let flags = 0;
  if (f.compositeSource) flags |= 1 << 5;
  if (f.inner) flags |= 1 << 7;
  if (f.knockout) flags |= 1 << 6;
  flags |= (f.quality & 0x0f);
  bw.writeUI8(flags);
}

/**
 * Encode an AdjustColor (ColorMatrix) filter (FilterID = 6).
 *
 * SWF stores a 4×5 color matrix as 20 IEEE 754 floats (80 bytes).
 * We derive a reasonable approximation from the brightness/contrast/
 * saturation/hue parameters.
 *
 * Matrix layout (row-major):
 *   [R'] = [m[0]  m[1]  m[2]  m[3]  m[4] ] [R]
 *   [G'] = [m[5]  m[6]  m[7]  m[8]  m[9] ] [G]
 *   [B'] = [m[10] m[11] m[12] m[13] m[14]] [B]
 *   [A'] = [m[15] m[16] m[17] m[18] m[19]] [A]
 */
function writeAdjustColorFilter(bw: BitWriter, f: AdjustColorFilter): void {
  // Start with identity matrix
  const m: number[] = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ];

  // Brightness: add offset to RGB channels (translate by brightness * 2.55 to map -100..100 → -255..255)
  const brightnessOffset = f.brightness * 2.55;
  m[4]  += brightnessOffset;
  m[9]  += brightnessOffset;
  m[14] += brightnessOffset;

  // Contrast: scale around midpoint 127.5
  // contrast range -100..100 → scale factor ~0..2
  const contrastScale = (f.contrast + 100) / 100; // 0..2
  const contrastOffset = 127.5 * (1 - contrastScale);
  m[0]  *= contrastScale;  m[4]  += contrastOffset;
  m[6]  *= contrastScale;  m[9]  += contrastOffset;
  m[12] *= contrastScale;  m[14] += contrastOffset;

  // Saturation: interpolate between luminance-only and full color
  // sat=0 → greyscale, sat=1 → identity, sat=-1 → inverted saturation
  // Luminance weights (ITU-R BT.601)
  const lr = 0.213, lg = 0.715, lb = 0.072;
  const sat = (f.saturation + 100) / 100; // 0..2 (1 = no change)
  // Mix identity matrix with luminance matrix
  // satMatrix * current
  const sm = [
    lr + (1 - lr) * sat, lg - lg * sat,        lb - lb * sat,        0, 0,
    lr - lr * sat,        lg + (1 - lg) * sat,  lb - lb * sat,        0, 0,
    lr - lr * sat,        lg - lg * sat,        lb + (1 - lb) * sat,  0, 0,
    0, 0, 0, 1, 0,
  ];
  // Multiply sm × m
  const result: number[] = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let val = 0;
      for (let k = 0; k < 4; k++) {
        val += sm[row * 5 + k] * m[k * 5 + col];
      }
      // Translation column (col=4): add sm translation directly
      if (col === 4) val += sm[row * 5 + 4];
      result[row * 5 + col] = val;
    }
  }
  for (let i = 0; i < 20; i++) m[i] = result[i];

  // Hue rotation: rotate in the YIQ colorspace
  // hue in degrees → radians
  const hueRad = (f.hue * Math.PI) / 180;
  const cosH = Math.cos(hueRad);
  const sinH = Math.sin(hueRad);
  // Using YIQ hue rotation approximation
  const hm = [
    0.213 + cosH * 0.787 - sinH * 0.213, 0.715 - cosH * 0.715 - sinH * 0.715, 0.072 - cosH * 0.072 + sinH * 0.928, 0, 0,
    0.213 - cosH * 0.213 + sinH * 0.143, 0.715 + cosH * 0.285 + sinH * 0.140, 0.072 - cosH * 0.072 - sinH * 0.283, 0, 0,
    0.213 - cosH * 0.213 - sinH * 0.787, 0.715 - cosH * 0.715 + sinH * 0.715, 0.072 + cosH * 0.928 + sinH * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
  // Multiply hm × m
  const result2: number[] = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let val = 0;
      for (let k = 0; k < 4; k++) {
        val += hm[row * 5 + k] * m[k * 5 + col];
      }
      if (col === 4) val += hm[row * 5 + 4];
      result2[row * 5 + col] = val;
    }
  }
  for (let i = 0; i < 20; i++) m[i] = result2[i];

  // Write 20 floats (80 bytes)
  for (let i = 0; i < 20; i++) {
    bw.writeFloat(m[i]);
  }
}

// ---------------------------------------------------------------------------
// FILTERLIST encoder
// ---------------------------------------------------------------------------

/**
 * Encode a SWF FILTERLIST into a BitWriter.
 * Only encodes enabled filters.
 */
function writeFilterList(bw: BitWriter, filters: readonly FlashFilter[]): void {
  const enabled = filters.filter((f) => f.enabled);
  bw.writeUI8(enabled.length); // FilterCount

  for (const f of enabled) {
    switch (f.type) {
      case "drop-shadow":
        bw.writeUI8(0); // FilterID
        writeDropShadowFilter(bw, f);
        break;
      case "blur":
        bw.writeUI8(1); // FilterID
        writeBlurFilter(bw, f);
        break;
      case "glow":
        bw.writeUI8(2); // FilterID
        writeGlowFilter(bw, f);
        break;
      case "bevel":
        bw.writeUI8(3); // FilterID
        writeBevelFilter(bw, f);
        break;
      case "gradientGlow":
        bw.writeUI8(4); // FilterID
        writeGradientGlowFilter(bw, f);
        break;
      case "adjustColor":
        bw.writeUI8(6); // FilterID
        writeAdjustColorFilter(bw, f);
        break;
      case "gradientBevel":
        bw.writeUI8(7); // FilterID
        writeGradientBevelFilter(bw, f);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a PlaceObject3 tag body (tag 70) for a character with filters.
 *
 * PlaceObject3 extends PlaceObject2 with a second flags byte and optional
 * FILTERLIST, BlendMode, etc.
 *
 * @param charId     Character ID to place
 * @param depth      Display list depth (1-based)
 * @param x          X position in pixels
 * @param y          Y position in pixels
 * @param filters    Flash filters to embed in the tag
 * @param transform  Optional scale/rotation/skew (defaults to identity)
 */
export function encodePlaceObject3WithFilters(
  charId: number,
  depth: number,
  x: number,
  y: number,
  filters: readonly FlashFilter[],
  transform?: {
    scaleX?: number;    // 1.0 = no scale
    scaleY?: number;
    rotation?: number;  // degrees
    skewX?: number;
    skewY?: number;
  }
): Uint8Array {
  const bw = new BitWriter();

  // ---------------------------------------------------------------------------
  // Flags1: UI8
  // bit 0: HasMove (0 — placing new object)
  // bit 1: HasCharacter (1)
  // bit 2: HasMatrix (1)
  // bit 3: HasColorTransform (0)
  // bit 4: HasRatio (0)
  // bit 5: HasName (0)
  // bit 6: HasClipDepth (0)
  // bit 7: HasClipActions (0)
  // ---------------------------------------------------------------------------
  const flags1 =
    (1 << 1) | // HasCharacter
    (1 << 2);  // HasMatrix
  bw.writeUI8(flags1);

  // ---------------------------------------------------------------------------
  // Flags2: UI8
  // bit 0: HasImage (0)
  // bit 1: HasClassName (0)
  // bit 2: HasCacheAsBitmap (0)
  // bit 3: HasBlendMode (0)
  // bit 4: HasFilterList (1 if filters present)
  // bits 5-7: reserved
  // ---------------------------------------------------------------------------
  const enabledFilters = filters.filter((f) => f.enabled);
  const flags2 = enabledFilters.length > 0 ? (1 << 4) : 0;
  bw.writeUI8(flags2);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16 (HasCharacter)
  bw.writeUI16LE(charId);

  // MATRIX — build full affine matrix from position + optional transform
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);

  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  // hasScale
  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }

  // hasRotate
  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }

  // Translate is unconditional per SWF spec (no flag bit)
  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }

  bw.flushBits();

  // FILTERLIST (HasFilterList is set)
  if (enabledFilters.length > 0) {
    writeFilterList(bw, filters);
  }

  return bw.getBytes();
}

/**
 * Returns true if an object has any enabled filters.
 */
export function hasEnabledFilters(filters: readonly FlashFilter[] | undefined): boolean {
  if (!filters || filters.length === 0) return false;
  return filters.some((f) => f.enabled);
}

// ---------------------------------------------------------------------------
// Blend mode
// ---------------------------------------------------------------------------

/**
 * Flash blend mode name → SWF BlendMode UI8 value mapping.
 */
export const SWF_BLEND_MODE: Record<string, number> = {
  'normal':     0,
  'layer':      1,
  'multiply':   2,
  'screen':     3,
  'lighten':    4,
  'darken':     5,
  'difference': 6,
  'add':        7,
  'subtract':   8,
  'invert':     9,
  'alpha':      10,
  'erase':      11,
  'overlay':    12,
  'hardlight':  13,
};

/**
 * Encode a PlaceObject3 tag body (tag 70) for a character with a blend mode
 * (and optionally filters too).
 *
 * @param charId     Character ID to place
 * @param depth      Display list depth (1-based)
 * @param x          X position in pixels
 * @param y          Y position in pixels
 * @param blendMode  Flash blend mode name (e.g. 'multiply')
 * @param filters    Optional Flash filters to embed alongside the blend mode
 * @param transform  Optional scale/rotation/skew (defaults to identity)
 */
export function encodePlaceObject3WithBlendMode(
  charId: number,
  depth: number,
  x: number,
  y: number,
  blendMode: string,
  filters?: readonly FlashFilter[],
  transform?: {
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    skewX?: number;
    skewY?: number;
  }
): Uint8Array {
  const bw = new BitWriter();

  const flags1 =
    (1 << 1) | // HasCharacter
    (1 << 2);  // HasMatrix
  bw.writeUI8(flags1);

  // Flags2:
  //   bit 1 (0x02): HasBlendMode
  //   bit 4 (0x10): HasFilterList
  const enabledFilters = filters ? filters.filter((f) => f.enabled) : [];
  let flags2 = 0x02; // HasBlendMode always set here
  if (enabledFilters.length > 0) flags2 |= 0x10; // HasFilterList
  bw.writeUI8(flags2);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // MATRIX
  const m = composeMatrix({
    tx: x,
    ty: y,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    skewX: transform?.skewX ?? 0,
    skewY: transform?.skewY ?? 0,
  });
  const swfM = toSWFMatrix(m);

  const { hasScale, scaleX, scaleY, hasRotate, rotateSkew0, rotateSkew1, translateX, translateY } = swfM;

  bw.writeBits(hasScale ? 1 : 0, 1);
  if (hasScale) {
    const nBits = Math.max(edgeNumBits([scaleX, scaleY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(scaleX, nBits);
    bw.writeBits(scaleY, nBits);
  }

  bw.writeBits(hasRotate ? 1 : 0, 1);
  if (hasRotate) {
    const nBits = Math.max(edgeNumBits([rotateSkew0, rotateSkew1]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(rotateSkew0, nBits);
    bw.writeBits(rotateSkew1, nBits);
  }

  {
    const nBits = Math.max(edgeNumBits([translateX, translateY]), 2);
    bw.writeBits(nBits, 5);
    bw.writeBits(translateX, nBits);
    bw.writeBits(translateY, nBits);
  }

  bw.flushBits();

  // FILTERLIST (HasFilterList is set when there are enabled filters)
  if (enabledFilters.length > 0) {
    writeFilterList(bw, filters!);
  }

  // BlendMode: UI8
  const blendByte = SWF_BLEND_MODE[blendMode] ?? 0;
  bw.writeUI8(blendByte);

  return bw.getBytes();
}
