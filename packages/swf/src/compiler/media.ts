/**
 * Audio/video library helpers.
 *
 * (The full sound/video character pre-pass is threaded through CompileContext by
 * the orchestrator; this module currently owns the standalone video-placement
 * transform fit used by the per-frame loop.)
 */
import type { FlashDocument, SoundItem, VideoDisplayObject, VideoItem } from "@flash/core";
import { Tag } from "../tags.js";
import { SwfWriter } from "../writer.js";
import { encodeDefineSound } from "../audio.js";
import { dataUriToBytes } from "../bitmaps.js";
import { encodeDefineVideoStream, demuxFlv, flvCodecToSwfCodec, VideoCodec, type FlvVideoFrame } from "../video.js";

/** A demuxed video stream and its per-SWF-frame payloads. */
export interface VideoStreamInfo {
  /** Library VideoItem id this stream was built from. */
  itemId: string;
  charId: number;
  width: number;
  height: number;
  /** Per-SWF-frame video payloads (one entry per VideoFrame tag to emit). */
  payloads: Uint8Array[];
}

/** Outputs of the sound/video library definition pre-pass. */
export interface MediaPassResult {
  /** The filtered SoundItem library entries (consumed by sound-linkage emit). */
  soundItems: SoundItem[];
  /** SoundItem.id → DefineSound character ID. */
  soundIdMap: Map<string, number>;
  /** VideoItem.id → DefineVideoStream character ID. */
  videoCharIdMap: Map<string, number>;
  /** One entry per emitted DefineVideoStream, with its per-frame payloads. */
  videoStreams: VideoStreamInfo[];
}

/**
 * Emit DefineSound (14) and DefineVideoStream (60) tags for every sound/video
 * library item, BEFORE the symbol loop, so encodeDefineSprite can resolve their
 * character IDs for StartSound / VideoDisplayObject placement inside symbol
 * timelines. The actual per-frame VideoFrame (61) tags are emitted later in the
 * frame loop so they interleave with ShowFrame in playback order.
 */
export function runMediaPass(writer: SwfWriter, doc: FlashDocument): MediaPassResult {
  // Sounds: emit DefineSound and build soundIdMap.
  const soundItems = doc.library.items.filter(
    (item): item is SoundItem => item.itemType === "sound"
  );
  const soundIdMap = new Map<string, number>();
  for (const soundItem of soundItems) {
    if (!soundItem.dataUri) continue;
    const soundId = writer.nextCharId();
    soundIdMap.set(soundItem.id, soundId);
    const soundBody = encodeDefineSound(soundId, soundItem);
    writer.writeTag(Tag.DefineSound, soundBody);
  }

  // Videos: demux FLV, emit DefineVideoStream, collect per-frame payloads.
  const videoItems = doc.library.items.filter(
    (item): item is VideoItem => item.itemType === "video"
  );
  const videoStreams: VideoStreamInfo[] = [];
  const videoCharIdMap = new Map<string, number>();
  for (const videoItem of videoItems) {
    // Attempt to demux the FLV payload from the data URI; fall back to an
    // empty stream so authoring still produces a valid character.
    let flvFrames: FlvVideoFrame[] = [];
    let codecId: number = VideoCodec.H263;
    if (videoItem.dataUri) {
      try {
        const bytes = dataUriToBytes(videoItem.dataUri);
        const flv = demuxFlv(bytes);
        if (flv) {
          flvFrames = flv.frames;
          codecId = flvCodecToSwfCodec(flv.codecId);
        }
      } catch {
        // Malformed data URI — emit an empty stream so compile still succeeds.
      }
    }

    // Build the per-frame payload list. With real demuxed FLV frames we use the
    // decoded video payloads directly. When demux yields nothing (e.g. a stub
    // data URI in authoring), fall back to driving `frameCount` empty-payload
    // VideoFrame tags so the stream is still advanced one frame per ShowFrame.
    let payloads: Uint8Array[];
    if (flvFrames.length > 0) {
      payloads = flvFrames.map((f) => f.data);
    } else {
      const n = Math.max(0, Math.floor(videoItem.frameCount));
      payloads = Array.from({ length: n }, () => new Uint8Array(0));
    }

    const numFrames = payloads.length;
    const charId = writer.nextCharId();
    const width = Math.max(0, Math.round(videoItem.width));
    const height = Math.max(0, Math.round(videoItem.height));
    writer.writeTag(
      Tag.DefineVideoStream,
      encodeDefineVideoStream(charId, numFrames, width, height, codecId)
    );
    videoCharIdMap.set(videoItem.id, charId);
    videoStreams.push({ itemId: videoItem.id, charId, width, height, payloads });
  }

  return { soundItems, soundIdMap, videoCharIdMap, videoStreams };
}

/**
 * Computes the PlaceObject2 transform for a VideoDisplayObject. The
 * DefineVideoStream character has the stream's native pixel dimensions, so we
 * scale it to the requested display width/height, then apply the object's own
 * scaleX/scaleY/rotation on top. Returns `undefined` when the resulting
 * transform is the identity (avoids emitting a redundant HasScale/HasRotate).
 */
export function videoFitTransform(
  vdo: VideoDisplayObject,
  videoStreams: ReadonlyArray<{ itemId: string; width: number; height: number }>
):
  | { scaleX?: number; scaleY?: number; rotation?: number }
  | undefined {
  const stream = videoStreams.find((s) => s.itemId === vdo.videoItemId);
  const nativeW = stream && stream.width > 0 ? stream.width : vdo.width;
  const nativeH = stream && stream.height > 0 ? stream.height : vdo.height;
  const fitX = nativeW > 0 ? vdo.width / nativeW : 1;
  const fitY = nativeH > 0 ? vdo.height / nativeH : 1;
  const scaleX = fitX * (vdo.scaleX ?? 1);
  const scaleY = fitY * (vdo.scaleY ?? 1);
  const rotation = vdo.rotation ?? 0;
  if (scaleX === 1 && scaleY === 1 && rotation === 0) return undefined;
  return { scaleX, scaleY, rotation };
}
