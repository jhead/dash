/**
 * placeLibraryItem — create a display object from a library item and add it
 * to the specified keyframe on the stage.
 *
 * Supported item types:
 *   - 'symbol'    → SymbolInstance
 *   - 'bitmap'    → BitmapDisplayObject
 *   - 'component' → SymbolInstance (carrying default component parameters)
 *   - all others  → doc returned unchanged (not placeable on stage directly)
 */

import type { FlashDocument, Frame, Layer, Scene } from '../model/types.js';
import { getComponentDef, defaultComponentParameters } from '../model/components.js';
import type { BitmapDisplayObject, DisplayObject, SymbolInstance } from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the keyframe that governs frameIndex in the given layer.
 * Returns the latest keyframe at or before frameIndex, or null.
 */
function findGoverningKeyframe(layer: Layer, frameIndex: number): Frame | null {
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
 * Immutable — every ancestor object is spread.
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

  const newFrames: readonly Frame[] = layer.frames.map((f) =>
    f === keyframe ? newFrame : f
  );

  const newLayer: Layer = { ...layer, frames: newFrames };

  const newLayers: readonly Layer[] = scene.timeline.layers.map((l, i) =>
    i === layerIndex ? newLayer : l
  );

  const newScene: Scene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };

  const newScenes: readonly Scene[] = doc.scenes.map((s, i) =>
    i === sceneIndex ? newScene : s
  );

  return { ...doc, scenes: newScenes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a display object from a library item and add it to the specified frame.
 *
 * @param doc          - Source document (never mutated).
 * @param sceneIdx     - 0-based index of the target scene.
 * @param layerIdx     - 0-based index of the target layer within the scene.
 * @param frameIdx     - Frame index; the governing keyframe at or before this
 *                       index is used.
 * @param libraryItemId - ID of the library item to instantiate.
 * @param x            - Stage X coordinate for the new object.
 * @param y            - Stage Y coordinate for the new object.
 * @returns New FlashDocument with the object added, or the original doc if
 *          the item cannot be placed.
 */
export function placeLibraryItem(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  libraryItemId: string,
  x: number,
  y: number
): FlashDocument {
  // Resolve the library item.
  const item = doc.library.items.find((i) => i.id === libraryItemId);
  if (!item) return doc;

  // Resolve the target scene / layer.
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  // Resolve the governing keyframe.
  const keyframe = findGoverningKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  // Build the appropriate display object based on item type.
  let newObj: DisplayObject;

  if (item.itemType === 'symbol') {
    const instance: SymbolInstance = {
      id: crypto.randomUUID(),
      type: 'instance',
      symbolId: item.id,
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      instanceName: '',
      blendMode: 'normal',
      colorEffect: undefined,
    };
    newObj = instance;
  } else if (item.itemType === 'bitmap') {
    const bitmapObj: BitmapDisplayObject = {
      id: crypto.randomUUID(),
      type: 'bitmap',
      libraryItemId: item.id,
      x,
      y,
      width: item.originalWidth,
      height: item.originalHeight,
    };
    newObj = bitmapObj;
  } else if (item.itemType === 'component') {
    const def = getComponentDef(item.componentName);
    const instance: SymbolInstance = {
      id: crypto.randomUUID(),
      type: 'instance',
      symbolId: item.id,
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      instanceName: '',
      ...(def ? { naturalWidth: def.defaultWidth, naturalHeight: def.defaultHeight } : {}),
      componentParameters: def ? defaultComponentParameters(def) : {},
    };
    newObj = instance;
  } else {
    // SoundItem, VideoItem, FontItem — not placeable on stage.
    return doc;
  }

  const newDisplayObjects: readonly DisplayObject[] = [
    ...keyframe.displayObjects,
    newObj,
  ];

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newDisplayObjects);
}
