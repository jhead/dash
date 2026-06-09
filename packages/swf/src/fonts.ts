/**
 * SWF font embedding — DefineFont2 (tag 48).
 *
 * Emits placeholder glyph data for printable ASCII (codes 32–126 = 95 glyphs)
 * without requiring DOM canvas or browser APIs. Uses approximate metrics based
 * on standard Flash em-unit conventions (1024 twips per em).
 */
import { BitWriter } from "./bits.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First printable ASCII code point. */
const FIRST_CODE = 32;
/** Last printable ASCII code point. */
const LAST_CODE = 126;
/** Total number of glyphs we embed (ASCII 32–126). */
const GLYPH_COUNT = LAST_CODE - FIRST_CODE + 1; // 95

/** Advance width (twips) for most glyphs (approx 60% of em = 600/1024 em). */
const ADVANCE_DEFAULT = 600;
/** Advance width (twips) for space character. */
const ADVANCE_SPACE = 300;

/** Font metrics in twips (1024-unit em square). */
const ASCENT = 800;
const DESCENT = 200;
const LEADING = 40;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineFont2 tag body (tag 48) for the given font.
 *
 * Produces 95 placeholder glyphs for printable ASCII (codes 32–126).
 * Each glyph shape is a minimal empty shape (no contours). Layout metrics
 * are approximated using a 1024-unit em square — the standard Flash convention.
 *
 * The result is the tag *body* (without the tag-record header); pass it to
 * SwfWriter.writeTag(Tag.DefineFont2, body).
 */
export function encodeDefineFont2(
  charId: number,
  fontName: string,
  isBold: boolean,
  isItalic: boolean
): Uint8Array {
  const bw = new BitWriter();

  // FontID: UI16
  bw.writeUI16LE(charId);

  // Flags byte 1 (MSB to LSB within the byte, but written as a plain UI8):
  // bit7: FontFlagsHasLayout = 1
  // bit6: FontFlagsShiftJIS  = 0
  // bit5: FontFlagsSmallText = 0
  // bit4: FontFlagsANSI      = 0
  // bit3: FontFlagsWideOffsets = 1 (32-bit offsets)
  // bit2: FontFlagsWideCodes   = 1 (16-bit code table entries)
  // bit1: FontFlagsItalic
  // bit0: FontFlagsBold
  let fontFlags = 0;
  fontFlags |= 0x80; // HasLayout
  fontFlags |= 0x08; // WideOffsets
  fontFlags |= 0x04; // WideCodes
  if (isItalic) fontFlags |= 0x02;
  if (isBold) fontFlags |= 0x01;
  bw.writeUI8(fontFlags);

  // LanguageCode: UI8 (0 = undefined/don't care)
  bw.writeUI8(0);

  // FontNameLen + FontName (ASCII, no null terminator inside name field)
  const nameBytes = new TextEncoder().encode(fontName);
  bw.writeUI8(nameBytes.length);
  bw.writeBytes(nameBytes);

  // GlyphCount: UI16
  bw.writeUI16LE(GLYPH_COUNT);

  // ---------------------------------------------------------------------------
  // OffsetTable: (GlyphCount + 1) UI32 values (WideOffsets=1).
  // Offsets are relative to the start of the OffsetTable itself.
  //
  // Layout:
  //   OffsetTable: (GLYPH_COUNT + 1) × 4 bytes = 96 × 4 = 384 bytes
  //   GlyphShapeTable: each glyph = 2 bytes → GLYPH_COUNT × 2 = 190 bytes
  //   CodeTable: GLYPH_COUNT × 2 bytes (WideCodes) = 190 bytes
  //
  // OffsetTable[i]           = (GLYPH_COUNT + 1) * 4 + i * 2
  // OffsetTable[GLYPH_COUNT] = CodeTableOffset = (GLYPH_COUNT + 1) * 4 + GLYPH_COUNT * 2
  // ---------------------------------------------------------------------------

  const offsetTableSize = (GLYPH_COUNT + 1) * 4; // bytes
  const glyphBodySize = 2; // bytes per empty glyph shape

  for (let i = 0; i < GLYPH_COUNT; i++) {
    const offset = offsetTableSize + i * glyphBodySize;
    bw.writeUI32LE(offset);
  }
  // CodeTableOffset (last entry)
  const codeTableOffset = offsetTableSize + GLYPH_COUNT * glyphBodySize;
  bw.writeUI32LE(codeTableOffset);

  // ---------------------------------------------------------------------------
  // GlyphShapeTable: GLYPH_COUNT empty SHAPE records.
  //
  // Each empty SHAPE:
  //   byte 0: NumFillBits(4 bits)=0, NumLineBits(4 bits)=0 → 0x00
  //   byte 1: EndShapeRecord packed as 6 bits: TypeFlag(1b=0)+EndShapeFlag(5b=11111)
  //           = 0b00111111 = 0x3F, padded to a full byte → 0x3F
  //           (the upper 2 bits are padding zeros after the 6-bit record)
  //
  // Note: in SWF bit packing, the EndShapeRecord is TypeFlag=0 followed by
  // ShapeRecordEdgeBits (5 bits) all = 1 = 0b11111. Packed MSB-first:
  //   bits: 0 1 1 1 1 1 → byte value with 2 pad bits → 0b00111111 = 0x3F
  // ---------------------------------------------------------------------------
  for (let i = 0; i < GLYPH_COUNT; i++) {
    bw.writeUI8(0x00); // NumFillBits=0, NumLineBits=0
    bw.writeUI8(0x3f); // EndShapeRecord (6 bits packed, 2 pad bits)
  }

  // ---------------------------------------------------------------------------
  // CodeTable: GLYPH_COUNT UI16 entries (WideCodes=1) — Unicode code points.
  // ---------------------------------------------------------------------------
  for (let i = 0; i < GLYPH_COUNT; i++) {
    bw.writeUI16LE(FIRST_CODE + i);
  }

  // ---------------------------------------------------------------------------
  // Layout block (HasLayout=1):
  //   Ascent:  SI16
  //   Descent: SI16
  //   Leading: SI16
  //   AdvanceTable: GLYPH_COUNT SI16 values
  //   BoundsTable: GLYPH_COUNT RECT records
  //   KerningCount: UI16 = 0
  // ---------------------------------------------------------------------------

  bw.writeSI16LE(ASCENT);
  bw.writeSI16LE(DESCENT);
  bw.writeSI16LE(LEADING);

  // AdvanceTable
  for (let i = 0; i < GLYPH_COUNT; i++) {
    const codePoint = FIRST_CODE + i;
    const advance = codePoint === 32 /* space */ ? ADVANCE_SPACE : ADVANCE_DEFAULT;
    bw.writeSI16LE(advance);
  }

  // BoundsTable — one RECT per glyph, all empty (0,0,0,0).
  // An empty RECT uses Nbits=1, all four coords = 0: 5 bits + 4×1 bit = 9 bits → 2 bytes.
  for (let i = 0; i < GLYPH_COUNT; i++) {
    // Nbits=1 (5 bits), Xmin=0, Xmax=0, Ymin=0, Ymax=0 (each 1 bit)
    // total = 9 bits → flush to 2 bytes: 0b00001_0_0_0_0 = 0x08, pad → [0x08, 0x00]
    bw.writeBits(1, 5);  // Nbits = 1
    bw.writeBits(0, 1);  // Xmin
    bw.writeBits(0, 1);  // Xmax
    bw.writeBits(0, 1);  // Ymin
    bw.writeBits(0, 1);  // Ymax
    bw.flushBits();
  }

  // KerningCount: UI16 = 0
  bw.writeUI16LE(0);

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Font key helper
// ---------------------------------------------------------------------------

/**
 * Compute the canonical map key for a font face.
 * Used to deduplicate fonts across TextDisplayObjects.
 */
export function fontKey(name: string, bold: boolean, italic: boolean): string {
  return `${name}:${bold ? "bold" : ""}:${italic ? "italic" : ""}`;
}
