/**
 * Integration tests for SoundStreamHead (tag 18) and SoundStreamBlock (tag 19)
 * in the compiled SWF output.
 *
 * Verifies that compileDocument() emits stream tags when a frame has
 * sound.syncMode === 'stream', and does NOT emit them for event sounds.
 */

import { describe, it, expect } from "vitest";
import { compileDocument } from "../compile.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// SWF tag parser helpers (shared pattern from sound.test.ts)
// ---------------------------------------------------------------------------

interface SwfTag {
  code: number;
  body: Uint8Array;
  offset: number;
}

function parseTags(swf: Uint8Array): SwfTag[] {
  // Skip past the SWF header (signature + version + fileLen + RECT + frameRate + frameCount)
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
    if (tagCode === 0) break; // End tag
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

const TAG_SOUND_STREAM_HEAD  = 18;
const TAG_SOUND_STREAM_BLOCK = 19;
const TAG_DEFINE_SOUND       = 14;
const TAG_START_SOUND        = 15;

function makeSoundItem(id: string, compressionType: "mp3" | "raw" | "adpcm" = "mp3"): SoundItem {
  return {
    id,
    name: `${id}.${compressionType}`,
    itemType: "sound",
    dataUri: `data:audio/${compressionType};base64,`,
    compressionType,
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1,
  };
}

function makeSoundLinkage(
  libraryItemId: string,
  syncMode: SoundLinkage["syncMode"] = "event",
  repeatCount = 1
): SoundLinkage {
  return { libraryItemId, syncMode, repeatCount };
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
    id: "doc-stream",
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

// ---------------------------------------------------------------------------
// Tests: SoundStreamHead (tag 18) in compiled SWF
// ---------------------------------------------------------------------------

describe("compileDocument — stream sound (syncMode=stream)", () => {
  it("emits SoundStreamHead (tag 18) when a frame has syncMode=stream", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const streamHeadTags = tags.filter((t) => t.code === TAG_SOUND_STREAM_HEAD);
    expect(streamHeadTags.length).toBeGreaterThanOrEqual(1);
  });

  it("emits SoundStreamBlock (tag 19) when a frame has syncMode=stream", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const streamBlockTags = tags.filter((t) => t.code === TAG_SOUND_STREAM_BLOCK);
    expect(streamBlockTags.length).toBeGreaterThanOrEqual(1);
  });

  it("SoundStreamHead (tag 18) appears before SoundStreamBlock (tag 19)", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const headIdx = tags.findIndex((t) => t.code === TAG_SOUND_STREAM_HEAD);
    const blockIdx = tags.findIndex((t) => t.code === TAG_SOUND_STREAM_BLOCK);
    expect(headIdx).toBeGreaterThanOrEqual(0);
    expect(blockIdx).toBeGreaterThan(headIdx);
  });

  it("SoundStreamHead body has MP3 format bits (2) encoded in the high nibble of byte 1", () => {
    const snd = makeSoundItem("snd-1", "mp3");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const headTag = tags.find((t) => t.code === TAG_SOUND_STREAM_HEAD)!;
    expect(headTag).toBeDefined();
    const streamFormatBits = (headTag.body[1] >> 4) & 0xf;
    expect(streamFormatBits).toBe(2); // 2 = MP3
  });
});

// ---------------------------------------------------------------------------
// Tests: SoundStreamBlock (tag 19) body structure
// ---------------------------------------------------------------------------

describe("compileDocument — SoundStreamBlock body structure", () => {
  it("SoundStreamBlock body starts with SeekSamples (UI16, can be 0)", () => {
    const snd = makeSoundItem("snd-1", "mp3");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const blockTag = tags.find((t) => t.code === TAG_SOUND_STREAM_BLOCK)!;
    expect(blockTag).toBeDefined();
    // Body must be at least 2 bytes for SeekSamples UI16
    expect(blockTag.body.length).toBeGreaterThanOrEqual(2);
    // SeekSamples is a UI16 — verify it reads without error (value 0 is valid)
    const seekSamples = blockTag.body[0] | (blockTag.body[1] << 8);
    expect(seekSamples).toBeGreaterThanOrEqual(0);
  });

  it("SoundStreamBlock body length > 2 bytes (has audio data after SeekSamples)", () => {
    // Provide a minimal non-empty base64-encoded audio payload so the block
    // body contains SeekSamples (2 bytes) plus at least one byte of audio data.
    const audioPayload = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // 4-byte minimal MP3-like header
    const b64 = btoa(String.fromCharCode(...audioPayload));
    const snd: SoundItem = {
      id: "snd-audio",
      name: "snd-audio.mp3",
      itemType: "sound",
      dataUri: `data:audio/mp3;base64,${b64}`,
      compressionType: "mp3",
      sampleRate: 44100,
      sampleSize: 16,
      isStereo: false,
      durationSeconds: 1,
    };
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-audio", "stream") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const blockTag = tags.find((t) => t.code === TAG_SOUND_STREAM_BLOCK)!;
    expect(blockTag).toBeDefined();
    // Must have more than just the 2-byte SeekSamples header
    expect(blockTag.body.length).toBeGreaterThan(2);
  });

  it("SoundStreamBlock is only emitted when syncMode is 'stream', not 'event'", () => {
    const snd = makeSoundItem("snd-1", "mp3");
    const docStream = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "stream") }]
    );
    const docEvent = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event") }]
    );
    const streamTags = parseTags(compileDocument(docStream));
    const eventTags  = parseTags(compileDocument(docEvent));
    const streamBlocks = streamTags.filter((t) => t.code === TAG_SOUND_STREAM_BLOCK);
    const eventBlocks  = eventTags.filter((t) => t.code === TAG_SOUND_STREAM_BLOCK);
    expect(streamBlocks.length).toBeGreaterThanOrEqual(1);
    expect(eventBlocks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Event sound (syncMode=event) does NOT emit stream tags
// ---------------------------------------------------------------------------

describe("compileDocument — event sound (syncMode=event)", () => {
  it("does NOT emit SoundStreamHead (tag 18) for event sounds", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const streamHeadTags = tags.filter((t) => t.code === TAG_SOUND_STREAM_HEAD);
    expect(streamHeadTags.length).toBe(0);
  });

  it("does NOT emit SoundStreamBlock (tag 19) for event sounds", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const streamBlockTags = tags.filter((t) => t.code === TAG_SOUND_STREAM_BLOCK);
    expect(streamBlockTags.length).toBe(0);
  });

  it("event sound emits DefineSound (tag 14) and StartSound (tag 15) instead", () => {
    const snd = makeSoundItem("snd-1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd-1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const defineSoundTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    const startSoundTags  = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(defineSoundTags.length).toBe(1);
    expect(startSoundTags.length).toBe(1);
  });
});
