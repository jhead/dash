/**
 * Acceptance tests for the Publish-Settings "JPEG quality" slider (task 1287).
 *
 * The bug: the slider was inert — photo (JPEG) library bitmaps were embedded by
 * passing their ORIGINAL dataUri bytes through verbatim, so changing the quality
 * produced a byte-identical SWF. The fix threads `CompileOptions.jpegQuality`
 * (sourced from the Publish-Settings slider) into the bitmap emit paths, which
 * RE-ENCODE the bitmap's decoded ARGB pixels to JPEG at the requested quality.
 *
 * Oracle (from the task): a bitmap-containing doc published at jpegQuality 20 vs
 * 90 must produce DIFFERENT DefineBitsJPEG2/3 payload bytes (smaller at lower
 * quality). We decode our OWN compiled SWF's DefineBitsJPEG2 tag and compare.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { encodeJpeg } from "../jpeg-encode.js";
import type { BitmapItem, BitmapDisplayObject, FlashDocument, Frame, Layer, Scene } from "@flash/core";

// ---------------------------------------------------------------------------
// Minimal SWF tag parser (header → tag stream)
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

/** Return the JPEG image bytes from the first DefineBitsJPEG2 (tag 21), if any. */
function jpeg2ImageBytes(swf: Uint8Array): Uint8Array | undefined {
  const tag = parseSWFTags(swf).find((t) => t.code === 21);
  if (!tag) return undefined;
  // body = UI16 charId + raw image bytes
  return tag.body.slice(2);
}

// ---------------------------------------------------------------------------
// Document factory helpers (mirrors bitmap-compression.test.ts)
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

const W = 32;
const H = 32;

/** A detailed ARGB image so the quality difference is large enough to measure. */
function makeArgbPixels(): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      px[i] = 255; // A — opaque, so we stay on the DefineBitsJPEG2 (tag 21) path
      px[i + 1] = (x * 8 + y * 3) & 0xff; // R
      px[i + 2] = (y * 8 + x * 5) & 0xff; // G
      px[i + 3] = ((x ^ y) * 11) & 0xff; // B
    }
  }
  return px;
}

function makeBitmapItem(): BitmapItem {
  // dataUri is a tiny placeholder JPEG — when jpegQuality + bitmapPixels are
  // supplied the emit path re-encodes from pixels, NOT from this dataUri.
  return {
    id: "bmp-1",
    name: "photo.jpg",
    itemType: "bitmap",
    dataUri: "data:image/jpeg;base64,/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
    originalWidth: W,
    originalHeight: H,
    allowSmoothing: false,
    compressionType: "photo",
    quality: 80,
  };
}

function makeFrame(displayObjects: readonly BitmapDisplayObject[]): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: false,
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

function makeDoc(bitmapItem: BitmapItem): FlashDocument {
  const bmpObj: BitmapDisplayObject = {
    type: "bitmap",
    id: "bmp-obj-1",
    libraryItemId: bitmapItem.id,
    x: 0,
    y: 0,
    width: W,
    height: H,
  };
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

describe("encodeJpeg (baseline JPEG encoder)", () => {
  it("produces a well-formed JFIF stream (SOI…EOI) and quality scales size", () => {
    const px = makeArgbPixels();
    const lo = encodeJpeg(W, H, px, 20);
    const hi = encodeJpeg(W, H, px, 90);

    // SOI / EOI markers
    expect(lo[0]).toBe(0xff);
    expect(lo[1]).toBe(0xd8);
    expect(lo[lo.length - 2]).toBe(0xff);
    expect(lo[lo.length - 1]).toBe(0xd9);

    // Higher quality → more bytes
    expect(hi.length).toBeGreaterThan(lo.length);
  });

  it("is deterministic: same pixels + quality → identical bytes", () => {
    const px = makeArgbPixels();
    const a = encodeJpeg(W, H, px, 75);
    const b = encodeJpeg(W, H, px, 75);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("Publish-Settings JPEG quality threads into the SWF (task 1287)", () => {
  it("two quality settings produce DIFFERENT, size-ordered DefineBitsJPEG2 payloads", () => {
    const pixels = makeArgbPixels();
    const bitmapPixels = new Map([[ "bmp-1", { width: W, height: H, pixels } ]]);

    const swfLow = compileDocument(makeDoc(makeBitmapItem()), { jpegQuality: 20, bitmapPixels });
    const swfHigh = compileDocument(makeDoc(makeBitmapItem()), { jpegQuality: 90, bitmapPixels });

    const lowImg = jpeg2ImageBytes(swfLow);
    const highImg = jpeg2ImageBytes(swfHigh);

    expect(lowImg).toBeDefined();
    expect(highImg).toBeDefined();

    // Different bytes — the slider is no longer inert.
    expect(Array.from(lowImg!)).not.toEqual(Array.from(highImg!));
    // Lower quality → smaller encoded JPEG.
    expect(lowImg!.length).toBeLessThan(highImg!.length);

    // Both are real JPEGs (SOI/EOI), not the placeholder dataUri passed through.
    expect(lowImg![0]).toBe(0xff);
    expect(lowImg![1]).toBe(0xd8);
    expect(highImg![0]).toBe(0xff);
    expect(highImg![1]).toBe(0xd8);
  });

  it("re-encodes from pixels (ignores the dataUri) when quality is set", () => {
    const pixels = makeArgbPixels();
    const bitmapPixels = new Map([[ "bmp-1", { width: W, height: H, pixels } ]]);

    // Without quality → original dataUri bytes pass through verbatim (legacy).
    const swfPassthrough = compileDocument(makeDoc(makeBitmapItem()), { bitmapPixels });
    // With quality → re-encoded from pixels.
    const swfReencoded = compileDocument(makeDoc(makeBitmapItem()), { jpegQuality: 90, bitmapPixels });

    const passImg = jpeg2ImageBytes(swfPassthrough)!;
    const reImg = jpeg2ImageBytes(swfReencoded)!;

    // The re-encoded 32×32 image is far larger than the 1×1 placeholder dataUri,
    // proving the dataUri was NOT used when quality is supplied.
    expect(reImg.length).toBeGreaterThan(passImg.length);
  });

  it("without jpegQuality the photo path is unchanged (no regression)", () => {
    const pixels = makeArgbPixels();
    const bitmapPixels = new Map([[ "bmp-1", { width: W, height: H, pixels } ]]);

    const a = jpeg2ImageBytes(compileDocument(makeDoc(makeBitmapItem()), { bitmapPixels }))!;
    const b = jpeg2ImageBytes(compileDocument(makeDoc(makeBitmapItem()), {}))!;

    // Same original dataUri bytes either way (pixels present or not) when no quality.
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
