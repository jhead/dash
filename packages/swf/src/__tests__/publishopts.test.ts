/**
 * Task 0604 — Core publish settings and SWF output options tests.
 *
 * Tests the compile options surface of compileDocument:
 *   - compress: true/false  → CWS/FWS header
 *   - Version byte          → 0x08 (Flash 8)
 *   - protect: true/false   → Protect tag (24) present/absent
 *   - debugPassword         → EnableDebugger2 tag (64) present/absent
 *   - Empty scenes          → valid SWF still produced
 *
 * Tag codes:
 *    0  End
 *    9  SetBackgroundColor
 *   24  Protect
 *   64  EnableDebugger2
 */

import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_PROTECT = 24;
const TAG_ENABLE_DEBUGGER2 = 64;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseSWFTags(bytes: Uint8Array): SwfTag[] {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
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
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  width: 550,
  height: 400,
  frameRate: 12,
  backgroundColor: "#ffffff",
  rulerUnits: "px" as const,
  grid: {
    showGrid: false,
    snapToGrid: false,
    gridColor: "#999999",
    gridWidth: 18,
    gridHeight: 18,
  },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeBlankFrame(index: number): Frame {
  return {
    index,
    isKeyframe: true,
    isEmpty: true,
    tweenType: "none",
    label: "",
    labelType: "name",
    script: "",
    sound: null,
    motionEase: 0,
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects: [],
  };
}

function makeLayer(id: string, frameCount: number): Layer {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) frames.push(makeBlankFrame(i));
  return {
    id,
    name: id,
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames,
    frameCount,
  };
}

function makeScene(id: string, name: string, frameCount = 1): Scene {
  return {
    id,
    name,
    timeline: { layers: [makeLayer(`${id}-layer`, frameCount)] },
  };
}

function makeDoc(scenes: Scene[], overrides: Partial<typeof BASE_PROPS> = {}): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS, ...overrides },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF output options — compression (task 0604)", () => {
  it("1. default compile (no options) produces FWS (uncompressed) header", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const buf = compileDocument(doc);
    expect(buf[0]).toBe(0x46); // 'F'
    expect(buf[1]).toBe(0x57); // 'W'
    expect(buf[2]).toBe(0x53); // 'S'
  });

  it("2. { compress: true } produces CWS (compressed) header", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const buf = compileDocument(doc, { compress: true });
    expect(buf[0]).toBe(0x43); // 'C'
    expect(buf[1]).toBe(0x57); // 'W'
    expect(buf[2]).toBe(0x53); // 'S'
  });

  it("3. { compress: false } always produces FWS header", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const buf = compileDocument(doc, { compress: false });
    expect(buf[0]).toBe(0x46); // 'F'
    expect(buf[1]).toBe(0x57); // 'W'
    expect(buf[2]).toBe(0x53); // 'S'
  });

  it("4. CWS body decompresses to the same content as the FWS body", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const fws = compileDocument(doc, { compress: false });
    const cws = compileDocument(doc, { compress: true });
    const decompressed = inflateSync(cws.slice(8));
    expect(decompressed).toEqual(fws.slice(8));
  });
});

describe("SWF output options — version byte (task 0604)", () => {
  it("5. version byte (byte 3) is 0x08 (Flash 8) in uncompressed output", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const buf = compileDocument(doc);
    expect(buf[3]).toBe(0x08);
  });

  it("6. version byte (byte 3) is 0x08 (Flash 8) in compressed output", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const buf = compileDocument(doc, { compress: true });
    expect(buf[3]).toBe(0x08);
  });
});

describe("SWF output options — Protect tag (task 0604)", () => {
  it("7. Protect tag (24) is absent by default", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const swf = compileDocument(doc);
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_PROTECT)).toBe(false);
  });

  it("8. { protect: true } adds Protect tag (24) to output", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const swf = compileDocument(doc, { protect: true });
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_PROTECT)).toBe(true);
  });

  it("9. { protect: false } omits Protect tag (24)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const swf = compileDocument(doc, { protect: false });
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_PROTECT)).toBe(false);
  });
});

describe("SWF output options — debugPassword (task 0604)", () => {
  it("10. { debugPassword: 'pass' } does not crash", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    expect(() => compileDocument(doc, { debugPassword: "pass" })).not.toThrow();
  });

  it("11. { debugPassword: 'pass' } emits EnableDebugger2 tag (64)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const swf = compileDocument(doc, { debugPassword: "pass" });
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_ENABLE_DEBUGGER2)).toBe(true);
  });

  it("12. EnableDebugger2 tag is absent when debugPassword is not set", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1")]);
    const swf = compileDocument(doc);
    const tags = parseSWFTags(swf);
    expect(tags.some((t) => t.code === TAG_ENABLE_DEBUGGER2)).toBe(false);
  });
});

describe("SWF output options — empty scenes (task 0604)", () => {
  it("13. compile with empty scenes still produces a valid SWF", () => {
    const doc: FlashDocument = {
      id: "doc-empty",
      properties: { ...BASE_PROPS },
      scenes: [],
      library: { items: [], folders: [] },
    };
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("14. compile with empty scenes produces FWS header", () => {
    const doc: FlashDocument = {
      id: "doc-empty",
      properties: { ...BASE_PROPS },
      scenes: [],
      library: { items: [], folders: [] },
    };
    const swf = compileDocument(doc);
    expect(swf[0]).toBe(0x46); // 'F'
    expect(swf[1]).toBe(0x57); // 'W'
    expect(swf[2]).toBe(0x53); // 'S'
  });
});
