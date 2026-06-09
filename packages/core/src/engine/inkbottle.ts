/**
 * Ink Bottle tool: apply a stroke to all paths of a ShapeDisplayObject.
 *
 * In Flash 8, the Ink Bottle tool lets you click a shape to apply (or replace)
 * the stroke on every path in the shape. This module provides the document-level
 * operation that implements that behaviour immutably.
 */

import type { FlashDocument, Frame, Layer, Scene } from '../model/types.js';
import type { DisplayObject, ShapeDisplayObject, ShapePath, Stroke } from './types.js';
import { cssToColor } from './color-utils.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the keyframe that governs the given frameIndex in the layer.
 * Returns the latest keyframe at or before frameIndex, or null if none.
 */
function findKeyframe(layer: Layer, frameIndex: number): Frame | null {
  let governing: Frame | null = null;
  for (const frame of layer.frames) {
    if (frame.index <= frameIndex && frame.isKeyframe) {
      governing = frame;
    }
  }
  return governing;
}

/**
 * Return a new document with the target frame's displayObjects replaced.
 * Immutable — every ancestor object is spread-copied.
 */
function replaceDisplayObjects(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  keyframe: Frame,
  newDisplayObjects: readonly DisplayObject[]
): FlashDocument {
  const scene = doc.scenes[sceneIndex];
  const layer = scene.timeline.layers[layerIndex];

  const newFrame: Frame = { ...keyframe, displayObjects: newDisplayObjects };

  const newFrames: Frame[] = layer.frames.map((f) =>
    f === keyframe ? newFrame : f
  );

  const newLayer: Layer = { ...layer, frames: newFrames };

  const newLayers: Layer[] = scene.timeline.layers.map((l, i) =>
    i === layerIndex ? newLayer : l
  );

  const newScene: Scene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };

  const newScenes: Scene[] = doc.scenes.map((s, i) =>
    i === sceneIndex ? newScene : s
  );

  return { ...doc, scenes: newScenes };
}

// ---------------------------------------------------------------------------
// applyInkBottle
// ---------------------------------------------------------------------------

/**
 * Apply the ink bottle stroke to all paths of a ShapeDisplayObject.
 *
 * If a path already has a stroke it is replaced; if it has no stroke one is
 * added. Non-shape display objects and missing objects are silently ignored
 * and the original document is returned unchanged.
 *
 * @param doc         The current document (not mutated).
 * @param sceneIdx    0-based scene index.
 * @param layerIdx    0-based layer index within the scene.
 * @param frameIdx    Frame number used to resolve the governing keyframe.
 * @param objectId    ID of the ShapeDisplayObject to modify.
 * @param strokeColor CSS hex color string, e.g. "#ff0000".
 * @param strokeWidth Stroke width in pixels.
 * @returns A new FlashDocument with the stroke applied, or the original
 *          document if the shape could not be found.
 */
export function applyInkBottle(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectId: string,
  strokeColor: string,
  strokeWidth: number
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const target = keyframe.displayObjects.find((obj) => obj.id === objectId);
  if (!target || target.type !== 'shape') return doc;

  const shape = target as ShapeDisplayObject;

  const stroke: Stroke = {
    type: 'solid',
    color: cssToColor(strokeColor),
    width: strokeWidth,
    caps: 'round',
    joints: 'round',
    miterLimit: 3,
  };

  const newPaths: ShapePath[] = shape.shape.paths.map((path) => ({
    ...path,
    stroke,
  }));

  const newShape: ShapeDisplayObject = {
    ...shape,
    shape: { ...shape.shape, paths: newPaths },
  };

  const newDisplayObjects: DisplayObject[] = keyframe.displayObjects.map((obj) =>
    obj.id === objectId ? newShape : obj
  );

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newDisplayObjects);
}
