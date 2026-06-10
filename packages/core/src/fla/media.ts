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

  let inflated: Uint8Array;
  try {
    inflated = unzlibSync(compressed);
  } catch {
    return null;
  }
  if (inflated.length < width * height * 4) return null;

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

  // (d) plain zlib-wrapped JPEG/PNG
  try {
    const dec = unzlibSync(data);
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
    // not a zlib stream
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
