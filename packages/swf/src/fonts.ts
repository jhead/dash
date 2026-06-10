/**
 * SWF font embedding — DefineFont2 (tag 48) / DefineFont3 (tag 75).
 *
 * Emits REAL vector glyph outlines for printable ASCII (codes 32–126 = 95
 * glyphs) so embedded text actually renders in Ruffle / Flash Player.
 *
 * The glyphs are generated from a compact built-in 5×7 bitmap font: each "on"
 * cell of a glyph becomes a small filled square contour in the glyph's SHAPE
 * record. This produces legible, pure-vector text without requiring a TTF
 * parser, bundled font file, or any DOM/canvas API.
 *
 * Why this works in Ruffle: `swf_glyph_to_shape()` wraps each glyph's
 * shape-records in a Shape whose single fill style (index 1) is white, and the
 * text rendering path recolors that fill with the TEXTRECORD/EditText color.
 * So every contour we emit must reference fill-style index 1 via a
 * StyleChangeRecord; the actual colour comes from the text field, not the glyph.
 */
import { BitWriter } from "./bits.js";
import { glyphCells, FONT_COLS, FONT_ROWS } from "./glyphdata.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First printable ASCII code point. */
const FIRST_CODE = 32;
/** Last printable ASCII code point. */
const LAST_CODE = 126;
/** Total number of glyphs we embed (ASCII 32–126). */
const GLYPH_COUNT = LAST_CODE - FIRST_CODE + 1; // 95

/** EM square size in font units (Flash convention). */
const EM = 1024;

/** Font metrics in EM units. */
const ASCENT = 800;
const DESCENT = 200;
const LEADING = 40;

/**
 * Glyph layout within the EM box.
 *
 * The 5×7 cell grid is mapped into a box that sits above the baseline (y = 0,
 * with negative y pointing up the way SWF font glyphs are conventionally laid
 * out). We use a cap-height of ~720 units and a left side bearing so glyphs do
 * not touch.
 */
const CELL = 100; // size of each grid cell in EM units
const GLYPH_LEFT = 80; // left side bearing
const CAP_TOP = -720; // top of the glyph box (negative = above baseline)
/** Advance width per glyph in EM units (cells span + bearings). */
const ADVANCE_DEFAULT = GLYPH_LEFT + FONT_COLS * CELL + GLYPH_LEFT; // 80 + 500 + 80 = 660
/** Advance width for the space character. */
const ADVANCE_SPACE = 460;

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

/**
 * Encode a single glyph's SHAPE body (the bytes that follow the per-glyph
 * NumFillBits/NumLineBits header byte is written here too).
 *
 * Layout of the returned bytes:
 *   UI8  : NumFillBits(4) << 4 | NumLineBits(4)   — we use 1 fill bit, 0 line bits
 *   bits : shape records (StyleChange + StraightEdges …) then EndShape
 *
 * Each "on" cell is drawn as a closed square contour referencing fill style 1.
 * Movement between cells uses absolute MoveTo (SWF MoveTo deltas in a glyph are
 * relative to the glyph origin / current pen — we always emit an absolute-style
 * MoveTo by treating the pen as reset, which the spec permits because each
 * StyleChange MoveTo carries the full destination coordinate pair).
 */
function encodeGlyphShape(code: number, coordScale: number): Uint8Array {
  const bw = new BitWriter();

  // NumFillBits = 1 (we only ever reference fill index 0 or 1), NumLineBits = 0.
  const NUM_FILL_BITS = 1;
  const NUM_LINE_BITS = 0;
  bw.writeUI8((NUM_FILL_BITS << 4) | NUM_LINE_BITS);

  const cells = glyphCells(code);
  const S = coordScale; // DefineFont3 stores glyph coords at 20× scale.

  // Pen position in (scaled) glyph units; tracked so MoveTo deltas are correct.
  let penX = 0;
  let penY = 0;
  let firstContour = true;

  /** Emit one filled rectangle contour [x0,y0]→[x1,y1] (clockwise, Y-down). */
  function emitRect(x0: number, y0: number, x1: number, y1: number): void {
    // StyleChangeRecord: MoveTo (x0,y0). Set fill style 1 = 1 only on the first
    // contour — it persists for subsequent contours in the same shape.
    //
    // We use FILL STYLE 1 (the "right" fill, flushed without flipping by
    // Ruffle's ShapeConverter). Ruffle's swf_glyph_to_shape() installs a single
    // fill at index 1, and the text colour is applied by the text record.
    const dx = x0 - penX;
    const dy = y0 - penY;
    const setFill = firstContour ? 1 : 0;
    bw.writeBits(0, 1); // type = 0 (non-edge)
    bw.writeBits(0, 1); // stateNewStyles = 0
    bw.writeBits(0, 1); // stateLineStyle = 0
    bw.writeBits(setFill, 1); // stateFillStyle1
    bw.writeBits(0, 1); // stateFillStyle0 = 0
    bw.writeBits(1, 1); // stateMoveTo = 1
    const moveBits = numBitsFor([dx, dy]);
    bw.writeBits(moveBits, 5);
    bw.writeBits(dx & ((1 << moveBits) - 1), moveBits);
    bw.writeBits(dy & ((1 << moveBits) - 1), moveBits);
    if (setFill) bw.writeBits(1, NUM_FILL_BITS); // FillStyle1 index = 1
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
      const nBits = numBitsFor([edx, edy]);
      bw.writeBits(1, 1); // edge record
      bw.writeBits(1, 1); // straight edge
      bw.writeBits(nBits - 2, 4); // numBits field (stored = actual - 2)
      bw.writeBits(1, 1); // generalLineFlag (write both deltas)
      bw.writeBits(edx & ((1 << nBits) - 1), nBits);
      bw.writeBits(edy & ((1 << nBits) - 1), nBits);
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
  coordScale = 1
): Uint8Array {
  const bw = new BitWriter();

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
  bw.writeUI16LE(GLYPH_COUNT);

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
  for (let i = 0; i < GLYPH_COUNT; i++) {
    glyphBodies.push(encodeGlyphShape(FIRST_CODE + i, coordScale));
  }

  const offsetTableSize = (GLYPH_COUNT + 1) * 4; // bytes
  let cursor = offsetTableSize;
  for (let i = 0; i < GLYPH_COUNT; i++) {
    bw.writeUI32LE(cursor);
    cursor += glyphBodies[i].length;
  }
  // CodeTableOffset (last entry) — points just past the last glyph.
  bw.writeUI32LE(cursor);

  // GlyphShapeTable
  for (let i = 0; i < GLYPH_COUNT; i++) {
    bw.writeBytes(glyphBodies[i]);
  }

  // CodeTable: GLYPH_COUNT UI16 entries (WideCodes=1) — Unicode code points.
  for (let i = 0; i < GLYPH_COUNT; i++) {
    bw.writeUI16LE(FIRST_CODE + i);
  }

  // ---------------------------------------------------------------------------
  // Layout block (HasLayout=1)
  // ---------------------------------------------------------------------------
  bw.writeSI16LE(ASCENT * coordScale);
  bw.writeSI16LE(DESCENT * coordScale);
  bw.writeSI16LE(LEADING * coordScale);

  // AdvanceTable (in the same EM units as the glyph coordinates).
  for (let i = 0; i < GLYPH_COUNT; i++) {
    const codePoint = FIRST_CODE + i;
    const advance = (codePoint === 32 ? ADVANCE_SPACE : ADVANCE_DEFAULT) * coordScale;
    bw.writeSI16LE(advance);
  }

  // BoundsTable — one RECT per glyph. Empty bounds are permitted (Ruffle
  // recalculates real bounds from the shape records); use empty RECTs.
  for (let i = 0; i < GLYPH_COUNT; i++) {
    bw.writeBits(0, 5); // Nbits = 0 → no coord bits follow
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

/** EM units per glyph advance (default), exported for the text encoder. */
export const GLYPH_ADVANCE_EM = ADVANCE_DEFAULT;
export const GLYPH_ADVANCE_SPACE_EM = ADVANCE_SPACE;
export const FONT_EM = EM;
