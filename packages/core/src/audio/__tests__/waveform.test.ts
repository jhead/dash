import { describe, it, expect } from "vitest";
import { decodeWavPeaks } from "../waveform.js";

/** Build a minimal 16-bit PCM WAV from per-channel Int16 sample arrays. */
function buildWav(channelsData: number[][], sampleRate = 44100): string {
  const channels = channelsData.length;
  const frameCount = channelsData[0].length;
  const bitsPerSample = 16;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataLen = frameCount * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };

  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  dv.setUint32(40, dataLen, true);

  let off = 44;
  for (let f = 0; f < frameCount; f++) {
    for (let c = 0; c < channels; c++) {
      dv.setInt16(off, channelsData[c][f], true);
      off += 2;
    }
  }

  // base64 encode
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = Buffer.from(binary, "binary").toString("base64");
  return `data:audio/wav;base64,${b64}`;
}

describe("decodeWavPeaks", () => {
  it("returns null for non-WAV data", () => {
    const mp3 = "data:audio/mpeg;base64,SUQzAAAAAAA="; // ID3 header, not WAV
    expect(decodeWavPeaks(mp3, 100)).toBeNull();
  });

  it("returns null for garbage / empty input", () => {
    expect(decodeWavPeaks("not-a-data-uri", 100)).toBeNull();
    expect(decodeWavPeaks("data:audio/wav;base64,", 100)).toBeNull();
  });

  it("parses header metadata (sampleRate, channels, frameCount)", () => {
    const left = new Array(1000).fill(0).map((_, i) => (i % 2 ? 16000 : -16000));
    const right = new Array(1000).fill(0).map(() => 0);
    const peaks = decodeWavPeaks(buildWav([left, right], 22050), 50);
    expect(peaks).not.toBeNull();
    expect(peaks!.sampleRate).toBe(22050);
    expect(peaks!.channelCount).toBe(2);
    expect(peaks!.frameCount).toBe(1000);
    expect(peaks!.buckets).toBe(50);
    expect(peaks!.channels).toHaveLength(2);
    expect(peaks!.channels[0]).toHaveLength(50);
  });

  it("computes per-bucket min/max peaks normalised to [-1, 1]", () => {
    // A constant +full-scale signal on the left channel.
    const left = new Array(800).fill(32767);
    const right = new Array(800).fill(0);
    const peaks = decodeWavPeaks(buildWav([left, right]), 40)!;
    // Every left bucket: min ≈ max ≈ +1 (32767/32768).
    for (const [mn, mx] of peaks.channels[0]) {
      expect(mx).toBeGreaterThan(0.999);
      expect(mn).toBeGreaterThan(0.999);
    }
    // Right channel is silent.
    for (const [mn, mx] of peaks.channels[1]) {
      expect(mn).toBe(0);
      expect(mx).toBe(0);
    }
  });

  it("captures both positive and negative extremes within a bucket", () => {
    // Alternating ±full-scale, so a wide bucket sees both extremes.
    const samples = new Array(400).fill(0).map((_, i) => (i % 2 ? 32767 : -32768));
    const peaks = decodeWavPeaks(buildWav([samples]), 10)!;
    for (const [mn, mx] of peaks.channels[0]) {
      expect(mx).toBeGreaterThan(0.99); // saw +1
      expect(mn).toBeLessThan(-0.99); // saw -1
    }
  });

  it("handles mono input", () => {
    const samples = new Array(500).fill(8000);
    const peaks = decodeWavPeaks(buildWav([samples]), 20)!;
    expect(peaks.channelCount).toBe(1);
    expect(peaks.channels).toHaveLength(1);
  });

  it("returns null when buckets < 1", () => {
    const samples = new Array(100).fill(0);
    expect(decodeWavPeaks(buildWav([samples]), 0)).toBeNull();
  });
});
