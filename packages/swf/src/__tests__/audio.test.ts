/**
 * Golden tests for DefineSound (tag 14) and StartSound (tag 15) encoding.
 *
 * DefineSound body layout:
 *   [0..1]  soundId UI16LE
 *   [2]     SoundFlags UI8 — (format<<4)|(rate<<2)|(size<<1)|channels
 *   [3..6]  SoundSampleCount UI32LE
 *   [7..8]  SeekSamples SI16LE — ONLY present for MP3 (format=2)
 *   [7+...]  audio data
 *
 * StartSound body layout:
 *   [0..1]  soundId UI16LE
 *   [2]     SoundInfo UI8 — bit flags
 *   [3..4]  LoopCount UI16LE — ONLY when HasLoops bit (bit 2) is set
 *
 * SoundInfo bit layout (bits 7..0):
 *   bit 5: SyncStop
 *   bit 4: SyncNoMultiple
 *   bit 3: HasEnvelope  (0 for MVP)
 *   bit 2: HasLoops
 *   bit 1: HasOutPoint  (0 for MVP)
 *   bit 0: HasInPoint   (0 for MVP)
 */

import { describe, it, expect } from "vitest";
import { encodeDefineSound, encodeStartSound } from "../audio.js";
import type { SoundItem, SoundLinkage } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMp3Item(extraBytes = 0): SoundItem {
  // Minimal data URI for an MP3 (base64 encoded empty array)
  const data = new Uint8Array(extraBytes);
  const base64 = btoa(String.fromCharCode(...data));
  return {
    id: "snd-1",
    name: "test.mp3",
    itemType: "sound",
    dataUri: `data:audio/mp3;base64,${base64}`,
    compressionType: "mp3",
    sampleRate: 44100,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 0,
  };
}

function makeRawItem(): SoundItem {
  return {
    id: "snd-2",
    name: "test.raw",
    itemType: "sound",
    dataUri: "data:audio/raw;base64,",
    compressionType: "raw",
    sampleRate: 22050,
    sampleSize: 8,
    isStereo: false,
    durationSeconds: 0,
  };
}

function makeLinkage(
  syncMode: "event" | "start" | "stop" = "event",
  repeatCount = 1
): SoundLinkage {
  return { libraryItemId: "snd-1", syncMode, repeatCount };
}

// ---------------------------------------------------------------------------
// DefineSound
// ---------------------------------------------------------------------------

describe("DefineSound", () => {
  it("encodes soundId as UI16LE at bytes [0..1]", () => {
    const body = encodeDefineSound(7, makeMp3Item());
    const soundId = body[0] | (body[1] << 8);
    expect(soundId).toBe(7);
  });

  it("MP3 SoundFlags has format bits 2 (MP3) in high nibble", () => {
    const body = encodeDefineSound(1, makeMp3Item());
    const flags = body[2];
    const format = (flags >> 4) & 0xf;
    expect(format).toBe(2); // 2 = MP3 per SWF spec
  });

  it("44100 Hz sample rate — rate bits are 3 in SoundFlags bits[3:2]", () => {
    const body = encodeDefineSound(1, makeMp3Item());
    const flags = body[2];
    const rateBits = (flags >> 2) & 0x3;
    expect(rateBits).toBe(3); // 3 = 44100 Hz
  });

  it("22050 Hz sample rate — rate bits are 2", () => {
    const item: SoundItem = { ...makeMp3Item(), sampleRate: 22050 };
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    const rateBits = (flags >> 2) & 0x3;
    expect(rateBits).toBe(2);
  });

  it("16-bit sample size — sizeBit is 1 in SoundFlags bit[1]", () => {
    const body = encodeDefineSound(1, makeMp3Item());
    const flags = body[2];
    const sizeBit = (flags >> 1) & 0x1;
    expect(sizeBit).toBe(1); // 1 = 16-bit
  });

  it("8-bit sample size — sizeBit is 0", () => {
    const item: SoundItem = { ...makeRawItem(), sampleSize: 8 };
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    const sizeBit = (flags >> 1) & 0x1;
    expect(sizeBit).toBe(0);
  });

  it("mono — channelBit is 0 in SoundFlags bit[0]", () => {
    const body = encodeDefineSound(1, makeMp3Item());
    const flags = body[2];
    expect(flags & 0x1).toBe(0);
  });

  it("stereo — channelBit is 1", () => {
    const item: SoundItem = { ...makeMp3Item(), isStereo: true };
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    expect(flags & 0x1).toBe(1);
  });

  it("SampleCount is UI32LE zero at bytes [3..6]", () => {
    const body = encodeDefineSound(1, makeMp3Item());
    const count =
      body[3] | (body[4] << 8) | (body[5] << 16) | (body[6] << 24);
    expect(count).toBe(0);
  });

  it("MP3: SeekSamples SI16LE is present at bytes [7..8] and equals 0", () => {
    const body = encodeDefineSound(1, makeMp3Item());
    // SeekSamples: 2 bytes after the 4-byte SampleCount (offset 7)
    // Present for MP3 (format=2 per SWF spec)
    const seekSamples = body[7] | (body[8] << 8);
    expect(seekSamples).toBe(0);
  });

  it("raw (non-MP3): no SeekSamples — body is shorter by 2 bytes vs MP3", () => {
    const rawBody = encodeDefineSound(1, makeRawItem());
    const mp3Body = encodeDefineSound(1, makeMp3Item());
    // MP3 body has 2 extra bytes for SeekSamples (when audio data is empty)
    expect(mp3Body.length).toBe(rawBody.length + 2);
  });

  it("audio bytes are appended after the header (MP3)", () => {
    const audioData = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const base64 = btoa(String.fromCharCode(...audioData));
    const item: SoundItem = {
      id: "snd-3",
      name: "test.mp3",
      itemType: "sound",
      dataUri: `data:audio/mp3;base64,${base64}`,
      compressionType: "mp3",
      sampleRate: 44100,
      sampleSize: 16,
      isStereo: false,
      durationSeconds: 0,
    };
    const body = encodeDefineSound(1, item);
    // Header: 2 (soundId) + 1 (flags) + 4 (sampleCount) + 2 (seekSamples for MP3) = 9 bytes
    expect(body.length).toBe(9 + audioData.length);
    expect(Array.from(body.slice(9))).toEqual(Array.from(audioData));
  });
});

// ---------------------------------------------------------------------------
// StartSound
// ---------------------------------------------------------------------------

describe("StartSound", () => {
  it("encodes soundId as UI16LE at bytes [0..1]", () => {
    const body = encodeStartSound(12, makeLinkage());
    const soundId = body[0] | (body[1] << 8);
    expect(soundId).toBe(12);
  });

  it("event sync mode — SyncStop and SyncNoMultiple bits are both 0", () => {
    const body = encodeStartSound(1, makeLinkage("event"));
    const info = body[2];
    expect((info >> 5) & 1).toBe(0); // SyncStop
    expect((info >> 4) & 1).toBe(0); // SyncNoMultiple
  });

  it("stop sync mode — SyncStop bit (bit 5) is 1", () => {
    const body = encodeStartSound(1, makeLinkage("stop"));
    const info = body[2];
    expect((info >> 5) & 1).toBe(1);
  });

  it("start sync mode — SyncNoMultiple bit (bit 4) is 1", () => {
    const body = encodeStartSound(1, makeLinkage("start"));
    const info = body[2];
    expect((info >> 4) & 1).toBe(1);
  });

  it("repeatCount=1 — HasLoops bit (bit 2) is 0, no LoopCount bytes", () => {
    const body = encodeStartSound(1, makeLinkage("event", 1));
    const info = body[2];
    expect((info >> 2) & 1).toBe(0); // HasLoops = 0
    expect(body.length).toBe(3);     // no LoopCount
  });

  it("repeatCount=3 — HasLoops bit (bit 2) is 1", () => {
    const body = encodeStartSound(1, makeLinkage("event", 3));
    const info = body[2];
    expect((info >> 2) & 1).toBe(1); // HasLoops = 1
  });

  it("repeatCount=3 — LoopCount UI16LE present at bytes [3..4]", () => {
    const body = encodeStartSound(1, makeLinkage("event", 3));
    expect(body.length).toBe(5);
    const loopCount = body[3] | (body[4] << 8);
    expect(loopCount).toBe(3);
  });

  it("repeatCount=0 (infinite loop) — LoopCount is 0xFFFF", () => {
    const body = encodeStartSound(1, makeLinkage("event", 0));
    const loopCount = body[3] | (body[4] << 8);
    expect(loopCount).toBe(0xffff);
  });
});
