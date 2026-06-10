/**
 * Tests for ConvolutionFilter SWF encoding (FilterID = 5).
 *
 * SWF ConvolutionFilter layout:
 *   UI8:  FilterID = 5
 *   UI8:  matrixX (columns)
 *   UI8:  matrixY (rows)
 *   FLOAT: divisor (IEEE 754 LE)
 *   FLOAT: bias    (IEEE 754 LE)
 *   matrixX*matrixY × FLOAT: matrix entries (row-major)
 *   RGBA:  defaultColor (4 bytes)
 *   UI8:   flags (bit 0 = clamp, bit 1 = preserveAlpha)
 */

import { describe, it, expect } from "vitest";
import { encodePlaceObject3WithFilters } from "../filters.js";
import type { ConvolutionFilter } from "@flash/core";

// ---------------------------------------------------------------------------
// Helper: read IEEE 754 float32 LE from a byte array
// ---------------------------------------------------------------------------
function readFloat32LE(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

// ---------------------------------------------------------------------------
// Helper: find the FILTERLIST start (FilterCount byte) in a PlaceObject3 body
// ---------------------------------------------------------------------------
function findFilterListStart(body: Uint8Array, filterCount: number, filterId: number): number {
  for (let i = 7; i < body.length - 1; i++) {
    if (body[i] === filterCount && body[i + 1] === filterId) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Filter factory
// ---------------------------------------------------------------------------
function makeConvolutionFilter(overrides: Partial<ConvolutionFilter> = {}): ConvolutionFilter {
  return {
    type: "convolution",
    matrixX: 3,
    matrixY: 3,
    // 3×3 identity kernel: center=1, rest=0
    matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    divisor: 1,
    bias: 0,
    defaultColor: { r: 0, g: 0, b: 0, a: 0 },
    clamp: true,
    preserveAlpha: false,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConvolutionFilter SWF encoding (FilterID=5)", () => {
  /**
   * Test 1: FilterID byte is 5 for ConvolutionFilter.
   */
  it("ConvolutionFilter: FilterID byte is 5", () => {
    const filter = makeConvolutionFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Find FILTERLIST: count=1, FilterID=5
    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);
    expect(body[start + 1]).toBe(5);
  });

  /**
   * Test 2: matrixX and matrixY are written as the first two bytes after FilterID.
   */
  it("ConvolutionFilter: matrixX=3 and matrixY=3 are written correctly", () => {
    const filter = makeConvolutionFilter({ matrixX: 3, matrixY: 3 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);

    // Immediately after FilterID byte (at start+1) come matrixX and matrixY
    const matrixX = body[start + 2];
    const matrixY = body[start + 3];
    expect(matrixX).toBe(3);
    expect(matrixY).toBe(3);
  });

  /**
   * Test 3: divisor and bias are IEEE 754 float32 LE values.
   */
  it("ConvolutionFilter: divisor and bias are IEEE 754 float32 LE", () => {
    const filter = makeConvolutionFilter({ divisor: 2.5, bias: -0.5 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);

    // Layout from start:
    //   start+0: FilterCount (1)
    //   start+1: FilterID (5)
    //   start+2: matrixX (1 byte)
    //   start+3: matrixY (1 byte)
    //   start+4..+7: divisor FLOAT32 (4 bytes)
    //   start+8..+11: bias FLOAT32 (4 bytes)
    const divisor = readFloat32LE(body, start + 4);
    const bias = readFloat32LE(body, start + 8);

    expect(divisor).toBeCloseTo(2.5, 5);
    expect(bias).toBeCloseTo(-0.5, 5);
  });

  /**
   * Test 4: 3×3 identity matrix values are written as IEEE 754 float32 LE.
   * Identity: [0,0,0, 0,1,0, 0,0,0] — 9 floats at 4 bytes each = 36 bytes.
   */
  it("ConvolutionFilter: 3x3 identity matrix written as 9 float32 values", () => {
    const identityMatrix = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    const filter = makeConvolutionFilter({ matrix: identityMatrix, matrixX: 3, matrixY: 3 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);

    // Matrix starts at start+12 (after FilterCount, FilterID, matrixX, matrixY, divisor, bias)
    const matrixOffset = start + 12;
    for (let i = 0; i < 9; i++) {
      const val = readFloat32LE(body, matrixOffset + i * 4);
      expect(val).toBeCloseTo(identityMatrix[i], 5);
    }
  });

  /**
   * Test 5: defaultColor RGBA bytes are written correctly after the matrix.
   */
  it("ConvolutionFilter: defaultColor RGBA bytes are correct", () => {
    const filter = makeConvolutionFilter({
      defaultColor: { r: 0x11, g: 0x22, b: 0x33, a: 0xff },
    });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);

    // 3×3 filter: 9 matrix floats = 36 bytes
    // Layout from start:
    //   filterCount(1) + FilterID(1) + matX(1) + matY(1) + divisor(4) + bias(4) + matrix(36) = 48
    // defaultColor starts at start+48
    const colorOffset = start + 1 + 1 + 1 + 1 + 4 + 4 + 36; // = start + 48
    expect(body[colorOffset]).toBe(0x11);     // R
    expect(body[colorOffset + 1]).toBe(0x22); // G
    expect(body[colorOffset + 2]).toBe(0x33); // B
    expect(body[colorOffset + 3]).toBe(0xff); // A
  });

  /**
   * Test 6: flags byte encodes clamp (bit 0) and preserveAlpha (bit 1).
   */
  it("ConvolutionFilter: flags byte encodes clamp and preserveAlpha correctly", () => {
    // Layout: filterCount(1)+FilterID(1)+matX(1)+matY(1)+divisor(4)+bias(4)+matrix(36)+RGBA(4) = 52
    // flags is at start+52
    const flagsOffsetFor3x3 = (s: number) => s + 1 + 1 + 1 + 1 + 4 + 4 + 36 + 4; // = s + 52

    // clamp=true, preserveAlpha=false → flags = 0x01
    const f1 = makeConvolutionFilter({ clamp: true, preserveAlpha: false });
    const body1 = encodePlaceObject3WithFilters(1, 1, 0, 0, [f1]);
    const start1 = findFilterListStart(body1, 1, 5);
    expect(start1).toBeGreaterThan(-1);
    expect(body1[flagsOffsetFor3x3(start1)] & 0x01).toBe(1); // clamp bit
    expect(body1[flagsOffsetFor3x3(start1)] & 0x02).toBe(0); // preserveAlpha bit clear

    // clamp=false, preserveAlpha=true → flags = 0x02
    const f2 = makeConvolutionFilter({ clamp: false, preserveAlpha: true });
    const body2 = encodePlaceObject3WithFilters(1, 1, 0, 0, [f2]);
    const start2 = findFilterListStart(body2, 1, 5);
    expect(start2).toBeGreaterThan(-1);
    expect(body2[flagsOffsetFor3x3(start2)] & 0x01).toBe(0); // clamp bit clear
    expect(body2[flagsOffsetFor3x3(start2)] & 0x02).toBe(2); // preserveAlpha bit

    // clamp=true, preserveAlpha=true → flags = 0x03
    const f3 = makeConvolutionFilter({ clamp: true, preserveAlpha: true });
    const body3 = encodePlaceObject3WithFilters(1, 1, 0, 0, [f3]);
    const start3 = findFilterListStart(body3, 1, 5);
    expect(start3).toBeGreaterThan(-1);
    expect(body3[flagsOffsetFor3x3(start3)] & 0x03).toBe(3); // both bits set
  });

  /**
   * Test 7: Total byte size for a 3×3 ConvolutionFilter is correct.
   *
   * FilterID=1 + matrixX=1 + matrixY=1 + divisor=4 + bias=4 + matrix=36 + RGBA=4 + flags=1 = 52 bytes
   * Plus FilterCount=1 prefix = 53 bytes total in FILTERLIST.
   */
  it("ConvolutionFilter: 3x3 filter has correct total encoded byte count", () => {
    const filter = makeConvolutionFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);

    // From filterListStart to end:
    // filterCount(1) + filterId(1) + matX(1) + matY(1) + divisor(4) + bias(4) + matrix(36) + rgba(4) + flags(1) = 53 bytes
    const filterListBytes = body.length - start;
    expect(filterListBytes).toBe(53);
  });

  /**
   * Test 8: Non-3×3 matrix (5×5 = 25 floats) is encoded correctly.
   */
  it("ConvolutionFilter: 5x5 matrix encodes 25 float32 values", () => {
    // 5×5 identity: 0s with 1 in center (index 12)
    const matrix5x5 = new Array(25).fill(0);
    matrix5x5[12] = 1;
    const filter = makeConvolutionFilter({ matrixX: 5, matrixY: 5, matrix: matrix5x5 });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    const start = findFilterListStart(body, 1, 5);
    expect(start).toBeGreaterThan(-1);

    const matX = body[start + 2];
    const matY = body[start + 3];
    expect(matX).toBe(5);
    expect(matY).toBe(5);

    // Verify the center element (index 12) of the matrix
    const matrixOffset = start + 12;
    const centerVal = readFloat32LE(body, matrixOffset + 12 * 4);
    expect(centerVal).toBeCloseTo(1, 5);
  });

  /**
   * Test 9: HasFilterList flag (bit 4 of Flags2) is set for ConvolutionFilter.
   */
  it("ConvolutionFilter: PlaceObject3 Flags2 HasFilterList bit is set", () => {
    const filter = makeConvolutionFilter();
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Flags2 is at byte index 1
    const flags2 = body[1];
    expect(flags2 & 0x10).toBe(0x10); // HasFilterList bit
  });

  /**
   * Test 10: Disabled ConvolutionFilter is excluded from the FILTERLIST.
   */
  it("ConvolutionFilter: disabled filter is not encoded in FILTERLIST", () => {
    const filter = makeConvolutionFilter({ enabled: false });
    const body = encodePlaceObject3WithFilters(1, 1, 0, 0, [filter]);

    // Flags2 should have HasFilterList clear
    const flags2 = body[1];
    expect(flags2 & 0x10).toBe(0); // HasFilterList bit clear

    // No FilterID=5 should appear after byte 7
    let found = false;
    for (let i = 7; i < body.length - 1; i++) {
      if (body[i] === 1 && body[i + 1] === 5) {
        found = true;
        break;
      }
    }
    expect(found).toBe(false);
  });
});
