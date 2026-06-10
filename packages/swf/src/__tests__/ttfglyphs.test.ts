/**
 * Tests that DefineFont glyphs use REAL TTF-derived outlines (task 0708):
 * curved edges from the NotoSans contours, and advance widths taken from the
 * font's real metrics rather than a single fixed value.
 *
 * The 5×7 bitmap font is now only a fallback for code points without a real
 * outline; for ASCII 32–126 every glyph comes from the embedded TTF.
 */
import { describe, it, expect } from "vitest";
import { encodeDefineFont2, glyphAdvanceEm } from "../fonts.js";
import { glyphPath, GLYPH_EM, GLYPH_ASCENT, GLYPH_DESCENT } from "../glyphdata.js";

// ---------------------------------------------------------------------------
// Minimal MSB-first bit reader for SWF UB/SB fields.
// ---------------------------------------------------------------------------
class BitReader {
  private bitPos = 0;
  constructor(
    private bytes: Uint8Array,
    private byteStart: number
  ) {}
  readBit(): number {
    const byteIdx = this.byteStart + (this.bitPos >> 3);
    const bit = (this.bytes[byteIdx] >> (7 - (this.bitPos & 7))) & 1;
    this.bitPos++;
    return bit;
  }
  readUB(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit();
    return v >>> 0;
  }
}

interface GlyphStats {
  straightEdges: number;
  curvedEdges: number;
  contours: number;
}

function decodeGlyphShape(body: Uint8Array, start: number): GlyphStats {
  const numBitsByte = body[start];
  const numFillBits = numBitsByte >> 4;
  const numLineBits = numBitsByte & 0x0f;
  const br = new BitReader(body, start + 1);
  let straightEdges = 0;
  let curvedEdges = 0;
  let contours = 0;
  for (let guard = 0; guard < 20000; guard++) {
    const isEdge = br.readBit();
    if (isEdge) {
      const isStraight = br.readBit();
      const numBits = br.readUB(4) + 2;
      if (isStraight) {
        straightEdges++;
        const general = br.readBit();
        if (general) {
          br.readUB(numBits);
          br.readUB(numBits);
        } else {
          br.readBit();
          br.readUB(numBits);
        }
      } else {
        curvedEdges++;
        br.readUB(numBits);
        br.readUB(numBits);
        br.readUB(numBits);
        br.readUB(numBits);
      }
    } else {
      const flags = br.readUB(5);
      if (flags === 0) break; // EndShape
      contours++;
      const moveTo = (flags & 0x01) !== 0;
      const fillStyle0 = (flags & 0x02) !== 0;
      const fillStyle1 = (flags & 0x04) !== 0;
      const lineStyle = (flags & 0x08) !== 0;
      if (moveTo) {
        const moveBits = br.readUB(5);
        br.readUB(moveBits);
        br.readUB(moveBits);
      }
      if (fillStyle0) br.readUB(numFillBits);
      if (fillStyle1) br.readUB(numFillBits);
      if (lineStyle) br.readUB(numLineBits);
    }
  }
  return { straightEdges, curvedEdges, contours };
}

function glyphStats(body: Uint8Array, code: number): GlyphStats {
  const nameLen = body[4];
  const offsetTableStart = 5 + nameLen + 2;
  const readU32 = (off: number) =>
    (body[off] | (body[off + 1] << 8) | (body[off + 2] << 16) | (body[off + 3] << 24)) >>> 0;
  const glyphOffset = readU32(offsetTableStart + (code - 32) * 4);
  return decodeGlyphShape(body, offsetTableStart + glyphOffset);
}

describe("TTF-derived glyph outlines (task 0708)", () => {
  const body = encodeDefineFont2(7, "Arial", false, false);

  it("round-shaped glyphs contain curved edges (real Bézier outlines)", () => {
    for (const ch of "OQGCoceg") {
      const s = glyphStats(body, ch.charCodeAt(0));
      expect(s.curvedEdges).toBeGreaterThan(0);
    }
  });

  it("'O' has multiple contours (outer + inner counter)", () => {
    const s = glyphStats(body, "O".charCodeAt(0));
    expect(s.contours).toBeGreaterThanOrEqual(2);
  });

  it("space has no edges", () => {
    const s = glyphStats(body, 0x20);
    expect(s.straightEdges + s.curvedEdges).toBe(0);
  });

  it("glyph data is sourced from the bundled TTF for all of ASCII 33–126", () => {
    let missing = 0;
    for (let c = 33; c <= 126; c++) {
      if (glyphPath(c) === undefined) missing++;
    }
    expect(missing).toBe(0);
  });

  it("advance widths vary per glyph (real metrics, not a single fixed value)", () => {
    const widthI = glyphAdvanceEm("i".charCodeAt(0));
    const widthW = glyphAdvanceEm("W".charCodeAt(0));
    // A proportional font: 'W' is much wider than 'i'.
    expect(widthW).toBeGreaterThan(widthI * 1.5);
  });

  it("font metrics match the embedded NotoSans (EM 1024)", () => {
    expect(GLYPH_EM).toBe(1024);
    expect(GLYPH_ASCENT).toBeGreaterThan(700);
    expect(GLYPH_DESCENT).toBeGreaterThan(100);
  });
});
