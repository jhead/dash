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
        br.readSB(moveBits);
        br.readSB(moveBits);
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

  return { edgeCount, styleChangeCount, fillStyle1Set };
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
});
