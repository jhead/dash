/**
 * Tests for SetBackgroundColor (tag 9) correctness in compiled SWF output.
 *
 * Verifies that:
 * - SetBackgroundColor is emitted exactly ONCE per SWF (not once per scene)
 * - The RGB bytes are correct for the doc's backgroundColor property
 * - SetBackgroundColor appears before the first ShowFrame tag
 *
 * Tag codes:
 *    1  ShowFrame
 *    9  SetBackgroundColor
 *   43  FrameLabel
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;

// ---------------------------------------------------------------------------
// SWF tag parser (shared with scenes.test.ts)
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
// Document factory helpers (reused from scenes.test.ts pattern)
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
    motionEaseType: "none",
    motionRotate: "none",
    motionRotateCount: 0,
    motionOrientToPath: false,
    motionSync: false,
    motionSnap: false,
    motionScale: false,
    shapeEase: 0,
    shapeEaseType: "none",
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

function makeDoc(
  scenes: Scene[],
  backgroundColor = "#ffffff"
): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS, backgroundColor },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SetBackgroundColor (tag 9) correctness", () => {
  // Test 1: Single-scene document: SetBackgroundColor appears exactly once
  it("single-scene document: SetBackgroundColor (tag 9) appears exactly once", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTags = tags.filter((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTags.length).toBe(1);
  });

  // Test 2: Multi-scene document: SetBackgroundColor appears exactly once (not N times)
  it("three-scene document: SetBackgroundColor appears exactly once (not 3 times)", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 2),
      makeScene("s3", "Scene 3", 2),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTags = tags.filter((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTags.length).toBe(1);
  });

  // Test 3: backgroundColor '#ff0000' encodes correctly (R=255, G=0, B=0)
  it("backgroundColor '#ff0000' encodes R=255, G=0, B=0", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], "#ff0000");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body[0]).toBe(255); // R
    expect(bgTag!.body[1]).toBe(0);   // G
    expect(bgTag!.body[2]).toBe(0);   // B
  });

  // Test 4: backgroundColor '#ffffff' (white) encodes R=255, G=255, B=255
  it("backgroundColor '#ffffff' encodes R=255, G=255, B=255", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], "#ffffff");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body[0]).toBe(255); // R
    expect(bgTag!.body[1]).toBe(255); // G
    expect(bgTag!.body[2]).toBe(255); // B
  });

  // Test 5: SetBackgroundColor appears before the first ShowFrame
  it("SetBackgroundColor appears before the first ShowFrame in the tag stream", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 2)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const bgTagIdx = withIndices.find((t) => t.code === TAG_SET_BACKGROUND_COLOR)?.idx;
    const firstShowFrameIdx = withIndices.find((t) => t.code === TAG_SHOW_FRAME)?.idx;
    expect(bgTagIdx).toBeDefined();
    expect(firstShowFrameIdx).toBeDefined();
    expect(bgTagIdx!).toBeLessThan(firstShowFrameIdx!);
  });

  // Test 6: Two-scene document: SetBackgroundColor appears exactly once
  it("two-scene document: SetBackgroundColor appears exactly once (not 2 times)", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 3),
      makeScene("s2", "Scene 2", 3),
    ]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTags = tags.filter((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTags.length).toBe(1);
  });

  // Test 7: backgroundColor '#0000ff' encodes R=0, G=0, B=255
  it("backgroundColor '#0000ff' encodes R=0, G=0, B=255", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], "#0000ff");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body[0]).toBe(0);   // R
    expect(bgTag!.body[1]).toBe(0);   // G
    expect(bgTag!.body[2]).toBe(255); // B
  });

  // Test 8: SetBackgroundColor body is exactly 3 bytes (RGB)
  it("SetBackgroundColor body is exactly 3 bytes", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)], "#336699");
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const bgTag = tags.find((t) => t.code === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body.length).toBe(3);
  });
});
