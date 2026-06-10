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

  // Test 7: One DefineVideoStream (tag 60) is emitted per VideoItem.
  it("emits one DefineVideoStream (tag 60) per VideoItem with a dataUri", () => {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA" });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const videoStreamTags = tags.filter((t) => t.code === 60);
    expect(videoStreamTags.length).toBe(1);
  });

  // Test 8: VideoFrame (tag 61) tags are emitted to drive the stream.
  it("emits VideoFrame (tag 61) tags to drive the stream", () => {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA", frameCount: 10 });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const videoFrameTags = tags.filter((t) => t.code === 61);
    // With an undecodable FLV stub we synthesize frameCount empty frames.
    expect(videoFrameTags.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Skipped tests: pending implementation of DefineVideoStream / VideoFrame
// ---------------------------------------------------------------------------

describe("SWF video tag support — pending implementation", () => {
  // These tests document the expected behaviour once tag 60 and tag 61 are
  // implemented.  They are skipped so they don't fail CI until the feature
  // is wired up.  Remove the `.skip` when adding the implementation.

  it("emits DefineVideoStream (tag 60) for each VideoItem with a dataUri", () => {
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

  it("emits one VideoFrame (tag 61) per decoded video frame in the dataUri", () => {
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

  it("DefineVideoStream StreamID matches the VideoFrame StreamID", () => {
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

  it("Tag.DefineVideoStream constant equals 60", () => {
    // Once tags.ts is updated, this constant should exist.
    expect((Tag as Record<string, number>)["DefineVideoStream"]).toBe(60);
  });

  it("Tag.VideoFrame constant equals 61", () => {
    expect((Tag as Record<string, number>)["VideoFrame"]).toBe(61);
  });
});

// ---------------------------------------------------------------------------
// Low-level encoder + FLV demuxer unit tests (synthetic data)
// ---------------------------------------------------------------------------

import {
  encodeDefineVideoStream,
  encodeVideoFrame,
  demuxFlv,
  VideoCodec,
} from "../video.js";

/** Build a minimal valid FLV with `n` video tags (H.263 codec, payload = i+1 bytes). */
function makeFlv(n: number): Uint8Array {
  const parts: number[] = [];
  // Header: "FLV", version 1, flags (video only = 0x01), DataOffset = 9.
  parts.push(0x46, 0x4c, 0x56, 0x01, 0x01, 0x00, 0x00, 0x00, 0x09);
  // First PreviousTagSize.
  parts.push(0x00, 0x00, 0x00, 0x00);
  for (let i = 0; i < n; i++) {
    const payloadLen = i + 1; // first byte is the frametype/codec nibble byte
    parts.push(9); // TagType = video
    // DataSize UI24-BE
    parts.push((payloadLen >> 16) & 0xff, (payloadLen >> 8) & 0xff, payloadLen & 0xff);
    // Timestamp UI24-BE + ext
    parts.push(0, 0, 0, 0);
    // StreamID UI24
    parts.push(0, 0, 0);
    // VIDEODATA: first byte = (frameType<<4)|codec. keyframe(1) for first, inter(2) after.
    const frameType = i === 0 ? 1 : 2;
    parts.push((frameType << 4) | 2 /* H.263 */);
    for (let b = 1; b < payloadLen; b++) parts.push(0xaa);
    // Trailing PreviousTagSize UI32-BE (11 + payloadLen)
    parts.push(0, 0, 0, 11 + payloadLen);
  }
  return new Uint8Array(parts);
}

describe("video.ts — encoders", () => {
  it("encodeDefineVideoStream produces the exact 10-byte SWF body layout", () => {
    const body = encodeDefineVideoStream(7, 30, 320, 240, VideoCodec.Vp6, {
      deblocking: 1,
      smoothing: true,
    });
    expect(body.length).toBe(10);
    const dv = new DataView(body.buffer);
    expect(dv.getUint16(0, true)).toBe(7); // id
    expect(dv.getUint16(2, true)).toBe(30); // numFrames
    expect(dv.getUint16(4, true)).toBe(320); // width
    expect(dv.getUint16(6, true)).toBe(240); // height
    // flags = (deblocking << 1) | smoothing = (1<<1)|1 = 3
    expect(body[8]).toBe(0b011);
    expect(body[9]).toBe(VideoCodec.Vp6); // codecId = 4
  });

  it("encodeVideoFrame writes StreamID, FrameNum then payload", () => {
    const payload = new Uint8Array([0x12, 0x34, 0x56]);
    const body = encodeVideoFrame(7, 5, payload);
    expect(body.length).toBe(4 + payload.length);
    const dv = new DataView(body.buffer);
    expect(dv.getUint16(0, true)).toBe(7); // streamId
    expect(dv.getUint16(2, true)).toBe(5); // frameNum
    expect(Array.from(body.slice(4))).toEqual([0x12, 0x34, 0x56]);
  });
});

describe("video.ts — FLV demuxer", () => {
  it("returns null for non-FLV input", () => {
    expect(demuxFlv(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
    expect(demuxFlv(new Uint8Array(0))).toBeNull();
  });

  it("extracts every video frame with sequential frameNum and codec", () => {
    const flv = makeFlv(4);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.codecId).toBe(2); // H.263
    expect(result!.frames.length).toBe(4);
    result!.frames.forEach((f, i) => {
      expect(f.frameNum).toBe(i);
      expect(f.codecId).toBe(2);
      expect(f.data.length).toBe(i + 1); // payload includes the nibble byte
      expect(f.frameType).toBe(i === 0 ? 1 : 2);
    });
  });

  it("compiles a real FLV data URI into matching tag-60/tag-61 payloads", () => {
    const flv = makeFlv(3);
    // Encode FLV bytes as a base64 data URI (Node Buffer available in vitest).
    const b64 = Buffer.from(flv).toString("base64");
    const video = makeVideoItem({
      dataUri: `data:video/x-flv;base64,${b64}`,
      frameCount: 99, // should be ignored — real demux yields 3 frames
      width: 128,
      height: 96,
    });
    const doc = makeDoc([video]);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);

    const streamTags = tags.filter((t) => t.code === 60);
    expect(streamTags.length).toBe(1);
    const sBody = streamTags[0].body;
    const sdv = new DataView(sBody.buffer, sBody.byteOffset, sBody.byteLength);
    expect(sdv.getUint16(2, true)).toBe(3); // numFrames = demuxed count, not 99
    expect(sdv.getUint16(4, true)).toBe(128); // width
    expect(sdv.getUint16(6, true)).toBe(96); // height
    expect(sBody[9]).toBe(VideoCodec.H263); // codec mapped from FLV nibble 2

    const frameTags = tags.filter((t) => t.code === 61);
    expect(frameTags.length).toBe(3);
    const streamId = sdv.getUint16(0, true);
    frameTags.forEach((t, i) => {
      const fdv = new DataView(t.body.buffer, t.body.byteOffset, t.body.byteLength);
      expect(fdv.getUint16(0, true)).toBe(streamId); // streamId matches
      expect(fdv.getUint16(2, true)).toBe(i); // frameNum
      // payload length matches the FLV frame payload (i+1 bytes)
      expect(t.body.length - 4).toBe(i + 1);
    });
  });
});
