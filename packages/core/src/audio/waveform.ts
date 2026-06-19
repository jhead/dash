/**
 * Waveform peak extraction for the Sound Envelope editor.
 *
 * Pure TypeScript, browser-safe (uses `atob`/`Uint8Array`, no Node Buffer and
 * no Web Audio). Decodes uncompressed PCM WAV (RIFF/WAVE) data into per-bucket
 * min/max peaks suitable for drawing a waveform in a canvas.
 *
 * Compressed formats (MP3/AAC/OGG) are NOT decoded here — there is no pure-TS
 * MP3 decoder in the tree — so {@link decodeWavPeaks} returns null for them and
 * the caller falls back to a flat placeholder. Authored/imported sounds that are
 * raw WAV (the common authoring case) get a real waveform.
 */

/** A pair of per-channel peak arrays, one bucket per pixel column. */
export interface WaveformPeaks {
  /** Number of buckets (columns) requested. */
  readonly buckets: number;
  /** Per-channel peaks: `channels[c][i] = [min, max]` in range [-1, 1]. */
  readonly channels: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** Sample rate in Hz parsed from the WAV header. */
  readonly sampleRate: number;
  /** Channel count parsed from the WAV header (1 = mono, 2 = stereo). */
  readonly channelCount: number;
  /** Total sample frames in the decoded data. */
  readonly frameCount: number;
}

/** Decode a base64 string to bytes (browser-safe, no Buffer). */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Extract the base64 payload from a `data:` URI (or treat the input as base64). */
function dataUriToBytes(dataUri: string): Uint8Array | null {
  const comma = dataUri.indexOf(",");
  const b64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

interface WavFmt {
  audioFormat: number; // 1 = PCM, 3 = IEEE float
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

/** Parse the RIFF/WAVE header, locating the `fmt ` and `data` chunks. */
function parseWavHeader(bytes: Uint8Array): WavFmt | null {
  if (bytes.length < 12) return null;
  // "RIFF" .... "WAVE"
  if (
    bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46 ||
    bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45
  ) {
    return null;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let fmt: Omit<WavFmt, "dataOffset" | "dataLength"> | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  let off = 12;
  while (off + 8 <= bytes.length) {
    const id0 = bytes[off], id1 = bytes[off + 1], id2 = bytes[off + 2], id3 = bytes[off + 3];
    const chunkSize = dv.getUint32(off + 4, true);
    const body = off + 8;
    // "fmt "
    if (id0 === 0x66 && id1 === 0x6d && id2 === 0x74 && id3 === 0x20 && body + 16 <= bytes.length) {
      fmt = {
        audioFormat: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bitsPerSample: dv.getUint16(body + 14, true),
      };
    } else if (id0 === 0x64 && id1 === 0x61 && id2 === 0x74 && id3 === 0x61) {
      // "data"
      dataOffset = body;
      dataLength = Math.min(chunkSize, bytes.length - body);
    }
    // Chunks are word-aligned (pad byte if odd size).
    off = body + chunkSize + (chunkSize & 1);
  }

  if (!fmt || dataOffset < 0 || fmt.channels < 1) return null;
  return { ...fmt, dataOffset, dataLength };
}

/** Read one PCM sample (normalised to [-1, 1]) at a byte offset. */
function readSample(dv: DataView, off: number, fmt: WavFmt): number {
  if (fmt.audioFormat === 3) {
    // IEEE float
    if (fmt.bitsPerSample === 64) return dv.getFloat64(off, true);
    return dv.getFloat32(off, true);
  }
  // PCM integer
  switch (fmt.bitsPerSample) {
    case 8:
      // 8-bit WAV is unsigned (0..255), centred at 128.
      return (dv.getUint8(off) - 128) / 128;
    case 16:
      return dv.getInt16(off, true) / 32768;
    case 24: {
      let v = dv.getUint8(off) | (dv.getUint8(off + 1) << 8) | (dv.getUint8(off + 2) << 16);
      if (v & 0x800000) v -= 0x1000000;
      return v / 0x800000;
    }
    case 32:
      return dv.getInt32(off, true) / 0x80000000;
    default:
      return 0;
  }
}

/**
 * Decode an uncompressed PCM/float WAV data URI into per-bucket min/max peaks.
 *
 * @param dataUri  a `data:audio/...;base64,...` URI (or a bare base64 string)
 * @param buckets  number of output columns (>= 1)
 * @returns peaks, or null if the data is not a decodable PCM WAV
 */
export function decodeWavPeaks(dataUri: string, buckets: number): WaveformPeaks | null {
  if (buckets < 1) return null;
  const bytes = dataUriToBytes(dataUri);
  if (!bytes) return null;
  const fmt = parseWavHeader(bytes);
  if (!fmt) return null;
  // Only PCM integer (1) and IEEE float (3) are byte-decodable here.
  if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) return null;
  const bytesPerSample = fmt.bitsPerSample >> 3;
  if (bytesPerSample < 1) return null;

  const frameBytes = bytesPerSample * fmt.channels;
  const frameCount = Math.floor(fmt.dataLength / frameBytes);
  if (frameCount < 1) return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Pre-init min/max accumulators per channel per bucket.
  const channels: Array<Array<[number, number]>> = [];
  for (let c = 0; c < fmt.channels; c++) {
    const arr: Array<[number, number]> = new Array(buckets);
    for (let i = 0; i < buckets; i++) arr[i] = [0, 0];
    channels.push(arr);
  }

  const framesPerBucket = frameCount / buckets;
  for (let b = 0; b < buckets; b++) {
    const startFrame = Math.floor(b * framesPerBucket);
    const endFrame = Math.min(
      frameCount,
      Math.max(startFrame + 1, Math.floor((b + 1) * framesPerBucket)),
    );
    for (let c = 0; c < fmt.channels; c++) {
      let mn = Infinity;
      let mx = -Infinity;
      for (let f = startFrame; f < endFrame; f++) {
        const off = fmt.dataOffset + f * frameBytes + c * bytesPerSample;
        if (off + bytesPerSample > bytes.length) break;
        const s = readSample(dv, off, fmt);
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
      if (!Number.isFinite(mn)) mn = 0;
      if (!Number.isFinite(mx)) mx = 0;
      channels[c][b] = [
        Math.max(-1, Math.min(1, mn)),
        Math.max(-1, Math.min(1, mx)),
      ];
    }
  }

  return {
    buckets,
    channels,
    sampleRate: fmt.sampleRate,
    channelCount: fmt.channels,
    frameCount,
  };
}
