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

/**
 * Parse a RAW tag stream (no SWF header / FrameSize prefix) starting at `start`.
 * Used to walk the nested control-tag stream inside a DefineSprite body.
 */
function parseTagStream(bytes: Buffer, start: number): SwfTag[] {
  let offset = start;
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
    if (tagType === 0) break; // End tag terminates the sprite stream
  }
  return tags;
}

/**
 * Parse every top-level tag PLUS the nested control tags inside each
 * DefineSprite (tag 39). A DefineSprite body is `UI16 spriteId, UI16 frameCount`
 * then its own tag stream — so a symbol-internal PlaceObject3 (the sprite.ts
 * emit path) lives there, not at top level. Returns the flattened union so an
 * oracle can find a sprite-internal placement with the same finder it uses for
 * scene-level placements (task 1372).
 */
export function parseSwfTagsDeep(rawOrDecompressed: Buffer): SwfTag[] {
  const top = parseSwfTags(rawOrDecompressed);
  const out: SwfTag[] = [];
  for (const tag of top) {
    out.push(tag);
    if (tag.type === 39) {
      // DefineSprite: skip spriteId (UI16) + frameCount (UI16), then walk nested.
      out.push(...parseTagStream(tag.body, 4));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PlaceObject3 FILTERLIST decoder (task 1242)
// ---------------------------------------------------------------------------

/**
 * A decoded FILTERLIST entry: its FilterID (0..7) and the raw body bytes that
 * follow the id byte (so callers can spot-check field values for the
 * "filter present but corrupted" regression class, e.g. task 1236).
 */
export interface DecodedFilter {
  id: number;
  body: Buffer;
}

/**
 * Decoded PlaceObject3 (tag 70): whether it carried a FILTERLIST and, if so,
 * the decoded filters. The multi-flag fields (task 1372) record whether the
 * HasBlendMode / HasCacheAsBitmap bits of flags2 were set and, when present, the
 * trailing BlendMode UI8 and is_bitmap_cached UI8 values — so an oracle can pin
 * that a single PlaceObject3 carried filters + blend + cacheAsBitmap together,
 * in the exact encoder field order, with no parse drift.
 */
export interface DecodedPlaceObject3 {
  hasFilterList: boolean;
  hasBlendMode: boolean;
  hasCacheAsBitmap: boolean;
  filters: DecodedFilter[];
  /** BlendMode UI8 (only meaningful when hasBlendMode); undefined otherwise. */
  blendMode?: number;
  /** is_bitmap_cached UI8 (only meaningful when hasCacheAsBitmap); undefined otherwise. */
  isBitmapCached?: number;
}

/**
 * Byte length of a single FILTERLIST entry's BODY (everything after its 1-byte
 * FilterID), keyed by FilterID. Mirrors the encoder layouts in
 * packages/swf/src/filters.ts. For the variable-length gradient (4/7) and
 * convolution (5) filters the size depends on a count byte read from `body`.
 *
 * Returns the body byte length, or throws if the id is unknown (so a corrupted
 * list fails loudly rather than mis-aligning).
 */
function filterBodyLen(id: number, body: Buffer, at: number): number {
  switch (id) {
    // DropShadow (0): RGBA(4) + blurX(4) + blurY(4) + angle(4) + distance(4)
    //   + strength(2) + flags(1) = 23
    case 0: return 23;
    // Blur (1): blurX(4) + blurY(4) + flags(1) = 9
    case 1: return 9;
    // Glow (2): RGBA(4) + blurX(4) + blurY(4) + strength(2) + flags(1) = 15
    case 2: return 15;
    // Bevel (3): RGBA highlight(4) + RGBA shadow(4) + blurX(4) + blurY(4)
    //   + angle(4) + distance(4) + strength(2) + flags(1) = 27
    case 3: return 27;
    // GradientGlow (4) / GradientBevel (7): numColors(1) + N*RGBA(4) + N*ratio(1)
    //   + blurX(4) + blurY(4) + angle(4) + distance(4) + strength(2) + flags(1)
    case 4:
    case 7: {
      const n = body[at]; // numColors (the first body byte)
      return 1 + n * 4 + n * 1 + 4 + 4 + 4 + 4 + 2 + 1;
    }
    // Convolution (5): matrixX(1) + matrixY(1) + divisor(4) + bias(4)
    //   + (mx*my)*FLOAT(4) + defaultColor RGBA(4) + flags(1)
    case 5: {
      const mx = body[at];
      const my = body[at + 1];
      return 1 + 1 + 4 + 4 + mx * my * 4 + 4 + 1;
    }
    // ColorMatrix / AdjustColor (6): 20 * FLOAT(4) = 80
    case 6: return 80;
    default:
      throw new Error(`unknown SWF FilterID ${id} in FILTERLIST`);
  }
}

/**
 * Decode the FILTERLIST out of a PlaceObject3 (tag 70) body, walking the
 * flag-gated optional fields exactly as the encoder writes them
 * (packages/swf/src/filters.ts encodePlaceObject3WithFilters).
 *
 * This is the structural guard for the 3 filter types Ruffle 0.2.0 has no
 * renderer for (GradientGlow/GradientBevel/Convolution): it proves the filter
 * actually survives the full publish path into the SWF with HasFilterList set
 * and the correct FilterID + fields — i.e. it catches the task-1238 (filter
 * dropped at the PlaceObject3 flag) and task-1236 (wrong filter fields) classes
 * that a Ruffle pixel oracle cannot, because Ruffle silently no-ops them.
 */
export function decodePlaceObject3(body: Buffer): DecodedPlaceObject3 {
  let p = 0;
  const flags1 = body[p++];
  const flags2 = body[p++];
  const hasMove = (flags1 & (1 << 0)) !== 0;
  const hasCharacter = (flags1 & (1 << 1)) !== 0;
  const hasMatrix = (flags1 & (1 << 2)) !== 0;
  const hasCXForm = (flags1 & (1 << 3)) !== 0;
  const hasRatio = (flags1 & (1 << 4)) !== 0;
  const hasName = (flags1 & (1 << 5)) !== 0;
  // flags2 (high byte of the LE u16 PlaceFlag), per packages/swf/src/filters.ts:
  //   bit 0 (0x01): HasFilterList, bit 1 (0x02): HasBlendMode,
  //   bit 2 (0x04): HasCacheAsBitmap.
  const hasFilterList = (flags2 & (1 << 0)) !== 0;
  const hasBlendMode = (flags2 & (1 << 1)) !== 0;
  const hasCacheAsBitmap = (flags2 & (1 << 2)) !== 0;

  p += 2; // Depth UI16
  if (hasCharacter && !hasMove) p += 2; // CharacterId UI16

  // --- MATRIX (bit-packed) ---
  if (hasMatrix) {
    let bitPos = p * 8;
    const readBits = (n: number): number => {
      let v = 0;
      for (let i = 0; i < n; i++) {
        const byteIdx = bitPos >> 3;
        const bit = (body[byteIdx] >> (7 - (bitPos & 7))) & 1;
        v = (v << 1) | bit;
        bitPos++;
      }
      return v;
    };
    const hasScale = readBits(1);
    if (hasScale) { const nb = readBits(5); readBits(nb); readBits(nb); }
    const hasRotate = readBits(1);
    if (hasRotate) { const nb = readBits(5); readBits(nb); readBits(nb); }
    const nbT = readBits(5); readBits(nbT); readBits(nbT); // translate (unconditional)
    p = Math.ceil(bitPos / 8); // byte-align after MATRIX
  }

  // --- CXFORMWITHALPHA (bit-packed) ---
  if (hasCXForm) {
    let bitPos = p * 8;
    const readBits = (n: number): number => {
      let v = 0;
      for (let i = 0; i < n; i++) {
        const byteIdx = bitPos >> 3;
        const bit = (body[byteIdx] >> (7 - (bitPos & 7))) & 1;
        v = (v << 1) | bit;
        bitPos++;
      }
      return v;
    };
    const hasAdd = readBits(1);
    const hasMult = readBits(1);
    const nb = readBits(4);
    const terms = (hasMult ? 4 : 0) + (hasAdd ? 4 : 0);
    for (let i = 0; i < terms; i++) readBits(nb);
    p = Math.ceil(bitPos / 8);
  }

  if (hasRatio) p += 2; // Ratio UI16
  if (hasName) { while (body[p] !== 0) p++; p++; } // null-terminated Name

  const filters: DecodedFilter[] = [];
  if (hasFilterList) {
    const count = body[p++];
    for (let i = 0; i < count; i++) {
      const id = body[p++];
      const len = filterBodyLen(id, body, p);
      filters.push({ id, body: body.subarray(p, p + len) });
      p += len;
    }
  }

  // BlendMode UI8 then is_bitmap_cached UI8 — in the exact encoder field order
  // (packages/swf/src/filters.ts encodePlaceObject3WithBlendMode): FILTERLIST,
  // BlendMode, is_bitmap_cached. Reading them here (task 1372) proves the three
  // multi-flag fields co-occur in one PlaceObject3 with no parse drift.
  let blendMode: number | undefined;
  let isBitmapCached: number | undefined;
  if (hasBlendMode) blendMode = body[p++];
  if (hasCacheAsBitmap) isBitmapCached = body[p++];

  return { hasFilterList, hasBlendMode, hasCacheAsBitmap, filters, blendMode, isBitmapCached };
}

/**
 * Find the single PlaceObject3 (tag 70) in a published SWF that carries a
 * FILTERLIST, and return its decoded filters. Throws if there is not exactly
 * one such tag (the structural-oracle fixtures place exactly one filtered shape).
 */
export function findSoleFilteredPlaceObject3(rawSwf: Buffer): DecodedPlaceObject3 {
  const tags = parseSwfTags(rawSwf);
  const withFilters = tags
    .filter((t) => t.type === 70)
    .map((t) => decodePlaceObject3(t.body))
    .filter((d) => d.hasFilterList && d.filters.length > 0);
  if (withFilters.length !== 1) {
    throw new Error(
      `expected exactly 1 PlaceObject3 with a FILTERLIST, found ${withFilters.length}`,
    );
  }
  return withFilters[0];
}

/**
 * Find the single PlaceObject3 (tag 70) carrying ALL THREE of HasFilterList,
 * HasBlendMode and HasCacheAsBitmap (task 1372). Returns every such tag so a
 * multi-flag oracle can assert exactly the expected co-occurrence count (a scene
 * placement, a sprite-internal placement, or a move can each emit one). Throws
 * if there are none — the multi-flag fixtures always place at least one.
 */
export function findMultiFlagPlaceObject3s(rawSwf: Buffer): DecodedPlaceObject3[] {
  const tags = parseSwfTagsDeep(rawSwf);
  const multi = tags
    .filter((t) => t.type === 70)
    .map((t) => decodePlaceObject3(t.body))
    .filter((d) => d.hasFilterList && d.hasBlendMode && d.hasCacheAsBitmap && d.filters.length > 0);
  if (multi.length === 0) {
    throw new Error(
      'expected at least 1 PlaceObject3 with HasFilterList+HasBlendMode+HasCacheAsBitmap, found 0',
    );
  }
  return multi;
}
