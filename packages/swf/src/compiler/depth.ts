/**
 * Depth-assignment helpers.
 *
 * (The full depth pre-pass — stable per-(scene:layer:objId) allocation with
 * mask grouping — is threaded through CompileContext by the orchestrator; this
 * module currently owns the standalone scene frame-count helper.)
 */
import type { Timeline } from "@flash/core";
import { layerFrameCount } from "@flash/core";

/**
 * Return the number of frames in a Timeline (max layer frameCount, min 1).
 */
export function sceneFrameCount(timeline: Timeline): number {
  if (!timeline.layers.length) return 1;
  let max = 1;
  for (const layer of timeline.layers) {
    const count = layerFrameCount(layer);
    if (count > max) max = count;
  }
  return max;
}
