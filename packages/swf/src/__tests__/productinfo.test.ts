/**
 * Tests for optional SWF tags: ProductInfo (tag 41) and DebugId (tag 63).
 *
 * ProductInfo (tag 41): Identifies the authoring tool that produced the SWF.
 *   Body contains tool name, version, and build information.
 *
 * DebugId (tag 63): A 16-byte UUID used to link a SWF to its debug symbols.
 *   Only emitted when debug output is enabled.
 *
 * These tags are optional — the tests below check the structure IF the tag is
 * present, and use `.todo` placeholders for behaviour that is not yet emitted.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_PRODUCT_INFO = 41;
const TAG_DEBUG_ID = 63;
const TAG_END = 0;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

/**
 * Walk the tag stream of a compiled SWF binary.
 * Stops at the End tag (type 0) or end of file.
 */
function findTags(bytes: Uint8Array): Array<SwfTag> {
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  let i = 8 + rectBytes + 4;
  const tags: Array<{ type: number; body: Uint8Array }> = [];
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
    if (type === TAG_END) break;
    i += len;
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

describe("ProductInfo (tag 41) and DebugId (tag 63) optional tags", () => {
  it("SWF compiles without error", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("SWF contains at least one non-End tag", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const nonEndTags = tags.filter((t) => t.type !== TAG_END);
    expect(nonEndTags.length).toBeGreaterThan(0);
  });

  it("if ProductInfo (tag 41) is present, its body is non-empty", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const productInfoTag = tags.find((t) => t.type === TAG_PRODUCT_INFO);
    if (productInfoTag !== undefined) {
      expect(productInfoTag.body.length).toBeGreaterThan(0);
    }
  });

  it("if DebugId (tag 63) is present, its body is exactly 16 bytes (UUID)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const debugIdTag = tags.find((t) => t.type === TAG_DEBUG_ID);
    if (debugIdTag !== undefined) {
      expect(debugIdTag.body.length).toBe(16);
    }
  });

  it("ProductInfo (tag 41) is always emitted with productId=8 and majorVersion=8", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = findTags(swf);
    const tag = tags.find((t) => t.type === TAG_PRODUCT_INFO);
    expect(tag).toBeDefined();
    // body must be at least 10 bytes (UI32 productId + UI32 edition + UI8 major + UI8 minor)
    expect(tag!.body.length).toBeGreaterThanOrEqual(10);
    // productId @ offset 0, LE UI32 = 8
    const productId =
      tag!.body[0] |
      (tag!.body[1] << 8) |
      (tag!.body[2] << 16) |
      (tag!.body[3] << 24);
    expect(productId).toBe(8);
    // majorVersion @ offset 8
    expect(tag!.body[8]).toBe(8);
    // minorVersion @ offset 9
    expect(tag!.body[9]).toBe(0);
  });

  it("DebugId (tag 63) is a 16-byte UUID when debugPassword is supplied", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { debugPassword: "test" });
    const tags = findTags(swf);
    const tag = tags.find((t) => t.type === TAG_DEBUG_ID);
    expect(tag).toBeDefined();
    expect(tag!.body.length).toBe(16);
  });
});
