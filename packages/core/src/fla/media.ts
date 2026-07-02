/**
 * Decoder for binary-FLA "Media N" streams that carry imported bitmap data.
 *
 * A bitmap's pixels live in an OLE stream named exactly `Media ${mediaId}`,
 * where `mediaId` is the u16 stored in each CPicBitmapRef record
 * (flash8-binary.ts readCPicBitmapRef). The payload is in one of these forms:
 *
 *   a) Raw JPEG bytes          — starts with FF D8 FF
 *   b) Raw PNG bytes           — starts with 89 50 4E 47 0D 0A 1A 0A
 *   c) Flash lossless bitmap   — 03 05 header + chunked-zlib ABGR pixels
 *   d) zlib-wrapped JPEG/PNG   — rare; a raw zlib stream wrapping (a) or (b)
 *
 * Forms (a), (b) and (d) are returned as their native MIME type. Form (c) is
 * decoded to straight RGBA and re-encoded as a PNG so the editor can display
 * it via a `data:image/png;base64,...` URI.
 *
 * Format references: eddiemoore/fla-decoder (`fla_decoder/bitmaps.py`,
 * `fla_decoder/lossless.py`, docs/FORMAT.md §7) and JPEXS flacomdoc
 * (`LosslessImageBinDataReader.java`). Both are cross-checked against real
 * Flash 8 output.
 */
import { unzlibSync, zlibSync } from "fflate";

export interface DecodedBitmap {
  /** Decoded image bytes ready to embed (JPEG or PNG). */
  readonly bytes: Uint8Array;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly width: number;
  readonly height: number;
  readonly compressionType: "photo" | "lossless";
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// GIF87a and GIF89a both start with "GIF8" (0x47 0x49 0x46 0x38).
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38];

// ---------------------------------------------------------------------------
// Decompression-bomb / oversized-allocation guards (FLA import path)
//
// Bitmap width/height on the import path are attacker-controlled u16 values
// (up to 65535 each -> ~4.3 Gpx -> ~17 GB for an RGBA buffer), and the zlib
// payload of a lossless container can expand without bound. A crafted "Media N"
// stream can therefore OOM the importer. Cap dimensions before allocating the
// pixel buffer and cap every inflate against a fixed output budget so a zlib
// bomb stops instead of growing.
// ---------------------------------------------------------------------------

/** Reject either dimension above this (well beyond any real Flash bitmap). */
const MAX_BITMAP_DIMENSION = 16384;
/** Reject total pixels above this; bounds an RGBA buffer to 64 MiB (4096*4096). */
const MAX_BITMAP_PIXELS = 16_777_216;
/** Cap for inflating a zlib-wrapped image (form d) so a bomb cannot expand. */
const MAX_INFLATED_MEDIA_BYTES = 64 * 1024 * 1024;

/**
 * True when `width` x `height` is a plausible bitmap size. Rejects the
 * decompression-bomb dimensions before any pixel buffer is allocated.
 */
function isSaneBitmapSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_BITMAP_DIMENSION &&
    height <= MAX_BITMAP_DIMENSION &&
    width * height <= MAX_BITMAP_PIXELS
  );
}

/**
 * Cheap zlib-header sniff so we only allocate a large inflate buffer for input
 * that actually is a zlib stream. zlib CMF/FLG: low nibble of CMF is the
 * compression method (8 = deflate) and (CMF<<8 | FLG) must be a multiple of 31.
 */
function looksLikeZlib(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  if ((data[0]! & 0x0f) !== 0x08) return false;
  return (((data[0]! << 8) | data[1]!) % 31) === 0;
}

function startsWith(data: Uint8Array, magic: number[]): boolean {
  if (data.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (data[i] !== magic[i]) return false;
  }
  return true;
}

/** Read the pixel dimensions from a JPEG by scanning SOF markers. */
function jpegDimensions(data: Uint8Array): { width: number; height: number } {
  // Skip the initial FFD8 (SOI), then walk marker segments.
  let pos = 2;
  while (pos + 9 < data.length) {
    if (data[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = data[pos + 1]!;
    // Standalone markers without a length field.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const len = (data[pos + 2]! << 8) | data[pos + 3]!;
    // SOF0..SOF15 (excluding DHT/JPG/DAC) carry frame dimensions.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (data[pos + 5]! << 8) | data[pos + 6]!;
      const width = (data[pos + 7]! << 8) | data[pos + 8]!;
      return { width, height };
    }
    pos += 2 + len;
  }
  return { width: 0, height: 0 };
}

/** Read width/height from a PNG IHDR chunk. */
function pngDimensions(data: Uint8Array): { width: number; height: number } {
  // IHDR width/height are big-endian u32 at byte offsets 16 and 20.
  if (data.length < 24) return { width: 0, height: 0 };
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a minimal RGBA PNG (color type 6, 8-bit) with no third-party deps. */
function pngFromRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const chunk = (tag: string, body: Uint8Array): Uint8Array => {
    const tagBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) tagBytes[i] = tag.charCodeAt(i);
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    out.set(tagBytes, 4);
    out.set(body, 8);
    const crcInput = new Uint8Array(4 + body.length);
    crcInput.set(tagBytes, 0);
    crcInput.set(body, 4);
    dv.setUint32(8 + body.length, crc32(crcInput));
    return out;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // bytes 10-12 (compression, filter, interlace) default 0

  // Each scanline gets a leading filter byte (0 = none).
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 6 });

  const sig = new Uint8Array(PNG_MAGIC);
  const parts = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Decode the Flash lossless bitmap container (form c). Returns straight-RGBA
 * pixels, or null if the bytes are not a lossless container.
 *
 * Layout (docs/FORMAT.md §7 / LosslessImageBinDataReader.java):
 *   u8 0x03, u8 0x05, u16 rowSize, u16 width, u16 height,
 *   u32 frame{Left,Right,Top,Bottom}, u8 flags, u8 variant,
 *   then (variant==1) chunked zlib: repeat [u16 len, len bytes] until len==0.
 */
function decodeLossless(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (data.length < 21 || data[0] !== 0x03 || data[1] !== 0x05) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // offset 2: rowSize (u16, unused)
  const width = dv.getUint16(4, true);
  const height = dv.getUint16(6, true);
  // Reject implausible dimensions before allocating any pixel buffer — a
  // crafted container can declare 65535x65535 (~17 GB RGBA).
  if (!isSaneBitmapSize(width, height)) return null;
  // offsets 8..23: four u32 frame bounds (twips, unused)
  // offset 24: flags, offset 25: variant
  const variant = data[25]!;

  let compressed: Uint8Array;
  if (variant === 1) {
    const chunks: Uint8Array[] = [];
    let pos = 26;
    while (pos + 2 <= data.length) {
      const len = dv.getUint16(pos, true);
      pos += 2;
      if (len === 0) break;
      if (pos + len > data.length) return null;
      chunks.push(data.subarray(pos, pos + len));
      pos += len;
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    compressed = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      compressed.set(c, off);
      off += c.length;
    }
  } else {
    compressed = data.subarray(26);
  }

  // Inflate into a fixed output buffer sized to exactly the pixels we need.
  // fflate does not grow a caller-supplied buffer, so a zlib bomb stops at the
  // cap instead of expanding without bound (dimensions are already clamped, so
  // width*height*4 is at most 64 MiB).
  const needed = width * height * 4;
  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(compressed, { out: new Uint8Array(needed) });
  } catch {
    return null;
  }
  if (inflated.length < needed) return null;

  // Reorder ABGR (premultiplied alpha) -> straight RGBA, un-premultiplying.
  const rgba = new Uint8Array(width * height * 4);
  let p = 0;
  let o = 0;
  for (let i = 0; i < width * height; i++) {
    let a = inflated[p]!;
    let b = inflated[p + 1]!;
    let g = inflated[p + 2]!;
    let r = inflated[p + 3]!;
    p += 4;
    if (a > 0 && a < 255) {
      const a1 = a - 1;
      if (a1 > 0) {
        r = Math.min(255, Math.floor((r * 256) / a1));
        g = Math.min(255, Math.floor((g * 256) / a1));
        b = Math.min(255, Math.floor((b * 256) / a1));
      }
      a = a1;
    }
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = a;
    o += 4;
  }
  return { width, height, rgba };
}

/**
 * Decode the raw bytes of a "Media N" stream into an embeddable image.
 * Returns null when the payload is empty or an unrecognized (non-bitmap)
 * media type — e.g. audio PCM/MP3 lives in Media streams too, so callers
 * must only treat a non-null result as a bitmap.
 */
export function decodeMediaBitmap(data: Uint8Array): DecodedBitmap | null {
  if (data.length === 0) return null;

  // (a) raw JPEG
  if (startsWith(data, JPEG_MAGIC)) {
    return {
      bytes: data,
      mimeType: "image/jpeg",
      ...jpegDimensions(data),
      compressionType: "photo",
    };
  }

  // (b) raw PNG
  if (startsWith(data, PNG_MAGIC)) {
    return {
      bytes: data,
      mimeType: "image/png",
      ...pngDimensions(data),
      compressionType: "lossless",
    };
  }

  // (b2) GIF (no pure-JS decoder available; extract dimensions and return a
  //      transparent-black PNG placeholder so the library item is not silently dropped).
  //      GIF header layout: bytes 0-2 "GIF", 3-5 "87a"/"89a",
  //      6-7 width (little-endian u16), 8-9 height (little-endian u16).
  if (startsWith(data, GIF_MAGIC) && data.length >= 10) {
    const w = data[6]! | (data[7]! << 8);
    const h = data[8]! | (data[9]! << 8);
    const width = w > 0 ? w : 1;
    const height = h > 0 ? h : 1;
    // Guard against an oversized GIF header (u16 each -> up to 65535) forcing a
    // multi-GB placeholder allocation.
    if (!isSaneBitmapSize(width, height)) return null;
    // Build a transparent RGBA pixel array and encode as PNG.
    const rgba = new Uint8Array(width * height * 4); // all zeros = transparent black
    return {
      bytes: pngFromRgba(width, height, rgba),
      mimeType: "image/png",
      width,
      height,
      compressionType: "lossless",
    };
  }

  // (c) Flash lossless bitmap container
  const lossless = decodeLossless(data);
  if (lossless) {
    return {
      bytes: pngFromRgba(lossless.width, lossless.height, lossless.rgba),
      mimeType: "image/png",
      width: lossless.width,
      height: lossless.height,
      compressionType: "lossless",
    };
  }

  // (d) plain zlib-wrapped JPEG/PNG. Only attempt (and only allocate the cap
  // buffer) when the payload actually looks like zlib, and cap the inflate so a
  // zlib bomb in a crafted Media stream cannot expand without bound.
  if (looksLikeZlib(data)) {
    try {
      const dec = unzlibSync(data, { out: new Uint8Array(MAX_INFLATED_MEDIA_BYTES) });
      if (startsWith(dec, JPEG_MAGIC)) {
        return {
          bytes: dec,
          mimeType: "image/jpeg",
          ...jpegDimensions(dec),
          compressionType: "photo",
        };
      }
      if (startsWith(dec, PNG_MAGIC)) {
        return {
          bytes: dec,
          mimeType: "image/png",
          ...pngDimensions(dec),
          compressionType: "lossless",
        };
      }
    } catch {
      // not a valid zlib stream (or exceeded the inflate cap)
    }
  }

  return null;
}

export interface DecodedAudio {
  /** Base64-encoded data URI ready to embed, e.g. "data:audio/mpeg;base64,..." */
  readonly dataUri: string;
  /** MIME type of the detected audio format. */
  readonly mimeType: "audio/mpeg" | "audio/wav" | "audio/ogg" | "audio/aac";
  /**
   * Compression type mapped to SoundItem.compressionType.
   * MP3 and AAC map to "mp3"; WAV and OGG map to "raw".
   */
  readonly compressionType: "mp3" | "raw";
}

// Magic byte sequences for common audio formats.
// MP3 sync word variants (MPEG-1/2 layer-3) and ID3 tag header.
const MP3_SYNC_FF_FB = [0xff, 0xfb];
const MP3_SYNC_FF_F3 = [0xff, 0xf3];
const MP3_SYNC_FF_F2 = [0xff, 0xf2];
const MP3_SYNC_FF_FA = [0xff, 0xfa];
const MP3_SYNC_FF_F9_LAYER3 = [0xff, 0xf9]; // treated as MPEG-2 layer3 (also AAC ADTS)
const ID3_MAGIC = [0x49, 0x44, 0x33]; // "ID3"
const WAV_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const AAC_SYNC_FF_F1 = [0xff, 0xf1]; // MPEG-4 AAC ADTS
// NOTE: FF F9 can be AAC or MPEG-2 — we treat both as AAC (audio/aac) since
// Flash typically stores MP3 (FF FB/F3/F2/FA) not raw AAC, so FF F9 => aac.

/**
 * Detect whether the raw bytes of a "Media N" stream contain audio data and,
 * if so, return a data URI plus metadata needed to populate SoundItem.
 *
 * Supported formats: MP3, WAV, OGG, AAC/ADTS.
 * Returns null for non-audio payloads (bitmaps, video, empty streams).
 */
export function decodeMediaAudio(data: Uint8Array): DecodedAudio | null {
  if (data.length < 4) return null;

  // MP3 with ID3v2 tag
  if (startsWith(data, ID3_MAGIC)) {
    return {
      dataUri: `data:audio/mpeg;base64,${bytesToBase64(data)}`,
      mimeType: "audio/mpeg",
      compressionType: "mp3",
    };
  }

  // Raw MP3 sync frames (no ID3 tag)
  if (
    startsWith(data, MP3_SYNC_FF_FB) ||
    startsWith(data, MP3_SYNC_FF_F3) ||
    startsWith(data, MP3_SYNC_FF_F2) ||
    startsWith(data, MP3_SYNC_FF_FA)
  ) {
    return {
      dataUri: `data:audio/mpeg;base64,${bytesToBase64(data)}`,
      mimeType: "audio/mpeg",
      compressionType: "mp3",
    };
  }

  // WAV (RIFF container — check "WAVE" at offset 8 to avoid false-positives
  // for other RIFF variants like AVI)
  if (startsWith(data, WAV_MAGIC)) {
    const isWave =
      data.length >= 12 &&
      data[8] === 0x57 && // 'W'
      data[9] === 0x41 && // 'A'
      data[10] === 0x56 && // 'V'
      data[11] === 0x45;   // 'E'
    if (isWave) {
      return {
        dataUri: `data:audio/wav;base64,${bytesToBase64(data)}`,
        mimeType: "audio/wav",
        compressionType: "raw",
      };
    }
  }

  // OGG (Vorbis, Opus, FLAC-in-Ogg…)
  if (startsWith(data, OGG_MAGIC)) {
    return {
      dataUri: `data:audio/ogg;base64,${bytesToBase64(data)}`,
      mimeType: "audio/ogg",
      compressionType: "raw",
    };
  }

  // AAC ADTS sync words (FF F1 = MPEG-4, FF F9 = MPEG-2)
  if (startsWith(data, AAC_SYNC_FF_F1) || startsWith(data, MP3_SYNC_FF_F9_LAYER3)) {
    return {
      dataUri: `data:audio/aac;base64,${bytesToBase64(data)}`,
      mimeType: "audio/aac",
      compressionType: "mp3",
    };
  }

  return null;
}

/** Encode raw bytes to a base64 string (browser-safe, no Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Convert a decoded bitmap to a `data:` URI. */
export function decodedBitmapToDataUri(bm: DecodedBitmap): string {
  return `data:${bm.mimeType};base64,${bytesToBase64(bm.bytes)}`;
}
