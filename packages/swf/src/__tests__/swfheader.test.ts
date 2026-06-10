/**
 * Tests for SWF header encoding: signature, version, SetBackgroundColor (tag 9),
 * frame rate encoding, and RECT (frame dimensions in twips).
 *
 * SWF v8 header layout:
 *   bytes 0-2: signature "FWS" = [0x46, 0x57, 0x53] (uncompressed)
 *   byte  3:   version byte = 0x08 (Flash 8)
 *   bytes 4-7: file length as uint32 LE
 *   bytes 8+:  RECT (frame size in TWIPS, bit-packed)
 *              then FrameRate as uint16 LE (fps * 256)
 *              then FrameCount as uint16 LE
 *
 * Tag codes:
 *    9  SetBackgroundColor
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument } from "@flash/core";

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

function makeDoc(bg = "#ff0000", fps = 24): FlashDocument {
  return {
    id: "t",
    properties: {
      width: 550,
      height: 400,
      frameRate: fps,
      backgroundColor: bg,
      rulerUnits: "px",
      grid: {
        showGrid: false,
        snapToGrid: false,
        gridColor: "#999",
        gridWidth: 18,
        gridHeight: 18,
      },
      guides: [],
      snapToObjects: false,
      snapToPixels: false,
      snapToGuides: false,
    },
    scenes: [
      {
        id: "s1",
        name: "Scene 1",
        timeline: { layers: [] },
      },
    ],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

function findTags(bytes: Uint8Array): Array<SwfTag> {
  const nBits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<SwfTag> = [];
  while (i < bytes.length - 1) {
    const h = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
    const type = (h >> 6) & 0x3ff;
    let len = h & 0x3f;
    if (len === 63) {
      len =
        bytes[i] |
        (bytes[i + 1] << 8) |
        (bytes[i + 2] << 16) |
        (bytes[i + 3] << 24);
      i += 4;
    }
    tags.push({ type, body: bytes.slice(i, i + len) });
    if (type === 0) break;
    i += len;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// RECT bit reader
// ---------------------------------------------------------------------------

function readRect(
  bytes: Uint8Array,
  offset: number
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const nBits = bytes[offset] >> 3;
  let pos = offset * 8 + 5; // skip the 5-bit nBits field
  function readBits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = Math.floor(pos / 8);
      const bit = 7 - (pos % 8);
      v = (v << 1) | ((bytes[byte] >> bit) & 1);
      pos++;
    }
    // Sign extend
    if (v & (1 << (n - 1))) v |= -(1 << n);
    return v;
  }
  return {
    xMin: readBits(nBits),
    xMax: readBits(nBits),
    yMin: readBits(nBits),
    yMax: readBits(nBits),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF header and SetBackgroundColor encoding", () => {
  it("SWF starts with 'FWS' (uncompressed) signature", () => {
    const bytes = compileDocument(makeDoc());
    // FWS = [0x46, 0x57, 0x53]
    expect(bytes[0]).toBe(0x46); // 'F'
    expect(bytes[1]).toBe(0x57); // 'W'
    expect(bytes[2]).toBe(0x53); // 'S'
  });

  it("SWF version byte is 8 (Flash 8)", () => {
    const bytes = compileDocument(makeDoc());
    expect(bytes[3]).toBe(8);
  });

  it("SetBackgroundColor (tag 9) is present in the compiled output", () => {
    const bytes = compileDocument(makeDoc("#ff0000"));
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === 9);
    expect(bgTag).toBeDefined();
  });

  it("SetBackgroundColor body is 3 bytes [R, G, B] matching #ff0000", () => {
    const bytes = compileDocument(makeDoc("#ff0000"));
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === 9)!;
    expect(bgTag.body.length).toBe(3);
    expect(bgTag.body[0]).toBe(0xff); // R
    expect(bgTag.body[1]).toBe(0x00); // G
    expect(bgTag.body[2]).toBe(0x00); // B
  });

  it("SetBackgroundColor for #0066FF → body[0]=0, body[1]=0x66, body[2]=0xFF", () => {
    const bytes = compileDocument(makeDoc("#0066ff"));
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === 9)!;
    expect(bgTag.body[0]).toBe(0x00);  // R
    expect(bgTag.body[1]).toBe(0x66);  // G
    expect(bgTag.body[2]).toBe(0xff);  // B
  });

  it("frame rate 24fps is encoded as 24*256 = 6144 (8.8 fixed-point) after RECT", () => {
    const bytes = compileDocument(makeDoc("#ffffff", 24));
    const nBits = bytes[8] >> 3;
    const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
    const frameRateOffset = 8 + rectBytes;
    const frameRateRaw =
      bytes[frameRateOffset] | (bytes[frameRateOffset + 1] << 8);
    expect(frameRateRaw).toBe(24 * 256); // 6144
  });

  it("document width 550px → RECT xMax = 11000 twips (550 * 20)", () => {
    const bytes = compileDocument(makeDoc());
    const rect = readRect(bytes, 8);
    expect(rect.xMin).toBe(0);
    expect(rect.xMax).toBe(11000); // 550 * 20
  });
});
