/**
 * Visual regression tests — fixture document compilation checks.
 *
 * These tests do NOT use Playwright or a browser. They verify that the
 * fixture documents produced by visual-fixture.ts compile correctly into
 * valid SWF binaries with the expected tag structure.
 *
 * SWF tag codes referenced:
 *   0   End
 *   1   ShowFrame
 *   9   SetBackgroundColor
 *  26   PlaceObject2
 *  83   DefineShape4
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import {
  makeColoredRectDoc,
  makeMultiShapeDoc,
  makeTweenedDoc,
} from "./visual-fixture.js";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_PLACE_OBJECT2 = 26;
const TAG_DEFINE_SHAPE4 = 83;

// ---------------------------------------------------------------------------
// Minimal SWF parser (same approach as integration.test.ts)
// ---------------------------------------------------------------------------

interface SWFTag {
  code: number;
  body: Uint8Array;
}

function parseTags(bytes: Uint8Array, offset: number): SWFTag[] {
  const tags: SWFTag[] = [];
  let pos = offset;
  while (pos + 2 <= bytes.length) {
    const recordHdr = bytes[pos] | (bytes[pos + 1] << 8);
    const tagCode = (recordHdr >> 6) & 0x3ff;
    let bodyLength = recordHdr & 0x3f;
    let hdrSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        bytes[pos + 2] |
        (bytes[pos + 3] << 8) |
        (bytes[pos + 4] << 16) |
        (bytes[pos + 5] << 24);
      hdrSize = 6;
    }
    const bodyStart = pos + hdrSize;
    tags.push({ code: tagCode, body: bytes.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === TAG_END) break;
  }
  return tags;
}

function parseSWF(bytes: Uint8Array): { tagsOffset: number; tags: SWFTag[]; frameCount: number } {
  // Parse the RECT bit-pack to find the tags offset
  let byteOff = 8;
  let bitBuf = 0;
  let bitsLeft = 0;

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bitsLeft === 0) {
        bitBuf = bytes[byteOff++];
        bitsLeft = 8;
      }
      result = (result << 1) | ((bitBuf >> (bitsLeft - 1)) & 1);
      bitsLeft--;
    }
    return result;
  }

  const nBits = readBits(5);
  readBits(nBits * 4); // xMin, xMax, yMin, yMax

  bitsLeft = 0; // flush to byte boundary
  const frameCount = bytes[byteOff + 2] | (bytes[byteOff + 3] << 8);
  const tagsOffset = byteOff + 4;

  const tags = parseTags(bytes, tagsOffset);
  return { tagsOffset, tags, frameCount };
}

// ---------------------------------------------------------------------------
// Tests: makeColoredRectDoc
// ---------------------------------------------------------------------------

describe("visual-fixture: makeColoredRectDoc", () => {
  it("compiles without throwing", () => {
    const doc = makeColoredRectDoc("#ff0000", 10, 10, 100, 100);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("produces a valid FWS SWF (signature bytes)", () => {
    const doc = makeColoredRectDoc("#ff0000", 10, 10, 100, 100);
    const bytes = compileDocument(doc);
    expect(bytes[0]).toBe(0x46); // F
    expect(bytes[1]).toBe(0x57); // W
    expect(bytes[2]).toBe(0x53); // S
    expect(bytes[3]).toBe(8);    // version 8
  });

  it("contains a SetBackgroundColor tag (code 9)", () => {
    const doc = makeColoredRectDoc("#ff0000", 10, 10, 100, 100);
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    // Body is exactly 3 bytes (R, G, B)
    expect(bgTag!.body.length).toBe(3);
  });

  it("SetBackgroundColor is NOT the rect color (background differs from shape)", () => {
    // makeColoredRectDoc uses a contrasting background so they are distinguishable
    const doc = makeColoredRectDoc("#ff0000", 10, 10, 100, 100);
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    // Background should be white (#ffffff → 255, 255, 255), not red
    expect(bgTag!.body[0]).toBe(0xff); // R
    expect(bgTag!.body[1]).toBe(0xff); // G
    expect(bgTag!.body[2]).toBe(0xff); // B
  });

  it("contains exactly one DefineShape4 tag (code 83)", () => {
    const doc = makeColoredRectDoc("#0000ff", 50, 50, 200, 150);
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBe(1);
  });

  it("DefineShape4 appears before PlaceObject2 in tag stream", () => {
    const doc = makeColoredRectDoc("#00ff00", 20, 20, 80, 80);
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const defineIdx = tags.findIndex((t) => t.code === TAG_DEFINE_SHAPE4);
    const placeIdx = tags.findIndex((t) => t.code === TAG_PLACE_OBJECT2);
    expect(defineIdx).toBeGreaterThanOrEqual(0);
    expect(placeIdx).toBeGreaterThanOrEqual(0);
    expect(defineIdx).toBeLessThan(placeIdx);
  });

  it("produces exactly one ShowFrame tag for a single-frame document", () => {
    const doc = makeColoredRectDoc("#ff0000", 10, 10, 100, 100);
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: makeMultiShapeDoc
// ---------------------------------------------------------------------------

describe("visual-fixture: makeMultiShapeDoc", () => {
  it("compiles without throwing", () => {
    const doc = makeMultiShapeDoc();
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("contains exactly 3 DefineShape4 tags — one per colored rectangle", () => {
    const doc = makeMultiShapeDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const shapeTags = tags.filter((t) => t.code === TAG_DEFINE_SHAPE4);
    expect(shapeTags.length).toBe(3);
  });

  it("all DefineShape4 tags appear before PlaceObject2 tags", () => {
    const doc = makeMultiShapeDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const lastDefineIdx = tags.reduce(
      (max, t, i) => (t.code === TAG_DEFINE_SHAPE4 ? i : max),
      -1
    );
    const firstPlaceIdx = tags.findIndex((t) => t.code === TAG_PLACE_OBJECT2);
    expect(lastDefineIdx).toBeGreaterThanOrEqual(0);
    expect(firstPlaceIdx).toBeGreaterThanOrEqual(0);
    expect(lastDefineIdx).toBeLessThan(firstPlaceIdx);
  });

  it("contains exactly one ShowFrame tag (single-frame doc)", () => {
    const doc = makeMultiShapeDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    expect(tags.filter((t) => t.code === TAG_SHOW_FRAME).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: makeTweenedDoc
// ---------------------------------------------------------------------------

describe("visual-fixture: makeTweenedDoc", () => {
  it("compiles without throwing", () => {
    const doc = makeTweenedDoc();
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("produces exactly 5 ShowFrame tags for the 5-frame tween", () => {
    const doc = makeTweenedDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const showFrames = tags.filter((t) => t.code === TAG_SHOW_FRAME);
    expect(showFrames.length).toBe(5);
  });

  it("FrameCount in SWF header equals 5", () => {
    const doc = makeTweenedDoc();
    const bytes = compileDocument(doc);
    const { frameCount } = parseSWF(bytes);
    expect(frameCount).toBe(5);
  });

  it("has at least one DefineShape4 tag for the tweened rectangle", () => {
    const doc = makeTweenedDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    expect(tags.some((t) => t.code === TAG_DEFINE_SHAPE4)).toBe(true);
  });

  it("has multiple PlaceObject2 tags as the shape moves across frames", () => {
    const doc = makeTweenedDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    const placeTags = tags.filter((t) => t.code === TAG_PLACE_OBJECT2);
    // First frame places the object (isFirst), subsequent moved frames emit move updates
    expect(placeTags.length).toBeGreaterThanOrEqual(2);
  });

  it("ends with an End tag (code 0)", () => {
    const doc = makeTweenedDoc();
    const bytes = compileDocument(doc);
    const { tags } = parseSWF(bytes);
    expect(tags[tags.length - 1].code).toBe(TAG_END);
  });
});
