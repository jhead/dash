/**
 * Audio/video library helpers.
 *
 * (The full sound/video character pre-pass is threaded through CompileContext by
 * the orchestrator; this module currently owns the standalone video-placement
 * transform fit used by the per-frame loop.)
 */
import type { VideoDisplayObject } from "@flash/core";

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
