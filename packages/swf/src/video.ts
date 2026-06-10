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
}

const FLV_TAG_VIDEO = 9;

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
 */
export function demuxFlv(buf: Uint8Array): FlvVideoStream | null {
  if (buf.length < 9) return null;
  // Signature "FLV"
  if (buf[0] !== 0x46 || buf[1] !== 0x4c || buf[2] !== 0x56) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataOffset = view.getUint32(5, false /* big-endian */);
  let pos = dataOffset >= 9 ? dataOffset : 9;

  const frames: FlvVideoFrame[] = [];

  // First PreviousTagSize (UI32) precedes the first real tag.
  pos += 4;

  while (pos + 11 <= buf.length) {
    const tagType = buf[pos];
    const dataSize =
      (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    const dataStart = pos + 11; // 1 + 3 + 3 + 1 + 3
    const dataEnd = dataStart + dataSize;
    if (dataEnd > buf.length) break;

    if (tagType === FLV_TAG_VIDEO && dataSize > 0) {
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
  return { codecId: frames[0]!.codecId, frames };
}
