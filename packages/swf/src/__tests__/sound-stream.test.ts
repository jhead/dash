/**
 * Tests for SoundStreamHead (tag 18), SoundStreamBlock (tag 19),
 * and fixed DefineSound compression type mapping.
 *
 * SoundStreamHead body layout:
 *   [0]    Byte: Reserved(4) | PlaybackRate(2) | PlaybackSize(1) | PlaybackType(1)
 *   [1]    Byte: StreamFormat(4) | StreamRate(2) | StreamSize(1) | StreamType(1)
 *   [2..3] StreamSoundSampleCount UI16LE
 *   [4..5] LatencySeek SI16LE — only present when streamFormat=2 (MP3)
 *
 * SoundStreamBlock body:
 *   Raw audio bytes (passed through as-is)
 *
 * DefineSound SWF spec format codes:
 *   0 = Raw (native-endian)
 *   1 = ADPCM
 *   2 = MP3
 *   3 = Raw (little-endian)
 *   5 = Nellymoser 8kHz
 *   6 = Nellymoser (speech)
 *   11 = Speex
 */

import { describe, it, expect } from "vitest";
import {
  encodeSoundStreamHead,
  encodeSoundStreamBlock,
  encodeDefineSound,
} from "../audio.js";
import { Tag } from "../tags.js";
import type { SoundItem } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSoundItem(
  compressionType: "mp3" | "adpcm" | "raw" | "speech",
  sampleRate = 44100
): SoundItem {
  return {
    id: "snd-1",
    name: `test.${compressionType}`,
    itemType: "sound",
    dataUri: `data:audio/${compressionType};base64,`,
    compressionType,
    sampleRate,
    sampleSize: 16,
    isStereo: false,
    durationSeconds: 0,
  };
}

// ---------------------------------------------------------------------------
// SoundStreamHead (tag 18)
// ---------------------------------------------------------------------------

describe("SoundStreamHead encoding", () => {
  it("encodeSoundStreamHead returns a Uint8Array", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 2,
      streamRate: 3,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 1152,
    });
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("SoundStreamHead tag code is 18", () => {
    expect(Tag.SoundStreamHead).toBe(18);
  });

  it("stream format byte for MP3 (streamFormat=2) is encoded in high nibble of byte 1", () => {
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
    // byte[1] = (streamFormat<<4) | (streamRate<<2) | (streamSize<<1) | streamStereo
    const byte1 = result[1];
    const format = (byte1 >> 4) & 0xf;
    expect(format).toBe(2); // MP3
  });

  it("stream format byte for ADPCM (streamFormat=1) is encoded correctly", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 2,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 1, // ADPCM
      streamRate: 2,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 512,
    });
    const byte1 = result[1];
    const format = (byte1 >> 4) & 0xf;
    expect(format).toBe(1); // ADPCM
  });

  it("SoundStreamHead for 44100Hz has streamRate=3 encoded in bits[3:2] of byte 1", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 2,
      streamRate: 3, // 44kHz
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 1152,
    });
    const byte1 = result[1];
    const rate = (byte1 >> 2) & 0x3;
    expect(rate).toBe(3); // 44kHz
  });

  it("SoundStreamHead for MP3 includes LatencySeek SI16LE at bytes [4..5]", () => {
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
    // For MP3: 1 (byte0) + 1 (byte1) + 2 (sampleCount) + 2 (latencySeek) = 6 bytes
    expect(result.length).toBe(6);
    const latencySeek = result[4] | (result[5] << 8);
    expect(latencySeek).toBe(0);
  });

  it("SoundStreamHead for non-MP3 (ADPCM) does NOT include LatencySeek", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 2,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 1, // ADPCM
      streamRate: 2,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 512,
    });
    // For non-MP3: 1 (byte0) + 1 (byte1) + 2 (sampleCount) = 4 bytes
    expect(result.length).toBe(4);
  });

  it("StreamSoundSampleCount UI16LE is written at bytes [2..3]", () => {
    const result = encodeSoundStreamHead({
      playbackRate: 3,
      playbackSize: 1,
      playbackStereo: 0,
      streamFormat: 1, // ADPCM (no LatencySeek)
      streamRate: 3,
      streamSize: 1,
      streamStereo: 0,
      streamSampleCount: 1024,
    });
    const sampleCount = result[2] | (result[3] << 8);
    expect(sampleCount).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// SoundStreamBlock (tag 19)
// ---------------------------------------------------------------------------

describe("SoundStreamBlock encoding", () => {
  it("encodeSoundStreamBlock wraps audio bytes and returns a Uint8Array", () => {
    const audioChunk = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const result = encodeSoundStreamBlock(audioChunk);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("SoundStreamBlock tag code is 19", () => {
    expect(Tag.SoundStreamBlock).toBe(19);
  });

  it("SoundStreamBlock body starts with SeekSamples UI16 (0) followed by original audio bytes", () => {
    const audioChunk = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const result = encodeSoundStreamBlock(audioChunk);
    // Per SWF spec, body = SeekSamples UI16LE (2 bytes) + audio data
    expect(result[0]).toBe(0); // SeekSamples low byte
    expect(result[1]).toBe(0); // SeekSamples high byte
    expect(Array.from(result.slice(2))).toEqual(Array.from(audioChunk));
  });
});

// ---------------------------------------------------------------------------
// DefineSound compression type mapping (fixed per SWF spec)
// ---------------------------------------------------------------------------

describe("DefineSound compression type mapping", () => {
  it("DefineSound for 'adpcm' sound has format byte = 1 (not 2)", () => {
    const item = makeSoundItem("adpcm");
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    const format = (flags >> 4) & 0xf;
    expect(format).toBe(1); // ADPCM = 1 per SWF spec
  });

  it("DefineSound for 'raw' sound has format byte = 3 (little-endian raw)", () => {
    const item = makeSoundItem("raw");
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    const format = (flags >> 4) & 0xf;
    expect(format).toBe(3); // Raw little-endian = 3 per SWF spec
  });

  it("DefineSound for 'mp3' sound has format byte = 2", () => {
    const item = makeSoundItem("mp3");
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    const format = (flags >> 4) & 0xf;
    expect(format).toBe(2); // MP3 = 2 per SWF spec
  });

  it("DefineSound for 'speech' sound has format byte = 6 (Nellymoser)", () => {
    const item = makeSoundItem("speech");
    const body = encodeDefineSound(1, item);
    const flags = body[2];
    const format = (flags >> 4) & 0xf;
    expect(format).toBe(6); // Nellymoser = 6 per SWF spec
  });
});
