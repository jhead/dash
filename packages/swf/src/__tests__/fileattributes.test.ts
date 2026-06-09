/**
 * Tests for FileAttributes (tag 69) correctness in compiled SWF output.
 *
 * SWF v8+ requires FileAttributes as the very first tag after the header.
 * Without it, some players treat the SWF as an older version.
 *
 * Tag codes:
 *    1  ShowFrame
 *    9  SetBackgroundColor
 *   69  FileAttributes
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_FILE_ATTRIBUTES = 69;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

/**
 * Parse all tag records from a compiled SWF binary.
 * Stops at the End tag (code 0) or end of file.
 */
function parseTags(swf: Uint8Array): SwfTag[] {
  // Locate end of the variable-length RECT in the header.
  // RECT starts at byte 8: first 5 bits = Nbits; total RECT bits = 5 + 4*Nbits
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // SWF header = 8 bytes (sig+ver+fileLen) + rectBytes + 4 (frameRate+frameCount)
  let pos = 8 + rectBytes + 4;

  const tags: SwfTag[] = [];
  while (pos < swf.length) {
    const recordHeader = swf[pos] | (swf[pos + 1] << 8);
    const tagCode = (recordHeader >> 6) & 0x3ff;
    let bodyLength = recordHeader & 0x3f;
    let headerSize = 2;
    if (bodyLength === 0x3f) {
      bodyLength =
        swf[pos + 2] |
        (swf[pos + 3] << 8) |
        (swf[pos + 4] << 16) |
        (swf[pos + 5] << 24);
      headerSize = 6;
    }
    const bodyStart = pos + headerSize;
    tags.push({
      code: tagCode,
      body: swf.slice(bodyStart, bodyStart + bodyLength),
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break; // End tag
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
  for (let i = 0; i < frameCount; i++) {
    frames.push(makeBlankFrame(i));
  }
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
    timeline: {
      layers: [makeLayer(`${id}-layer`, frameCount)],
    },
  };
}

function makeDoc(scenes: Scene[]): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileAttributes (tag 69) correctness", () => {
  it("FileAttributes (tag 69) is the very first tag in the SWF output", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].code).toBe(TAG_FILE_ATTRIBUTES);
  });

  it("FileAttributes appears before SetBackgroundColor (tag 9)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const fileAttrIdx = withIndices.find((t) => t.code === TAG_FILE_ATTRIBUTES)?.idx;
    const bgColorIdx = withIndices.find((t) => t.code === TAG_SET_BACKGROUND_COLOR)?.idx;
    expect(fileAttrIdx).toBeDefined();
    expect(bgColorIdx).toBeDefined();
    expect(fileAttrIdx!).toBeLessThan(bgColorIdx!);
  });

  it("FileAttributes tag body is exactly 4 bytes", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const fileAttrTag = tags.find((t) => t.code === TAG_FILE_ATTRIBUTES);
    expect(fileAttrTag).toBeDefined();
    expect(fileAttrTag!.body.length).toBe(4);
  });

  it("FileAttributes 4-byte flags body is all zeros (local sandbox, AVM1, no metadata)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const fileAttrTag = tags.find((t) => t.code === TAG_FILE_ATTRIBUTES);
    expect(fileAttrTag).toBeDefined();
    expect(fileAttrTag!.body[0]).toBe(0x00);
    expect(fileAttrTag!.body[1]).toBe(0x00);
    expect(fileAttrTag!.body[2]).toBe(0x00);
    expect(fileAttrTag!.body[3]).toBe(0x00);
  });

  it("FileAttributes appears before the first ShowFrame tag", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const fileAttrIdx = withIndices.find((t) => t.code === TAG_FILE_ATTRIBUTES)?.idx;
    const firstShowFrameIdx = withIndices.find((t) => t.code === TAG_SHOW_FRAME)?.idx;
    expect(fileAttrIdx).toBeDefined();
    expect(firstShowFrameIdx).toBeDefined();
    expect(fileAttrIdx!).toBeLessThan(firstShowFrameIdx!);
  });

  it("FileAttributes appears exactly once in the SWF output", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const fileAttrTags = tags.filter((t) => t.code === TAG_FILE_ATTRIBUTES);
    expect(fileAttrTags.length).toBe(1);
  });
});
