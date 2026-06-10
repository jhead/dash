/**
 * Tests for DefineBitsLossless2 (tag 36) and DefineBitsJPEG3 (tag 35) encoding.
 *
 * Focused unit tests verifying:
 *  - encodeDefineBitsLossless2: tag type 36, format byte 5, width/height fields
 *  - encodeDefineBitsJpeg3: tag type 35, returns Uint8Array
 */

import { describe, it, expect } from "vitest";
import { encodeDefineBitsLossless2, encodeDefineBitsJpeg3, ensureJpegEOI } from "../bitmaps.js";

// ---------------------------------------------------------------------------
// Helper: parse the tag record header from a standalone Uint8Array
// ---------------------------------------------------------------------------

function parseTagRecord(tag: Uint8Array): { tagCode: number; body: Uint8Array } {
  const recordHdr = tag[0] | (tag[1] << 8);
  const tagCode = (recordHdr >> 6) & 0x3ff;
  let bodyLength = recordHdr & 0x3f;
  let hdrSize = 2;
  if (bodyLength === 0x3f) {
    bodyLength =
      tag[2] | (tag[3] << 8) | (tag[4] << 16) | (tag[5] << 24);
    hdrSize = 6;
  }
  const body = tag.slice(hdrSize, hdrSize + bodyLength);
  return { tagCode, body };
}

// ---------------------------------------------------------------------------
// DefineBitsLossless2 tests
// ---------------------------------------------------------------------------

describe("encodeDefineBitsLossless2", () => {
  // 2×2 ARGB image: opaque red, green, blue, semi-grey
  const pixels = new Uint8Array([
    255, 255, 0,   0,   // pixel 0: A=255, R=255, G=0,   B=0
    255, 0,   255, 0,   // pixel 1: A=255, R=0,   G=255, B=0
    255, 0,   0,   255, // pixel 2: A=255, R=0,   G=0,   B=255
    255, 128, 128, 128, // pixel 3: A=255, R=128, G=128, B=128
  ]);
  const WIDTH = 2;
  const HEIGHT = 2;
  const CHAR_ID = 1;

  it("returns a Uint8Array", () => {
    const result = encodeDefineBitsLossless2(CHAR_ID, WIDTH, HEIGHT, pixels);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("tag type is 36 (DefineBitsLossless2)", () => {
    const tag = encodeDefineBitsLossless2(CHAR_ID, WIDTH, HEIGHT, pixels);
    const { tagCode } = parseTagRecord(tag);
    expect(tagCode).toBe(36);
  });

  it("body format byte is 5 (32-bit ARGB)", () => {
    const tag = encodeDefineBitsLossless2(CHAR_ID, WIDTH, HEIGHT, pixels);
    const { body } = parseTagRecord(tag);
    // body layout: UI16 characterId, UI8 format, UI16 width, UI16 height, ...
    expect(body[2]).toBe(5);
  });

  it("body width field is 2", () => {
    const tag = encodeDefineBitsLossless2(CHAR_ID, WIDTH, HEIGHT, pixels);
    const { body } = parseTagRecord(tag);
    const width = body[3] | (body[4] << 8);
    expect(width).toBe(WIDTH);
  });

  it("body height field is 2", () => {
    const tag = encodeDefineBitsLossless2(CHAR_ID, WIDTH, HEIGHT, pixels);
    const { body } = parseTagRecord(tag);
    const height = body[5] | (body[6] << 8);
    expect(height).toBe(HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// DefineBitsJPEG3 tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ensureJpegEOI tests
// ---------------------------------------------------------------------------

describe("ensureJpegEOI", () => {
  it("appends EOI (0xFF 0xD9) to a JPEG missing it", () => {
    // JPEG with SOI but no EOI
    const input = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xaa, 0xbb]);
    const result = ensureJpegEOI(input);
    expect(result.length).toBe(input.length + 2);
    expect(result[result.length - 2]).toBe(0xff);
    expect(result[result.length - 1]).toBe(0xd9);
  });

  it("does not duplicate EOI when already present", () => {
    // JPEG with SOI and EOI
    const input = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
    const result = ensureJpegEOI(input);
    expect(result).toBe(input); // same reference — no copy made
    expect(result.length).toBe(input.length);
  });

  it("returns non-JPEG data unchanged", () => {
    // PNG magic bytes
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = ensureJpegEOI(png);
    expect(result).toBe(png);
  });

  it("returns empty array unchanged", () => {
    const empty = new Uint8Array(0);
    const result = ensureJpegEOI(empty);
    expect(result).toBe(empty);
  });

  it("handles a minimal JPEG (SOI only, no EOI)", () => {
    const soi = new Uint8Array([0xff, 0xd8]);
    const result = ensureJpegEOI(soi);
    expect(result).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });
});

describe("encodeDefineBitsJpeg3", () => {
  // Minimal JPEG bytes (empty JPEG: SOI + EOI markers)
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  // Single-pixel alpha channel
  const alphaBytes = new Uint8Array([0xff]);
  const CHAR_ID = 2;

  it("returns a Uint8Array", () => {
    const result = encodeDefineBitsJpeg3(CHAR_ID, jpegBytes, alphaBytes);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("tag type is 35 (DefineBitsJPEG3)", () => {
    const tag = encodeDefineBitsJpeg3(CHAR_ID, jpegBytes, alphaBytes);
    const { tagCode } = parseTagRecord(tag);
    expect(tagCode).toBe(35);
  });
});
