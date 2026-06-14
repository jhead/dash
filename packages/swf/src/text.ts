/**
 * SWF text encoding — DefineText (tag 11) for static text fields and
 * DefineEditText (tag 37) for dynamic/input text fields.
 *
 * Coordinates are in twips (1 pixel = 20 twips).
 */
import { BitWriter } from "./bits.js";
import type { TextDisplayObject } from "@flash/core";
import { px, edgeNumBits, writeRect } from "./helpers.js";
import { GLYPH_ADVANCE_EM, FONT_EM, glyphAdvanceEm, kerningAdjustEm } from "./fonts.js";

/**
 * Advance (in twips) for a glyph at the given text height (twips), derived from
 * the embedded font's real per-glyph EM advance so spacing matches the outlines.
 */
function glyphAdvanceTwips(code: number, textHeightTwips: number): number {
  return Math.round((glyphAdvanceEm(code) / FONT_EM) * textHeightTwips);
}

/**
 * Total advance width (in twips) of a static-text run, using the SAME per-glyph
 * advances (and optional baked kerning) that {@link encodeDefineText} emits.
 * Used by the compiler to compute the centered/right-aligned X start offset so
 * the published static glyphs sit where Flash placed them in the text box.
 */
export function measureTextWidthTwips(
  text: string,
  fontSizeTwips: number,
  autoKern = false
): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let advance = glyphAdvanceTwips(code, fontSizeTwips);
    if (autoKern && i + 1 < text.length) {
      const km = kerningAdjustEm(code, text.charCodeAt(i + 1));
      if (km !== 0) advance += Math.round((km / FONT_EM) * fontSizeTwips);
    }
    if (advance < 0) advance = 0;
    total += advance;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Escape the five XML special chars so plain text is safe inside an HTML wrapper. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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
  y: number,
  /**
   * When true, bake the embedded font's pair kerning into the per-glyph
   * advances. This matches Flash 8, which stores kerned advances directly in the
   * DefineText record for static "Auto kern" fields (rather than relying on a
   * runtime KerningTable as dynamic/input fields do).
   */
  autoKern = false,
  /**
   * Optional code-point → glyph-index map for the referenced (possibly subsetted)
   * font. When omitted, the legacy mapping `glyphIndex = code - 32` is used, which
   * matches the full default 95-glyph table (codes 32–126) — byte-identical to the
   * historical behavior. When the font has been subsetted to a chosen embed range,
   * pass the map so glyph indices point at the right entries in the subset table.
   */
  glyphIndexByCode?: ReadonlyMap<number, number>
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
    // Glyph index into the (possibly subsetted) font glyph table. With the full
    // default table this is `code - 32`; with a subset, look it up in the map.
    const mappedIndex = glyphIndexByCode?.get(code);
    const glyphIndex = (mappedIndex ?? Math.max(0, code - 32)) & 0xff;
    let advance = glyphAdvanceTwips(code, fontSize);
    // Bake pair kerning into this glyph's advance (Flash-accurate static kerning):
    // the adjustment for (this glyph, next glyph) is added in the same EM space
    // as the advance and scaled to twips. Negative tightens the following glyph.
    if (autoKern && i + 1 < text.length) {
      const km = kerningAdjustEm(code, text.charCodeAt(i + 1));
      if (km !== 0) advance += Math.round((km / FONT_EM) * fontSize);
    }
    // Clamp to a non-negative advance so a large kern cannot wrap the SI16.
    if (advance < 0) advance = 0;
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
  //
  // NOTE: DefineEditText has no vertical-orientation flag. Flash stores orientation
  // in the binary FLA CPicText per-run vertical/rtl bytes; published SWF vertical
  // text uses DefineText glyph layout or runtime TextField layout, not an EditText
  // flag. obj.orientation is preserved in the model for import/re-export round-trips.

  const isStatic = obj.textType === "static";
  const isDynamic = obj.textType === "dynamic";
  const isInput = obj.textType === "input";

  // Static and dynamic text are read-only at runtime; input text is editable.
  const isReadOnly = isStatic || isDynamic;

  const hasEmbeddedFont = fontCharId !== undefined;

  // When html=true, the initial content is the HTML string (htmlText); otherwise
  // plain text. For encoding purposes we use whichever string is authoritative.
  //
  // Single-run super/subscript: if characterPosition is 1 (superscript) or 2
  // (subscript) and the field is not already using HTML markup, wrap the plain
  // text in <sup>…</sup> or <sub>…</sub> and force the HTML flag so Ruffle
  // renders the correct baseline/size shift.
  const charPos = obj.characterPosition ?? 0;
  const needsHtmlWrap = charPos !== 0 && obj.html !== true;
  // Auto kern: applying the embedded font's kerning pairs requires the field to
  // render with the EMBEDDED font (UseOutlines=1 → FontType::Embedded) AND for
  // the player's TextFormat kerning flag to be on. DefineEditText's flags carry
  // no kerning bit and Ruffle hardcodes kerning=false at parse time, so we turn
  // kerning on via an HTML <font kerning="1"> wrapper (SWF>=8 only — see Ruffle
  // html/text_format.rs). This forces HTML mode for the field.
  const autoKern = obj.autoKern === true && hasEmbeddedFont;
  // Hyperlink: when linkUrl is non-empty, wrap the content in an HTML anchor and
  // force the HTML flag so the player renders a clickable link (getURL on click).
  const linkUrl = (obj.linkUrl ?? "").trim();
  const linkTarget = (obj.linkTarget ?? "").trim();
  const hasLink = linkUrl.length > 0;
  const isHtml = obj.html === true || needsHtmlWrap || autoKern || hasLink;
  let initialContent: string;
  if (needsHtmlWrap) {
    const tag = charPos === 1 ? "sup" : "sub";
    initialContent = `<${tag}>${obj.text}</${tag}>`;
  } else if (obj.html === true && obj.htmlText != null) {
    initialContent = obj.htmlText;
  } else {
    initialContent = obj.text;
  }
  // Wrap the (plain) content in a kerning-enabling <font> tag. Preserve the
  // field's face/size/color and bold/italic so rendering is identical apart
  // from the pair-kerning adjustment.
  if (autoKern && obj.html !== true && charPos === 0) {
    const sizePt = Math.round(obj.fontSize);
    const colorHex = `#${obj.color.r.toString(16).padStart(2, "0")}${obj.color.g
      .toString(16)
      .padStart(2, "0")}${obj.color.b.toString(16).padStart(2, "0")}`;
    let inner = escapeHtmlText(initialContent);
    if (obj.italic) inner = `<i>${inner}</i>`;
    if (obj.bold) inner = `<b>${inner}</b>`;
    initialContent = `<font face="${obj.fontFamily}" size="${sizePt}" color="${colorHex}" kerning="1">${inner}</font>`;
  }

  // Hyperlink anchor wrap. The anchor goes OUTSIDE any existing markup so the
  // entire visible text is clickable. If the content is still plain (no other
  // markup forced HTML), escape it before placing it inside the anchor element.
  if (hasLink) {
    const contentIsMarkup = obj.html === true || needsHtmlWrap || (autoKern && charPos === 0);
    const inner = contentIsMarkup ? initialContent : escapeHtmlText(initialContent);
    const hrefAttr = ` href="${escapeHtmlText(linkUrl)}"`;
    const targetAttr = linkTarget ? ` target="${escapeHtmlText(linkTarget)}"` : "";
    initialContent = `<a${hrefAttr}${targetAttr}>${inner}</a>`;
  }

  // Emit HasText for static/dynamic (always have content) and for input only
  // when there is a non-empty initial value.
  const hasText = isStatic || isDynamic || initialContent.length > 0;

  // HasMaxLength: only meaningful for input text; set when maxChars > 0.
  const hasMaxLength = isInput && obj.maxChars != null && obj.maxChars > 0;

  let flags = 0;
  if (hasEmbeddedFont) flags |= 1 << 0;  // HasFont — provides FontID + FontHeight for size
  if (hasMaxLength) flags |= 1 << 1;     // HasMaxLength
  flags |= 1 << 2;                       // HasTextColor
  if (isReadOnly) flags |= 1 << 3;       // ReadOnly for static and dynamic text
  if (isInput && obj.password) flags |= 1 << 4;  // Password — mask characters
  if (obj.multiline) flags |= 1 << 5;    // Multiline
  if (obj.wordWrap) flags |= 1 << 6;     // WordWrap
  if (hasText) flags |= 1 << 7;          // HasText
  // NOTE: UseOutlines (bit 8) is normally NOT set: setting it forces Ruffle to
  // use our embedded font glyphs instead of system device fonts. For "Auto kern"
  // we MUST set it, because kerning pairs live in our embedded DefineFont3 layout
  // block and Ruffle only consults them when the field renders with the embedded
  // font (FontType::Embedded). Without UseOutlines the field uses a device font
  // whose kerning we do not control. (Ruffle layout.rs resolve_font / font.rs.)
  if (autoKern) flags |= 1 << 8;         // UseOutlines — render with embedded font (enables our kerning table)
  if (isHtml) flags |= 1 << 9;           // HTML — enables Flash HTML markup in text content
  if (isStatic) flags |= 1 << 10;        // WasStatic — Flash 8+ static marker
  if (obj.hasBorder || obj.hasBackground) flags |= 1 << 11;   // Border — draw border rectangle and/or background fill
  // NoSelect: always set for static text; for dynamic/input, set only when selectable === false
  // (undefined/omitted means selectable=true, so NoSelect is clear by default)
  if (isStatic || (!isStatic && obj.selectable === false)) flags |= 1 << 12;
  flags |= 1 << 13;                      // HasLayout
  if (obj.autoSize) flags |= 1 << 14;   // AutoSize — field resizes to fit content

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

  // MaxLength: UI16 (only present when HasMaxLength is set)
  // Field order per Ruffle read.rs: HAS_MAX_LENGTH is read after HAS_TEXT_COLOR
  // and before HAS_LAYOUT.
  if (hasMaxLength) {
    bw.writeUI16LE(obj.maxChars!);
  }

  // HasLayout block: Align UI8, LeftMargin UI16, RightMargin UI16, Indent UI16, Leading SI16
  const alignMap: Record<string, number> = {
    left: 0,
    right: 1,
    center: 2,
    justify: 3,
  };
  bw.writeUI8(alignMap[obj.align] ?? 0);

  // LeftMargin: UI16 (HasLayout) — convert px to twips (1px = 20 twips)
  bw.writeUI16LE(obj.leftMargin != null ? Math.round(obj.leftMargin * 20) : 0);

  // RightMargin: UI16 (HasLayout) — convert px to twips
  bw.writeUI16LE(obj.rightMargin != null ? Math.round(obj.rightMargin * 20) : 0);

  // Indent: UI16 (HasLayout) — convert px to twips
  bw.writeUI16LE(obj.indent != null ? Math.round(obj.indent * 20) : 0);

  // Leading: SI16 (HasLayout) — convert px to twips, default 0 (no extra spacing)
  // NOTE: letterSpacing is a TextFormat runtime property, not a DefineEditText field.
  // It is applied via a DoAction tag in compile.ts (var _tf=new TextFormat();
  // _tf.letterSpacing=N; _root.<instanceName>.setTextFormat(_tf);) for named fields.
  bw.writeSI16LE(obj.leading != null ? Math.round(obj.leading * 20) : 0);

  // VariableName: null-terminated string (AS1/AS2 variable binding for this text field)
  bw.writeString(obj.as2VariableName ?? "");

  // InitialText: null-terminated string (only present when HasText flag is set).
  // When html=true, emit the HTML-formatted string (htmlText) so Flash's HTML
  // renderer can apply per-run font/size/color/bold/italic markup.
  if (hasText) {
    bw.writeString(initialContent);
  }

  return bw.getBytes();
}

/**
 * Encode a CSMTextSettings tag body (tag 74) for a DefineEditText character.
 *
 * Tag 74 layout (SWF spec §12.12 / Ruffle swf/src/read.rs `read_csm_text_settings`):
 *   UI16   textID         — character ID of the DefineEditText / DefineText
 *   UB[3]  UseFlashType   — 0=normal renderer, 1=FlashType renderer
 *   UB[3]  GridFit        — 0=none, 1=pixel, 2=subpixel
 *   UB[2]  reserved = 0
 *   FLOAT  thickness       — sub-pixel thickness hint (IEEE 754 32-bit, LE)
 *   FLOAT  sharpness       — sub-pixel sharpness hint (IEEE 754 32-bit, LE)
 *   UI8    reserved = 0
 *
 * For antiAlias === "readability": UseFlashType=1, GridFit=1, thickness=0, sharpness=0.
 * For antiAlias === "custom": UseFlashType=1, GridFit=1, thickness=csm.thickness, sharpness=csm.sharpness.
 *
 * Note: DefineFontAlignZones (tag 73) is emitted in compile.ts immediately after
 * each DefineFont3 tag (for all embedded fonts). This provides per-glyph stem-width
 * hint zones and enables the full FlashType sub-pixel rendering path in Ruffle.
 *
 * @param textCharId  SWF character ID of the text field (DefineEditText charId)
 * @param thickness   Sub-pixel thickness hint (0.0 for readability mode)
 * @param sharpness   Sub-pixel sharpness hint (0.0 for readability mode)
 */
export function encodeCSMTextSettings(
  textCharId: number,
  thickness: number,
  sharpness: number
): Uint8Array {
  // Total size: 2 (UI16 textID) + 1 (UB[8] flags) + 4 (FLOAT thickness) + 4 (FLOAT sharpness) + 1 (UI8 reserved) = 12 bytes
  const buf = new Uint8Array(12);
  const view = new DataView(buf.buffer);

  // textID: UI16 LE
  view.setUint16(0, textCharId, true /* LE */);

  // Flags byte: UB[3] UseFlashType=1 | UB[3] GridFit=1 | UB[2] reserved=0
  // Bits 7-5: UseFlashType (3 bits), bits 4-2: GridFit (3 bits), bits 1-0: reserved
  // UseFlashType=1 → 0b001 << 5 = 0x20
  // GridFit=1      → 0b001 << 2 = 0x04
  buf[2] = 0x20 | 0x04; // 0x24

  // thickness: FLOAT (IEEE 754 32-bit, little-endian)
  view.setFloat32(3, thickness, true /* LE */);

  // sharpness: FLOAT (IEEE 754 32-bit, little-endian)
  view.setFloat32(7, sharpness, true /* LE */);

  // reserved: UI8 = 0 (already 0 from Uint8Array init)
  // buf[11] = 0;

  return buf;
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
