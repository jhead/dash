/**
 * End-to-end SWF compile and parse round-trip tests.
 *
 * Builds a FlashDocument, compiles it via exportSWF, then parses the raw
 * binary to verify structural correctness.
 *
 * Tag codes used:
 *   0   End
 *   1   ShowFrame
 *   9   SetBackgroundColor
 *  69   FileAttributes
 */

import { describe, it, expect } from "vitest";
import { exportSWF } from "../export.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_END = 0;
const TAG_SHOW_FRAME = 1;
const TAG_SET_BACKGROUND_COLOR = 9;
const TAG_FILE_ATTRIBUTES = 69;

// ---------------------------------------------------------------------------
// SWF tag parser
// ---------------------------------------------------------------------------

interface SwfTag {
  type: number;
  body: Uint8Array;
}

/**
 * Parse all tag records from a compiled SWF binary.
 * Stops at End tag (type 0) or end of buffer.
 */
function findTags(bytes: Uint8Array): SwfTag[] {
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
    if (type === 0) break;
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
  frameRate: 24,
  backgroundColor: "#336699",
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

function makeBlankFrame(index: number, overrides: Partial<Frame> = {}): Frame {
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
    ...overrides,
  };
}

function makeLayer(id: string, frameCount: number, overrides: Partial<Layer> = {}): Layer {
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
    ...overrides,
  };
}

function makeScene(id: string, name: string, layers: Layer[]): Scene {
  return {
    id,
    name,
    timeline: { layers },
  };
}

/** Build the test document with 2 scenes: scene1 has 3 layers, scene2 has 1 layer. */
function buildTestDoc(): FlashDocument {
  // Scene 1: 3 layers (normal, guide, masked) each with 1 frame
  const scene1Layers: Layer[] = [
    makeLayer("s1-layer-0", 1, { name: "Normal Layer", type: "normal" }),
    makeLayer("s1-layer-1", 1, { name: "Guide Layer", type: "guide" }),
    makeLayer("s1-layer-2", 1, { name: "Masked Layer", type: "masked" }),
  ];

  // Scene 2: 1 normal layer with 1 frame
  const scene2Layers: Layer[] = [
    makeLayer("s2-layer-0", 1, { name: "Scene 2 Layer", type: "normal" }),
  ];

  return {
    id: "e2e-doc",
    properties: { ...BASE_PROPS },
    scenes: [
      makeScene("scene-1", "Scene 1", scene1Layers),
      makeScene("scene-2", "Scene 2", scene2Layers),
    ],
    library: { items: [], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SWF e2e compile and parse round-trip", () => {
  // Test 1: SWF compiles without error
  it("SWF compiles without error", () => {
    const doc = buildTestDoc();
    expect(() => exportSWF(doc, { compress: false })).not.toThrow();
  });

  // Test 2: File starts with "FWS"
  it('file starts with "FWS" (bytes 0-2 are 0x46, 0x57, 0x53)', () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    expect(bytes[0]).toBe(0x46); // F
    expect(bytes[1]).toBe(0x57); // W
    expect(bytes[2]).toBe(0x53); // S
  });

  // Test 3: Version byte (index 3) is 8
  it("version byte (index 3) is 8 (Flash Player 8 / SWF v8)", () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    expect(bytes[3]).toBe(8);
  });

  // Test 4: Tag stream contains ShowFrame tag (type 1)
  it("tag stream contains ShowFrame tag (type 1)", () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);
    const showFrameTags = tags.filter((t) => t.type === TAG_SHOW_FRAME);
    expect(showFrameTags.length).toBeGreaterThan(0);
  });

  // Test 5: Tag stream contains End tag (type 0)
  it("tag stream contains End tag (type 0)", () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);
    const endTag = tags.find((t) => t.type === TAG_END);
    expect(endTag).toBeDefined();
  });

  // Test 6: Tag stream contains SetBackgroundColor tag (type 9)
  it("tag stream contains SetBackgroundColor tag (type 9)", () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
  });

  // Test 7: SetBackgroundColor body is 3 bytes
  it("SetBackgroundColor body is 3 bytes", () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);
    const bgTag = tags.find((t) => t.type === TAG_SET_BACKGROUND_COLOR);
    expect(bgTag).toBeDefined();
    expect(bgTag!.body.length).toBe(3);
  });

  // Test 8: FileAttributes tag (type 69) is first in stream
  it("FileAttributes tag (type 69) is the first tag in the stream", () => {
    const doc = buildTestDoc();
    const bytes = exportSWF(doc, { compress: false });
    const tags = findTags(bytes);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].type).toBe(TAG_FILE_ATTRIBUTES);
  });

  // Test 9: FrameRate in header is correct (frameRate * 256 stored as little-endian UI16)
  it("FrameRate in header encodes frameRate * 256 as little-endian UI16 (24fps → 0x1800)", () => {
    const doc = buildTestDoc(); // frameRate: 24
    const bytes = exportSWF(doc, { compress: false });

    // Parse RECT length to find the FrameRate field offset
    const nbits = bytes[8] >> 3;
    const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
    const frameRateOffset = 8 + rectBytes;

    // FrameRate is a UI16LE: fps * 256
    const frameRateRaw = bytes[frameRateOffset] | (bytes[frameRateOffset + 1] << 8);
    // 24 * 256 = 6144 = 0x1800
    expect(frameRateRaw).toBe(24 * 256);
  });
});
