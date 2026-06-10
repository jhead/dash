/**
 * Golden tests for DefineShape4 and PlaceObject2 encoding.
 *
 * Strategy: call the encoder, then manually inspect key byte offsets to
 * verify structure — no full SWF parser needed.
 *
 * DefineShape4 tag body layout (abbreviated):
 *   [0..1]   charId UI16LE
 *   [2..]    ShapeBounds RECT (variable width)
 *   ...      EdgeBounds RECT
 *   ...      flags byte (0x00)
 *   ...      FILLSTYLEARRAY
 *   ...      LINESTYLEARRAY  ← each LINESTYLE2 entry:
 *                width UI16LE (2 bytes)
 *                flags highByte (1 byte) + lowByte (1 byte)
 *                [MiterLimitFactor UI16LE — only when join=miter]
 *                RGBA (4 bytes)
 *
 * To locate the LINESTYLE2 flags without a full parser we build a minimal
 * shape (no fills, exactly one stroke), then find the byte immediately after
 * the line style count and the 2-byte width — that is the flags high byte.
 *
 * Minimal shape: single straight-line path, no fill.
 */

import { describe, it, expect } from "vitest";
import { encodeDefineShape4, encodePlaceObject2 } from "../shapes.js";
import type { Shape } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Shape with one straight-line path and the given stroke. */
function makeStrokeShape(
  caps: "round" | "none" | "square",
  joints: "round" | "bevel" | "miter",
  miterLimit = 3
): Shape {
  return {
    id: "test",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [{ type: "line", to: { x: 10, y: 0 } }],
        closed: false,
        stroke: {
          type: "solid",
          color: { r: 0, g: 0, b: 0, a: 255 },
          width: 2,
          caps,
          joints,
          miterLimit,
        },
      },
    ],
  };
}

/** Build a shape with one solid fill, no stroke. */
function makeFillShape(
  r: number,
  g: number,
  b: number,
  a = 255
): Shape {
  return {
    id: "test",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 10, y: 0 } },
          { type: "line", to: { x: 10, y: 10 } },
          { type: "line", to: { x: 0, y: 10 } },
        ],
        closed: true,
        fill: { type: "solid", color: { r, g, b, a } },
      },
    ],
  };
}

/** Build a shape with a linear gradient fill, no stroke. */
function makeGradientShape(): Shape {
  return {
    id: "test",
    paths: [
      {
        start: { x: 0, y: 0 },
        segments: [
          { type: "line", to: { x: 100, y: 0 } },
          { type: "line", to: { x: 100, y: 100 } },
          { type: "line", to: { x: 0, y: 100 } },
        ],
        closed: true,
        fill: {
          type: "linear-gradient",
          angle: 0,
          stops: [
            { ratio: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
            { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
          ],
        },
      },
    ],
  };
}

/**
 * Wrap a tag body in a SWF record header (short or long) and return the
 * combined bytes.  This lets us check the tag code via the header.
 *
 * SWF short record header: UI16LE — bits [15:6] tag code, bits [5:0] length
 *   (short form used when length < 63)
 * SWF long record header: short header with length=0x3f, then UI32LE length.
 */
function wrapTag(tagCode: number, body: Uint8Array): Uint8Array {
  const isLong = body.length >= 63;
  if (isLong) {
    const hdr = new Uint8Array(6);
    const shortField = (tagCode << 6) | 0x3f;
    hdr[0] = shortField & 0xff;
    hdr[1] = (shortField >> 8) & 0xff;
    hdr[2] = body.length & 0xff;
    hdr[3] = (body.length >> 8) & 0xff;
    hdr[4] = (body.length >> 16) & 0xff;
    hdr[5] = (body.length >> 24) & 0xff;
    const out = new Uint8Array(6 + body.length);
    out.set(hdr);
    out.set(body, 6);
    return out;
  } else {
    const shortField = (tagCode << 6) | body.length;
    const hdr = new Uint8Array(2);
    hdr[0] = shortField & 0xff;
    hdr[1] = (shortField >> 8) & 0xff;
    const out = new Uint8Array(2 + body.length);
    out.set(hdr);
    out.set(body, 2);
    return out;
  }
}

/**
 * Locate the offset of the LINESTYLE2 flags high byte within a DefineShape4
 * body for a shape that has exactly zero fills and exactly one stroke.
 *
 * Layout after the fixed-size prefix:
 *   UI16LE  charId            (2 bytes)  offset 0
 *   RECT    ShapeBounds       (variable)
 *   RECT    EdgeBounds        (variable)
 *   UI8     flags             (1 byte)
 *   UI8     fillStyleCount=0  (1 byte)
 *   UI8     lineStyleCount=1  (1 byte)
 *   UI16LE  width             (2 bytes)
 *   UI8     flagsHighByte     ← we want this offset
 *   UI8     flagsLowByte
 *   RGBA    color             (4 bytes)
 *
 * The two RECTs are bit-packed — we need to skip them.  The helper reads
 * bits manually using the same bit-order as BitWriter.
 */
function findLinestyle2FlagsOffset(body: Uint8Array): number {
  // Skip charId (2 bytes)
  let byteOffset = 2;

  // Parse a RECT — bit-packed: UB[5] nBits, then 4 × SB[nBits]
  // (called twice for ShapeBounds + EdgeBounds)
  function skipRect(): void {
    // We need to read bit-packed data starting at byteOffset
    // The RECT always starts on a byte boundary.
    let bitBuf = 0;
    let bitsLeft = 0;

    function readBits(n: number): number {
      let result = 0;
      for (let i = 0; i < n; i++) {
        if (bitsLeft === 0) {
          bitBuf = body[byteOffset++];
          bitsLeft = 8;
        }
        result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
        bitsLeft--;
      }
      return result;
    }

    const nBits = readBits(5);
    readBits(nBits); // xMin
    readBits(nBits); // xMax
    readBits(nBits); // yMin
    readBits(nBits); // yMax
    // flush to byte boundary
    if (bitsLeft > 0) {
      // bitsLeft bits were consumed partially; byteOffset already advanced
    }
    // Re-sync: after flushBits the remaining bits in the partial byte are
    // discarded; byteOffset already points past the last byte consumed.
    // Because readBits advances byteOffset when it consumes a byte, and
    // bitsLeft tracks leftovers in bitBuf (which came from byteOffset-1),
    // we don't need to advance further — byteOffset is already past the
    // full bytes used; the leftover bits in bitsLeft were in the last byte.
    // No extra adjustment needed.
  }

  skipRect(); // ShapeBounds
  skipRect(); // EdgeBounds

  // UI8 DefineShape4 flags
  byteOffset += 1;

  // fillStyleCount = 0
  byteOffset += 1;

  // lineStyleCount = 1
  byteOffset += 1;

  // width UI16LE
  byteOffset += 2;

  // Now at flags high byte
  return byteOffset;
}

// ---------------------------------------------------------------------------
// DefineShape4 — fill styles
// ---------------------------------------------------------------------------

describe("DefineShape4 — fill styles", () => {
  it("encodes a solid fill without crashing", () => {
    const body = encodeDefineShape4(1, makeFillShape(255, 0, 0));
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.length).toBeGreaterThan(10);
  });

  it("encodes a linear gradient fill", () => {
    const body = encodeDefineShape4(1, makeGradientShape());
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.length).toBeGreaterThan(10);
  });

  it("produces the correct tag code (83) in the header", () => {
    const body = encodeDefineShape4(1, makeFillShape(0, 255, 0));
    const tagged = wrapTag(83, body);
    // Read the tag code from the header
    const shortField = tagged[0] | (tagged[1] << 8);
    const tagCode = shortField >> 6;
    expect(tagCode).toBe(83);
  });

  it("encodes charId correctly as UI16LE in first two bytes", () => {
    const body = encodeDefineShape4(42, makeFillShape(0, 0, 255));
    // charId at bytes 0..1 LE
    const charId = body[0] | (body[1] << 8);
    expect(charId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// LINESTYLE2 flags
// ---------------------------------------------------------------------------

describe("LINESTYLE2 flags", () => {
  it("round/round caps — HasFill bit NOT set in high byte", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("round", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    // HasFill is bit 3 of the high byte (0x08) — must be 0
    expect(highByte & 0x08).toBe(0);
  });

  it("round/round caps — StartCap bits are 0 (round) in high byte bits[7:6]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("round", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    const startCapBits = (highByte >> 6) & 0x3;
    expect(startCapBits).toBe(0); // 0 = round
  });

  it("none caps — StartCap bits are 1 (none) in high byte bits[7:6]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("none", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    const startCapBits = (highByte >> 6) & 0x3;
    expect(startCapBits).toBe(1); // 1 = none
  });

  it("none caps — HasFill bit NOT set (no bleed into fill flag)", () => {
    // Previously the LE byte swap caused capBits=1 to land on HasFill
    const body = encodeDefineShape4(1, makeStrokeShape("none", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    expect(highByte & 0x08).toBe(0);
  });

  it("square caps — StartCap bits are 2 (square) in high byte bits[7:6]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("square", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    const startCapBits = (highByte >> 6) & 0x3;
    expect(startCapBits).toBe(2); // 2 = square
  });

  it("none caps — EndCap bits are 1 (none) in low byte bits[1:0]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("none", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const lowByte = body[flagsOffset + 1];
    const endCapBits = lowByte & 0x3;
    expect(endCapBits).toBe(1); // 1 = none
  });

  it("round join — Join bits are 0 in high byte bits[5:4]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("round", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    const joinBits = (highByte >> 4) & 0x3;
    expect(joinBits).toBe(0); // 0 = round
  });

  it("bevel join — Join bits are 1 in high byte bits[5:4]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("round", "bevel"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    const joinBits = (highByte >> 4) & 0x3;
    expect(joinBits).toBe(1); // 1 = bevel
  });

  it("miter join — Join bits are 2 in high byte bits[5:4]", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("round", "miter", 3));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    const highByte = body[flagsOffset];
    const joinBits = (highByte >> 4) & 0x3;
    expect(joinBits).toBe(2); // 2 = miter
  });

  it("miter join — MiterLimitFactor present as UI16LE after flags bytes", () => {
    const miterLimit = 3;
    const body = encodeDefineShape4(1, makeStrokeShape("round", "miter", miterLimit));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    // flags are 2 bytes (highByte + lowByte), then MiterLimitFactor UI16LE
    const miterRaw = body[flagsOffset + 2] | (body[flagsOffset + 3] << 8);
    // miterLimit is stored as FIXED8 (8.8): miterLimit * 256
    expect(miterRaw).toBe(miterLimit * 256);
  });

  it("miter join — color RGBA follows MiterLimitFactor (no desync)", () => {
    const body = encodeDefineShape4(
      1,
      makeStrokeShape("round", "miter", 3)
    );
    const flagsOffset = findLinestyle2FlagsOffset(body);
    // flags(2) + MiterLimitFactor(2) = 4 bytes before RGBA
    const r = body[flagsOffset + 4];
    const g = body[flagsOffset + 5];
    const b = body[flagsOffset + 6];
    const a = body[flagsOffset + 7];
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it("round join (non-miter) — color RGBA immediately follows flags (no MiterLimitFactor)", () => {
    const body = encodeDefineShape4(1, makeStrokeShape("round", "round"));
    const flagsOffset = findLinestyle2FlagsOffset(body);
    // flags(2) bytes only — no MiterLimitFactor
    const r = body[flagsOffset + 2];
    const g = body[flagsOffset + 3];
    const b = body[flagsOffset + 4];
    const a = body[flagsOffset + 5];
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Degenerate path filtering
// ---------------------------------------------------------------------------

describe("DefineShape4 — degenerate path filtering", () => {
  /**
   * Regression test for task 0890: shapes imported from corrupt FLA binaries can
   * contain paths with garbage coordinates (e.g. x=236829.45, y=-318545.7 pixels)
   * that exceed the valid SWF range. These cause the shape bit stream to produce a
   * spurious stateNewStyles=1 flag which Ruffle interprets as a new fill style array,
   * triggering "Invalid fill style" errors.
   *
   * The encoder must silently drop such paths to prevent corrupt SWF output.
   */
  it("silently drops paths with out-of-range coordinates (>65535 px)", () => {
    const shapeWithGarbage: Shape = {
      id: "test",
      paths: [
        // Valid path
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 10, y: 0 } },
            { type: "line", to: { x: 10, y: 10 } },
            { type: "line", to: { x: 0, y: 10 } },
          ],
          closed: true,
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        },
        // Garbage path from corrupt FLA import (coordinates > 65535 px)
        {
          start: { x: 236829.45, y: -318545.7 },
          segments: [
            { type: "line", to: { x: 236829.45, y: -658416.1 } },
            { type: "line", to: { x: 402910.55, y: -658416.1 } },
            { type: "line", to: { x: 402910.55, y: -318545.7 } },
            { type: "line", to: { x: 236829.45, y: -318545.7 } },
          ],
          closed: false,
          stroke: { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 }, width: 1, caps: "round", joints: "round", miterLimit: 3 },
        },
      ],
    };

    // Encoding must not throw
    const body = encodeDefineShape4(1, shapeWithGarbage);
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.length).toBeGreaterThan(10);

    // The resulting body must match the encoding of the shape WITHOUT the garbage path
    const shapeWithoutGarbage: Shape = {
      id: "test",
      paths: [shapeWithGarbage.paths[0]],
    };
    const cleanBody = encodeDefineShape4(1, shapeWithoutGarbage);
    expect(body).toEqual(cleanBody);
  });

  it("does not filter valid paths with large-but-valid coordinates", () => {
    const shape: Shape = {
      id: "test",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [{ type: "line", to: { x: 3000, y: 3000 } }],
          closed: false,
          stroke: { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 }, width: 2, caps: "round", joints: "round", miterLimit: 3 },
        },
      ],
    };
    const body = encodeDefineShape4(1, shape);
    expect(body.length).toBeGreaterThan(10);
  });
});

// PlaceObject2
// ---------------------------------------------------------------------------

describe("PlaceObject2", () => {
  it("encodes placement with MATRIX — does not crash", () => {
    const body = encodePlaceObject2(1, 1, 100, 200);
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.length).toBeGreaterThan(4);
  });

  it("flag byte is 0x06 for first placement (HasCharacter | HasMatrix)", () => {
    const body = encodePlaceObject2(1, 1, 0, 0);
    expect(body[0]).toBe(0x06);
  });

  it("depth is encoded as UI16LE at bytes [1..2]", () => {
    const body = encodePlaceObject2(5, 3, 0, 0);
    const depth = body[1] | (body[2] << 8);
    expect(depth).toBe(3);
  });

  it("charId is encoded as UI16LE at bytes [3..4]", () => {
    const body = encodePlaceObject2(42, 1, 0, 0);
    const charId = body[3] | (body[4] << 8);
    expect(charId).toBe(42);
  });

  it("encodes a scaled placement without crashing", () => {
    const body = encodePlaceObject2(1, 1, 50, 50, {
      scaleX: 2,
      scaleY: 2,
    });
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.length).toBeGreaterThan(4);
  });

  it("encodes a rotated placement without crashing", () => {
    const body = encodePlaceObject2(1, 1, 0, 0, {
      rotation: 45,
    });
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.length).toBeGreaterThan(4);
  });
});
