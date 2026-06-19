/**
 * SWF video tag encoders + FLV demuxer.
 *
 * Implements:
 *   - DefineVideoStream (tag 60) — declares a video character (id, dims, codec).
 *   - VideoFrame        (tag 61) — delivers one compressed video frame.
 *
 * Byte layouts verified against ruffle/swf/src/{read,write}.rs:
 *
 *   DefineVideoStream body (10 bytes):
 *     UI16 CharacterID
 *     UI16 NumFrames
 *     UI16 Width
 *     UI16 Height
 *     UI8  Flags = (Deblocking << 1) | IsSmoothed   (top 4 bits reserved)
 *     UI8  CodecID
 *
 *   VideoFrame body:
 *     UI16 StreamID   (references the DefineVideoStream CharacterID)
 *     UI16 FrameNum   (0-based)
 *     BYTE[] VideoData (raw compressed video payload for this frame)
 */

// ---------------------------------------------------------------------------
// Codec IDs (match ruffle VideoCodec enum)
// ---------------------------------------------------------------------------

export const VideoCodec = {
  None: 0,
  H263: 2, // Sorenson Spark / H.263
  ScreenVideo: 3,
  Vp6: 4, // On2 VP6
  Vp6WithAlpha: 5,
  ScreenVideoV2: 6,
  H264: 7,
} as const;

export type VideoCodecId = (typeof VideoCodec)[keyof typeof VideoCodec];

/** Map an FLV video tag CodecId nibble to an SWF DefineVideoStream CodecID. */
export function flvCodecToSwfCodec(flvCodec: number): number {
  // FLV video CodecId values (per the FLV spec) line up 1:1 with SWF except
  // VP6alpha which FLV stores as 5 too. Pass through; default to H263.
  switch (flvCodec) {
    case 2:
      return VideoCodec.H263;
    case 3:
      return VideoCodec.ScreenVideo;
    case 4:
      return VideoCodec.Vp6;
    case 5:
      return VideoCodec.Vp6WithAlpha;
    case 6:
      return VideoCodec.ScreenVideoV2;
    case 7:
      return VideoCodec.H264;
    default:
      return VideoCodec.H263;
  }
}

// ---------------------------------------------------------------------------
// Tag encoders
// ---------------------------------------------------------------------------

/**
 * Encode the body of a DefineVideoStream (tag 60) record (10 bytes).
 *
 * @param id         SWF character ID for the video stream
 * @param numFrames  number of video frames the stream will deliver
 * @param width      frame width in pixels
 * @param height     frame height in pixels
 * @param codecId    SWF CodecID (see VideoCodec)
 * @param opts       optional deblocking (0..5) / smoothing flags
 */
export function encodeDefineVideoStream(
  id: number,
  numFrames: number,
  width: number,
  height: number,
  codecId: number,
  opts?: { deblocking?: number; smoothing?: boolean }
): Uint8Array {
  const body = new Uint8Array(10);
  const view = new DataView(body.buffer);
  view.setUint16(0, id & 0xffff, true);
  view.setUint16(2, numFrames & 0xffff, true);
  view.setUint16(4, width & 0xffff, true);
  view.setUint16(6, height & 0xffff, true);
  const deblocking = (opts?.deblocking ?? 0) & 0b111;
  const smoothing = opts?.smoothing ? 1 : 0;
  // Flags byte: VideoFlagsReserved(4) | Deblocking(3) | Smoothing(1)
  body[8] = (deblocking << 1) | smoothing;
  body[9] = codecId & 0xff;
  return body;
}

/**
 * Encode the body of a VideoFrame (tag 61) record.
 *
 * @param streamId   the DefineVideoStream CharacterID this frame belongs to
 * @param frameNum   0-based frame index
 * @param videoData  raw compressed video payload for this frame
 */
export function encodeVideoFrame(
  streamId: number,
  frameNum: number,
  videoData: Uint8Array
): Uint8Array {
  const body = new Uint8Array(4 + videoData.length);
  const view = new DataView(body.buffer);
  view.setUint16(0, streamId & 0xffff, true);
  view.setUint16(2, frameNum & 0xffff, true);
  body.set(videoData, 4);
  return body;
}

// ---------------------------------------------------------------------------
// FLV demuxer
// ---------------------------------------------------------------------------

export interface FlvVideoFrame {
  /** 0-based sequential index among video frames. */
  frameNum: number;
  /** FLV CodecId nibble of this video tag. */
  codecId: number;
  /** Frame type nibble (1 = keyframe, 2 = inter, ...). */
  frameType: number;
  /** Raw video payload (the full FLV VIDEODATA including the type/codec byte). */
  data: Uint8Array;
}

export interface FlvVideoStream {
  /** Codec of the first video frame (used for DefineVideoStream). */
  codecId: number;
  frames: FlvVideoFrame[];
  /** Frame width extracted from the FLV metadata or codec bitstream (falls back to 320). */
  width: number;
  /** Frame height extracted from the FLV metadata or codec bitstream (falls back to 240). */
  height: number;
}

const FLV_TAG_VIDEO = 9;
const FLV_TAG_SCRIPT = 18;

// ---------------------------------------------------------------------------
// FLV metadata (onMetaData AMF0 Script tag) dimension extractor
// ---------------------------------------------------------------------------

/**
 * Attempt to read width and height from an FLV script (onMetaData) tag.
 *
 * The first script tag in most FLV files carries an AMF0 ECMA-Array with
 * "width" and "height" keys encoded as AMF0 Number (IEEE-754 double).
 *
 * AMF0 layout of the payload:
 *   UI8(0x02) + UI16-BE(len) + "onMetaData"   — string marker
 *   UI8(0x08) + UI32-BE(count)                — ECMA-array marker
 *   [ UI16-BE(keyLen) + key + AMF0-value ]*   — key-value pairs
 */
function parseFlvMetaDims(
  buf: Uint8Array
): { width: number; height: number } | null {
  // Payload must start with AMF0 String "onMetaData" (type 0x02).
  if (buf.length < 3 || buf[0] !== 0x02) return null;
  const strLen = (buf[1] << 8) | buf[2];
  const strEnd = 3 + strLen;
  if (strEnd > buf.length) return null;
  // Check that the string is "onMetaData"
  const onMetaData = "onMetaData";
  if (strLen !== onMetaData.length) return null;
  for (let i = 0; i < strLen; i++) {
    if (buf[3 + i] !== onMetaData.charCodeAt(i)) return null;
  }

  // Next must be AMF0 ECMA-Array (type 0x08).
  let pos = strEnd;
  if (pos + 5 > buf.length || buf[pos] !== 0x08) return null;
  // Skip type byte + 4-byte array count.
  pos += 5;

  let foundWidth: number | null = null;
  let foundHeight: number | null = null;

  // Walk key-value pairs until we find width/height or hit the end marker.
  while (pos + 2 <= buf.length) {
    const keyLen = (buf[pos] << 8) | buf[pos + 1];
    pos += 2;

    // End marker: key length 0 followed by type 0x09.
    if (keyLen === 0) break;

    if (pos + keyLen > buf.length) break;
    let key = "";
    for (let i = 0; i < keyLen; i++) {
      key += String.fromCharCode(buf[pos + i]!);
    }
    pos += keyLen;

    if (pos >= buf.length) break;
    const valueType = buf[pos++];

    if (valueType === 0x00 /* AMF0 Number — IEEE-754 double BE */) {
      if (pos + 8 > buf.length) break;
      const view = new DataView(
        buf.buffer,
        buf.byteOffset + pos,
        8
      );
      const value = view.getFloat64(0, false /* big-endian */);
      pos += 8;
      if (key === "width") foundWidth = value;
      else if (key === "height") foundHeight = value;
    } else if (valueType === 0x02 /* AMF0 String */) {
      if (pos + 2 > buf.length) break;
      const sLen = (buf[pos] << 8) | buf[pos + 1];
      pos += 2 + sLen;
    } else if (valueType === 0x01 /* AMF0 Boolean */) {
      pos += 1;
    } else {
      // Unknown type — stop parsing (we can't know the length).
      break;
    }

    if (foundWidth !== null && foundHeight !== null) {
      const w = Math.round(foundWidth);
      const h = Math.round(foundHeight);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
  }

  if (foundWidth !== null && foundHeight !== null) {
    const w = Math.round(foundWidth);
    const h = Math.round(foundHeight);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sorenson H.263 bitstream dimension extractor
// ---------------------------------------------------------------------------

/**
 * Extract frame dimensions from the first Sorenson H.263 video frame payload.
 *
 * `videoData` is the full FLV VIDEODATA bytes (including the leading
 * FrameType/CodecId byte at offset 0).  The actual H.263 bitstream begins
 * at offset 1.
 *
 * Sorenson H.263 picture header layout (bit-level):
 *   [17 bits]  PSC (picture start code: 16 zeros + 1)
 *   [5 bits]   Version (gob_id)
 *   [8 bits]   Temporal reference
 *   [3 bits]   psize (picture format):
 *                0 = custom,  next 8 bits = width,  next 8 bits = height
 *                1 = custom,  next 16 bits = width, next 16 bits = height
 *                2 = CIF      352×288
 *                3 = QCIF     176×144
 *                4 = Sub-QCIF 128×96
 *                5 = 320×240
 *                6 = 160×120
 *                7 = reserved
 *
 * Verified against h263-rs/h263/src/parser/picture.rs decode_sorenson_ptype().
 */
function parseH263Dims(
  videoData: Uint8Array
): { width: number; height: number } | null {
  // The H.263 bitstream starts at byte 1 (byte 0 is the FLV FrameType/CodecId).
  if (videoData.length < 5) return null;

  // Build a simple bit reader over the H.263 payload (byte 1 onward).
  const payload = videoData;
  const payloadStart = 1; // skip FLV FrameType/CodecId byte

  let bytePos = payloadStart;
  let bitPos = 0; // bit offset within the current byte (0 = MSB)

  function readBits(n: number): number {
    let result = 0;
    for (let i = 0; i < n; i++) {
      if (bytePos >= payload.length) return -1;
      const bit = (payload[bytePos]! >> (7 - bitPos)) & 1;
      result = (result << 1) | bit;
      bitPos++;
      if (bitPos === 8) {
        bitPos = 0;
        bytePos++;
      }
    }
    return result;
  }

  // Scan for PSC: 17 bits where the value equals 1 (i.e., 16 zeros then a 1).
  // In practice the PSC is at bit 0 for well-formed streams.
  let pscFound = false;
  const maxScanBits = Math.min((payload.length - payloadStart) * 8, 64);
  for (let skip = 0; skip <= maxScanBits; skip++) {
    // Reset read position to `skip` bits from the H.263 payload start.
    bytePos = payloadStart + Math.floor(skip / 8);
    bitPos = skip % 8;

    const psc = readBits(17);
    if (psc === 1) {
      pscFound = true;
      // Reader is now positioned right after the PSC.
      break;
    }
  }
  if (!pscFound) return null;

  // Skip version (5 bits) + temporal reference (8 bits) = 13 bits.
  if (readBits(13) === -1) return null;

  // Read 3-bit psize field.
  const psize = readBits(3);
  if (psize === -1) return null;

  switch (psize) {
    case 0: {
      // Custom: 8-bit width, 8-bit height.
      const w = readBits(8);
      const h = readBits(8);
      if (w <= 0 || h <= 0) return null;
      return { width: w, height: h };
    }
    case 1: {
      // Custom: 16-bit width, 16-bit height.
      const w = readBits(16);
      const h = readBits(16);
      if (w <= 0 || h <= 0) return null;
      return { width: w, height: h };
    }
    case 2: return { width: 352, height: 288 }; // CIF
    case 3: return { width: 176, height: 144 }; // QCIF
    case 4: return { width: 128, height: 96 };  // Sub-QCIF
    case 5: return { width: 320, height: 240 }; // 320×240
    case 6: return { width: 160, height: 120 }; // 160×120
    default: return null; // reserved
  }
}

/**
 * Demux an FLV byte buffer into its video frames.
 *
 * Returns null if the buffer is not a valid FLV (missing "FLV" signature) or
 * has no video tags.
 *
 * FLV layout:
 *   Header:  "FLV" (3) | version (1) | flags (1) | DataOffset UI32-BE (4)
 *   Then a stream of: PreviousTagSize UI32-BE, then a tag:
 *     TagType UI8 | DataSize UI24-BE | Timestamp UI24-BE | TimestampExt UI8 |
 *     StreamID UI24-BE | Data[DataSize]
 *
 * Dimensions are extracted by (in priority order):
 *   1. FLV Script tag onMetaData (works for any codec)
 *   2. Sorenson H.263 bitstream header (codecId = 2)
 *   3. Fallback: 320×240
 */
export function demuxFlv(buf: Uint8Array): FlvVideoStream | null {
  if (buf.length < 9) return null;
  // Signature "FLV"
  if (buf[0] !== 0x46 || buf[1] !== 0x4c || buf[2] !== 0x56) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataOffset = view.getUint32(5, false /* big-endian */);
  let pos = dataOffset >= 9 ? dataOffset : 9;

  const frames: FlvVideoFrame[] = [];
  let metaDims: { width: number; height: number } | null = null;

  // First PreviousTagSize (UI32) precedes the first real tag.
  pos += 4;

  while (pos + 11 <= buf.length) {
    const tagType = buf[pos];
    const dataSize =
      (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const dataStart = pos + 11; // 1 + 3 + 3 + 1 + 3
    const dataEnd = dataStart + dataSize;
    if (dataEnd > buf.length) break;

    if (tagType === FLV_TAG_SCRIPT && dataSize > 0 && metaDims === null) {
      // Try to extract width/height from the onMetaData script tag.
      metaDims = parseFlvMetaDims(buf.slice(dataStart, dataEnd));
    } else if (tagType === FLV_TAG_VIDEO && dataSize > 0) {
      const flags = buf[dataStart];
      const frameType = (flags >> 4) & 0x0f;
      const codecId = flags & 0x0f;
      // VideoData = the entire FLV video payload (Ruffle's video decoders
      // expect the FrameType/CodecId byte to be present).
      const data = buf.slice(dataStart, dataEnd);
      frames.push({ frameNum: frames.length, codecId, frameType, data });
    }

    // Advance past this tag and its trailing PreviousTagSize (UI32).
    pos = dataEnd + 4;
  }

  if (frames.length === 0) return null;

  const codecId = frames[0]!.codecId;

  // Determine dimensions: metadata > bitstream > fallback.
  let width = 320;
  let height = 240;
  if (metaDims !== null) {
    width = metaDims.width;
    height = metaDims.height;
  } else if (codecId === 2 /* Sorenson H.263 */) {
    const dims = parseH263Dims(frames[0]!.data);
    if (dims !== null) {
      width = dims.width;
      height = dims.height;
    }
  }

  return { codecId, frames, width, height };
}

// ---------------------------------------------------------------------------
// FLV probe (Import Video wizard)
// ---------------------------------------------------------------------------

/** Human-readable codec label for a SWF/FLV CodecID (used by the import wizard). */
export function videoCodecName(codecId: number): string {
  switch (codecId) {
    case VideoCodec.None:
      return "None";
    case VideoCodec.H263:
      return "Sorenson Spark (H.263)";
    case VideoCodec.ScreenVideo:
      return "Screen Video";
    case VideoCodec.Vp6:
      return "On2 VP6";
    case VideoCodec.Vp6WithAlpha:
      return "On2 VP6 (alpha)";
    case VideoCodec.ScreenVideoV2:
      return "Screen Video V2";
    case VideoCodec.H264:
      return "H.264";
    default:
      return `Unknown (${codecId})`;
  }
}

/**
 * Lenient scan for a single AMF0 Number keyed by `wantKey` inside an FLV
 * `onMetaData` script-tag payload. Unlike `parseFlvMetaDims` (which bails on
 * any unrecognized AMF0 type), this walks the whole buffer looking for the
 * `UI16(len) + key + UI8(0x00) + Float64-BE` signature, so it survives arrays
 * that interleave types it doesn't model. Returns null if not found.
 */
function scanFlvMetaNumber(buf: Uint8Array, wantKey: string): number | null {
  const keyBytes: number[] = [];
  for (let i = 0; i < wantKey.length; i++) keyBytes.push(wantKey.charCodeAt(i));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const limit = buf.length - (2 + wantKey.length + 1 + 8);
  for (let p = 0; p <= limit; p++) {
    const keyLen = (buf[p]! << 8) | buf[p + 1]!;
    if (keyLen !== wantKey.length) continue;
    let match = true;
    for (let i = 0; i < keyLen; i++) {
      if (buf[p + 2 + i] !== keyBytes[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const typePos = p + 2 + keyLen;
    if (buf[typePos] !== 0x00 /* AMF0 Number */) continue;
    const value = view.getFloat64(typePos + 1, false /* big-endian */);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** Result of probing a video container for the Import Video wizard. */
export interface VideoProbe {
  /** SWF/FLV CodecID of the video stream. */
  codecId: number;
  /** Human-readable codec label. */
  codecName: string;
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Number of decoded video frames. */
  frameCount: number;
  /** Frame rate from FLV metadata, or null if not present. */
  frameRate: number | null;
}

/**
 * Probe a video container for the Import Video wizard.
 *
 * For FLV input this demuxes the stream and reads `framerate` from the
 * `onMetaData` script tag. Returns `null` for non-FLV / undecodable input
 * (the wizard falls back to user-editable defaults in that case).
 */
export function probeFlv(buf: Uint8Array): VideoProbe | null {
  const stream = demuxFlv(buf);
  if (!stream) return null;

  // framerate lives in the onMetaData Script tag (AMF0 Number).
  let frameRate: number | null = null;
  // Re-walk the FLV looking at the first Script tag for `framerate`.
  if (buf.length >= 9 && buf[0] === 0x46 && buf[1] === 0x4c && buf[2] === 0x56) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dataOffset = view.getUint32(5, false);
    let pos = (dataOffset >= 9 ? dataOffset : 9) + 4;
    while (pos + 11 <= buf.length) {
      const tagType = buf[pos]!;
      const dataSize =
        (buf[pos + 1]! << 16) | (buf[pos + 2]! << 8) | buf[pos + 3]!;
      const dataStart = pos + 11;
      const dataEnd = dataStart + dataSize;
      if (dataEnd > buf.length) break;
      if (tagType === FLV_TAG_SCRIPT && dataSize > 0) {
        const fr = scanFlvMetaNumber(buf.slice(dataStart, dataEnd), "framerate");
        if (fr !== null && fr > 0 && fr <= 240) {
          frameRate = Math.round(fr * 1000) / 1000;
          break;
        }
      }
      pos = dataEnd + 4;
    }
  }

  return {
    codecId: stream.codecId,
    codecName: videoCodecName(stream.codecId),
    width: stream.width,
    height: stream.height,
    frameCount: stream.frames.length,
    frameRate,
  };
}
