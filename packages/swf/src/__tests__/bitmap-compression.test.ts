/**
 * Tests for bitmap compression type routing in the SWF compiler.
 *
 * Verifies that:
 *  - BitmapItem with compressionType "lossless" + bitmapPixels → DefineBitsLossless2 (tag 36)
 *  - BitmapItem with compressionType "photo" (default JPEG path) → DefineBitsJPEG2 (tag 21)
 *
 * Related to task 0812: Bitmap Properties dialog — per-asset JPEG quality vs lossless
 * compression choice, allowSmoothing toggle.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { BitmapItem, BitmapDisplayObject, FlashDocument, Frame, Layer, Scene } from "@flash/core";

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
    const hdr = bytes[pos] | (bytes[pos + 1] << 8);
    const code = (hdr >> 6) & 0x3ff;
    let len = hdr & 0x3f;
    let headerSize = 2;
    if (len === 0x3f) {
      len = bytes[pos + 2] | (bytes[pos + 3] << 8) | (bytes[pos + 4] << 16) | (bytes[pos + 5] << 24);
      headerSize = 6;
    }
    tags.push({ code, body: bytes.slice(pos + headerSize, pos + headerSize + len) });
    pos += headerSize + len;
    if (code === 0) break;
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
  grid: { showGrid: false, snapToGrid: false, gridColor: "#999999", gridWidth: 18, gridHeight: 18 },
  guides: [],
  snapToObjects: false,
  snapToPixels: false,
  snapToGuides: false,
};

function makeBitmapItem(overrides?: Partial<BitmapItem>): BitmapItem {
  return {
    id: "bmp-1",
    name: "test.png",
    itemType: "bitmap",
    dataUri: "",
    originalWidth: 4,
    originalHeight: 4,
    allowSmoothing: false,
    compressionType: "lossless",
    quality: 80,
    ...overrides,
  };
}

function makeBitmapDisplayObject(libraryItemId: string): BitmapDisplayObject {
  return {
    type: "bitmap",
    id: "bmp-obj-1",
    libraryItemId,
    x: 0,
    y: 0,
    width: 4,
    height: 4,
  };
}

function makeFrame(displayObjects: readonly BitmapDisplayObject[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
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
    displayObjects,
  };
}

function makeLayer(frames: Frame[]): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frameCount: frames.length,
    frames,
  };
}

function makeScene(layers: Layer[]): Scene {
  return { id: "scene-1", name: "Scene 1", timeline: { layers } };
}

function makeDocWithBitmapOnStage(bitmapItem: BitmapItem): FlashDocument {
  const bmpObj = makeBitmapDisplayObject(bitmapItem.id);
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene([makeLayer([makeFrame([bmpObj])])])],
    library: { items: [bitmapItem], folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bitmap compression routing", () => {
  it("lossless bitmap + bitmapPixels → DefineBitsLossless2 (tag 36)", () => {
    const bitmapItem = makeBitmapItem({ compressionType: "lossless" });
    const doc = makeDocWithBitmapOnStage(bitmapItem);

    // Provide pre-decoded pixel data — required for lossless path
    const pixels = new Uint8Array(4 * 4 * 4);
    pixels.fill(0xff);
    const bitmapPixels = new Map([
      [bitmapItem.id, { width: 4, height: 4, pixels }],
    ]);

    const swf = compileDocument(doc, { bitmapPixels });
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(36); // DefineBitsLossless2
    expect(tagCodes).not.toContain(21); // no DefineBitsJPEG2
  });

  it("photo bitmap with dataUri → DefineBitsJPEG2 (tag 21)", () => {
    // Minimal valid PNG used as JPEG fallback data URI
    const minPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bitmapItem = makeBitmapItem({
      compressionType: "photo",
      dataUri: minPng,
      quality: 80,
    });
    const doc = makeDocWithBitmapOnStage(bitmapItem);

    // No bitmapPixels — falls back to JPEG path using the dataUri bytes
    const swf = compileDocument(doc);
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(21); // DefineBitsJPEG2
    expect(tagCodes).not.toContain(36); // no DefineBitsLossless2
  });

  it("lossless bitmap without bitmapPixels but with dataUri falls back to tag 21", () => {
    const minPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bitmapItem = makeBitmapItem({
      compressionType: "lossless",
      dataUri: minPng,
    });
    const doc = makeDocWithBitmapOnStage(bitmapItem);

    // No bitmapPixels provided → compiler uses dataUri fallback (JPEG2 tag)
    const swf = compileDocument(doc);
    const tags = parseSWFTags(swf);
    const tagCodes = tags.map((t) => t.code);

    expect(tagCodes).toContain(21); // DefineBitsJPEG2 fallback
    expect(tagCodes).not.toContain(36); // no DefineBitsLossless2 without pixel data
  });

  it("allowSmoothing field is persisted in BitmapItem", () => {
    const item = makeBitmapItem({ allowSmoothing: true });
    expect(item.allowSmoothing).toBe(true);

    const item2 = makeBitmapItem({ allowSmoothing: false });
    expect(item2.allowSmoothing).toBe(false);
  });

  it("quality field is persisted in BitmapItem", () => {
    const item = makeBitmapItem({ quality: 60 });
    expect(item.quality).toBe(60);

    const item2 = makeBitmapItem({ quality: 100 });
    expect(item2.quality).toBe(100);
  });

  it("compiles without error for any compressionType value", () => {
    for (const compressionType of ["photo", "lossless"] as const) {
      const item = makeBitmapItem({ compressionType, dataUri: "" });
      const doc = makeDocWithBitmapOnStage(item);
      expect(() => compileDocument(doc)).not.toThrow();
    }
  });
});
