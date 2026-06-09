import type { FlashDocument } from "../model/types.js";

export interface OnionSkinFrame {
  frameIdx: number;
  alpha: number;      // 0.0 to 1.0 render opacity
  isBefore: boolean;  // true = before current frame, false = after
}

export interface OnionSkinOptions {
  before: number;     // how many frames before current to show (default 2)
  after: number;      // how many frames after current to show (default 2)
  onlyKeyframes?: boolean;  // if true, skip interpolated frames
}

/**
 * Returns the set of frame indices to render as onion skin ghosts,
 * along with their opacity. Current frame itself is NOT included.
 *
 * Alpha decreases with distance from current frame:
 *   distance 1 → 0.5
 *   distance 2 → 0.25
 *   distance N → 0.5 / N (minimum 0.1)
 */
export function getOnionSkinFrames(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  currentFrameIdx: number,
  options: OnionSkinOptions
): OnionSkinFrame[] {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return [];

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return [];

  const maxIdx = layer.frameCount - 1;
  const result: OnionSkinFrame[] = [];

  // Helper to compute alpha for a given distance
  function alphaForDistance(distance: number): number {
    return Math.max(0.1, 0.5 / distance);
  }

  // Helper to check if a frame index is a keyframe
  function isKeyframe(idx: number): boolean {
    const frame = layer.frames[idx];
    return frame !== undefined && frame.isKeyframe === true;
  }

  // Frames before current
  for (let d = 1; d <= options.before; d++) {
    const idx = currentFrameIdx - d;
    if (idx < 0) continue;
    if (idx > maxIdx) continue;
    if (options.onlyKeyframes && !isKeyframe(idx)) continue;
    result.push({
      frameIdx: idx,
      alpha: alphaForDistance(d),
      isBefore: true,
    });
  }

  // Frames after current
  for (let d = 1; d <= options.after; d++) {
    const idx = currentFrameIdx + d;
    if (idx < 0) continue;
    if (idx > maxIdx) continue;
    if (options.onlyKeyframes && !isKeyframe(idx)) continue;
    result.push({
      frameIdx: idx,
      alpha: alphaForDistance(d),
      isBefore: false,
    });
  }

  return result;
}

/**
 * Returns an array of frame indices within [currentFrame - before,
 * currentFrame + after], clamped to [0, totalFrames - 1].
 */
export function getOnionSkinRange(
  currentFrame: number,
  before: number,
  after: number,
  totalFrames: number
): number[] {
  const start = Math.max(0, currentFrame - before);
  const end = Math.min(totalFrames - 1, currentFrame + after);
  const result: number[] = [];
  for (let i = start; i <= end; i++) result.push(i);
  return result;
}
