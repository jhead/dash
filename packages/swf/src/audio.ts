/**
 * SWF audio tag encoding: DefineSound (tag 14), StartSound (tag 15),
 * SoundStreamHead (tag 18), and SoundStreamBlock (tag 19).
 *
 * DefineSound stores audio data in the character dictionary.
 * StartSound triggers playback on a specific frame.
 * SoundStreamHead/SoundStreamBlock support timeline-synced streaming audio.
 */
import type { SoundItem, SoundLinkage } from "@flash/core";
import { BitWriter } from "./bits.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a data URI (e.g. "data:audio/mp3;base64,....") to raw bytes.
 */
function dataUriToBytes(dataUri: string): Uint8Array {
  const commaIdx = dataUri.indexOf(",");
  if (commaIdx === -1) return new Uint8Array(0);
  const meta = dataUri.slice(0, commaIdx);
  const data = dataUri.slice(commaIdx + 1);
  if (meta.includes(";base64")) {
    // Decode base64
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // URL-encoded plain text (rare for audio, but handle gracefully)
  const decoded = decodeURIComponent(data);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Sound format helpers
// ---------------------------------------------------------------------------

/**
 * Map a SoundItem compressionType to the SWF format code.
 * SWF spec:
 *   0 = Raw (uncompressed native-endian)
 *   1 = ADPCM
 *   2 = MP3
 *   3 = Raw (uncompressed little-endian)
 *   5 = Nellymoser 8kHz mono
 *   6 = Nellymoser (speech)
 *   11 = Speex
 */
export function soundFormat(compressionType: string): number {
  switch (compressionType) {
    case "raw":     return 3; // uncompressed little-endian
    case "adpcm":   return 1;
    case "mp3":     return 2;
    case "speech":  return 6; // Nellymoser (closest match)
    default:        return 2; // default to MP3
  }
}

/**
 * Map a sample rate (Hz) to the SWF rate bits.
 *   0 = 5.5kHz, 1 = 11kHz, 2 = 22kHz, 3 = 44kHz
 */
export function soundRate(sampleRate: number): number {
  if (sampleRate >= 44100) return 3;
  if (sampleRate >= 22050) return 2;
  if (sampleRate >= 11025) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// DefineSound (tag 14)
// ---------------------------------------------------------------------------

/**
 * Emit a DefineSound tag body for a SoundItem.
 *
 * DefineSound body layout:
 *   SoundId:          UI16
 *   SoundFlags:       UI8  — (format<<4)|(rate<<2)|(size<<1)|channels
 *   SoundSampleCount: UI32
 *   SoundData:        UI8[...] — raw audio bytes
 */
export function encodeDefineSound(soundId: number, item: SoundItem): Uint8Array {
  const audioBytes = dataUriToBytes(item.dataUri);

  const format = soundFormat(item.compressionType);
  const rateBits = soundRate(item.sampleRate);

  const sizeBit = item.sampleSize === 16 ? 1 : 0;
  const channelBit = item.isStereo ? 1 : 0;
  const flags = (format << 4) | (rateBits << 2) | (sizeBit << 1) | channelBit;

  // SampleCount: use 0 for MVP (Flash Player can still play the sound)
  const sampleCount = 0;

  const bw = new BitWriter();
  bw.writeUI16LE(soundId);
  bw.writeUI8(flags);
  bw.writeUI32LE(sampleCount);
  // For MP3 format (2), SoundData must begin with a SeekSamples SI16 (samples to skip at start)
  if (format === 2) {
    bw.writeSI16LE(0); // SeekSamples = 0 (no skip)
  }
  bw.writeBytes(audioBytes);
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// SoundStreamHead (tag 18)
// ---------------------------------------------------------------------------

/**
 * Encode a SoundStreamHead (tag 18) tag body.
 * Specifies the stream format for timeline-synced audio.
 *
 * Binary layout:
 *   UB[4]  Reserved (0)
 *   UB[2]  PlaybackSoundRate
 *   UB[1]  PlaybackSoundSize
 *   UB[1]  PlaybackSoundType (stereo)
 *   UB[4]  StreamSoundCompression (format code)
 *   UB[2]  StreamSoundRate
 *   UB[1]  StreamSoundSize
 *   UB[1]  StreamSoundType
 *   UI16   StreamSoundSampleCount (average samples per frame)
 *   SI16   LatencySeek (0 for non-MP3; only present when format=2/MP3)
 */
export function encodeSoundStreamHead(opts: {
  playbackRate: number;      // 0=5.5kHz, 1=11kHz, 2=22kHz, 3=44kHz
  playbackSize: 0 | 1;      // 0=8bit, 1=16bit
  playbackStereo: 0 | 1;
  streamFormat: number;      // same as DefineSound format codes
  streamRate: number;
  streamSize: 0 | 1;
  streamStereo: 0 | 1;
  streamSampleCount: number; // average samples per frame
}): Uint8Array {
  const bw = new BitWriter();

  // Byte 0: Reserved(4) | PlaybackRate(2) | PlaybackSize(1) | PlaybackType(1)
  const byte0 =
    ((opts.playbackRate & 0x3) << 2) |
    ((opts.playbackSize & 0x1) << 1) |
    (opts.playbackStereo & 0x1);
  bw.writeUI8(byte0);

  // Byte 1: StreamFormat(4) | StreamRate(2) | StreamSize(1) | StreamType(1)
  const byte1 =
    ((opts.streamFormat & 0xf) << 4) |
    ((opts.streamRate & 0x3) << 2) |
    ((opts.streamSize & 0x1) << 1) |
    (opts.streamStereo & 0x1);
  bw.writeUI8(byte1);

  // StreamSoundSampleCount: UI16LE
  bw.writeUI16LE(opts.streamSampleCount);

  // LatencySeek: SI16LE — present only for MP3 (format=2)
  if (opts.streamFormat === 2) {
    bw.writeSI16LE(0);
  }

  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// SoundStreamBlock (tag 19)
// ---------------------------------------------------------------------------

/**
 * Encode a SoundStreamBlock (tag 19) tag body.
 *
 * SWF spec layout (for all stream formats):
 *   SeekSamples: UI16  — number of samples to seek (usually 0)
 *   AudioData:   BYTE[] — compressed audio data
 *
 * For MP3 stream blocks the SeekSamples field is mandatory per the SWF spec.
 * We always write it (value 0) so the block is always at least 2 bytes,
 * followed by the raw audio chunk bytes.
 */
export function encodeSoundStreamBlock(audioChunk: Uint8Array): Uint8Array {
  // Always prepend the 2-byte SeekSamples UI16LE header (value 0)
  const body = new Uint8Array(2 + audioChunk.length);
  body[0] = 0; // SeekSamples low byte
  body[1] = 0; // SeekSamples high byte
  body.set(audioChunk, 2);
  return body;
}

// ---------------------------------------------------------------------------
// StartSound (tag 15)
// ---------------------------------------------------------------------------

/**
 * Emit a StartSound tag body to trigger a sound on a frame.
 *
 * StartSound body layout:
 *   SoundId:   UI16
 *   SoundInfo: UI8  — packed flags byte
 *   LoopCount: UI16 — only if HasLoops flag is set
 *
 * SoundInfo bit layout (bits 7..0):
 *   bit 7: Reserved
 *   bit 6: Reserved
 *   bit 5: SyncStop       — 1 if syncMode === 'stop'
 *   bit 4: SyncNoMultiple — 1 if syncMode === 'start'
 *   bit 3: HasEnvelope    — 0 for MVP
 *   bit 2: HasLoops       — 1 if repeatCount !== 1
 *   bit 1: HasOutPoint    — 0 for MVP
 *   bit 0: HasInPoint     — 0 for MVP
 */
export function encodeStartSound(
  soundId: number,
  linkage: SoundLinkage
): Uint8Array {
  const syncStop = linkage.syncMode === "stop" ? 1 : 0;
  const syncNoMultiple = linkage.syncMode === "start" ? 1 : 0;
  const hasLoops = linkage.repeatCount !== 1 ? 1 : 0;

  // Bits: [reserved1][reserved0][syncStop][syncNoMultiple][hasEnv][hasLoops][hasOutPt][hasInPt]
  const infoByte =
    (syncStop << 5) | (syncNoMultiple << 4) | (hasLoops << 2);

  const bw = new BitWriter();
  bw.writeUI16LE(soundId);
  bw.writeUI8(infoByte);
  if (hasLoops) {
    // repeatCount 0 = loop indefinitely → use 0xFFFF
    const loopCount = linkage.repeatCount === 0 ? 0xffff : linkage.repeatCount;
    bw.writeUI16LE(loopCount);
  }
  return bw.getBytes();
}
