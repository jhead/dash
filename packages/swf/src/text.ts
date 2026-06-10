/**
 * SWF text encoding — DefineText (tag 11) for static text fields and
 * DefineEditText (tag 37) for dynamic/input text fields.
 *
 * Coordinates are in twips (1 pixel = 20 twips).
 */
import { BitWriter } from "./bits.js";
import type { TextDisplayObject } from "@flash/core";
import { px, edgeNumBits, writeRect } from "./helpers.js";
import { GLYPH_ADVANCE_EM, FONT_EM, glyphAdvanceEm } from "./fonts.js";

/**
 * Advance (in twips) for a glyph at the given text height (twips), derived from
 * the embedded font's real per-glyph EM advance so spacing matches the outlines.
 */
function glyphAdvanceTwips(code: number, textHeightTwips: number): number {
  return Math.round((glyphAdvanceEm(code) / FONT_EM) * textHeightTwips);
}

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
  // Advances are in twips and can exceed an 8-bit signed range for larger text
  // (e.g. 660/1024 * 480 ≈ 309 twips), so use 16 advance bits.
  const ADVANCE_BITS = 16;

  const bw = new BitWriter();

  // CharacterId: UI16 LE
  bw.writeUI16LE(charId);

  // TextBounds RECT. The glyph baseline is at y = `y` (the TextRecord YOffset)
  // and outlines extend upward from there, so bounds span from above the
  // baseline down past it. fontSize is in twips.
  const approxWidth =
    x + Math.round(text.length * (GLYPH_ADVANCE_EM / FONT_EM) * fontSize);
  const top = y - fontSize; // ascenders above baseline
  const bottom = y + Math.round(fontSize * 0.3); // descenders below baseline
  writeRect(bw, 0, approxWidth, top, bottom);

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
  // First byte is a GlyphStyleChange record. The style flags are (per SWF spec
  // §16, matching Ruffle's read_text_record):
  //   bit 7: TextRecordType = 1 (must be 1 for a style-change record)
  //   bits 6-4: reserved = 0
  //   bit 3 (0b1000): StyleFlagsHasFont
  //   bit 2 (0b0100): StyleFlagsHasColor
  //   bit 1 (0b0010): StyleFlagsHasYOffset
  //   bit 0 (0b0001): StyleFlagsHasXOffset
  //
  // We set HasFont|HasColor|HasYOffset|HasXOffset → low nibble 0b1111, plus the
  // record-type bit (0x80): 0x80 | 0x0F = 0x8F.
  bw.writeUI8(0x8f);

  // The fields then follow in this exact order (this is what Ruffle reads):
  //   HasFont    → UI16 FontID
  //   HasColor   → RGB (DefineText) / RGBA (DefineText2)
  //   HasXOffset → SI16 XOffset
  //   HasYOffset → SI16 YOffset
  //   HasFont    → UI16 TextHeight   (height is read AFTER the offsets!)
  //   UI8 GlyphCount
  //   then GlyphCount × (UB[GlyphBits] index, SB[AdvanceBits] advance)

  // FontID: UI16 LE
  bw.writeUI16LE(fontId);

  // TextColor: RGB (3 bytes for DefineText tag 11)
  const rgb = parseHexColor(color);
  bw.writeUI8(rgb.r);
  bw.writeUI8(rgb.g);
  bw.writeUI8(rgb.b);

  // XOffset: SI16 LE
  bw.writeSI16LE(x);

  // YOffset: SI16 LE
  bw.writeSI16LE(y);

  // TextHeight: UI16 LE (font size in twips) — comes after the offsets.
  bw.writeUI16LE(fontSize);

  // GlyphCount: UI8
  bw.writeUI8(text.length);

  // Glyph entries: UB[GlyphBits] GlyphIndex, SB[AdvanceBits] GlyphAdvance.
  // Advance is per-glyph in twips, derived from the embedded font's EM metrics
  // so the spacing matches the real glyph outlines.
  const advMask = (1 << ADVANCE_BITS) - 1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const glyphIndex = Math.max(0, code - 32) & 0xff;
    const advance = glyphAdvanceTwips(code, fontSize);
    bw.writeBits(glyphIndex, GLYPH_BITS);
    bw.writeBits(advance & advMask, ADVANCE_BITS);
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
  // Flags UI16 — bit positions per SWF spec / Ruffle's EditTextFlag.
  // ---------------------------------------------------------------------------
  // bit 0:  HasFont        — FontID + FontHeight follow
  // bit 1:  HasMaxLength
  // bit 2:  HasTextColor
  // bit 3:  ReadOnly
  // bit 4:  Password
  // bit 5:  Multiline
  // bit 6:  WordWrap
  // bit 7:  HasText        — initial text string follows VariableName
  // bit 8:  UseOutlines    — render with embedded font outlines (vs device font)
  // bit 9:  HTML
  // bit 10: WasStatic      — Flash 8+: set for static text fields
  // bit 11: Border
  // bit 12: NoSelect       — not selectable (static text)
  // bit 13: HasLayout      — layout block follows the color
  // bit 14: AutoSize
  // bit 15: HasFontClass

  const isStatic = obj.textType === "static";
  const isDynamic = obj.textType === "dynamic";

  // Static and dynamic text are read-only at runtime; input text is editable.
  const isReadOnly = isStatic || isDynamic;

  const hasEmbeddedFont = fontCharId !== undefined;

  // Emit HasText for static/dynamic (always have content) and for input only
  // when there is a non-empty initial value.
  const hasText = isStatic || isDynamic || obj.text.length > 0;

  let flags = 0;
  if (hasEmbeddedFont) flags |= 1 << 0;  // HasFont — provides FontID + FontHeight for size
  flags |= 1 << 2;                       // HasTextColor
  if (isReadOnly) flags |= 1 << 3;       // ReadOnly for static and dynamic text
  if (obj.multiline) flags |= 1 << 5;    // Multiline
  if (obj.wordWrap) flags |= 1 << 6;     // WordWrap
  if (hasText) flags |= 1 << 7;          // HasText
  // NOTE: UseOutlines (bit 8) is intentionally NOT set. Setting it would force
  // Ruffle to use our custom embedded 5×7 pixel-art glyphs instead of system
  // device fonts, making the text look "mangled". With UseOutlines=0, Ruffle
  // renders with device fonts (real Arial, etc.) at the size given by FontHeight.
  if (isStatic) flags |= 1 << 10;        // WasStatic — Flash 8+ static marker
  if (isStatic) flags |= 1 << 12;        // NoSelect for static text only
  flags |= 1 << 13;                      // HasLayout

  bw.writeUI16LE(flags);

  // FontID and FontHeight are only present when HasFont (bit 0) is set.
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
