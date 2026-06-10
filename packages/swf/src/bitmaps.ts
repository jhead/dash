/**
 * SWF bitmap tag encoders.
 *
 * DefineBitsJPEG2 (tag 21) embeds raw JPEG or PNG bytes directly.
 * Ruffle and Flash Player both support PNG embedded in DefineBitsJPEG2 for SWF8+.
 *
 * DefineBitsLossless2 (tag 36) embeds ZLIB-compressed ARGB pixel data.
 * BitmapFormat 5 = 32-bit ARGB; rows are stored top-to-bottom, no padding.
 */
import { deflateSync } from "fflate";
import { BitWriter } from "./bits.js";

// ---------------------------------------------------------------------------
// Tag header helper (internal use only)
// ---------------------------------------------------------------------------

/**
 * Encode a SWF tag record header + body into a Uint8Array.
 * Short form: (tagCode << 6) | length  when length < 63
 * Long form:  (tagCode << 6) | 0x3F, then SI32 length
 */
function encodeTagRecord(tagCode: number, body: Uint8Array): Uint8Array {
  const bw = new BitWriter();
  if (body.length < 63) {
    bw.writeUI16LE((tagCode << 6) | body.length);
  } else {
    bw.writeUI16LE((tagCode << 6) | 0x3f);
    bw.writeSI32LE(body.length);
  }
  bw.writeBytes(body);
  return bw.getBytes();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a DefineBitsJPEG2 tag body (tag 21) — works for JPEG AND PNG in SWF8+.
 *
 * Payload: CharacterID UI16, followed by raw JPEG or PNG image bytes.
 * Returns the full tag record (header + body).
 *
 * @param charId      SWF character ID for this bitmap
 * @param imageBytes  Raw JPEG or PNG bytes (decoded from data URI)
 */
export function encodeDefineBitsJPEG2(
  charId: number,
  imageBytes: Uint8Array
): Uint8Array {
  const DefineBitsJPEG2 = 21;
  const payload = new Uint8Array(2 + imageBytes.length);
  payload[0] = charId & 0xff;
  payload[1] = (charId >> 8) & 0xff;
  payload.set(imageBytes, 2);
  return encodeTagRecord(DefineBitsJPEG2, payload);
}

// ---------------------------------------------------------------------------
// DefineBitsJPEG3 encoder (tag 35)
// ---------------------------------------------------------------------------

/**
 * Encode a DefineBitsJPEG3 (tag 35) tag body.
 * Use when a bitmap has transparency (alpha channel data).
 *
 * Format:
 *   UI16 CharacterId
 *   UI32 AlphaDataOffset  — byte length of the JPEG data
 *   [JPEG bytes]          — standard JPEG image data
 *   [Zlib-compressed alpha bytes] — one byte per pixel, row-major
 *
 * @param charId - character ID
 * @param jpegBytes - raw JPEG image bytes (without JPEG header table)
 * @param alphaBytes - uncompressed alpha channel, one byte per pixel, row-major
 */
export function encodeDefineBitsJpeg3(
  charId: number,
  jpegBytes: Uint8Array,
  alphaBytes: Uint8Array
): Uint8Array {
  const DefineBitsJPEG3 = 35;
  const compressedAlpha = deflateSync(alphaBytes);

  // Build tag body
  const body = new Uint8Array(2 + 4 + jpegBytes.length + compressedAlpha.length);
  const view = new DataView(body.buffer);
  view.setUint16(0, charId, true);           // UI16 LE CharacterId
  view.setUint32(2, jpegBytes.length, true); // UI32 LE AlphaDataOffset
  body.set(jpegBytes, 6);
  body.set(compressedAlpha, 6 + jpegBytes.length);

  return encodeTagRecord(DefineBitsJPEG3, body);
}

// ---------------------------------------------------------------------------
// DefineBitsLossless2 encoder (tag 36)
// ---------------------------------------------------------------------------

/**
 * Options for palette-mode (BitmapFormat=3) encoding.
 *
 * Provide this alongside `pixels` to encode as 8-bit indexed color.
 * - `palette`: up to 256 colors, each 4 bytes RGBA.
 * - `indices`: one byte per pixel (row-major), referencing a palette entry.
 */
export interface PaletteOptions {
  /** RGBA color table: colorCount × 4 bytes. Must have 1–256 entries. */
  palette: Uint8Array;
  /** Pixel index data: one UI8 per pixel, width×height entries. */
  indices: Uint8Array;
}

/**
 * Encode a DefineBitsLossless2 tag (tag 36) — lossless bitmap.
 *
 * **Format 5 (32-bit ARGB):** Pass `pixels` only (no `paletteOpts`).
 * The pixel data is ZLIB-compressed before writing.
 *
 * SWF spec layout (format 5):
 *   BitmapId      UI16  — SWF character ID
 *   BitmapFormat  UI8   — 5 = 32-bit ARGB
 *   BitmapWidth   UI16
 *   BitmapHeight  UI16
 *   ZlibBitmapData ZLIB-compressed pixel bytes (ARGB, 4 bytes per pixel)
 *
 * **Format 3 (8-bit indexed):** Pass `paletteOpts` alongside `pixels` (which
 * is ignored in this mode — only `paletteOpts.palette` and
 * `paletteOpts.indices` are used).
 *
 * SWF spec layout (format 3):
 *   BitmapId           UI16
 *   BitmapFormat       UI8   — 3 = 8-bit indexed
 *   BitmapWidth        UI16
 *   BitmapHeight       UI16
 *   BitmapColorTableSize UI8 — colorCount − 1 (e.g., 255 means 256 colors)
 *   ZlibBitmapData = ZLIB( [colorCount × 4-byte RGBA entries]
 *                        + [height rows of width indices, each row padded
 *                           to a multiple of 4 bytes] )
 *
 * @param charId       SWF character ID for this bitmap
 * @param width        Bitmap width in pixels
 * @param height       Bitmap height in pixels
 * @param pixels       Raw ARGB pixel data (format 5) — ignored when paletteOpts provided
 * @param paletteOpts  Optional palette+indices for format 3 (8-bit indexed) encoding
 */
export function encodeDefineBitsLossless2(
  charId: number,
  width: number,
  height: number,
  pixels: Uint8Array,
  paletteOpts?: PaletteOptions
): Uint8Array {
  const DefineBitsLossless2 = 36;

  if (paletteOpts) {
    // -----------------------------------------------------------------------
    // BitmapFormat = 3 (8-bit indexed / palette mode)
    // -----------------------------------------------------------------------
    const BitmapFormat8BitIndexed = 3;
    const { palette, indices } = paletteOpts;
    const colorCount = palette.length / 4;

    if (colorCount < 1 || colorCount > 256 || Math.floor(colorCount) !== colorCount) {
      throw new Error(
        `encodeDefineBitsLossless2: palette must have 1–256 RGBA entries (got ${palette.length} bytes)`
      );
    }
    if (indices.length !== width * height) {
      throw new Error(
        `encodeDefineBitsLossless2: indices.length (${indices.length}) must equal width×height (${width * height})`
      );
    }

    // Each row of indices is padded to a multiple of 4 bytes.
    const rowStride = Math.ceil(width / 4) * 4;
    const uncompressedSize = palette.length + rowStride * height;
    const uncompressed = new Uint8Array(uncompressedSize);

    // Write palette entries
    uncompressed.set(palette, 0);

    // Write index rows with padding
    for (let row = 0; row < height; row++) {
      const srcOffset = row * width;
      const dstOffset = palette.length + row * rowStride;
      uncompressed.set(indices.subarray(srcOffset, srcOffset + width), dstOffset);
      // Padding bytes remain 0 (already initialized)
    }

    const compressed = deflateSync(uncompressed);

    // Tag body:
    //   UI16 charId + UI8 format + UI16 width + UI16 height + UI8 colorTableSize + compressed
    const headerSize = 2 + 1 + 2 + 2 + 1; // 8 bytes
    const body = new Uint8Array(headerSize + compressed.length);
    // BitmapId UI16 LE
    body[0] = charId & 0xff;
    body[1] = (charId >> 8) & 0xff;
    // BitmapFormat UI8
    body[2] = BitmapFormat8BitIndexed;
    // BitmapWidth UI16 LE
    body[3] = width & 0xff;
    body[4] = (width >> 8) & 0xff;
    // BitmapHeight UI16 LE
    body[5] = height & 0xff;
    body[6] = (height >> 8) & 0xff;
    // BitmapColorTableSize UI8 = colorCount − 1
    body[7] = (colorCount - 1) & 0xff;
    // ZlibBitmapData
    body.set(compressed, headerSize);

    return encodeTagRecord(DefineBitsLossless2, body);
  }

  // -------------------------------------------------------------------------
  // BitmapFormat = 5 (32-bit ARGB) — original path
  // -------------------------------------------------------------------------
  const BitmapFormat32BitARGB = 5;

  // ZLIB-compress the pixel data
  const compressed = deflateSync(pixels);

  // Build the tag body:
  //   UI16 charId + UI8 format + UI16 width + UI16 height + compressed bytes
  const headerSize = 2 + 1 + 2 + 2; // 7 bytes
  const body = new Uint8Array(headerSize + compressed.length);
  // BitmapId UI16 LE
  body[0] = charId & 0xff;
  body[1] = (charId >> 8) & 0xff;
  // BitmapFormat UI8
  body[2] = BitmapFormat32BitARGB;
  // BitmapWidth UI16 LE
  body[3] = width & 0xff;
  body[4] = (width >> 8) & 0xff;
  // BitmapHeight UI16 LE
  body[5] = height & 0xff;
  body[6] = (height >> 8) & 0xff;
  // ZlibBitmapData
  body.set(compressed, headerSize);

  return encodeTagRecord(DefineBitsLossless2, body);
}

// ---------------------------------------------------------------------------
// JPEG EOI helper
// ---------------------------------------------------------------------------

/**
 * Ensure a JPEG byte stream ends with the End-Of-Image marker (0xFF 0xD9).
 *
 * Some JPEG encoders and FLA Media streams omit the trailing EOI marker.
 * Ruffle (render/src/utils.rs) logs a warning and may fail to decode such
 * streams. This function appends the 2-byte EOI if it is missing.
 *
 * Non-JPEG data (e.g. PNG, starting with 0x89) is returned unchanged.
 */
export function ensureJpegEOI(data: Uint8Array): Uint8Array {
  // Only process JPEG data (SOI marker: 0xFF 0xD8)
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) {
    return data;
  }
  // Already has EOI marker
  if (data.length >= 2 && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9) {
    return data;
  }
  const result = new Uint8Array(data.length + 2);
  result.set(data);
  result[data.length] = 0xff;
  result[data.length + 1] = 0xd9;
  return result;
}

// ---------------------------------------------------------------------------
// Data URI helper
// ---------------------------------------------------------------------------

/**
 * Decode a base64 data URI to raw bytes.
 * Handles "data:<mime>;base64,<data>" format.
 * Returns an empty Uint8Array if the URI is empty or malformed.
 */
export function dataUriToBytes(dataUri: string): Uint8Array {
  if (!dataUri) return new Uint8Array(0);
  const commaIdx = dataUri.indexOf(",");
  if (commaIdx < 0) return new Uint8Array(0);
  const base64 = dataUri.slice(commaIdx + 1);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
}
