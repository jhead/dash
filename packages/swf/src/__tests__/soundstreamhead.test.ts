/**
 * Tests for SoundStreamHead (tag 18) MP3 parameter encoding.
 *
 * Verifies body length, sample-rate encoding, stereo flag, and that
 * SoundStreamHead2 (tag 45) is never emitted — only tag 18 is used.
 */

import { describe, it, expect } from "vitest";
import { encodeSoundStreamHead } from "../audio.js";
import { compileDocument } from "../compile.js";
import { Tag } from "../tags.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
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
      offset: pos,
    });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

function makeSoundItem(
  id: string,
  compressionType: "mp3" | "raw" | "adpcm" = "mp3",
  isStereo = false
): SoundItem {
  return {
    id,
    name: `${id}.${compressionType}`,
    itemType: "sound",
    dataUri: `data:audio/${compressionType};base64,`,
    compressionType,
    sampleRate: 44100,
    sampleSize: 16,
    isStereo,
    durationSeconds: 1,
  };
}

function makeSoundLinkage(
  libraryItemId: string,
  syncMode: SoundLinkage["syncMode"] = "stream"
): SoundLinkage {
  return { libraryItemId, syncMode, repeatCount: 1 };
}

function makeDoc(
  soundItems: SoundItem[],
  frameSounds: Array<{ frameIdx: number; sound: SoundLinkage }> = []
): FlashDocument {
  const maxFrame = frameSounds.reduce((m, fs) => Math.max(m, fs.frameIdx), 0);
  const frameMap = new Map<number, SoundLinkage>();
  for (const { frameIdx, sound } of frameSounds) {
    frameMap.set(frameIdx, sound);
  }

  const frames = [];
  for (let i = 0; i <= maxFrame; i++) {
    frames.push({
      index: i,
      isKeyframe: true,
      isEmpty: true,
      tweenType: "none" as const,
      label: "",
      labelType: "name" as const,
      script: "",
      sound: frameMap.get(i) ?? null,
      motionEase: 0,
      motionRotate: "none" as const,
      motionRotateCount: 0,
      motionOrientToPath: false,
      motionSync: false,
      motionScale: false,
      shapeEase: 0,
      shapeBlend: "distributive" as const,
      displayObjects: [],
    });
  }

  if (frames.length === 0) {
    frames.push({
      index: 0,
      isKeyframe: true,
      isEmpty: true,
      tweenType: "none" as const,
      label: "",
      labelType: "name" as const,
      script: "",
      sound: null,
      motionEase: 0,
      motionRotate: "none" as const,
      motionRotateCount: 0,
      motionOrientToPath: false,
      motionSync: false,
      motionScale: false,
      shapeEase: 0,
      shapeBlend: "distributive" as const,
      displayObjects: [],
    });
  }

  return {
    id: "doc-ssh",
    properties: {
      width: 550,
      height: 400,
      frameRate: 12,
      backgroundColor: "#ffffff",
      rulerUnits: "px",
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
    },
    scenes: [
      {
        id: "scene-1",
        name: "Scene 1",
        timeline: {
          layers: [
            {
              id: "layer-1",
              name: "Layer 1",
              type: "normal",
              visible: true,
              locked: false,
              outlineMode: false,
              outlineColor: "#ff0000",
              height: 20,
              parentFolderId: null,
              frames,
              frameCount: frames.length,
            },
          ],
        },
      },
    ],
    library: {
      items: soundItems,
      folders: [],
    },
  };
}

const TAG_SOUND_STREAM_HEAD  = 18;
const TAG_SOUND_STREAM_HEAD2 = 45;

// ---------------------------------------------------------------------------
// 1. SoundStreamHead body length >= 4 bytes
// ---------------------------------------------------------------------------

describe("SoundStreamHead body length", () => {
  it("encodeSoundStreamHead for non-MP3 produces at least 4 bytes", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 1, // ADPCM — no LatencySeek
      streamRate: 3,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 1152,
    });
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it("encodeSoundStreamHead for MP3 produces at least 4 bytes (6 with LatencySeek)", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 2, // MP3
      streamRate: 3,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 1152,
    });
    expect(result.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// 2. Stream rate bits in byte 1 encode sample rate correctly
// ---------------------------------------------------------------------------

describe("SoundStreamHead stream rate encoding in byte 1", () => {
  const rates: Array<[number, number]> = [
    [5512,  0],
    [11025, 1],
    [22050, 2],
    [44100, 3],
  ];

  for (const [hz, expected] of rates) {
    it(`streamRate=${expected} (${hz}Hz) is encoded in bits[3:2] of byte 1`, () => {
      const result = encodeSoundStreamHead({
        playbackRate: expected,
        playbackSize: 1,
        playbackStereo: 0,
        streamFormat: 1, // ADPCM
        streamRate: expected,
        streamSize: 1,
        streamStereo: 0,
        streamSampleCount: 512,
      });
      const rate = (result[1] >> 2) & 0x3;
      expect(rate).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. SoundStreamHead2 (tag 45) is NOT emitted — use tag 18 only
// ---------------------------------------------------------------------------

describe("SoundStreamHead2 (tag 45) is never emitted", () => {
  it("Tag.SoundStreamHead is 18 (not 45)", () => {
    expect(Tag.SoundStreamHead).toBe(18);
  });

  it("compileDocument does not emit tag 45 for a stream sound", () => {
    const snd = makeSoundItem("snd-1", "mp3");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const head2Tags = tags.filter((t) => t.code === TAG_SOUND_STREAM_HEAD2);
    expect(head2Tags.length).toBe(0);
  });

  it("compileDocument emits tag 18 (not tag 45) for a stream sound", () => {
    const snd = makeSoundItem("snd-1", "mp3");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const headTags = tags.filter((t) => t.code === TAG_SOUND_STREAM_HEAD);
    expect(headTags.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Stereo flag set when isStereo=true
// ---------------------------------------------------------------------------

describe("SoundStreamHead stereo flag", () => {
  it("encodeSoundStreamHead with streamStereo=1 sets bit 0 of byte 1", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 1,
      streamFormat: 2, // MP3
      streamRate: 3,
      streamSize: 1,
      streamStereo: 1,
      streamSampleCount: 1152,
    });
    const stereo = result[1] & 0x1;
    expect(stereo).toBe(1);
  });

  it("encodeSoundStreamHead with streamStereo=0 does NOT set bit 0 of byte 1", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 2, // MP3
      streamRate: 3,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 1152,
    });
    const stereo = result[1] & 0x1;
    expect(stereo).toBe(0);
  });

  it("compileDocument with isStereo=true sets stereo bit in SoundStreamHead tag 18", () => {
    const snd = makeSoundItem("snd-stereo", "mp3", true);
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-stereo", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const headTag = tags.find((t) => t.code === TAG_SOUND_STREAM_HEAD)!;
    expect(headTag).toBeDefined();
    const stereo = headTag.body[1] & 0x1;
    expect(stereo).toBe(1);
  });

  it("compileDocument with isStereo=false does NOT set stereo bit in SoundStreamHead", () => {
    const snd = makeSoundItem("snd-mono", "mp3", false);
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-mono", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const headTag = tags.find((t) => t.code === TAG_SOUND_STREAM_HEAD)!;
    expect(headTag).toBeDefined();
    const stereo = headTag.body[1] & 0x1;
    expect(stereo).toBe(0);
  });
});
