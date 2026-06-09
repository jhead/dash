/**
 * SWF text encoding — DefineText (tag 11) for static text fields and
 * DefineEditText (tag 37) for dynamic/input text fields.
 *
 * Coordinates are in twips (1 pixel = 20 twips).
 */
import { BitWriter } from "./bits.js";
import type { TextDisplayObject } from "@flash/core";
import { px, edgeNumBits, writeRect } from "./helpers.js";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Parse a CSS hex color "#rrggbb" → { r, g, b }. */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineText tag body (tag 11) for a static text field.
 *
 * Uses a simplified approach:
 *  - GlyphBits = 8, AdvanceBits = 8 (fixed widths for simplicity)
 *  - Identity TextMatrix (no transform)
 *  - Glyph index = charCode - 32 (matches DefineFont2's 95-glyph ASCII table)
 *  - Advance = fontSize * 0.6 per character (approximate)
 *  - Single TEXTRECORD with font, color, x/y offsets, and all glyphs
 *
 * @param charId    SWF character ID for this text definition
 * @param text      Text string to encode
 * @param fontId    SWF character ID of the referenced font
 * @param fontSize  Font size in twips (fontSize * 20)
 * @param color     CSS hex color string (e.g. "#000000")
 * @param x         X position in twips
 * @param y         Y position in twips
 */
export function encodeDefineText(
  charId: number,
  text: string,
  fontId: number,
  fontSize: number,
  color: string,
  x: number,
  y: number
): Uint8Array {
  const GLYPH_BITS = 8;
  const ADVANCE_BITS = 8;

  const bw = new BitWriter();

  // CharacterId: UI16 LE
  bw.writeUI16LE(charId);

  // TextBounds RECT (approximate based on text length and font size)
  // fontSize is in twips; approximate width = text.length * fontSize * 0.6
  const approxWidth = Math.round(text.length * fontSize * 0.6);
  const approxHeight = Math.round(fontSize * 1.2);
  // Bounds relative to origin; x/y offset applied in TextRecord
  writeRect(bw, 0, approxWidth, 0, approxHeight);

  // TextMatrix: identity matrix
  // MATRIX format:
  //   HasScale UB[1] = 0
  //   HasRotate UB[1] = 0
  //   NTranslateBits UB[5]
  //   TranslateX SB[NTranslateBits]
  //   TranslateY SB[NTranslateBits]
  // For identity (no translate), use NTranslateBits = 1, Tx = 0, Ty = 0
  bw.writeBits(0, 1); // HasScale = 0
  bw.writeBits(0, 1); // HasRotate = 0
  bw.writeBits(1, 5); // NTranslateBits = 1
  bw.writeBits(0, 1); // TranslateX = 0
  bw.writeBits(0, 1); // TranslateY = 0
  bw.flushBits();

  // GlyphBits and AdvanceBits
  bw.writeUI8(GLYPH_BITS);
  bw.writeUI8(ADVANCE_BITS);

  // ---------------------------------------------------------------------------
  // TEXTRECORD (single record with all glyphs)
  // ---------------------------------------------------------------------------
  // First byte of TEXTRECORD:
  //   bit 7 (MSB): TextRecordType = 1 (style change record) — must be 1
  //   bit 6: (reserved) = 0
  //   bit 5: TextHasFont
  //   bit 4: TextHasColor
  //   bit 3: TextHasYOffset
  //   bit 2: TextHasXOffset
  //   bits 1-0: (reserved) = 0
  //
  // Since we set HasFont=1, HasColor=1, HasXOffset=1, HasYOffset=1:
  // byte = 1_0_1_1_1_1_0_0 = 0b10111100 = 0xBC
  bw.writeUI8(0xbc);

  // GlyphCount: UI8 (since TextHasFont is set, the next byte is the glyph count)
  // Wait — per SWF spec: when TextHasFont=1, the GlyphCount is in the first byte
  // bits [3:0] when TextRecordType=1. Re-reading the spec:
  //
  // TEXTRECORD1 (for DefineText):
  //   UB[1]  TextRecordType  — must be 1
  //   UB[3]  StyleFlagsReserved
  //   UB[1]  StyleFlagsHasFont
  //   UB[1]  StyleFlagsHasColor
  //   UB[1]  StyleFlagsHasYOffset
  //   UB[1]  StyleFlagsHasXOffset
  //
  // This is the first byte. Then:
  //   If StyleFlagsHasFont: UI16 FontID, UI16 TextHeight
  //   If StyleFlagsHasColor: RGB (3 bytes for DefineText, RGBA for DefineText2)
  //   If StyleFlagsHasXOffset: SI16 XOffset
  //   If StyleFlagsHasYOffset: SI16 YOffset
  //   UI8 GlyphCount
  //   Then GlyphCount glyph entries: UB[GlyphBits] + SB[AdvanceBits]

  // FontID: UI16 LE
  bw.writeUI16LE(fontId);

  // TextHeight: UI16 LE (font size in twips)
  bw.writeUI16LE(fontSize);

  // TextColor: RGB (3 bytes for DefineText tag 11)
  const rgb = parseHexColor(color);
  bw.writeUI8(rgb.r);
  bw.writeUI8(rgb.g);
  bw.writeUI8(rgb.b);

  // XOffset: SI16 LE
  bw.writeSI16LE(x);

  // YOffset: SI16 LE
  bw.writeSI16LE(y);

  // GlyphCount: UI8
  bw.writeUI8(text.length);

  // Glyph entries: UB[GlyphBits] GlyphIndex, SB[AdvanceBits] GlyphAdvance
  const advance = Math.round(fontSize * 0.6);
  // Clamp advance to fit in signed 8-bit (-128..127)
  const advanceClamped = Math.min(127, Math.max(-128, advance));

  for (let i = 0; i < text.length; i++) {
    const glyphIndex = Math.max(0, text.charCodeAt(i) - 32) & 0xff;
    bw.writeBits(glyphIndex, GLYPH_BITS);
    bw.writeBits(advanceClamped & 0xff, ADVANCE_BITS);
  }
  bw.flushBits();

  // Terminator byte (0x00) — marks end of TEXTRECORD array
  bw.writeUI8(0x00);

  return bw.getBytes();
}

/**
 * Encode a DefineEditText tag body (tag 37) for a TextDisplayObject.
 *
 * The text field is defined at the origin; the actual position is applied
 * via a PlaceObject2 tag. Bounds are derived from width/height.
 *
 * @param charId      SWF character ID for this text field
 * @param obj         The TextDisplayObject to encode
 * @param fontCharId  When provided, sets HasFont=1 and references this embedded font char ID.
 *                    When omitted, uses device fonts (HasFont=0).
 */
export function encodeDefineEditText(
  charId: number,
  obj: TextDisplayObject,
  fontCharId?: number
): Uint8Array {
  const bw = new BitWriter();

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // Bounds RECT in twips (x1=0, y1=0, x2=width, y2=height)
  const x2 = px(obj.width);
  const y2 = px(obj.height);
  writeRect(bw, 0, x2, 0, y2);

  // ---------------------------------------------------------------------------
  // Flags UI16
  // ---------------------------------------------------------------------------
  // bit 0: HasText       — initial text string follows VariableName
  // bit 1: WordWrap
  // bit 2: Multiline
  // bit 3: Password
  // bit 4: ReadOnly      — static and dynamic text are read-only at runtime
  // bit 5: HasTextColor
  // bit 6: HasMaxLength
  // bit 7: HasFont
  // bit 8: HasFontClass (0)
  // bit 9: AutoSize
  // bit 10: HasLayout
  // bit 11: NoSelect     — static text only (not selectable)
  // bit 12: Border (0)
  // bit 13: StoreInDict (0)
  // bit 14: WasStatic    — Flash 8+: set for static text fields
  // bit 15: HTML (0)

  const isStatic = obj.textType === "static";
  const isDynamic = obj.textType === "dynamic";

  // Static and dynamic text are read-only at runtime; input text is editable.
  const isReadOnly = isStatic || isDynamic;

  const hasEmbeddedFont = fontCharId !== undefined;

  // Emit HasText for static/dynamic (always have content) and for input only
  // when there is a non-empty initial value.
  const hasText = isStatic || isDynamic || obj.text.length > 0;

  let flags = 0;
  if (hasText) flags |= 1 << 0;  // HasText
  if (obj.wordWrap) flags |= 1 << 1;
  if (obj.multiline) flags |= 1 << 2;
  if (isReadOnly) flags |= 1 << 4;  // ReadOnly for static and dynamic text
  flags |= 1 << 5;  // HasTextColor
  if (hasEmbeddedFont) flags |= 1 << 7; // HasFont — reference embedded font character
  flags |= 1 << 10; // HasLayout
  if (isStatic) flags |= 1 << 11; // NoSelect for static text only
  if (isStatic) flags |= 1 << 14; // WasStatic — Flash 8+ static text marker

  bw.writeUI16LE(flags);

  // FontID and FontHeight are only present when HasFont (bit 7) is set.
  if (hasEmbeddedFont) {
    bw.writeUI16LE(fontCharId!);                  // FontID: UI16
    bw.writeUI16LE(Math.round(obj.fontSize * 20)); // FontHeight in twips
  }

  // TextColor: RGBA (HasTextColor is set)
  bw.writeUI8(obj.color.r);
  bw.writeUI8(obj.color.g);
  bw.writeUI8(obj.color.b);
  bw.writeUI8(obj.color.a);

  // HasLayout block: Align UI8, LeftMargin UI16, RightMargin UI16, Indent UI16, Leading SI16
  const alignMap: Record<string, number> = {
    left: 0,
    right: 1,
    center: 2,
    justify: 3,
  };
  bw.writeUI8(alignMap[obj.align] ?? 0);

  // LeftMargin: UI16 (HasLayout)
  bw.writeUI16LE(0);

  // RightMargin: UI16 (HasLayout)
  bw.writeUI16LE(0);

  // Indent: UI16 (HasLayout)
  bw.writeUI16LE(0);

  // Leading: SI16 (HasLayout) — 2 twips default line spacing
  bw.writeSI16LE(2);

  // VariableName: null-terminated string (empty for static/dynamic display)
  bw.writeString("");

  // InitialText: null-terminated string (only present when HasText flag is set)
  if (hasText) {
    bw.writeString(obj.text);
  }

  return bw.getBytes();
}

/**
 * Encode a PlaceObject2 tag body for a text display object.
 * Positions the text field at (x, y) pixels.
 */
export function encodePlaceObject2ForText(
  charId: number,
  depth: number,
  x: number,
  y: number
): Uint8Array {
  const bw = new BitWriter();

  // Flags: hasCharacter (bit 1) | hasMatrix (bit 2) → 0x06
  bw.writeUI8(0x06);

  // Depth: UI16
  bw.writeUI16LE(depth);

  // CharacterId: UI16
  bw.writeUI16LE(charId);

  // MATRIX (translation only)
  const tx = px(x);
  const ty = px(y);

  const nBits = edgeNumBits([tx, ty]);

  // hasScale = 0
  bw.writeBits(0, 1);
  // hasRotate = 0
  bw.writeBits(0, 1);
  // Translate is unconditional per SWF spec (no flag bit)
  bw.writeBits(nBits, 5);
  bw.writeBits(tx, nBits);
  bw.writeBits(ty, nBits);
  bw.flushBits();

  return bw.getBytes();
}
