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
 * Encode a DefineBitsLossless2 tag (tag 36) — lossless ARGB bitmap.
 *
 * Uses BitmapFormat 5 (32-bit ARGB). The pixel data is ZLIB-compressed before
 * writing.
 *
 * SWF spec layout:
 *   BitmapId      UI16  — SWF character ID
 *   BitmapFormat  UI8   — 5 = 32-bit ARGB
 *   BitmapWidth   UI16
 *   BitmapHeight  UI16
 *   ZlibBitmapData ZLIB-compressed pixel bytes (ARGB, 4 bytes per pixel)
 *
 * @param charId  SWF character ID for this bitmap
 * @param width   Bitmap width in pixels
 * @param height  Bitmap height in pixels
 * @param pixels  Raw ARGB pixel data (4 bytes per pixel, width×height pixels)
 */
export function encodeDefineBitsLossless2(
  charId: number,
  width: number,
  height: number,
  pixels: Uint8Array
): Uint8Array {
  const DefineBitsLossless2 = 36;
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
