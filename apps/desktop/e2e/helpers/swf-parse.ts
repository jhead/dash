/**
 * SWF structural byte-parsing helpers for the e2e oracle suite (task 1214).
 *
 * `__flashTest.publish()` returns a COMPRESSED CWS SWF by default
 * (publishSettings.compress = true in Shell.tsx). The structural oracle tests
 * walk the SWF tag stream by hand to assert tag-level structure, but they used
 * to start reading at byte 8 of the RAW file — which, for a CWS, is the start of
 * the zlib-compressed body. Reading those compressed bytes as tag records yields
 * garbage tag types (e.g. 811, 369, 401 — none valid SWF tags), so the parsers
 * never found the real tags and the tests gave ZERO real coverage while failing.
 *
 * The SWF header is 8 bytes UNCOMPRESSED in every variant:
 *   bytes 0..2  signature  'FWS' (uncompressed) | 'CWS' (zlib) | 'ZWS' (LZMA)
 *   byte  3     version
 *   bytes 4..7  FileLength UI32 (total uncompressed size incl. header)
 * For CWS the bytes from offset 8 onward are a zlib stream of the rest of the
 * file body (FrameSize RECT, FrameRate, FrameCount, then the tag stream).
 *
 * `decompressSwf()` returns a Buffer that always looks like an FWS: the original
 * 8-byte header (signature rewritten to 'FWS') followed by the inflated body, so
 * downstream tag-walking at offset 8 works uniformly for FWS and CWS input.
 */

import { inflateSync } from 'node:zlib';

/** Decompress a CWS (zlib) SWF to its uncompressed FWS-equivalent bytes.
 *  FWS input is returned unchanged. Throws on the (unsupported) ZWS/LZMA form. */
export function decompressSwf(bytes: Buffer): Buffer {
  if (bytes.length < 8) {
    throw new Error(`SWF too short: ${bytes.length} bytes`);
  }
  const sig = bytes.toString('latin1', 0, 3);
  if (sig === 'FWS') {
    return bytes;
  }
  if (sig === 'CWS') {
    const header = Buffer.from(bytes.subarray(0, 8));
    header[0] = 0x46; // 'F' — present the result as an FWS for uniform walking
    const body = inflateSync(bytes.subarray(8));
    return Buffer.concat([header, body]);
  }
  if (sig === 'ZWS') {
    throw new Error('ZWS (LZMA) SWF compression is not supported by the e2e harness');
  }
  throw new Error(`unrecognized SWF signature: ${JSON.stringify(sig)}`);
}

/** A parsed SWF tag: numeric type and its raw (uncompressed) body bytes. */
export interface SwfTag {
  type: number;
  body: Buffer;
}

/**
 * Parse the SWF tag stream. Accepts EITHER a raw CWS/FWS file (it decompresses
 * CWS automatically) or an already-decompressed FWS buffer.
 */
export function parseSwfTags(rawOrDecompressed: Buffer): SwfTag[] {
  const bytes = decompressSwf(rawOrDecompressed);

  let offset = 8;
  // Skip FrameSize RECT (Nbits in the top 5 bits of the first byte).
  const nBits = (bytes[offset]! >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + 4 * nBits) / 8);
  offset += rectBytes + 4; // FrameRate UI16 + FrameCount UI16

  const tags: SwfTag[] = [];
  while (offset <= bytes.length - 2) {
    const tagWord = bytes.readUInt16LE(offset);
    const tagType = tagWord >> 6;
    const tagShortLen = tagWord & 0x3f;
    offset += 2;
    let tagLen = tagShortLen;
    if (tagShortLen === 0x3f) {
      if (offset + 4 > bytes.length) break;
      tagLen = bytes.readUInt32LE(offset);
      offset += 4;
    }
    tags.push({ type: tagType, body: bytes.subarray(offset, offset + tagLen) });
    offset += tagLen;
    if (tagType === 0) break; // End tag
  }
  return tags;
}
