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
// Model-driven VideoDisplayObject placement (task 0768)
// ---------------------------------------------------------------------------

describe("VideoDisplayObject placement", () => {
  /** Build a document with one VideoItem and a VideoDisplayObject placed on the timeline. */
  function makeDocWithPlacedVideo(
    videoOverrides: Partial<VideoItem> = {},
    vdoOverrides: Record<string, unknown> = {}
  ): FlashDocument {
    const video = makeVideoItem({ dataUri: "data:video/x-flv;base64,AAAA", ...videoOverrides });
    const vdo = {
      type: "video" as const,
      id: "vdo-1",
      videoItemId: video.id,
      x: 100,
      y: 80,
      width: video.width ?? 320,
      height: video.height ?? 240,
      ...vdoOverrides,
    };
    const layer = makeLayer("s1-layer", 1);
    const frames = layer.frames.map((f) =>
      f.index === 0 ? { ...f, isEmpty: false, displayObjects: [vdo] } : f
    );
    const scene: Scene = {
      id: "s1",
      name: "Scene 1",
      timeline: { layers: [{ ...layer, frames }] },
    };
    return {
      id: "doc-1",
      properties: BASE_PROPS,
      scenes: [scene],
      library: { items: [video], folders: [] },
    };
  }

  it("still emits exactly one DefineVideoStream when placed via a VideoDisplayObject", () => {
    const doc = makeDocWithPlacedVideo();
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(tags.filter((t) => t.code === 60).length).toBe(1);
  });

  it("places the video stream at the VideoDisplayObject's model position, not depth 50000", () => {
    const doc = makeDocWithPlacedVideo();
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    // The DefineVideoStream char id.
    const streamTag = tags.find((t) => t.code === 60)!;
    const streamCharId = streamTag.body[0] | (streamTag.body[1] << 8);
    // Find a PlaceObject2 (tag 26) that references the stream char id at a
    // model-driven (low) depth — not the legacy fixed base 50000.
    const placeTags = tags.filter((t) => t.code === Tag.PlaceObject2);
    const placedAtModelDepth = placeTags.some((t) => {
      const flags = t.body[0];
      const depth = t.body[1] | (t.body[2] << 8);
      const hasCharacter = (flags & 0x02) !== 0;
      if (!hasCharacter) return false;
      const charId = t.body[3] | (t.body[4] << 8);
      return charId === streamCharId && depth < 50000;
    });
    expect(placedAtModelDepth).toBe(true);
    // And NO placement at the legacy fixed depth base.
    const placedAtLegacyDepth = placeTags.some((t) => {
      const depth = t.body[1] | (t.body[2] << 8);
      return depth >= 50000;
    });
    expect(placedAtLegacyDepth).toBe(false);
  });

  it("still advances VideoFrame (tag 61) tags for a model-placed stream", () => {
    const doc = makeDocWithPlacedVideo({ frameCount: 5 });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    expect(tags.filter((t) => t.code === 61).length).toBe(5);
  });

  it("compiles a mix of placed and unplaced library videos", () => {
    const placedVideo = makeVideoItem({ id: "vid-placed", dataUri: "data:video/x-flv;base64,AAAA" });
    const looseVideo = makeVideoItem({ id: "vid-loose", name: "loose.flv", dataUri: "data:video/x-flv;base64,AAAA" });
    const vdo = {
      type: "video" as const,
      id: "vdo-1",
      videoItemId: placedVideo.id,
      x: 10,
      y: 20,
      width: 320,
      height: 240,
    };
    const layer = makeLayer("s1-layer", 1);
    const frames = layer.frames.map((f) =>
      f.index === 0 ? { ...f, isEmpty: false, displayObjects: [vdo] } : f
    );
    const doc: FlashDocument = {
      id: "doc-1",
      properties: BASE_PROPS,
      scenes: [{ id: "s1", name: "Scene 1", timeline: { layers: [{ ...layer, frames }] } }],
      library: { items: [placedVideo, looseVideo], folders: [] },
    };
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    // Two DefineVideoStream tags (one per VideoItem).
    expect(tags.filter((t) => t.code === 60).length).toBe(2);
    expect(tags[tags.length - 1].code).toBe(Tag.End);
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

// ---------------------------------------------------------------------------
// Helpers for dimension-extraction tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal Sorenson H.263 VIDEODATA payload (including the leading
 * FrameType/CodecId byte) with the given psize field.
 *
 * Bit layout of the H.263 bitstream (starting at byte 1 of the returned array):
 *   [17 bits] PSC = 0x000001 (16 zeros + a 1)
 *   [5  bits] version = 0
 *   [8  bits] temporal ref = 0
 *   [3  bits] psize
 *   [n  bits] optional custom width/height (for psize 0 or 1)
 */
function makeH263VideoData(
  psize: number,
  customW?: number,
  customH?: number,
): Uint8Array {
  // We pack bits MSB-first into a byte array.
  const bits: number[] = [];

  function pushBits(value: number, n: number) {
    for (let i = n - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  }

  // PSC: 17 bits == 1 (16 zeros + 1)
  pushBits(1, 17);
  // version (5 bits) = 0
  pushBits(0, 5);
  // temporal reference (8 bits) = 0
  pushBits(0, 8);
  // psize (3 bits)
  pushBits(psize, 3);
  // Optional custom dimensions
  if (psize === 0 && customW !== undefined && customH !== undefined) {
    pushBits(customW, 8);
    pushBits(customH, 8);
  } else if (psize === 1 && customW !== undefined && customH !== undefined) {
    pushBits(customW, 16);
    pushBits(customH, 16);
  }

  // Pack bits into bytes (MSB first, pad last byte with zeros).
  const byteCount = Math.ceil(bits.length / 8);
  const payload = new Uint8Array(byteCount);
  for (let i = 0; i < bits.length; i++) {
    payload[Math.floor(i / 8)] |= (bits[i]! << (7 - (i % 8)));
  }

  // Prepend the FLV FrameType/CodecId byte (keyframe=1, codecId=2 → 0x12).
  const videoData = new Uint8Array(1 + byteCount);
  videoData[0] = 0x12; // (1 << 4) | 2
  videoData.set(payload, 1);
  return videoData;
}

/**
 * Build a minimal FLV buffer that has only a Script tag with onMetaData
 * containing the given width/height, followed by one video tag.
 */
function makeFlvWithMetadata(w: number, h: number): Uint8Array {
  // Build AMF0 onMetaData payload
  const buildAmf0 = (): Uint8Array => {
    const parts: number[] = [];
    // AMF0 String "onMetaData"
    const meta = "onMetaData";
    parts.push(0x02, 0x00, meta.length);
    for (const c of meta) parts.push(c.charCodeAt(0));
    // AMF0 ECMA Array (type 0x08) with 2 entries
    parts.push(0x08, 0x00, 0x00, 0x00, 0x02);
    // Key "width"
    const writeNum = (key: string, val: number) => {
      parts.push(0x00, key.length);
      for (const c of key) parts.push(c.charCodeAt(0));
      parts.push(0x00); // Number type
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, val, false);
      parts.push(...new Uint8Array(buf));
    };
    writeNum("width", w);
    writeNum("height", h);
    // End marker
    parts.push(0x00, 0x00, 0x09);
    return new Uint8Array(parts);
  };

  const amf0 = buildAmf0();

  // Build FLV file
  const parts: number[] = [];
  // FLV header
  parts.push(0x46, 0x4c, 0x56, 0x01, 0x05 /* audio+video */, 0x00, 0x00, 0x00, 0x09);
  // First PreviousTagSize (0)
  parts.push(0x00, 0x00, 0x00, 0x00);

  // Script tag (type 18)
  parts.push(18);
  parts.push((amf0.length >> 16) & 0xff, (amf0.length >> 8) & 0xff, amf0.length & 0xff);
  parts.push(0x00, 0x00, 0x00, 0x00); // timestamp + ext
  parts.push(0x00, 0x00, 0x00); // stream id
  parts.push(...amf0);
  const scriptTagSize = 11 + amf0.length;
  parts.push(0, 0, 0, scriptTagSize);

  // One video tag (H.263 keyframe, 1-byte payload)
  parts.push(9, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  parts.push(0x12); // FrameType=1 | CodecId=2
  parts.push(0, 0, 0, 12); // PreviousTagSize

  return new Uint8Array(parts);
}

/**
 * Wrap a H.263 VIDEODATA into a minimal FLV (no metadata tag).
 */
function makeFlvWithH263Frame(videoData: Uint8Array): Uint8Array {
  const parts: number[] = [];
  // FLV header
  parts.push(0x46, 0x4c, 0x56, 0x01, 0x01, 0x00, 0x00, 0x00, 0x09);
  // First PreviousTagSize
  parts.push(0x00, 0x00, 0x00, 0x00);
  // Video tag
  parts.push(9);
  parts.push((videoData.length >> 16) & 0xff, (videoData.length >> 8) & 0xff, videoData.length & 0xff);
  parts.push(0x00, 0x00, 0x00, 0x00); // timestamp
  parts.push(0x00, 0x00, 0x00); // stream id
  parts.push(...videoData);
  parts.push(0, 0, 0, 11 + videoData.length);
  return new Uint8Array(parts);
}

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

  it("falls back to 320×240 when FLV has no metadata and non-parseable H.263", () => {
    const flv = makeFlv(1); // synthetic H.263 with 0xAA padding — not a real bitstream
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(320);
    expect(result!.height).toBe(240);
  });

  it("extracts CIF (352×288) from Sorenson H.263 psize=2 bitstream", () => {
    const videoData = makeH263VideoData(2); // psize=2 = CIF
    const flv = makeFlvWithH263Frame(videoData);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(352);
    expect(result!.height).toBe(288);
  });

  it("extracts QCIF (176×144) from Sorenson H.263 psize=3 bitstream", () => {
    const videoData = makeH263VideoData(3); // psize=3 = QCIF
    const flv = makeFlvWithH263Frame(videoData);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(176);
    expect(result!.height).toBe(144);
  });

  it("extracts Sub-QCIF (128×96) from Sorenson H.263 psize=4 bitstream", () => {
    const videoData = makeH263VideoData(4); // psize=4 = SubQCIF
    const flv = makeFlvWithH263Frame(videoData);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(128);
    expect(result!.height).toBe(96);
  });

  it("extracts 320×240 from Sorenson H.263 psize=5 bitstream", () => {
    const videoData = makeH263VideoData(5); // psize=5 = 320×240
    const flv = makeFlvWithH263Frame(videoData);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(320);
    expect(result!.height).toBe(240);
  });

  it("extracts custom 8-bit dims from Sorenson H.263 psize=0", () => {
    const videoData = makeH263VideoData(0, 160, 120); // psize=0 custom 8-bit
    const flv = makeFlvWithH263Frame(videoData);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(160);
    expect(result!.height).toBe(120);
  });

  it("extracts custom 16-bit dims from Sorenson H.263 psize=1", () => {
    const videoData = makeH263VideoData(1, 640, 480); // psize=1 custom 16-bit
    const flv = makeFlvWithH263Frame(videoData);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(640);
    expect(result!.height).toBe(480);
  });

  it("extracts dimensions from FLV onMetaData Script tag (overrides bitstream)", () => {
    const flv = makeFlvWithMetadata(640, 360);
    const result = demuxFlv(flv);
    expect(result).not.toBeNull();
    expect(result!.width).toBe(640);
    expect(result!.height).toBe(360);
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
