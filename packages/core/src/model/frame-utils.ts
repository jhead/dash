/**
 * Frame span utilities.
 *
 * In Flash, a keyframe "owns" all frames from its index up to (but not
 * including) the next keyframe, or the end of the layer if it is the last.
 * These helpers implement that lookup and span-length calculation.
 */

import type { Layer, Frame } from "./types.js";

/**
 * Returns the keyframe that "owns" the given frame index.
 * In Flash, a keyframe spans until the next keyframe or end of layer.
 * Returns undefined if idx is out of range (negative or >= layer.frameCount).
 *
 * @param layer  The layer to search.
 * @param idx    0-based frame index to look up.
 */
export function getFrameAtIndex(layer: Layer, idx: number): Frame | undefined {
  if (idx < 0 || idx >= layer.frameCount) return undefined;
  // Find the last keyframe at or before idx
  let owning: Frame | undefined;
  for (const frame of layer.frames) {
    if (frame.isKeyframe && frame.index <= idx) {
      owning = frame;
    }
  }
  return owning;
}

/**
 * Returns the number of frames this keyframe spans (until the next keyframe
 * or the end of the layer, whichever comes first).
 *
 * Returns 0 if the frame is not found among the layer's keyframes.
 *
 * @param frame  The keyframe whose span to measure.
 * @param layer  The layer that contains the frame.
 */
export function getFrameSpan(frame: Frame, layer: Layer): number {
  // Collect all keyframes sorted by index
  const sorted = [...layer.frames]
    .filter((f) => f.isKeyframe)
    .sort((a, b) => a.index - b.index);

  const thisIdx = sorted.findIndex((f) => f.index === frame.index);
  if (thisIdx === -1) return 0;

  if (thisIdx === sorted.length - 1) {
    // Last keyframe — spans until end of layer
    return layer.frameCount - frame.index;
  }
  // Span ends at the next keyframe
  return sorted[thisIdx + 1].index - frame.index;
}
