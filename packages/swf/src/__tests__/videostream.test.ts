/**
 * Tests for SWF DefineVideoStream (tag 60) and VideoFrame (tag 61) support.
 *
 * Current implementation status (as of writing):
 *   - VideoItem is defined in @flash/core (id, name, itemType, dataUri,
 *     frameCount, frameRate, width, height).
 *   - compile.ts does NOT import VideoItem and does NOT emit tag 60 or tag 61.
 *   - tags.ts does NOT define Tag.DefineVideoStream (60) or Tag.VideoFrame (61).
 *
 * Tests 1–5 verify the safe/graceful behaviour that already works.
 * Tests 6–8 are skipped pending implementation of the two video tags.
 *
 * SWF tag codes referenced:
 *   60  DefineVideoStream  — declares a video character (width, height, codec…)
 *   61  VideoFrame         — delivers one compressed video frame into the stream
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, Frame, Layer, Scene, VideoItem } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser (shared with other test files)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

/**
 * Walk every tag record in an uncompressed SWF binary (magic == "FWS").
 * Stops at the End tag (code 0) or end-of-file.
 */
function parseTags(swf: Uint8Array): SwfTag[] {
  // Skip the 3-byte signature, 1-byte version, 4-byte file-length.
  // Then skip the RECT (first 5 bits encode Nbits, total = 5+4*Nbits bits).
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  // After RECT: 2-byte FrameRate, 2-byte FrameCount.
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
    tags.push({ code: tagCode, body: swf.slice(bodyStart, bodyStart + bodyLength), offset: pos });
    pos = bodyStart + bodyLength;
    if (tagCode === 0 /* End */) break;
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

function makeLayer(id: string, frameCount = 1): Layer {
  const frames: Frame[] = [];
  for (let i = 0; i < frameCount; i++) frames.push(makeBlankFrame(i));
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
    timeline: { layers: [makeLayer(`${id}-layer`, frameCount)] },
  };
}

/** Build a VideoItem with optional overrides. */
function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: "video-1",
    name: "clip.flv",
    itemType: "video",
    dataUri: "",
    frameCount: 10,
    frameRate: 12,
    width: 320,
    height: 240,
    ...overrides,
  };
}

function makeDoc(
  libraryItems: import("@flash/core").LibraryItem[] = [],
  frameCount = 1
): FlashDocument {
  return {
    id: "doc-1",
    properties: BASE_PROPS,
    scenes: [makeScene("s1", "Scene 1", frameCount)],
    library: { items: libraryItems, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Tests: current graceful behaviour (no video tag support yet)
// ---------------------------------------------------------------------------

describe("SWF video tag support — graceful behaviour", () => {
  // Test 1: Compile succeeds with no video items in library.
  it("compiles a document with no video items without error", () => {
    const doc = makeDoc([]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 2: SWF output is non-empty and starts with the "FWS" magic bytes.
  it("SWF output starts with FWS magic [0x46, 0x57, 0x53] for a doc with no video", () => {
    const doc = makeDoc([]);
    const swf = compileDocument(doc);
    expect(swf).toBeInstanceOf(Uint8Array);
    expect(swf.length).toBeGreaterThan(20);
    expect(swf[0]).toBe(0x46); // 'F'
    expect(swf[1]).toBe(0x57); // 'W'
    expect(swf[2]).toBe(0x53); // 'S'
  });

  // Test 3: A VideoItem in the library does not cause a compile error.
  it("compiles without error when a VideoItem exists in the library", () => {
    const video = makeVideoItem();
    const doc = makeDoc([video]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 4: A VideoItem with non-empty dataUri in the library does not throw.
  it("compiles without error when a VideoItem has a non-empty dataUri", () => {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA" });
    const doc = makeDoc([video]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 5: Multiple VideoItems in the library do not cause a compile error.
  it("compiles without error when multiple VideoItems exist in the library", () => {
    const v1 = makeVideoItem({ id: "video-1", name: "clip1.flv" });
    const v2 = makeVideoItem({ id: "video-2", name: "clip2.flv", width: 640, height: 480 });
    const doc = makeDoc([v1, v2]);
    expect(() => compileDocument(doc)).not.toThrow();
  });

  // Test 6: Compiling with a VideoItem produces a valid SWF (parseable tags).
  it("SWF produced with a VideoItem in library is parseable and ends with End tag", () => {
    const video = makeVideoItem();
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(tags.length).toBeGreaterThan(0);
    const lastTag = tags[tags.length - 1];
    expect(lastTag.code).toBe(Tag.End);
  });

  // Test 7: No DefineVideoStream (tag 60) is emitted (not yet implemented).
  it("does NOT emit DefineVideoStream (tag 60) — not yet implemented", () => {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA" });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const videoStreamTags = tags.filter((t) => t.code === 60);
    // Currently expected to be empty because the feature is unimplemented.
    expect(videoStreamTags.length).toBe(0);
  });

  // Test 8: No VideoFrame (tag 61) is emitted (not yet implemented).
  it("does NOT emit VideoFrame (tag 61) — not yet implemented", () => {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA" });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const videoFrameTags = tags.filter((t) => t.code === 61);
    expect(videoFrameTags.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Skipped tests: pending implementation of DefineVideoStream / VideoFrame
// ---------------------------------------------------------------------------

describe("SWF video tag support — pending implementation", () => {
  // These tests document the expected behaviour once tag 60 and tag 61 are
  // implemented.  They are skipped so they don't fail CI until the feature
  // is wired up.  Remove the `.skip` when adding the implementation.

  it.skip("emits DefineVideoStream (tag 60) for each VideoItem with a dataUri", () => {
    // Expected: one tag-60 record whose body starts with:
    //   UI16  CharacterID      (≥ 1)
    //   UI16  NumFrames        (matches VideoItem.frameCount)
    //   UI16  Width            (VideoItem.width)
    //   UI16  Height           (VideoItem.height)
    //   UB[4] VideoFlagsDeblocking
    //   UB[4] VideoFlagsSmoothing
    //   UI8   CodecID          (e.g. 4 = Sorenson H.263, 3 = Screen Video)
    const video = makeVideoItem({
      dataUri: "data:video/x-flv;base64,AAAA",
      frameCount: 10,
      width: 320,
      height: 240,
    });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const streamTags = tags.filter((t) => t.code === 60);
    expect(streamTags.length).toBe(1);
    const body = streamTags[0].body;
    // CharacterID: first two bytes are a uint16 ≥ 1
    const charId = body[0] | (body[1] << 8);
    expect(charId).toBeGreaterThanOrEqual(1);
    // NumFrames
    const numFrames = body[2] | (body[3] << 8);
    expect(numFrames).toBe(10);
    // Width
    const width = body[4] | (body[5] << 8);
    expect(width).toBe(320);
    // Height
    const height = body[6] | (body[7] << 8);
    expect(height).toBe(240);
    // Body must be at least 10 bytes (header fields + flags + codecId)
    expect(body.length).toBeGreaterThanOrEqual(10);
  });

  it.skip("emits one VideoFrame (tag 61) per decoded video frame in the dataUri", () => {
    // Expected: N tag-61 records, each with body:
    //   UI16  StreamID   (matches the DefineVideoStream CharacterID)
    //   UI16  FrameNum   (0-based frame index)
    //   VIDEODATA        (compressed video payload for that frame)
    const video = makeVideoItem({
      dataUri: "data:video/x-flv;base64,AAAA",
      frameCount: 3,
    });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const frameTags = tags.filter((t) => t.code === 61);
    expect(frameTags.length).toBe(3);
    for (let i = 0; i < frameTags.length; i++) {
      const body = frameTags[i].body;
      const frameNum = body[2] | (body[3] << 8);
      expect(frameNum).toBe(i);
    }
  });

  it.skip("DefineVideoStream StreamID matches the VideoFrame StreamID", () => {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA", frameCount: 1 });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const streamTag = tags.find((t) => t.code === 60);
    const frameTag = tags.find((t) => t.code === 61);
    expect(streamTag).toBeDefined();
    expect(frameTag).toBeDefined();

    const streamCharId = streamTag!.body[0] | (streamTag!.body[1] << 8);
    const frameStreamId = frameTag!.body[0] | (frameTag!.body[1] << 8);
    expect(frameStreamId).toBe(streamCharId);
  });

  it.skip("Tag.DefineVideoStream constant equals 60", () => {
    // Once tags.ts is updated, this constant should exist.
    expect((Tag as Record<string, number>)["DefineVideoStream"]).toBe(60);
  });

  it.skip("Tag.VideoFrame constant equals 61", () => {
    expect((Tag as Record<string, number>)["VideoFrame"]).toBe(61);
  });
});
