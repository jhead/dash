/**
 * Tests for Metadata tag (tag 77) with XMP metadata in compiled SWF output.
 *
 * Tag codes:
 *   69  FileAttributes
 *   77  Metadata
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag codes
// ---------------------------------------------------------------------------

const TAG_FILE_ATTRIBUTES = 69;
const TAG_METADATA = 77;

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

describe("Metadata tag (tag 77)", () => {
  it("does not emit tag 77 when metadata option is not set", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const metadataTag = tags.find((t) => t.code === TAG_METADATA);
    expect(metadataTag).toBeUndefined();
  });

  it("emits tag 77 when metadata option is set to empty object", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: {} });
    const tags = parseTags(swf);
    const metadataTag = tags.find((t) => t.code === TAG_METADATA);
    expect(metadataTag).toBeDefined();
  });

  it("tag 77 body contains valid XMP XML (contains 'xmpmeta')", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: { title: "Test" } });
    const tags = parseTags(swf);
    const metadataTag = tags.find((t) => t.code === TAG_METADATA);
    expect(metadataTag).toBeDefined();
    const text = new TextDecoder().decode(metadataTag!.body);
    expect(text).toContain("xmpmeta");
  });

  it("tag 77 body contains the specified title", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: { title: "My Animation" } });
    const tags = parseTags(swf);
    const metadataTag = tags.find((t) => t.code === TAG_METADATA);
    expect(metadataTag).toBeDefined();
    const text = new TextDecoder().decode(metadataTag!.body);
    expect(text).toContain("My Animation");
  });

  it("tag 77 body contains the specified author", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: { author: "Jane Doe" } });
    const tags = parseTags(swf);
    const metadataTag = tags.find((t) => t.code === TAG_METADATA);
    expect(metadataTag).toBeDefined();
    const text = new TextDecoder().decode(metadataTag!.body);
    expect(text).toContain("Jane Doe");
  });

  it("XML-escapes special characters in title (<, >, &)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: { title: "A & B <test>" } });
    const tags = parseTags(swf);
    const metadataTag = tags.find((t) => t.code === TAG_METADATA);
    expect(metadataTag).toBeDefined();
    const text = new TextDecoder().decode(metadataTag!.body);
    expect(text).toContain("&amp;");
    expect(text).toContain("&lt;");
    expect(text).toContain("&gt;");
    expect(text).not.toContain("A & B");
    expect(text).not.toContain("<test>");
  });

  it("tag 77 appears after FileAttributes (tag 69)", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: { title: "Ordered" } });
    const tags = parseTags(swf);
    const withIndices = tags.map((t, idx) => ({ ...t, idx }));
    const fileAttrsIdx = withIndices.find((t) => t.code === TAG_FILE_ATTRIBUTES)?.idx;
    const metadataIdx = withIndices.find((t) => t.code === TAG_METADATA)?.idx;
    expect(fileAttrsIdx).toBeDefined();
    expect(metadataIdx).toBeDefined();
    expect(metadataIdx!).toBeGreaterThan(fileAttrsIdx!);
  });

  it("FileAttributes has HasMetadata bit (bit 4) set when metadata option is provided", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc, { metadata: { title: "Test" } });
    const tags = parseTags(swf);
    const fileAttrsTag = tags.find((t) => t.code === TAG_FILE_ATTRIBUTES);
    expect(fileAttrsTag).toBeDefined();
    const flags =
      fileAttrsTag!.body[0] |
      (fileAttrsTag!.body[1] << 8) |
      (fileAttrsTag!.body[2] << 16) |
      (fileAttrsTag!.body[3] << 24);
    expect(flags & 0x10).toBe(0x10);
  });

  it("FileAttributes does NOT have HasMetadata bit set when no metadata option", () => {
    const doc = makeDoc([makeScene("s1", "Scene 1", 1)]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const fileAttrsTag = tags.find((t) => t.code === TAG_FILE_ATTRIBUTES);
    expect(fileAttrsTag).toBeDefined();
    const flags =
      fileAttrsTag!.body[0] |
      (fileAttrsTag!.body[1] << 8) |
      (fileAttrsTag!.body[2] << 16) |
      (fileAttrsTag!.body[3] << 24);
    expect(flags & 0x10).toBe(0);
  });
});
