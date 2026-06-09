/**
 * Tests that the SWF header frameCount field matches the actual frame count
 * of the compiled document.
 *
 * SWF header layout (after RECT):
 *   FrameRate: uint16 LE  (fps * 256, fixed-point 8.8)
 *   FrameCount: uint16 LE (total frames across all scenes)
 *
 * The helper readSWFHeader() parses the RECT length dynamically
 * using the Nbits field (first 5 bits of byte 8) to locate these fields.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import {
  createDocument,
  createLayer,
  createFrame,
  createScene,
  insertFrame,
} from "@flash/core";
import type { FlashDocument, Timeline } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF header reader
// ---------------------------------------------------------------------------

/**
 * Parse the FrameRate and FrameCount from a compiled SWF binary header.
 *
 * Header layout:
 *   magic (3 bytes) + version (1 byte) + fileLength (4 bytes) = 8 bytes
 *   then FrameSize RECT (variable length, bit-packed)
 *   then FrameRate uint16 LE (fps * 256)
 *   then FrameCount uint16 LE
 */
function readSWFHeader(bytes: Uint8Array) {
  // The first 5 bits of byte 8 give Nbits for the RECT
  const nbits = bytes[8] >> 3;
  const rectBytes = Math.ceil((5 + 4 * nbits) / 8);
  const frameRateOffset = 8 + rectBytes;
  const frameCountOffset = frameRateOffset + 2;
  const frameRate = (bytes[frameRateOffset] | (bytes[frameRateOffset + 1] << 8)) / 256;
  const frameCount = bytes[frameCountOffset] | (bytes[frameCountOffset + 1] << 8);
  return { frameRate, frameCount };
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

/** Build a FlashDocument with a single scene containing one layer of N frames. */
function makeDocWithFrameCount(n: number, frameRate = 12): FlashDocument {
  const frames = Array.from({ length: n }, (_, i) =>
    createFrame(i, { isKeyframe: i === 0 })
  );
  const layer = createLayer("Layer 1", "normal", { frames, frameCount: n });
  const timeline: Timeline = { layers: [layer] };
  const scene = { ...createScene("Scene 1"), timeline };
  const doc = createDocument();
  return {
    ...doc,
    properties: { ...doc.properties, frameRate },
    scenes: [scene],
  };
}

/**
 * Build a doc with N frames using insertFrame to extend a base doc,
 * mirroring the task spec's suggested approach.
 */
function makeDocViaInsertFrame(n: number): FlashDocument {
  const base = createDocument();
  // createDocument() gives one scene with one layer (frameCount=1).
  // We need to extend to N frames by inserting N-1 additional frames.
  let doc = base;
  for (let i = 1; i < n; i++) {
    const scene = doc.scenes[0]!;
    const layer = scene.timeline.layers[0]!;
    const updatedTimeline = insertFrame(scene.timeline, layer.id, i);
    doc = {
      ...doc,
      scenes: [{ ...scene, timeline: updatedTimeline }],
    };
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Tests: frameCount field
// ---------------------------------------------------------------------------

describe("SWF header frameCount", () => {
  it("single-scene doc with 1 frame → frameCount = 1", () => {
    const doc = makeDocWithFrameCount(1);
    const swf = compileDocument(doc);
    const { frameCount } = readSWFHeader(swf);
    expect(frameCount).toBe(1);
  });

  it("single-scene doc with 10 frames → frameCount = 10", () => {
    const doc = makeDocWithFrameCount(10);
    const swf = compileDocument(doc);
    const { frameCount } = readSWFHeader(swf);
    expect(frameCount).toBe(10);
  });

  it("doc built with insertFrame to 5 frames → frameCount = 5", () => {
    const doc = makeDocViaInsertFrame(5);
    const swf = compileDocument(doc);
    const { frameCount } = readSWFHeader(swf);
    expect(frameCount).toBe(5);
  });

  it("doc built with insertFrame to 10 frames → frameCount = 10", () => {
    const doc = makeDocViaInsertFrame(10);
    const swf = compileDocument(doc);
    const { frameCount } = readSWFHeader(swf);
    expect(frameCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Tests: frameRate field
// ---------------------------------------------------------------------------

describe("SWF header frameRate", () => {
  it("frameRate=12 → header frameRate field = 12 (fixed-point 8.8)", () => {
    const doc = makeDocWithFrameCount(1, 12);
    const swf = compileDocument(doc);
    const { frameRate } = readSWFHeader(swf);
    expect(frameRate).toBeCloseTo(12, 0);
  });

  it("frameRate=24 → header frameRate field = 24 (fixed-point 8.8)", () => {
    const doc = makeDocWithFrameCount(1, 24);
    const swf = compileDocument(doc);
    const { frameRate } = readSWFHeader(swf);
    expect(frameRate).toBeCloseTo(24, 0);
  });
});
