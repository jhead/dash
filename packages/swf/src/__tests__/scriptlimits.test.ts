/**
 * Tests for SWF ScriptLimits (tag 65) and Protect (tag 24) tag encoding.
 *
 * ScriptLimits body = MaxRecursionDepth UI16 + ScriptTimeoutSeconds UI16 (4 bytes).
 * Protect (tag 24) is emitted via the `protect` option in CompileOptions.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Document factory helpers (shared pattern across swf tests)
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
  overrides: Partial<typeof BASE_PROPS> = {}
): FlashDocument {
  return {
    id: "doc-1",
    properties: { ...BASE_PROPS, ...overrides },
    scenes,
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// SWF tag parser helper (handles variable-length RECT header)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
}

function parseTags(swf: Uint8Array): SwfTag[] {
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
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

function readUI16LE(body: Uint8Array, offset: number): number {
  return body[offset] | (body[offset + 1] << 8);
}

const TAG_PROTECT = 24;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_SCRIPT_LIMITS = 65;
const TAG_SHOW_FRAME = 1;
const TAG_END = 0;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF minimal doc compilation", () => {
  it("minimal doc compiles without error", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("output starts with FWS magic bytes", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    expect(buf[0]).toBe(0x46);
    expect(buf[1]).toBe(0x57);
    expect(buf[2]).toBe(0x53);
  });

  it("output version byte is 0x08 (Flash 8)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    expect(buf[3]).toBe(0x08);
  });

  it("tag stream contains End tag (type 0)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const endTag = tags.find((t) => t.code === TAG_END);
    expect(endTag).toBeDefined();
  });
});

describe("SWF ScriptLimits tag (65)", () => {
  it("ScriptLimits tag is present in default compilation output", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const scriptLimitsTag = tags.find((t) => t.code === TAG_SCRIPT_LIMITS);
    expect(scriptLimitsTag).toBeDefined();
  });

  it("ScriptLimits tag body is exactly 4 bytes", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const scriptLimitsTag = tags.find((t) => t.code === TAG_SCRIPT_LIMITS);
    expect(scriptLimitsTag).toBeDefined();
    expect(scriptLimitsTag!.body.length).toBe(4);
  });

  it("ScriptLimits defaults: MaxRecursionDepth=256, ScriptTimeoutSeconds=15", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const scriptLimitsTag = tags.find((t) => t.code === TAG_SCRIPT_LIMITS);
    expect(scriptLimitsTag).toBeDefined();
    expect(readUI16LE(scriptLimitsTag!.body, 0)).toBe(256);
    expect(readUI16LE(scriptLimitsTag!.body, 2)).toBe(15);
  });

  it("ScriptLimits honors compile options", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, {
      maxRecursionDepth: 512,
      scriptTimeoutSeconds: 30,
    });
    const tags = parseTags(buf);
    const scriptLimitsTag = tags.find((t) => t.code === TAG_SCRIPT_LIMITS);
    expect(scriptLimitsTag).toBeDefined();
    expect(readUI16LE(scriptLimitsTag!.body, 0)).toBe(512);
    expect(readUI16LE(scriptLimitsTag!.body, 2)).toBe(30);
  });

  it("ScriptLimits appears immediately after SetBackgroundColor", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const bgColorIdx = withIndices.find(
      (t) => t.code === TAG_SET_BACKGROUND_COLOR
    )?.idx;
    const scriptLimitsIdx = withIndices.find(
      (t) => t.code === TAG_SCRIPT_LIMITS
    )?.idx;
    expect(bgColorIdx).toBeDefined();
    expect(scriptLimitsIdx).toBeDefined();
    expect(scriptLimitsIdx!).toBe(bgColorIdx! + 1);
  });

  it("ScriptLimits appears before the first ShowFrame", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 3)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const scriptLimitsIdx = withIndices.find(
      (t) => t.code === TAG_SCRIPT_LIMITS
    )?.idx;
    const firstShowFrameIdx = withIndices.find(
      (t) => t.code === TAG_SHOW_FRAME
    )?.idx;
    expect(scriptLimitsIdx).toBeDefined();
    expect(firstShowFrameIdx).toBeDefined();
    expect(scriptLimitsIdx!).toBeLessThan(firstShowFrameIdx!);
  });

  it("ScriptLimits appears exactly once in multi-scene SWF", () => {
    const doc = makeDoc([
      makeScene("s1", "Scene 1", 2),
      makeScene("s2", "Scene 2", 2),
    ]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const scriptLimitsTags = tags.filter((t) => t.code === TAG_SCRIPT_LIMITS);
    expect(scriptLimitsTags.length).toBe(1);
  });

  it("SWF with ScriptLimits emits all required structural tags", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    const codes = tags.map((t) => t.code);
    expect(codes).toContain(69); // FileAttributes
    expect(codes).toContain(9); // SetBackgroundColor
    expect(codes).toContain(65); // ScriptLimits
    expect(codes).toContain(1); // ShowFrame
    expect(codes).toContain(0); // End
  });
});

describe("SWF Protect tag (24)", () => {
  it("Protect tag is absent by default", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc);
    const tags = parseTags(buf);
    expect(tags.find((t) => t.code === TAG_PROTECT)).toBeUndefined();
  });

  it("Protect tag is present when protect option is true", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, { protect: true });
    const tags = parseTags(buf);
    const protectTag = tags.find((t) => t.code === TAG_PROTECT);
    expect(protectTag).toBeDefined();
  });

  it("Protect tag body is empty (0 bytes)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, { protect: true });
    const tags = parseTags(buf);
    const protectTag = tags.find((t) => t.code === TAG_PROTECT);
    expect(protectTag).toBeDefined();
    expect(protectTag!.body.length).toBe(0);
  });

  it("Protect tag is absent when protect option is false", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const buf = compileDocument(doc, { protect: false });
    const tags = parseTags(buf);
    expect(tags.find((t) => t.code === TAG_PROTECT)).toBeUndefined();
  });
});
