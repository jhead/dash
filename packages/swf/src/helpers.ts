/**
 * Shared helpers for SWF encoding — pixel/twip conversion, RECT, and bit utilities.
 *
 * These were previously duplicated across shapes.ts, text.ts, and filters.ts.
 * Centralised here so fixes apply once.
 */
import { BitWriter } from "./bits.js";

/** Convert pixels to twips (×20). */
export function px(v: number): number {
  return Math.round(v * 20);
}

/** Minimum number of signed bits needed to represent `v`. */
export function minSignedBits(v: number): number {
  if (v === 0) return 1;
  const abs = Math.abs(v);
  return Math.floor(Math.log2(abs)) + 2;
}

/**
 * Minimum number of signed bits to represent all values in the array.
 * Always returns at least 2 (SWF spec minimum for edge/move delta fields).
 */
export function edgeNumBits(values: number[]): number {
  let maxBits = 2;
  for (const v of values) {
    const b = v === 0 ? 1 : Math.floor(Math.log2(Math.abs(v))) + 2;
    if (b > maxBits) maxBits = b;
  }
  return maxBits;
}

/**
 * Write a SWF RECT into a BitWriter (bit-packed).
 * UB[5] Nbits, SB[Nbits] Xmin, SB[Nbits] Xmax, SB[Nbits] Ymin, SB[Nbits] Ymax
 */
export function writeRect(
  bw: BitWriter,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): void {
  const absMax = Math.max(
    Math.abs(xMin),
    Math.abs(xMax),
    Math.abs(yMin),
    Math.abs(yMax),
    1
  );
  let nBits = Math.floor(Math.log2(absMax)) + 2;
  if (nBits < 1) nBits = 1;

  bw.writeBits(nBits, 5);
  bw.writeBits(xMin, nBits);
  bw.writeBits(xMax, nBits);
  bw.writeBits(yMin, nBits);
  bw.writeBits(yMax, nBits);
  bw.flushBits();
}
