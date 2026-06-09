/**
 * Tests for StartSound (tag 15) and SoundInfo encoding.
 *
 * Covers:
 *   - encodeStartSound / encodeSoundInfo unit tests
 *   - compileDocument integration: tag 15 emitted for event-sync frame sounds
 *   - SoundId matches the DefineSound character ID
 *   - SoundInfo flag bits (HasLoops, stop, noMultiple)
 *   - LoopCount written correctly
 *   - syncMode='stop' produces stop flag
 *   - Frame with no sound produces no StartSound
 *   - DefineSound (tag 14) appears for the library item
 */

import { describe, it, expect } from "vitest";
import { encodeSoundInfo, encodeStartSound } from "../sounds.js";
import { compileDocument } from "../compile.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Tag constants
// ---------------------------------------------------------------------------

const TAG_DEFINE_SOUND = 14;
const TAG_START_SOUND = 15;

// ---------------------------------------------------------------------------
// SWF tag parser helpers
// ---------------------------------------------------------------------------

function getTagStreamStart(bytes: Uint8Array): number {
  const nBits = (bytes[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  return 8 + rectBytes + 4;
}

interface TagRecord {
  code: number;
  body: Uint8Array;
}

function findAllTagsOfType(
  bytes: Uint8Array,
  tagId: number
): Array<{ bodyStart: number; len: number }> {
  const result: Array<{ bodyStart: number; len: number }> = [];
  let i = getTagStreamStart(bytes);
  while (i < bytes.length - 2) {
    const hdr = bytes[i] | (bytes[i + 1] << 8);
    const type = (hdr >> 6) & 0x3ff;
    const slen = hdr & 0x3f;
    let len: number, hlen: number;
    if (slen === 63) {
      len =
        bytes[i + 2] |
        (bytes[i + 3] << 8) |
        (bytes[i + 4] << 16) |
        (bytes[i + 5] << 24);
      hlen = 6;
    } else {
      len = slen;
      hlen = 2;
    }
    if (type === tagId) result.push({ bodyStart: i + hlen, len });
    if (type === 0) break;
    i += hlen + len;
  }
  return result;
}

function parseTags(swf: Uint8Array): TagRecord[] {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;
  const tags: TagRecord[] = [];
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
    tags.push({ code: tagCode, body: swf.slice(bodyStart, bodyStart + bodyLength) });
    pos = bodyStart + bodyLength;
    if (tagCode === 0) break;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Document factory helpers
// ---------------------------------------------------------------------------

function makeSoundItem(id: string): SoundItem {
  return {
    id,
    name: `${id}.mp3`,
    itemType: "sound",
    dataUri: "data:audio/mp3;base64,",
    compressionType: "mp3",
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
    id: "doc-1",
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
    library: { items: soundItems, folders: [] },
  };
}

// ---------------------------------------------------------------------------
// Unit tests: encodeSoundInfo
// ---------------------------------------------------------------------------

describe("encodeSoundInfo — SoundInfo struct", () => {
  it("empty options produce a single flags byte of 0", () => {
    const info = encodeSoundInfo();
    expect(info.length).toBe(1);
    expect(info[0]).toBe(0);
  });

  it("loops option sets HasLoops bit (bit 2) and appends UI16LE LoopCount", () => {
    const info = encodeSoundInfo({ loops: 3 });
    expect((info[0] >> 2) & 1).toBe(1); // HasLoops
    expect(info.length).toBe(3); // 1 flags + 2 LoopCount
    const loopCount = info[1] | (info[2] << 8);
    expect(loopCount).toBe(3);
  });

  it("loops=0 sets HasLoops bit and LoopCount=0 (loop forever)", () => {
    const info = encodeSoundInfo({ loops: 0 });
    expect((info[0] >> 2) & 1).toBe(1);
    const loopCount = info[1] | (info[2] << 8);
    expect(loopCount).toBe(0);
  });

  it("stop option sets stop bit (bit 5)", () => {
    const info = encodeSoundInfo({ stop: true });
    expect((info[0] >> 5) & 1).toBe(1);
  });

  it("noMultiple option sets noMultiple bit (bit 4)", () => {
    const info = encodeSoundInfo({ noMultiple: true });
    expect((info[0] >> 4) & 1).toBe(1);
  });

  it("inPoint sets hasInPoint bit (bit 0) and appends UI32LE sample index", () => {
    const info = encodeSoundInfo({ inPoint: 1000 });
    expect(info[0] & 1).toBe(1); // hasInPoint
    expect(info.length).toBe(5); // 1 flags + 4 inPoint
    const ip = info[1] | (info[2] << 8) | (info[3] << 16) | (info[4] << 24);
    expect(ip).toBe(1000);
  });

  it("outPoint sets hasOutPoint bit (bit 1) and appends UI32LE sample index", () => {
    const info = encodeSoundInfo({ outPoint: 2000 });
    expect((info[0] >> 1) & 1).toBe(1); // hasOutPoint
    expect(info.length).toBe(5); // 1 flags + 4 outPoint
    const op = info[1] | (info[2] << 8) | (info[3] << 16) | (info[4] << 24);
    expect(op).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: encodeStartSound
// ---------------------------------------------------------------------------

describe("encodeStartSound — tag 15 body", () => {
  it("body starts with SoundId UI16LE", () => {
    const body = encodeStartSound(42);
    const id = body[0] | (body[1] << 8);
    expect(id).toBe(42);
  });

  it("body has SoundInfo flags byte after SoundId", () => {
    const body = encodeStartSound(1, {});
    expect(body.length).toBeGreaterThanOrEqual(3); // 2 soundId + 1 flags
    expect(body[2]).toBe(0); // no flags set
  });

  it("HasLoops in SoundInfo propagates into body", () => {
    const body = encodeStartSound(5, { loops: 2 });
    const flags = body[2];
    expect((flags >> 2) & 1).toBe(1); // HasLoops bit
    const loopCount = body[3] | (body[4] << 8);
    expect(loopCount).toBe(2);
  });

  it("stop flag propagates into SoundInfo flags byte", () => {
    const body = encodeStartSound(7, { stop: true });
    expect((body[2] >> 5) & 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: compileDocument → StartSound (tag 15)
// ---------------------------------------------------------------------------

describe("compileDocument — StartSound (tag 15) integration", () => {
  it("doc with event sound on frame compiles without error", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd1", "event") }]
    );
    expect(() => compileDocument(doc)).not.toThrow();
  });

  it("StartSound (tag 15) appears in output for event-sync sound", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTags = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(startTags.length).toBeGreaterThanOrEqual(1);
  });

  it("StartSound body starts with SoundId UI16 that matches DefineSound char id", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const defineTag = tags.find((t) => t.code === TAG_DEFINE_SOUND)!;
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const definedId = defineTag.body[0] | (defineTag.body[1] << 8);
    const startId = startTag.body[0] | (startTag.body[1] << 8);
    expect(startId).toBe(definedId);
  });

  it("StartSound body has SoundInfo byte (flags) after SoundId", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    // body[0..1] = SoundId, body[2] = SoundInfo flags byte
    expect(startTag.body.length).toBeGreaterThanOrEqual(3);
  });

  it("syncMode='stop' produces StartSound with stop flag (bit 5 of SoundInfo)", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd1", "stop") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    expect(startTag).toBeDefined();
    const infoFlags = startTag.body[2];
    expect((infoFlags >> 5) & 1).toBe(1); // SyncStop
  });

  it("frame with no sound produces no StartSound tag", () => {
    const doc = makeDoc([makeSoundItem("snd1")], []);
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTags = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(startTags.length).toBe(0);
  });

  it("DefineSound (tag 14) appears for the sound library item", () => {
    const snd = makeSoundItem("snd1");
    const doc = makeDoc(
      [snd],
      [{ frameIdx: 0, sound: makeSoundLinkage("snd1", "event") }]
    );
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const defineTags = tags.filter((t) => t.code === TAG_DEFINE_SOUND);
    expect(defineTags.length).toBe(1);
  });
});
