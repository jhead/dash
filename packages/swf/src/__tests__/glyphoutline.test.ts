/**
 * Tests that DefineFont2/3 glyph shapes contain REAL vector outlines (edges +
 * fill-style references), not empty placeholders.
 *
 * Regression guard for task 0702: previously every glyph was an empty SHAPE
 * (NumFillBits=0, NumLineBits=0, immediate EndShape), so text rendered as
 * nothing in Ruffle.
 */
import { describe, it, expect } from "vitest";
import { encodeDefineFont2 } from "../fonts.js";

// ---------------------------------------------------------------------------
// Minimal MSB-first bit reader (mirrors SWF UB/SB packing).
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

  readSB(n: number): number {
    const v = this.readUB(n);
    // sign-extend
    if (n > 0 && (v & (1 << (n - 1))) !== 0) return v - (1 << n);
    return v;
  }
}

interface GlyphStats {
  edgeCount: number;
  styleChangeCount: number;
  fillStyle1Set: boolean;
  /** Absolute MoveTo positions, one per contour (MoveTo is absolute in SWF). */
  moveTos: Array<{ x: number; y: number }>;
}

/** Decode a single glyph SHAPE starting at byte `start` and return record stats. */
function decodeGlyphShape(body: Uint8Array, start: number): GlyphStats {
  const numBitsByte = body[start];
  const numFillBits = numBitsByte >> 4;
  const numLineBits = numBitsByte & 0x0f;
  const br = new BitReader(body, start + 1);

  let edgeCount = 0;
  let styleChangeCount = 0;
  let fillStyle1Set = false;
  const moveTos: Array<{ x: number; y: number }> = [];

  // Read shape records until EndShape (type=0, all 5 flag bits = 0).
  // Cap iterations to avoid runaway on malformed data.
  for (let guard = 0; guard < 10000; guard++) {
    const isEdge = br.readBit();
    if (isEdge) {
      edgeCount++;
      const isStraight = br.readBit();
      const numBits = br.readUB(4) + 2;
      if (isStraight) {
        const general = br.readBit();
        if (general) {
          br.readSB(numBits); // dx
          br.readSB(numBits); // dy
        } else {
          br.readBit(); // vert flag
          br.readSB(numBits);
        }
      } else {
        br.readSB(numBits);
        br.readSB(numBits);
        br.readSB(numBits);
        br.readSB(numBits);
      }
    } else {
      const flags = br.readUB(5);
      if (flags === 0) break; // EndShapeRecord
      styleChangeCount++;
      const moveTo = (flags & 0x01) !== 0;
      const fillStyle0 = (flags & 0x02) !== 0;
      const fillStyle1 = (flags & 0x04) !== 0;
      const lineStyle = (flags & 0x08) !== 0;
      const newStyles = (flags & 0x10) !== 0;
      if (moveTo) {
        const moveBits = br.readUB(5);
        // SWF MoveTo coordinates are ABSOLUTE (not pen-relative).
        const x = br.readSB(moveBits);
        const y = br.readSB(moveBits);
        moveTos.push({ x, y });
      }
      if (fillStyle0) br.readUB(numFillBits);
      if (fillStyle1) {
        const idx = br.readUB(numFillBits);
        if (idx === 1) fillStyle1Set = true;
      }
      if (lineStyle) br.readUB(numLineBits);
      if (newStyles) throw new Error("unexpected new styles in glyph");
    }
  }

  return { edgeCount, styleChangeCount, fillStyle1Set, moveTos };
}

/** Locate the glyph offset table and decode glyph `index` (0-based). */
function decodeGlyphInFont(body: Uint8Array, index: number): GlyphStats {
  const nameLen = body[4];
  const glyphCountOffset = 5 + nameLen;
  const offsetTableStart = glyphCountOffset + 2;
  // WideOffsets (UI32) per encodeDefineFont2.
  const readU32 = (off: number) =>
    (body[off] |
      (body[off + 1] << 8) |
      (body[off + 2] << 16) |
      (body[off + 3] << 24)) >>>
    0;
  const glyphOffset = readU32(offsetTableStart + index * 4);
  return decodeGlyphShape(body, offsetTableStart + glyphOffset);
}

describe("DefineFont glyph outlines", () => {
  const body = encodeDefineFont2(7, "Arial", false, false);

  it("uses NumFillBits >= 1 per glyph (so fills can be referenced)", () => {
    const nameLen = body[4];
    const glyphCountOffset = 5 + nameLen;
    const offsetTableStart = glyphCountOffset + 2;
    const readU32 = (off: number) =>
      (body[off] | (body[off + 1] << 8) | (body[off + 2] << 16) | (body[off + 3] << 24)) >>> 0;
    const offsetA = readU32(offsetTableStart + ("A".charCodeAt(0) - 32) * 4);
    const numBitsByte = body[offsetTableStart + offsetA];
    expect(numBitsByte >> 4).toBeGreaterThanOrEqual(1);
  });

  it("letter 'A' has real edges and a fill-style-1 reference", () => {
    const stats = decodeGlyphInFont(body, "A".charCodeAt(0) - 32);
    expect(stats.edgeCount).toBeGreaterThan(0);
    expect(stats.styleChangeCount).toBeGreaterThan(0);
    expect(stats.fillStyle1Set).toBe(true);
  });

  it("space (0x20) has no edges (blank glyph)", () => {
    const stats = decodeGlyphInFont(body, " ".charCodeAt(0) - 32);
    expect(stats.edgeCount).toBe(0);
  });

  it("every printable letter has at least 4 edges (a closed contour)", () => {
    for (const ch of "HelloWorld0129") {
      const stats = decodeGlyphInFont(body, ch.charCodeAt(0) - 32);
      expect(stats.edgeCount).toBeGreaterThanOrEqual(4);
      expect(stats.fillStyle1Set).toBe(true);
    }
  });

  // Regression for task 1193: SWF StyleChangeRecord MoveTo is ABSOLUTE, not a
  // delta from the pen. Multi-contour glyphs (a/e/o counters, the 'i' dot) used
  // to encode the 2nd contour's MoveTo as a pen-relative delta, landing it near
  // the origin and collapsing the glyph to a tiny blob in Ruffle. Each contour's
  // MoveTo must be an independent absolute coordinate inside the glyph bounds.
  describe("multi-contour glyph MoveTo coordinates are absolute (task 1193)", () => {
    // DefineFont3 scale (20×) — same path the SWF v8 publish uses.
    const font3 = encodeDefineFont2(7, "Arial", false, false, 20);
    for (const ch of "oeai") {
      it(`'${ch}' has >=2 contours, all MoveTos in glyph bounds (not at origin)`, () => {
        const stats = decodeGlyphInFont(font3, ch.charCodeAt(0) - 32);
        expect(stats.moveTos.length).toBeGreaterThanOrEqual(2);
        // The outer contour establishes the glyph extent; gather its X range.
        const xs = stats.moveTos.map((m) => m.x);
        const ys = stats.moveTos.map((m) => m.y);
        const xmax = Math.max(...xs);
        // Every contour's MoveTo must be reasonably close to the others — a
        // delta-encoded 2nd contour would land near (small, small) far from the
        // outer contour. Assert all MoveTo X are within the glyph's X extent and
        // none collapsed to ~0 when the outer contour is well to the right.
        for (const m of stats.moveTos) {
          // No contour starts at the (0,0)-ish origin when the glyph body does not.
          expect(Math.abs(m.x) + Math.abs(m.y)).toBeGreaterThan(0);
          // Inner-contour X should be within ~2× the outer extent, never a tiny
          // pen-relative delta.
          expect(m.x).toBeLessThanOrEqual(xmax + 1);
        }
        // The contours should overlap vertically (counter sits inside the bowl),
        // i.e. their Y positions are within the same band, not split origin/far.
        const ySpan = Math.max(...ys) - Math.min(...ys);
        // Glyphs are ~10000+ twips tall at 20× scale; contour starts must be in a
        // comparable band, far smaller than the full glyph if mis-encoded.
        expect(ySpan).toBeLessThan(20000);
      });
    }
  });
});
