/**
 * SWF font embedding — DefineFont2 (tag 48) / DefineFont3 (tag 75).
 *
 * Emits REAL vector glyph outlines for printable ASCII (codes 32–126 = 95
 * glyphs) so embedded text actually renders in Ruffle / Flash Player.
 *
 * The glyphs are TTF-derived: `glyphdata.ts` is generated at build time from a
 * bundled copy of NotoSans (SIL OFL) via opentype.js, giving each glyph a list
 * of MoveTo / LineTo / QuadTo commands on a 1024-unit EM square. We translate
 * those commands directly into SWF shape records (StraightEdge + CurvedEdge).
 * For any code point that lacks a real outline we fall back to a compact 5×7
 * bitmap glyph (each "on" cell → one filled square), so text always renders.
 *
 * Why this works in Ruffle: `swf_glyph_to_shape()` wraps each glyph's
 * shape-records in a Shape whose single fill style (index 1) is white, and the
 * text rendering path recolors that fill with the TEXTRECORD/EditText color.
 * So every contour we emit must reference fill-style index 1 via a
 * StyleChangeRecord; the actual colour comes from the text field, not the glyph.
 */
import { BitWriter } from "./bits.js";
import {
  glyphCells,
  FONT_COLS,
  FONT_ROWS,
  glyphPath,
  glyphAdvance,
  GlyphOp,
  GLYPH_EM,
  GLYPH_ASCENT,
  GLYPH_DESCENT,
} from "./glyphdata.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First printable ASCII code point. */
const FIRST_CODE = 32;
/** Last printable ASCII code point. */
const LAST_CODE = 126;
/** Default glyph count when embedding the full printable-ASCII set (32–126). */
export const DEFAULT_GLYPH_COUNT = LAST_CODE - FIRST_CODE + 1; // 95

/**
 * The full default embedded code-point set: printable ASCII 32–126. When a font
 * is used without any explicit "Embed…" range selection, this complete set is
 * embedded — byte-identical to the historical (embed-everything) behavior.
 */
export const FULL_CODE_POINTS: readonly number[] = (() => {
  const out: number[] = [];
  for (let c = FIRST_CODE; c <= LAST_CODE; c++) out.push(c);
  return out;
})();

/** Named glyph range → the printable-ASCII code points it embeds. */
const RANGE_CODE_POINTS: Record<string, number[]> = {
  uppercase: range(0x41, 0x5a), // A–Z
  lowercase: range(0x61, 0x7a), // a–z
  numerals: range(0x30, 0x39), // 0–9
  // Punctuation: every printable-ASCII char that is NOT a letter, digit, or space.
  punctuation: FULL_CODE_POINTS.filter(
    (c) =>
      c !== 0x20 &&
      !(c >= 0x41 && c <= 0x5a) &&
      !(c >= 0x61 && c <= 0x7a) &&
      !(c >= 0x30 && c <= 0x39)
  ),
  all: [...FULL_CODE_POINTS],
};

function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let c = lo; c <= hi; c++) out.push(c);
  return out;
}

/**
 * Compute the sorted set of printable-ASCII code points to embed for a field,
 * given its chosen named ranges, free-text "specific characters", and the
 * characters its own text strictly requires.
 *
 * - `ranges === undefined` → the user has NOT opted into subsetting; returns the
 *   full default set (32–126) so output is byte-identical to embed-everything.
 * - `ranges` present (even empty) → returns the union of the named ranges, the
 *   specific chars, and the field's text — clamped to printable ASCII (32–126)
 *   and always including space (0x20) so layout/advances stay well-formed.
 */
export function computeEmbedCodePoints(
  ranges: readonly string[] | undefined,
  specificChars: string | undefined,
  fieldText: string | undefined
): number[] {
  if (ranges === undefined) return [...FULL_CODE_POINTS];

  const set = new Set<number>();
  set.add(0x20); // always embed space so spacing/advances resolve
  for (const r of ranges) {
    const cps = RANGE_CODE_POINTS[r];
    if (cps) for (const c of cps) set.add(c);
  }
  const addPrintable = (s: string | undefined) => {
    if (!s) return;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= FIRST_CODE && c <= LAST_CODE) set.add(c);
    }
  };
  addPrintable(specificChars);
  addPrintable(fieldText);

  return [...set].sort((a, b) => a - b);
}

/** EM square size in font units — matches the TTF (NotoSans unitsPerEm). */
const EM = GLYPH_EM; // 1024

/** Font metrics in EM units, taken from the embedded TTF. */
const ASCENT = GLYPH_ASCENT; // 784
const DESCENT = GLYPH_DESCENT; // 247
const LEADING = 40;

/**
 * 5×7 fallback-glyph layout within the EM box.
 *
 * Only used for code points that have no real TTF outline. The cell grid is
 * mapped into a box above the baseline (y = 0, negative y pointing up the way
 * SWF font glyphs are conventionally laid out), with a left side bearing so the
 * blocky fallback glyphs do not touch.
 */
const CELL = 100; // size of each grid cell in EM units
const GLYPH_LEFT = 80; // left side bearing
const CAP_TOP = -720; // top of the glyph box (negative = above baseline)
/** Advance width for a 5×7 fallback glyph (cells span + bearings). */
const FALLBACK_ADVANCE = GLYPH_LEFT + FONT_COLS * CELL + GLYPH_LEFT; // 660
/** Default/space advances used by the text encoder (real-font derived). */
const ADVANCE_DEFAULT = Math.round(glyphAdvance(0x41)); // 'A'
const ADVANCE_SPACE = Math.round(glyphAdvance(0x20)); // space

// ---------------------------------------------------------------------------
// Kerning pairs ("Auto kern")
// ---------------------------------------------------------------------------

/**
 * Common kerning pairs and their adjustment in **EM units** (negative = tighten
 * the pair, the usual case). Adjustments are stored in the same EM coordinate
 * space as glyph advances; the SWF encoder scales them by `coordScale` (20 for
 * DefineFont3) when writing the KerningTable, and Ruffle adds the (scaled)
 * adjustment to the left glyph's advance before applying the font→pixel scale
 * (see ruffle core/src/font.rs `evaluate`, where `advance += kerning`).
 *
 * NotoSans-Regular ships no GPOS/`kern` pairs (opentype `getKerningValue`
 * returns 0 for every ASCII pair), so this table is hand-authored from the
 * canonical Latin pairs every type designer kerns. Magnitudes are intentionally
 * generous (~10% EM) so the effect is clearly visible at typical sizes — Flash's
 * own auto-kern is similarly aggressive for the metrics-based device path.
 */
const KERNING_PAIRS_EM: ReadonlyArray<readonly [string, string, number]> = [
  // Capital + capital
  ["A", "V", -110], ["A", "W", -100], ["A", "Y", -110], ["A", "T", -110],
  ["V", "A", -110], ["W", "A", -100], ["Y", "A", -110], ["T", "A", -110],
  ["L", "T", -110], ["L", "V", -110], ["L", "W", -100], ["L", "Y", -110],
  ["F", "A", -90], ["P", "A", -100], ["R", "T", -50], ["R", "V", -50],
  ["K", "V", -50], ["K", "W", -40], ["K", "Y", -50],
  // Capital + lowercase
  ["T", "o", -120], ["T", "a", -120], ["T", "e", -120], ["T", "r", -90],
  ["T", "u", -90], ["T", "w", -90], ["T", "y", -90], ["T", "c", -120],
  ["T", "s", -110], ["T", ".", -120], ["T", ",", -120],
  ["V", "a", -90], ["V", "e", -90], ["V", "o", -90], ["V", "r", -60],
  ["V", ".", -120], ["V", ",", -120],
  ["W", "a", -70], ["W", "e", -70], ["W", "o", -70], ["W", ".", -90], ["W", ",", -90],
  ["Y", "a", -110], ["Y", "e", -110], ["Y", "o", -110], ["Y", "u", -90],
  ["Y", ".", -120], ["Y", ",", -120],
  ["F", ".", -120], ["F", ",", -120],
  ["P", ".", -120], ["P", ",", -120],
  // Lowercase + punctuation
  ["r", ".", -50], ["r", ",", -50],
  ["v", ".", -80], ["v", ",", -80],
  ["w", ".", -60], ["w", ",", -60],
  ["y", ".", -80], ["y", ",", -80],
  ["f", "f", -40],
];

/**
 * Encode the KerningTable portion of a DefineFont2/3 layout block.
 *
 * Format (SWF spec §10.3 / ruffle read.rs `read_kerning_record`, with
 * FontFlagsWideCodes=1 so codes are UI16):
 *   UI16  KerningCount
 *   repeated KerningCount times:
 *     UI16  FontKerningCode1 (left)
 *     UI16  FontKerningCode2 (right)
 *     SI16  FontKerningAdjustment  (EM units * coordScale)
 *
 * Only pairs whose glyphs are both inside the embedded ASCII range are emitted.
 */
/** Build a fast {left}{right} → EM-adjustment lookup from the pair table. */
const KERNING_LOOKUP: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const [l, r, em] of KERNING_PAIRS_EM) m.set(l + r, em);
  return m;
})();

/**
 * Kerning adjustment (in EM units, negative = tighten) for the ordered pair
 * (left, right), or 0 if the pair is not in the common-pairs table. Used by the
 * static-text (DefineText) path to bake kerning into per-glyph advances, the way
 * Flash 8 does (Flash bakes kerning into static glyph advances rather than
 * emitting a runtime KerningTable for static text).
 */
export function kerningAdjustEm(leftCode: number, rightCode: number): number {
  return KERNING_LOOKUP.get(String.fromCharCode(leftCode) + String.fromCharCode(rightCode)) ?? 0;
}

function writeKerningTable(bw: BitWriter, coordScale: number, embedded: ReadonlySet<number>): void {
  const pairs = KERNING_PAIRS_EM.filter(
    ([l, r]) => embedded.has(l.charCodeAt(0)) && embedded.has(r.charCodeAt(0))
  );
  bw.writeUI16LE(pairs.length);
  for (const [l, r, em] of pairs) {
    bw.writeUI16LE(l.charCodeAt(0)); // left code (WideCodes)
    bw.writeUI16LE(r.charCodeAt(0)); // right code (WideCodes)
    bw.writeSI16LE(Math.round(em * coordScale)); // adjustment in scaled EM units
  }
}

// ---------------------------------------------------------------------------
// Glyph SHAPE encoding
// ---------------------------------------------------------------------------

/** Minimum number of signed bits to represent all values (SWF min 2). */
function numBitsFor(values: number[]): number {
  let max = 2;
  for (const v of values) {
    const b = v === 0 ? 1 : Math.floor(Math.log2(Math.abs(v))) + 2;
    if (b > max) max = b;
  }
  return max;
}

/** Number of fill bits used in every glyph SHAPE (fill index 0 or 1). */
const NUM_FILL_BITS = 1;
/** Number of line bits — glyphs have no strokes. */
const NUM_LINE_BITS = 0;

/**
 * Emit a StyleChangeRecord that moves the pen to (x,y) and (optionally) selects
 * fill style 1. `setFill` should be true on the first contour of a glyph; the
 * fill persists for subsequent contours.
 *
 * Returns nothing; updates the caller's pen via the returned coordinates.
 */
function writeGlyphMoveTo(
  bw: BitWriter,
  x: number,
  y: number,
  penX: number,
  penY: number,
  setFill: boolean
): void {
  const dx = x - penX;
  const dy = y - penY;
  bw.writeBits(0, 1); // type = 0 (non-edge)
  bw.writeBits(0, 1); // stateNewStyles = 0
  bw.writeBits(0, 1); // stateLineStyle = 0
  bw.writeBits(setFill ? 1 : 0, 1); // stateFillStyle1
  bw.writeBits(0, 1); // stateFillStyle0 = 0
  bw.writeBits(1, 1); // stateMoveTo = 1
  const moveBits = numBitsFor([dx, dy]);
  bw.writeBits(moveBits, 5);
  bw.writeBits(dx & ((1 << moveBits) - 1), moveBits);
  bw.writeBits(dy & ((1 << moveBits) - 1), moveBits);
  if (setFill) bw.writeBits(1, NUM_FILL_BITS); // FillStyle1 index = 1
}

/** Emit a StraightEdgeRecord for delta (dx,dy) (general line, both deltas). */
function writeGlyphLine(bw: BitWriter, dx: number, dy: number): void {
  const nBits = numBitsFor([dx, dy]);
  bw.writeBits(1, 1); // edge record
  bw.writeBits(1, 1); // straight edge
  bw.writeBits(nBits - 2, 4); // numBits field (stored = actual - 2)
  bw.writeBits(1, 1); // generalLineFlag (write both deltas)
  bw.writeBits(dx & ((1 << nBits) - 1), nBits);
  bw.writeBits(dy & ((1 << nBits) - 1), nBits);
}

/** Emit a CurvedEdgeRecord for control delta (cdx,cdy) + anchor delta (adx,ady). */
function writeGlyphCurve(
  bw: BitWriter,
  cdx: number,
  cdy: number,
  adx: number,
  ady: number
): void {
  const nBits = numBitsFor([cdx, cdy, adx, ady]);
  bw.writeBits(1, 1); // edge record
  bw.writeBits(0, 1); // curved edge
  bw.writeBits(nBits - 2, 4); // numBits field (stored = actual - 2)
  bw.writeBits(cdx & ((1 << nBits) - 1), nBits);
  bw.writeBits(cdy & ((1 << nBits) - 1), nBits);
  bw.writeBits(adx & ((1 << nBits) - 1), nBits);
  bw.writeBits(ady & ((1 << nBits) - 1), nBits);
}

/**
 * Encode a glyph SHAPE from a real TTF-derived outline (packed command array
 * from glyphdata.ts). Returns null if the code point has no real outline.
 *
 * The packed array uses absolute EM-unit coordinates. We convert each command
 * to delta-based SWF edge records, scaling by `coordScale` (20 for DefineFont3,
 * 1 for DefineFont2). MoveTo starts a new contour; the first MoveTo also selects
 * fill style 1 (the fill Ruffle recolors with the text colour).
 */
function encodeRealGlyphShape(code: number, coordScale: number): Uint8Array | null {
  const cmds = glyphPath(code);
  if (cmds === undefined) return null;

  const bw = new BitWriter();
  bw.writeUI8((NUM_FILL_BITS << 4) | NUM_LINE_BITS);

  const S = coordScale;
  let penX = 0;
  let penY = 0;
  let firstContour = true;
  // Empty outline (e.g. space): still a valid glyph, just no records.
  let i = 0;
  while (i < cmds.length) {
    const op = cmds[i];
    if (op === GlyphOp.MoveTo) {
      const x = cmds[i + 1] * S;
      const y = cmds[i + 2] * S;
      writeGlyphMoveTo(bw, x, y, penX, penY, firstContour);
      firstContour = false;
      penX = x;
      penY = y;
      i += 3;
    } else if (op === GlyphOp.LineTo) {
      const x = cmds[i + 1] * S;
      const y = cmds[i + 2] * S;
      writeGlyphLine(bw, x - penX, y - penY);
      penX = x;
      penY = y;
      i += 3;
    } else {
      // QuadTo: control (cx,cy) then anchor (x,y).
      const cx = cmds[i + 1] * S;
      const cy = cmds[i + 2] * S;
      const x = cmds[i + 3] * S;
      const y = cmds[i + 4] * S;
      writeGlyphCurve(bw, cx - penX, cy - penY, x - cx, y - cy);
      penX = x;
      penY = y;
      i += 5;
    }
  }

  // EndShapeRecord: type bit 0 + 5 zero flag bits.
  bw.writeBits(0, 6);
  bw.flushBits();
  return bw.getBytes();
}

/**
 * Encode a single glyph's SHAPE body (including the leading
 * NumFillBits/NumLineBits header byte).
 *
 * Prefers the real TTF-derived outline (glyphdata.ts). For any code point that
 * lacks a real outline it falls back to a 5×7 bitmap glyph: each "on" cell is
 * decomposed into maximal solid rectangles and emitted as filled contours
 * referencing fill style 1.
 */
function encodeGlyphShape(code: number, coordScale: number): Uint8Array {
  const real = encodeRealGlyphShape(code, coordScale);
  if (real !== null) return real;

  const bw = new BitWriter();
  bw.writeUI8((NUM_FILL_BITS << 4) | NUM_LINE_BITS);

  const cells = glyphCells(code);
  const S = coordScale; // DefineFont3 stores glyph coords at 20× scale.

  // Pen position in (scaled) glyph units; tracked so MoveTo deltas are correct.
  let penX = 0;
  let penY = 0;
  let firstContour = true;

  /** Emit one filled rectangle contour [x0,y0]→[x1,y1] (clockwise, Y-down). */
  function emitRect(x0: number, y0: number, x1: number, y1: number): void {
    writeGlyphMoveTo(bw, x0, y0, penX, penY, firstContour);
    firstContour = false;
    penX = x0;
    penY = y0;

    const edges: Array<[number, number]> = [
      [x1 - x0, 0], // right
      [0, y1 - y0], // down
      [x0 - x1, 0], // left
      [0, y0 - y1], // up
    ];
    for (const [edx, edy] of edges) {
      writeGlyphLine(bw, edx, edy);
      penX += edx;
      penY += edy;
    }
  }

  // Decompose the glyph's on-cells into a small set of maximal solid rectangles
  // and emit each as one filled contour. Larger, fewer rectangles render
  // crisply; very thin (single-cell) fills tessellate unreliably at small sizes
  // in some players, so merging cells both horizontally and vertically into
  // chunky rectangles is important for legibility.
  const used: boolean[][] = cells.map((r) => r.map(() => false));
  for (let row = 0; row < FONT_ROWS; row++) {
    for (let col = 0; col < FONT_COLS; col++) {
      if (!cells[row][col] || used[row][col]) continue;

      // Grow a maximal rectangle of on, unused cells starting at (row,col).
      // First extend the width along this row.
      let w = 1;
      while (col + w < FONT_COLS && cells[row][col + w] && !used[row][col + w]) w++;
      // Then extend the height as long as every cell in the width band is on.
      let h = 1;
      while (row + h < FONT_ROWS) {
        let ok = true;
        for (let c = col; c < col + w; c++) {
          if (!cells[row + h][c] || used[row + h][c]) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
        h++;
      }
      // Mark the block used.
      for (let r = row; r < row + h; r++) {
        for (let c = col; c < col + w; c++) used[r][c] = true;
      }

      // Expand every rectangle outward so thin strokes stay solid. Overlapping
      // same-fill rectangles union cleanly under the non-zero winding rule, and
      // the expansion thickens single-cell strokes so they tessellate reliably
      // at small render sizes instead of dropping out. Grow more in whichever
      // axis is thin (1 cell) to guarantee a solid stroke in both axes.
      const growX = (w <= 1 ? 0.6 : 0.2) * CELL;
      const growY = (h <= 1 ? 0.6 : 0.2) * CELL;
      const x0 = (GLYPH_LEFT + col * CELL - growX) * S;
      const y0 = (CAP_TOP + row * CELL - growY) * S;
      const x1 = (GLYPH_LEFT + (col + w) * CELL + growX) * S;
      const y1 = (CAP_TOP + (row + h) * CELL + growY) * S;
      emitRect(x0, y0, x1, y1);
    }
  }

  // EndShapeRecord: type bit 0 + 5 zero flag bits.
  bw.writeBits(0, 6);
  bw.flushBits();

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineFont2/DefineFont3 tag body for the given font.
 *
 * Produces 95 real vector glyphs for printable ASCII (codes 32–126). The body
 * format is identical for tag 48 (DefineFont2) and tag 75 (DefineFont3); only
 * the tag code differs (the caller chooses).
 *
 * The result is the tag *body* (without the tag-record header); pass it to
 * SwfWriter.writeTag(Tag.DefineFont2 | Tag.DefineFont3, body).
 */
export function encodeDefineFont2(
  charId: number,
  fontName: string,
  isBold: boolean,
  isItalic: boolean,
  /**
   * Glyph-coordinate scale factor. DefineFont3 (tag 75) stores glyph
   * coordinates and layout metrics in a 20×-larger EM square than
   * DefineFont1/2, so pass 20 when emitting tag 75 and 1 for tag 48.
   */
  coordScale = 1,
  /**
   * When true, emit the KerningTable (common Latin pairs) in the layout block so
   * the player can apply pair kerning to fields that enable "Auto kern". When
   * false (default) KerningCount is 0 and no pairs are written.
   */
  kerning = false,
  /**
   * Sorted list of code points to embed (glyph subsetting). Defaults to the full
   * printable-ASCII set (32–126), which makes the output byte-identical to the
   * historical embed-everything behavior. Pass a subset (from
   * {@link computeEmbedCodePoints}) to embed only the chosen glyphs, producing a
   * smaller font. The DefineText glyph-index path must use the SAME ordering, so
   * the glyph index of a code point is its position in this array.
   */
  codePoints: readonly number[] = FULL_CODE_POINTS
): Uint8Array {
  const bw = new BitWriter();
  const glyphCount = codePoints.length;

  // FontID: UI16
  bw.writeUI16LE(charId);

  // Flags byte:
  // bit7: HasLayout = 1
  // bit3: WideOffsets = 1 (32-bit offsets)
  // bit2: WideCodes   = 1 (16-bit code table entries)
  // bit1: Italic
  // bit0: Bold
  let fontFlags = 0;
  fontFlags |= 0x80; // HasLayout
  fontFlags |= 0x08; // WideOffsets
  fontFlags |= 0x04; // WideCodes
  if (isItalic) fontFlags |= 0x02;
  if (isBold) fontFlags |= 0x01;
  bw.writeUI8(fontFlags);

  // LanguageCode: UI8 (0 = undefined)
  bw.writeUI8(0);

  // FontNameLen + FontName (ASCII, no null terminator)
  const nameBytes = new TextEncoder().encode(fontName);
  bw.writeUI8(nameBytes.length);
  bw.writeBytes(nameBytes);

  // GlyphCount: UI16
  bw.writeUI16LE(glyphCount);

  // ---------------------------------------------------------------------------
  // Pre-encode all glyph shapes so we know their byte lengths for the offset
  // table. Offsets (WideOffsets=1, 32-bit) are relative to the start of the
  // OffsetTable itself.
  //
  // Layout after the OffsetTable:
  //   OffsetTable:    (GLYPH_COUNT + 1) × 4 bytes
  //   GlyphShapeTable: concatenated glyph bodies (variable length)
  //   CodeTable:      GLYPH_COUNT × 2 bytes (WideCodes)
  // ---------------------------------------------------------------------------
  const glyphBodies: Uint8Array[] = [];
  for (let i = 0; i < glyphCount; i++) {
    glyphBodies.push(encodeGlyphShape(codePoints[i], coordScale));
  }

  const offsetTableSize = (glyphCount + 1) * 4; // bytes
  let cursor = offsetTableSize;
  for (let i = 0; i < glyphCount; i++) {
    bw.writeUI32LE(cursor);
    cursor += glyphBodies[i].length;
  }
  // CodeTableOffset (last entry) — points just past the last glyph.
  bw.writeUI32LE(cursor);

  // GlyphShapeTable
  for (let i = 0; i < glyphCount; i++) {
    bw.writeBytes(glyphBodies[i]);
  }

  // CodeTable: glyphCount UI16 entries (WideCodes=1) — Unicode code points.
  for (let i = 0; i < glyphCount; i++) {
    bw.writeUI16LE(codePoints[i]);
  }

  // ---------------------------------------------------------------------------
  // Layout block (HasLayout=1)
  // ---------------------------------------------------------------------------
  bw.writeSI16LE(ASCENT * coordScale);
  bw.writeSI16LE(DESCENT * coordScale);
  bw.writeSI16LE(LEADING * coordScale);

  // AdvanceTable (in the same EM units as the glyph coordinates). Real
  // per-glyph advances come from the embedded TTF; glyphs without an outline
  // fall back to the 5×7 box advance.
  for (let i = 0; i < glyphCount; i++) {
    const codePoint = codePoints[i];
    const emAdvance = glyphPath(codePoint) !== undefined ? glyphAdvance(codePoint) : FALLBACK_ADVANCE;
    const advance = Math.round(emAdvance * coordScale);
    bw.writeSI16LE(advance);
  }

  // BoundsTable — one RECT per glyph. Empty bounds are permitted (Ruffle
  // recalculates real bounds from the shape records); use empty RECTs.
  for (let i = 0; i < glyphCount; i++) {
    bw.writeBits(0, 5); // Nbits = 0 → no coord bits follow
    bw.flushBits();
  }

  // KerningTable (HasLayout=1). When the font is used by an "Auto kern" field,
  // emit the common Latin kerning pairs; otherwise KerningCount = 0.
  if (kerning) {
    writeKerningTable(bw, coordScale, new Set(codePoints));
  } else {
    bw.writeUI16LE(0); // KerningCount = 0
  }

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// DefineFontAlignZones (tag 73)
// ---------------------------------------------------------------------------

/**
 * Cap height of 'H' (code 72) in NotoSans EM units.
 *
 * From the TTF-derived glyph data: the top of 'H' sits at y = -731 in SWF
 * glyph space (+x right, -y up), so the cap height = 731 EM units.
 * Used as the Y-axis alignment zone coordinate for DefineFontAlignZones.
 */
const CAP_HEIGHT_EM = 731;

/**
 * Encode a DefineFontAlignZones (tag 73) body for an embedded font.
 *
 * Tag 73 provides per-glyph stem-width hint zones that enable FlashType
 * sub-pixel rendering in Ruffle / Flash Player. It is a companion tag to
 * DefineFont3 and CSMTextSettings (tag 74).
 *
 * Format (per Ruffle swf/src/read.rs `read_define_font_align_zones` /
 * swf/src/write.rs):
 *   UI16   fontID        — must match the DefineFont3 character ID
 *   UI8    thickness     — bits[7:6] = CSMTableHintType (0=thin, 1=medium, 2=thick)
 *   For each glyph (glyphCount entries):
 *     UI8    zoneCount = 2   (always 2 per Ruffle)
 *     SI16   left            — X-zone position in font glyph units
 *     SI16   width           — X-zone size (0 = no zone data for this axis)
 *     SI16   bottom          — Y-zone position in font glyph units
 *     SI16   height          — Y-zone size (0 = no zone data for this axis)
 *     UI8    zoneMask = 0b00000011  (both X and Y zones active)
 *
 * The "simplified approximation" used here emits the same two zones for every
 * glyph: a zero X-zone (baseline) and a Y-zone at the font's cap height.
 * This is sufficient to enable the DefineFontAlignZones path in Ruffle without
 * requiring per-glyph stem detection — matching what Flash exports for fonts
 * it cannot fully analyse.
 *
 * @param fontCharId  SWF character ID of the DefineFont3 this accompanies
 * @param glyphCount  Number of glyphs in the font (must match DefineFont3)
 * @param coordScale  Glyph coordinate scale (20 for DefineFont3, 1 for DefineFont2)
 * @param csmHint     CSMTableHint: 0=thin, 1=medium (default), 2=thick
 */
export function encodeDefineFontAlignZones(
  fontCharId: number,
  glyphCount: number,
  coordScale: number,
  csmHint: 0 | 1 | 2 = 1
): Uint8Array {
  const bw = new BitWriter();

  // fontID: UI16 LE
  bw.writeUI16LE(fontCharId);

  // CSMTableHint: UI8 — bits[7:6] hold the hint type, bits[5:0] reserved = 0
  bw.writeUI8((csmHint & 0x3) << 6);

  // Cap height in scaled font glyph units.
  // DefineFont3 stores coordinates in a 20480-unit EM square (20× the 1024-unit
  // EM used in the TTF source), so scale the cap height accordingly.
  const capHeightScaled = CAP_HEIGHT_EM * coordScale;

  // Emit one 10-byte zone record per glyph (simplified: same zones for every glyph)
  for (let i = 0; i < glyphCount; i++) {
    // ZoneCount: UI8 = 2 (always 2 dimensions per Ruffle convention)
    bw.writeUI8(2);

    // X-zone: baseline at 0, range 0 (no horizontal stem hint)
    bw.writeSI16LE(0);  // left = 0
    bw.writeSI16LE(0);  // width = 0

    // Y-zone: cap height position, range 0
    bw.writeSI16LE(capHeightScaled);  // bottom = cap height in scaled units
    bw.writeSI16LE(0);  // height = 0

    // ZoneMask: UI8 = 0b00000011 — both X and Y zones active
    bw.writeUI8(0x03);
  }

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// DefineFontInfo2 (tag 62)
// ---------------------------------------------------------------------------

/**
 * Encode a DefineFontInfo2 (tag 62) body.
 *
 * DefineFontInfo2 maps a DefineFont2/DefineFont3 character ID to a named
 * system (device) font, enabling Flash Player / Ruffle to fall back to a
 * device font by name when the embedded outlines are not used (UseOutlines=0).
 *
 * Format (SWF spec §10.4 / Ruffle read_define_font_info):
 *   UI16                FontID
 *   UI8                 FontNameLen
 *   UI8[FontNameLen]    FontName  (no null terminator)
 *   UI8 flags (packed):
 *     bit 4: IS_ANSI
 *     bit 2: IS_ITALIC
 *     bit 1: IS_BOLD
 *     bit 0: HAS_WIDE_CODES (must be 1 when code table uses UI16)
 *   UI8 LanguageCode  (1 = Latin, DefineFontInfo2 only)
 *   UI16[nGlyphs]     CodeTable
 */
export function encodeDefineFontInfo2(
  fontId: number,
  fontName: string,
  isBold: boolean,
  isItalic: boolean,
  codeTable: number[],
): Uint8Array {
  const bw = new BitWriter();

  // FontID: UI16 LE
  bw.writeUI16LE(fontId);

  // FontNameLen + FontName (ASCII bytes, no null terminator)
  const nameBytes = new TextEncoder().encode(fontName);
  bw.writeUI8(nameBytes.length);
  bw.writeBytes(nameBytes);

  // Single packed flags byte (matches Ruffle FontInfoFlag):
  //   bit 0: HAS_WIDE_CODES = 1  (we always emit UI16 code points)
  //   bit 1: IS_BOLD
  //   bit 2: IS_ITALIC
  //   bit 4: IS_ANSI
  const flags =
    0x01 | // HAS_WIDE_CODES (always set — code table is UI16)
    (isBold ? 0x02 : 0) |
    (isItalic ? 0x04 : 0) |
    0x10; // IS_ANSI (Latin font)
  bw.writeUI8(flags);

  // LanguageCode: UI8 = 1 (Latin) — present in DefineFontInfo2 (tag 62)
  bw.writeUI8(1);

  // CodeTable: UI16[nGlyphs]
  for (const code of codeTable) {
    bw.writeUI16LE(code);
  }

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

/** EM units per glyph advance (default), exported for the text encoder. */
export const GLYPH_ADVANCE_EM = ADVANCE_DEFAULT;
export const GLYPH_ADVANCE_SPACE_EM = ADVANCE_SPACE;
export const FONT_EM = EM;

/**
 * Real per-glyph advance width in EM units, matching the embedded glyph
 * outline. Used by the text encoder so glyph spacing tracks the real outlines.
 * Falls back to the default advance for code points without a real outline.
 */
export function glyphAdvanceEm(code: number): number {
  return glyphPath(code) !== undefined ? glyphAdvance(code) : ADVANCE_DEFAULT;
}
