/**
 * Tests for EnableDebugger2 (tag 64) and Protect (tag 24) in compiled SWF output.
 *
 * Tag codes:
 *    9  SetBackgroundColor
 *   24  Protect
 *   64  EnableDebugger2
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_PROTECT = 24;
const TAG_ENABLE_DEBUGGER2 = 64;

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
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
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

describe("Protect (tag 24)", () => {
  it("SWF contains tag 24 when protect: true", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { protect: true });
    const tags = parseTags(swf);
    const protectTag = tags.find((t) => t.code === TAG_PROTECT);
    expect(protectTag).toBeDefined();
  });

  it("SWF does NOT contain tag 24 when protect is not set", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const protectTag = tags.find((t) => t.code === TAG_PROTECT);
    expect(protectTag).toBeUndefined();
  });

  it("Protect tag (24) has an empty body", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { protect: true });
    const tags = parseTags(swf);
    const protectTag = tags.find((t) => t.code === TAG_PROTECT);
    expect(protectTag).toBeDefined();
    expect(protectTag!.body.length).toBe(0);
  });

  it("Protect tag (24) appears before SetBackgroundColor (tag 9)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { protect: true });
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const protectIdx = withIndices.find((t) => t.code === TAG_PROTECT)?.idx;
    const bgColorIdx = withIndices.find((t) => t.code === TAG_SET_BACKGROUND_COLOR)?.idx;
    expect(protectIdx).toBeDefined();
    expect(bgColorIdx).toBeDefined();
    expect(protectIdx!).toBeLessThan(bgColorIdx!);
  });
});

describe("EnableDebugger2 (tag 64)", () => {
  it("SWF contains tag 64 when debugPassword is set", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { debugPassword: "test" });
    const tags = parseTags(swf);
    const debugTag = tags.find((t) => t.code === TAG_ENABLE_DEBUGGER2);
    expect(debugTag).toBeDefined();
  });

  it("SWF does NOT contain tag 64 when debugPassword is not set", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const debugTag = tags.find((t) => t.code === TAG_ENABLE_DEBUGGER2);
    expect(debugTag).toBeUndefined();
  });

  it("EnableDebugger2 tag body starts with 0x00 0x00 (reserved uint16)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { debugPassword: "test" });
    const tags = parseTags(swf);
    const debugTag = tags.find((t) => t.code === TAG_ENABLE_DEBUGGER2);
    expect(debugTag).toBeDefined();
    expect(debugTag!.body[0]).toBe(0x00);
    expect(debugTag!.body[1]).toBe(0x00);
  });

  it("EnableDebugger2 tag body contains the password string null-terminated", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const password = "test";
    const swf = compileDocument(doc, { debugPassword: password });
    const tags = parseTags(swf);
    const debugTag = tags.find((t) => t.code === TAG_ENABLE_DEBUGGER2);
    expect(debugTag).toBeDefined();
    // Body: [0x00, 0x00, 't', 'e', 's', 't', 0x00]
    const body = debugTag!.body;
    expect(body.length).toBe(2 + password.length + 1);
    for (let i = 0; i < password.length; i++) {
      expect(body[2 + i]).toBe(password.charCodeAt(i));
    }
    // Null terminator
    expect(body[2 + password.length]).toBe(0x00);
  });

  it("EnableDebugger2 tag (64) appears before SetBackgroundColor (tag 9)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { debugPassword: "test" });
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const debugIdx = withIndices.find((t) => t.code === TAG_ENABLE_DEBUGGER2)?.idx;
    const bgColorIdx = withIndices.find((t) => t.code === TAG_SET_BACKGROUND_COLOR)?.idx;
    expect(debugIdx).toBeDefined();
    expect(bgColorIdx).toBeDefined();
    expect(debugIdx!).toBeLessThan(bgColorIdx!);
  });

  it("Both Protect and EnableDebugger2 appear before SetBackgroundColor when both options set", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { protect: true, debugPassword: "secret" });
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const protectIdx = withIndices.find((t) => t.code === TAG_PROTECT)?.idx;
    const debugIdx = withIndices.find((t) => t.code === TAG_ENABLE_DEBUGGER2)?.idx;
    const bgColorIdx = withIndices.find((t) => t.code === TAG_SET_BACKGROUND_COLOR)?.idx;
    expect(protectIdx).toBeDefined();
    expect(debugIdx).toBeDefined();
    expect(bgColorIdx).toBeDefined();
    expect(protectIdx!).toBeLessThan(bgColorIdx!);
    expect(debugIdx!).toBeLessThan(bgColorIdx!);
  });
});
