/**
 * Z-order (stacking order) operations for display objects.
 *
 * In Flash 8, the `displayObjects` array order determines z-order:
 * index 0 is bottom (back), last index is top (front).
 *
 * All operations are pure functions — they return a new FlashDocument
 * without mutating the input.
 */

import type { FlashDocument, Frame, Layer, Scene } from '../model/types.js';
import type { DisplayObject } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the governing keyframe for a given frameIndex in a layer.
 * Returns the latest keyframe at or before frameIndex, or null.
 */
function findKeyframe(layer: Layer, frameIndex: number): Frame | null {
  let governing: Frame | null = null;
  for (const frame of layer.frames) {
    if (frame.isKeyframe && frame.index <= frameIndex) {
      governing = frame;
    }
  }
  return governing;
}

/**
 * Return a new document with the target keyframe's displayObjects replaced.
 * Every ancestor object is spread to preserve immutability.
 */
function replaceDisplayObjects(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  keyframe: Frame,
  newDisplayObjects: readonly DisplayObject[]
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  const layer = scene.timeline.layers[layerIdx];

  const newFrame: Frame = { ...keyframe, displayObjects: newDisplayObjects };

  const newFrames: Frame[] = layer.frames.map((f) =>
    f === keyframe ? newFrame : f
  );

  const newLayer: Layer = { ...layer, frames: newFrames };

  const newLayers: Layer[] = scene.timeline.layers.map((l, i) =>
    i === layerIdx ? newLayer : l
  );

  const newScene: Scene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };

  const newScenes: Scene[] = doc.scenes.map((s, i) =>
    i === sceneIdx ? newScene : s
  );

  return { ...doc, scenes: newScenes };
}

// ---------------------------------------------------------------------------
// Z-order operations
// ---------------------------------------------------------------------------

/**
 * Move object to top of display list (in front of everything else).
 * If already at the top, returns doc unchanged.
 */
export function bringToFront(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectId: string
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const objects = keyframe.displayObjects;
  const idx = objects.findIndex((o) => o.id === objectId);
  if (idx === -1) return doc;

  // Already at front — no-op
  if (idx === objects.length - 1) return doc;

  const obj = objects[idx];
  const rest = objects.filter((o) => o.id !== objectId);
  const newDisplayObjects: readonly DisplayObject[] = [...rest, obj];

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newDisplayObjects);
}

/**
 * Move object to bottom of display list (behind everything else).
 * If already at the bottom, returns doc unchanged.
 */
export function sendToBack(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectId: string
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const objects = keyframe.displayObjects;
  const idx = objects.findIndex((o) => o.id === objectId);
  if (idx === -1) return doc;

  // Already at back — no-op
  if (idx === 0) return doc;

  const obj = objects[idx];
  const rest = objects.filter((o) => o.id !== objectId);
  const newDisplayObjects: readonly DisplayObject[] = [obj, ...rest];

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newDisplayObjects);
}

/**
 * Move object one step toward the top (swap with the object above it).
 * If already at the front, returns doc unchanged.
 */
export function bringForward(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectId: string
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const objects = keyframe.displayObjects;
  const idx = objects.findIndex((o) => o.id === objectId);
  if (idx === -1) return doc;

  // Already at front — no-op
  if (idx === objects.length - 1) return doc;

  const newArr = [...objects];
  // Swap with next element
  const temp = newArr[idx + 1];
  newArr[idx + 1] = newArr[idx];
  newArr[idx] = temp;

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newArr);
}

/**
 * Move object one step toward the bottom (swap with the object below it).
 * If already at the back, returns doc unchanged.
 */
export function sendBackward(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectId: string
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const objects = keyframe.displayObjects;
  const idx = objects.findIndex((o) => o.id === objectId);
  if (idx === -1) return doc;

  // Already at back — no-op
  if (idx === 0) return doc;

  const newArr = [...objects];
  // Swap with previous element
  const temp = newArr[idx - 1];
  newArr[idx - 1] = newArr[idx];
  newArr[idx] = temp;

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newArr);
}
