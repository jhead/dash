/**
 * Unit tests for SoundInfo struct encoding (sounds.ts) and
 * StartSound (tag 15) body builder.
 *
 * SoundInfo struct format:
 *   byte 0: SoundFlags
 *     bit 0: hasInPoint
 *     bit 1: hasOutPoint
 *     bit 2: hasLoops
 *     bit 3: hasEnvelope
 *     bit 4: noMultiple
 *     bit 5: stop
 *   [uint32] InPoint   (if hasInPoint)
 *   [uint32] OutPoint  (if hasOutPoint)
 *   [uint16] LoopCount (if hasLoops) — 0 = infinite
 *
 * StartSound (tag 15) body:
 *   [uint16] SoundId
 *   SoundInfo bytes
 */

import { describe, it, expect } from "vitest";
import { encodeSoundInfo, encodeStartSound } from "../sounds.js";

// ---------------------------------------------------------------------------
// encodeSoundInfo
// ---------------------------------------------------------------------------

describe("encodeSoundInfo", () => {
  it("empty options returns a single byte with flags = 0", () => {
    const result = encodeSoundInfo({});
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0);
  });

  it("no arguments returns a single byte with flags = 0", () => {
    const result = encodeSoundInfo();
    expect(result.length).toBe(1);
    expect(result[0]).toBe(0);
  });

  it("loops=3 sets hasLoops bit (bit 2) in flags and appends uint16 LoopCount = 3", () => {
    const result = encodeSoundInfo({ loops: 3 });
    expect(result.length).toBe(3); // 1 flags + 2 loop count
    const flags = result[0];
    expect((flags >> 2) & 1).toBe(1); // hasLoops
    const loopCount = result[1] | (result[2] << 8);
    expect(loopCount).toBe(3);
  });

  it("loops=0 sets hasLoops bit (bit 2) and LoopCount=0xFFFF (Ruffle infinite)", () => {
    const result = encodeSoundInfo({ loops: 0 });
    expect(result.length).toBe(3);
    const flags = result[0];
    expect((flags >> 2) & 1).toBe(1); // hasLoops
    const loopCount = result[1] | (result[2] << 8);
    expect(loopCount).toBe(0xFFFF);
  });

  it("inPoint=44100 sets hasInPoint bit (bit 0) and appends uint32 value", () => {
    const result = encodeSoundInfo({ inPoint: 44100 });
    expect(result.length).toBe(5); // 1 flags + 4 inPoint
    const flags = result[0];
    expect(flags & 1).toBe(1); // hasInPoint
    const inPoint =
      result[1] |
      (result[2] << 8) |
      (result[3] << 16) |
      (result[4] << 24);
    expect(inPoint).toBe(44100);
  });

  it("outPoint=88200 sets hasOutPoint bit (bit 1) and appends uint32 value", () => {
    const result = encodeSoundInfo({ outPoint: 88200 });
    expect(result.length).toBe(5); // 1 flags + 4 outPoint
    const flags = result[0];
    expect((flags >> 1) & 1).toBe(1); // hasOutPoint
    const outPoint =
      result[1] |
      (result[2] << 8) |
      (result[3] << 16) |
      (result[4] << 24);
    expect(outPoint).toBe(88200);
  });

  it("stop=true sets stop bit (bit 5) in flags, no extra bytes", () => {
    const result = encodeSoundInfo({ stop: true });
    expect(result.length).toBe(1);
    const flags = result[0];
    expect((flags >> 5) & 1).toBe(1); // stop
  });

  it("noMultiple=true sets noMultiple bit (bit 4) in flags, no extra bytes", () => {
    const result = encodeSoundInfo({ noMultiple: true });
    expect(result.length).toBe(1);
    const flags = result[0];
    expect((flags >> 4) & 1).toBe(1); // noMultiple
  });

  it("stop=false does not set stop bit", () => {
    const result = encodeSoundInfo({ stop: false });
    const flags = result[0];
    expect((flags >> 5) & 1).toBe(0);
  });

  it("inPoint and outPoint together write both uint32 values in order", () => {
    const result = encodeSoundInfo({ inPoint: 100, outPoint: 200 });
    // flags (1) + inPoint (4) + outPoint (4) = 9 bytes
    expect(result.length).toBe(9);
    const flags = result[0];
    expect(flags & 1).toBe(1);       // hasInPoint
    expect((flags >> 1) & 1).toBe(1); // hasOutPoint
    const inPoint =
      result[1] | (result[2] << 8) | (result[3] << 16) | (result[4] << 24);
    const outPoint =
      result[5] | (result[6] << 8) | (result[7] << 16) | (result[8] << 24);
    expect(inPoint).toBe(100);
    expect(outPoint).toBe(200);
  });

  it("all options combined: flags has all applicable bits set", () => {
    const result = encodeSoundInfo({
      inPoint: 10,
      outPoint: 20,
      loops: 2,
      stop: true,
      noMultiple: true,
    });
    const flags = result[0];
    expect(flags & 1).toBe(1);        // hasInPoint
    expect((flags >> 1) & 1).toBe(1); // hasOutPoint
    expect((flags >> 2) & 1).toBe(1); // hasLoops
    expect((flags >> 4) & 1).toBe(1); // noMultiple
    expect((flags >> 5) & 1).toBe(1); // stop
  });
});

// ---------------------------------------------------------------------------
// encodeStartSound
// ---------------------------------------------------------------------------

describe("encodeStartSound", () => {
  it("soundId=5 with no opts: 2-byte soundId + 1-byte SoundInfo (flags=0)", () => {
    const result = encodeStartSound(5);
    // 2 (soundId) + 1 (flags byte) = 3 bytes
    expect(result.length).toBe(3);
    const soundId = result[0] | (result[1] << 8);
    expect(soundId).toBe(5);
    expect(result[2]).toBe(0); // flags = 0
  });

  it("soundId is encoded as UI16LE in bytes [0..1]", () => {
    const result = encodeStartSound(0x0102);
    expect(result[0]).toBe(0x02);
    expect(result[1]).toBe(0x01);
  });

  it("loops option is encoded in SoundInfo bytes", () => {
    const result = encodeStartSound(5, { loops: 3 });
    // 2 (soundId) + 3 (SoundInfo: flags + uint16) = 5 bytes
    expect(result.length).toBe(5);
    const flags = result[2];
    expect((flags >> 2) & 1).toBe(1); // hasLoops
    const loopCount = result[3] | (result[4] << 8);
    expect(loopCount).toBe(3);
  });

  it("stop=true in opts sets stop bit in SoundInfo flags", () => {
    const result = encodeStartSound(1, { stop: true });
    const flags = result[2];
    expect((flags >> 5) & 1).toBe(1);
  });

  it("noMultiple=true in opts sets noMultiple bit in SoundInfo flags", () => {
    const result = encodeStartSound(1, { noMultiple: true });
    const flags = result[2];
    expect((flags >> 4) & 1).toBe(1);
  });

  it("empty opts produces same result as no opts", () => {
    const a = encodeStartSound(7);
    const b = encodeStartSound(7, {});
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

// ---------------------------------------------------------------------------
// Integration: compileDocument emits StartSound (tag 15) for event sound
// ---------------------------------------------------------------------------

import { compileDocument } from "../compile.js";
import type { FlashDocument, SoundItem, SoundLinkage } from "@flash/core";

const TAG_START_SOUND = 15;
const TAG_DEFINE_SOUND = 14;

function parseTags(swf: Uint8Array): Array<{ code: number; body: Uint8Array }> {
  const nBits = (swf[8] >> 3) & 0x1f;
  const rectBits = 5 + 4 * nBits;
  const rectBytes = Math.ceil(rectBits / 8);
  let pos = 8 + rectBytes + 4;
  const tags: Array<{ code: number; body: Uint8Array }> = [];
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

function makeMinimalDoc(sound: SoundLinkage): FlashDocument {
  const soundItem: SoundItem = {
    id: sound.libraryItemId,
    name: "test.mp3",
    itemType: "sound",
    dataUri: "data:audio/mp3;base64,",
    compressionType: "mp3",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 1,
  };
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
              frames: [
                {
                  index: 0,
                  isKeyframe: true,
                  isEmpty: true,
                  tweenType: "none",
                  label: "",
                  labelType: "name",
                  script: "",
                  sound,
                  motionEase: 0,
                  motionRotate: "none",
                  motionRotateCount: 0,
                  motionOrientToPath: false,
                  motionSync: false,
                  motionScale: false,
                  shapeEase: 0,
                  shapeBlend: "distributive",
                  displayObjects: [],
                },
              ],
              frameCount: 1,
            },
          ],
        },
      },
    ],
    library: {
      items: [soundItem],
      folders: [],
    },
  };
}

describe("compileDocument — StartSound (tag 15) integration", () => {
  it("emits StartSound (tag 15) for an event sound", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTags = tags.filter((t) => t.code === TAG_START_SOUND);
    expect(startTags.length).toBe(1);
  });

  it("StartSound body starts with correct soundId (matches DefineSound)", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const defineTag = tags.find((t) => t.code === TAG_DEFINE_SOUND)!;
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const definedSoundId = defineTag.body[0] | (defineTag.body[1] << 8);
    const startSoundId = startTag.body[0] | (startTag.body[1] << 8);
    expect(startSoundId).toBe(definedSoundId);
  });

  it("event sound with repeatCount=3 emits HasLoops with LoopCount=3", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 3,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const flags = startTag.body[2];
    expect((flags >> 2) & 1).toBe(1); // hasLoops
    const loopCount = startTag.body[3] | (startTag.body[4] << 8);
    expect(loopCount).toBe(3);
  });

  it("event sound with repeatCount=0 (infinite) emits HasLoops with LoopCount=0xFFFF (Ruffle infinite)", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 0,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const flags = startTag.body[2];
    expect((flags >> 2) & 1).toBe(1); // hasLoops
    const loopCount = startTag.body[3] | (startTag.body[4] << 8);
    expect(loopCount).toBe(0xFFFF); // 0xFFFF = loop forever (Ruffle infinite)
  });

  it("stop sync mode sets stop bit (bit 5) in SoundInfo flags", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "stop",
      repeatCount: 1,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const flags = startTag.body[2];
    expect((flags >> 5) & 1).toBe(1); // stop
  });

  it("start sync mode sets noMultiple bit (bit 4) in SoundInfo flags", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "start",
      repeatCount: 1,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const flags = startTag.body[2];
    expect((flags >> 4) & 1).toBe(1); // noMultiple
  });

  it("inPoint on SoundLinkage sets hasInPoint bit in SoundInfo", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
      inPoint: 4410,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const flags = startTag.body[2];
    expect(flags & 1).toBe(1); // hasInPoint
    const inPoint =
      startTag.body[3] |
      (startTag.body[4] << 8) |
      (startTag.body[5] << 16) |
      (startTag.body[6] << 24);
    expect(inPoint).toBe(4410);
  });

  it("outPoint on SoundLinkage sets hasOutPoint bit in SoundInfo", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
      outPoint: 22050,
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    const flags = startTag.body[2];
    expect((flags >> 1) & 1).toBe(1); // hasOutPoint
    const outPoint =
      startTag.body[3] |
      (startTag.body[4] << 8) |
      (startTag.body[5] << 16) |
      (startTag.body[6] << 24);
    expect(outPoint).toBe(22050);
  });

  it("customEnvelope on SoundLinkage sets hasEnvelope bit and encodes envelope points", () => {
    const doc = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
      customEnvelope: [
        { pos44: 0,     leftLevel: 0,     rightLevel: 0 },
        { pos44: 44100, leftLevel: 32768, rightLevel: 32768 },
      ],
    });
    const swf = compileDocument(doc);
    const tags = parseTags(swf);
    const startTag = tags.find((t) => t.code === TAG_START_SOUND)!;
    // body[2] = SoundInfo flags; hasEnvelope is bit 3
    const flags = startTag.body[2];
    expect((flags >> 3) & 1).toBe(1); // hasEnvelope
    // compile.ts always passes loops=repeatCount, so hasLoops (bit 2) is also set.
    // SoundInfo byte layout: [2]=flags, [3..4]=LoopCount, [5]=EnvelopeCount
    expect((flags >> 2) & 1).toBe(1); // hasLoops (always set since repeatCount is passed)
    expect(startTag.body[5]).toBe(2); // EnvelopeCount
  });

  it("customEnvelope overrides preset effect — leftLevel at pos44=0 reflects custom values", () => {
    // When customEnvelope is set, the preset effect should be ignored.
    const withPreset = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
      effect: "fadeIn",
    });
    const withCustom = makeMinimalDoc({
      libraryItemId: "snd-1",
      syncMode: "event",
      repeatCount: 1,
      effect: "fadeIn",
      customEnvelope: [
        { pos44: 0,     leftLevel: 16384, rightLevel: 16384 },
        { pos44: 44100, leftLevel: 16384, rightLevel: 16384 },
      ],
    });
    const swfPreset = compileDocument(withPreset);
    const swfCustom = compileDocument(withCustom);
    const tagsPreset = parseTags(swfPreset);
    const tagsCustom = parseTags(swfCustom);
    const presetStart = tagsPreset.find((t) => t.code === TAG_START_SOUND)!;
    const customStart = tagsCustom.find((t) => t.code === TAG_START_SOUND)!;
    // Both have hasEnvelope set (bit 3)
    expect((presetStart.body[2] >> 3) & 1).toBe(1);
    expect((customStart.body[2] >> 3) & 1).toBe(1);
    // SoundInfo byte layout (compile.ts always passes loops, so hasLoops is set):
    //   body[2]     = flags  (hasLoops + hasEnvelope bits)
    //   body[3..4]  = LoopCount (uint16 LE)
    //   body[5]     = EnvelopeCount
    //   body[6..9]  = first point pos44 (uint32 LE)
    //   body[10..11] = first point leftLevel (uint16 LE)
    //   body[12..13] = first point rightLevel (uint16 LE)
    const customLeftAt0 = customStart.body[10] | (customStart.body[11] << 8);
    expect(customLeftAt0).toBe(16384);
    const presetLeftAt0 = presetStart.body[10] | (presetStart.body[11] << 8);
    expect(presetLeftAt0).toBe(0); // fadeIn starts at silence (0)
  });
});
