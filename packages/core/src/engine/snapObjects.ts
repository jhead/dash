/**
 * Document-aware snap-to-objects helper.
 *
 * Given a moving object's proposed bounding box, find the closest
 * edge/center alignment with any other object in the same frame and
 * return the snapped position.
 *
 * This is a pure function — no mutations, no side effects.
 */

import type { FlashDocument } from "../model/types.js";
import { getGoverningKeyframe } from "../model/timeline-query.js";
import { getTransformedBounds, type Bounds } from "./bounds.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObjectSnapResult {
  x: number;
  y: number;
  snappedX: boolean; // whether x was snapped
  snappedY: boolean; // whether y was snapped
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Snap a moving object's proposed position to nearby object edges/centers.
 *
 * For X axis: compare left edge, right edge, and horizontal center of the
 * moving object against the same three points of every other object in the
 * frame. The pair with the smallest absolute difference (within `threshold`)
 * wins and the offset is applied to x.
 *
 * Same logic applies independently to Y axis (top, bottom, vertical center).
 *
 * @param doc          The Flash document.
 * @param sceneIdx     0-based scene index.
 * @param layerIdx     0-based layer index within the scene timeline.
 * @param frameIdx     0-based frame index.
 * @param movingObjId  ID of the object being moved (excluded from candidates).
 * @param movingBounds Bounding box at the proposed (not yet snapped) position.
 * @param threshold    Maximum snap distance in pixels (default 5).
 * @returns Snapped position and flags indicating which axes were snapped.
 */
export function snapToObjects(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  movingObjId: string,
  movingBounds: Bounds,
  threshold: number = 5
): ObjectSnapResult {
  const scene = doc.scenes[sceneIdx];
  if (!scene) {
    return { x: movingBounds.x, y: movingBounds.y, snappedX: false, snappedY: false };
  }

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) {
    return { x: movingBounds.x, y: movingBounds.y, snappedX: false, snappedY: false };
  }

  const keyframe = getGoverningKeyframe(layer, frameIdx);
  if (!keyframe) {
    return { x: movingBounds.x, y: movingBounds.y, snappedX: false, snappedY: false };
  }

  // Collect bounds of all other objects in the frame
  const otherBounds: Bounds[] = [];
  for (const obj of keyframe.displayObjects) {
    if (obj.id === movingObjId) continue;
    otherBounds.push(getTransformedBounds(obj));
  }

  if (otherBounds.length === 0) {
    return { x: movingBounds.x, y: movingBounds.y, snappedX: false, snappedY: false };
  }

  // Snap points for the moving object
  const movingXPoints = [
    movingBounds.x,
    movingBounds.x + movingBounds.width,
    movingBounds.x + movingBounds.width / 2,
  ];
  const movingYPoints = [
    movingBounds.y,
    movingBounds.y + movingBounds.height,
    movingBounds.y + movingBounds.height / 2,
  ];

  // Flatten snap points from all other objects
  const otherXPoints: number[] = [];
  const otherYPoints: number[] = [];
  for (const b of otherBounds) {
    otherXPoints.push(b.x, b.x + b.width, b.x + b.width / 2);
    otherYPoints.push(b.y, b.y + b.height, b.y + b.height / 2);
  }

  // Find best X snap: smallest |movingX - otherX| within threshold
  let bestXDelta: number | null = null;
  let bestXDist = threshold + 1; // initially out of range

  for (const mx of movingXPoints) {
    for (const ox of otherXPoints) {
      const dist = Math.abs(ox - mx);
      if (dist <= threshold && dist < bestXDist) {
        bestXDist = dist;
        bestXDelta = ox - mx;
      }
    }
  }

  // Find best Y snap
  let bestYDelta: number | null = null;
  let bestYDist = threshold + 1;

  for (const my of movingYPoints) {
    for (const oy of otherYPoints) {
      const dist = Math.abs(oy - my);
      if (dist <= threshold && dist < bestYDist) {
        bestYDist = dist;
        bestYDelta = oy - my;
      }
    }
  }

  return {
    x: bestXDelta !== null ? movingBounds.x + bestXDelta : movingBounds.x,
    y: bestYDelta !== null ? movingBounds.y + bestYDelta : movingBounds.y,
    snappedX: bestXDelta !== null,
    snappedY: bestYDelta !== null,
  };
}
