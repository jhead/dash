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

// ---------------------------------------------------------------------------
// Keyframe query helpers
// ---------------------------------------------------------------------------

/**
 * Returns all keyframes in the layer (frames where isKeyframe === true),
 * in the order they appear in layer.frames.
 */
export function getAllKeyframes(layer: Layer): Frame[] {
  return layer.frames.filter((f) => f.isKeyframe);
}

/**
 * Returns the keyframe that owns the given frameIndex — i.e. the latest
 * keyframe at or before frameIndex.
 * Returns undefined if no keyframe exists at or before frameIndex.
 *
 * @param layer       The layer to search.
 * @param frameIndex  0-based frame index.
 */
export function getKeyframeAt(layer: Layer, frameIndex: number): Frame | undefined {
  let owning: Frame | undefined;
  for (const frame of layer.frames) {
    if (frame.isKeyframe && frame.index <= frameIndex) {
      owning = frame;
    }
  }
  return owning;
}

/**
 * Returns the first keyframe with an index strictly greater than frameIndex.
 * Returns undefined if frameIndex is at or past the last keyframe.
 *
 * @param layer       The layer to search.
 * @param frameIndex  0-based frame index.
 */
export function getNextKeyframe(layer: Layer, frameIndex: number): Frame | undefined {
  return layer.frames.find((f) => f.isKeyframe && f.index > frameIndex);
}

/**
 * Returns the last keyframe with an index strictly less than frameIndex.
 * Returns undefined if frameIndex is at or before the first keyframe.
 *
 * @param layer       The layer to search.
 * @param frameIndex  0-based frame index.
 */
export function getPrevKeyframe(layer: Layer, frameIndex: number): Frame | undefined {
  let prev: Frame | undefined;
  for (const frame of layer.frames) {
    if (frame.isKeyframe && frame.index < frameIndex) prev = frame;
  }
  return prev;
}

// ---------------------------------------------------------------------------
// Frame copy / paste helpers
// ---------------------------------------------------------------------------

/**
 * Returns a shallow copy of the frames in [startIndex, endIndex] (inclusive),
 * reindexed so the first returned frame has index 0.
 *
 * @param layer       The layer to copy from.
 * @param startIndex  0-based inclusive start index.
 * @param endIndex    0-based inclusive end index.
 */
export function copyFrames(
  layer: Layer,
  startIndex: number,
  endIndex: number,
): readonly Frame[] {
  return layer.frames
    .slice(startIndex, endIndex + 1)
    .map((f, i) => ({ ...f, index: i }));
}

/**
 * Inserts `frames` into `layer` starting at position `atIndex`, shifting
 * all existing frames at or after `atIndex` to the right.  Returns a new
 * Layer (immutable — the original is not modified).
 *
 * @param layer    The layer to paste into.
 * @param frames   Frames to insert (produced by copyFrames).
 * @param atIndex  0-based insertion point in the destination layer.
 */
export function pasteFrames(
  layer: Layer,
  frames: readonly Frame[],
  atIndex: number,
): Layer {
  const before = layer.frames.slice(0, atIndex);
  const after = layer.frames.slice(atIndex);
  const inserted = frames.map((f, i) => ({ ...f, index: atIndex + i }));
  const reindexedAfter = after.map((f, i) => ({
    ...f,
    index: atIndex + frames.length + i,
  }));
  const allFrames = [...before, ...inserted, ...reindexedAfter];
  return {
    ...layer,
    frames: allFrames,
    frameCount: allFrames.length,
  };
}
