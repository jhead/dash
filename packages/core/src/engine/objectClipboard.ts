/**
 * Object-level clipboard operations: copy, paste (centered), and paste in place.
 *
 * Unlike the frame clipboard (frameClipboard.ts), these operations work on
 * individual DisplayObjects within a single keyframe.
 *
 * - copyObjects: snapshot the given display objects (deep-clone)
 * - pasteObjects: add cloned objects with a centering offset to the stage center
 * - pasteObjectsInPlace: add cloned objects at their original coordinates
 */

import type { FlashDocument, Frame, Layer, Scene } from "../model/types.js";
import type { DisplayObject } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Clipboard holding a snapshot of copied display objects, together with
 * the stage center used when computing the centering offset for regular paste.
 */
export interface ObjectClipboard {
  /** Deep-cloned display objects at the time of copy. */
  readonly objects: readonly DisplayObject[];
  /**
   * Original stage coordinates of each object (parallel array).
   * Preserved so that pasteObjectsInPlace can restore exact positions.
   */
  readonly originalPositions: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return "obj-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deep-clone a single DisplayObject and assign a fresh id. */
function cloneObject(obj: DisplayObject): DisplayObject {
  // Spread gives a shallow copy of the top-level; that's sufficient because
  // inner data (shape paths, filters) is treated as immutable.
  return { ...obj, id: generateId() } as DisplayObject;
}

/**
 * Find the keyframe that governs frameIndex in the given layer.
 * Returns the latest keyframe at or before frameIndex, or null.
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Snapshot the specified display objects into an ObjectClipboard.
 * If objectIds is empty the clipboard will contain no objects.
 * Objects are deep-cloned so later edits do not affect the clipboard.
 */
export function copyObjects(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  objectIds: string[]
): ObjectClipboard {
  if (objectIds.length === 0) {
    return { objects: [], originalPositions: [] };
  }

  const scene = doc.scenes[sceneIndex];
  if (!scene) return { objects: [], originalPositions: [] };

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return { objects: [], originalPositions: [] };

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return { objects: [], originalPositions: [] };

  const idSet = new Set(objectIds);
  const targets = keyframe.displayObjects.filter((obj) => idSet.has(obj.id));

  const objects = targets.map((obj) => ({ ...obj } as DisplayObject));
  const originalPositions = targets.map((obj) => ({
    x: "x" in obj ? (obj as { x: number }).x : 0,
    y: "y" in obj ? (obj as { y: number }).y : 0,
  }));

  return { objects, originalPositions };
}

/**
 * Paste display objects into the target frame, offsetting each object so that
 * the group center aligns with the given stage center (cx, cy).
 *
 * Objects are given new IDs to avoid collisions with existing objects.
 * Appends to existing display objects (does not replace).
 *
 * Pass the document's stage center as (cx, cy):
 *   cx = doc.properties.width / 2
 *   cy = doc.properties.height / 2
 */
export function pasteObjects(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  objects: readonly DisplayObject[],
  cx: number,
  cy: number
): FlashDocument {
  if (objects.length === 0) return doc;

  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return doc;

  // Compute the bounding-box center of the objects being pasted.
  const xs = objects.map((obj) => ("x" in obj ? (obj as { x: number }).x : 0));
  const ys = objects.map((obj) => ("y" in obj ? (obj as { y: number }).y : 0));
  const objCx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const objCy = (Math.min(...ys) + Math.max(...ys)) / 2;

  // Offset to move the group center to (cx, cy).
  const dx = cx - objCx;
  const dy = cy - objCy;

  const cloned: DisplayObject[] = objects.map((obj) => {
    const fresh = cloneObject(obj);
    const objX = "x" in obj ? (obj as { x: number }).x : 0;
    const objY = "y" in obj ? (obj as { y: number }).y : 0;
    return { ...fresh, x: objX + dx, y: objY + dy } as DisplayObject;
  });

  const newDisplayObjects: readonly DisplayObject[] = [
    ...keyframe.displayObjects,
    ...cloned,
  ];

  return replaceDisplayObjects(doc, sceneIndex, layerIndex, keyframe, newDisplayObjects);
}

/**
 * Paste display objects at their original coordinates (no centering offset).
 * Objects are given new IDs but keep their exact x, y positions.
 * Appends to existing display objects (does not replace).
 */
export function pasteObjectsInPlace(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  objects: readonly DisplayObject[]
): FlashDocument {
  if (objects.length === 0) return doc;

  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return doc;

  // Clone each object with a new ID, preserving x/y exactly.
  const cloned: DisplayObject[] = objects.map((obj) => cloneObject(obj));

  const newDisplayObjects: readonly DisplayObject[] = [
    ...keyframe.displayObjects,
    ...cloned,
  ];

  return replaceDisplayObjects(doc, sceneIndex, layerIndex, keyframe, newDisplayObjects);
}
