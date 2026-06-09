/**
 * Shape-level document operations: mergeShapes and breakApart.
 *
 * These are document-level mutations (immutable updates) that operate on
 * FlashDocument and return a new FlashDocument.
 *
 * - mergeShapes: Combines multiple ShapeDisplayObjects on the same keyframe
 *   into a single ShapeDisplayObject by concatenating their ShapePaths.
 * - breakApart: Decomposes a SymbolInstance into its constituent display
 *   objects (from the symbol's first keyframe), or is a no-op for shapes.
 */

import type { FlashDocument, Frame, Layer, Scene, Symbol } from "../model/types.js";
import type { DisplayObject, GroupObject, ShapeDisplayObject, SymbolInstance } from "./types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return "shapeop-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

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
// mergeShapes
// ---------------------------------------------------------------------------

/**
 * Merge multiple ShapeDisplayObjects into a single ShapeDisplayObject.
 * The merged shape uses the fill/stroke of the first shape's first path.
 * All specified shapeIds must be ShapeDisplayObjects on the same frame.
 * Returns the updated document (immutable).
 *
 * No-ops:
 *   - shapeIds is empty
 *   - any of the specified IDs does not exist on the frame
 *   - any of the specified IDs refers to a non-shape display object
 *   - the scene/layer/frame does not exist
 */
export function mergeShapes(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  shapeIds: string[]
): FlashDocument {
  if (shapeIds.length === 0) return doc;

  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return doc;

  // Find the display objects with the given IDs
  const idSet = new Set(shapeIds);
  const targets = keyframe.displayObjects.filter((obj) => idSet.has(obj.id));

  // Require that all IDs are found and all are shapes
  if (targets.length !== shapeIds.length) return doc;
  if (!targets.every((obj) => obj.type === "shape")) return doc;

  const shapes = targets as ShapeDisplayObject[];

  // Collect all paths from all shapes
  const allPaths = shapes.flatMap((s) => s.shape.paths);

  // Build merged shape using the first shape's geometry as base
  const first = shapes[0];
  const mergedShape: ShapeDisplayObject = {
    ...first,
    id: generateId(),
    shape: {
      ...first.shape,
      id: generateId(),
      paths: allPaths,
    },
  };

  // Replace the individual shapes with the merged one
  const targetIdSet = new Set(shapes.map((s) => s.id));
  let inserted = false;
  const newDisplayObjects: DisplayObject[] = [];

  for (const obj of keyframe.displayObjects) {
    if (!targetIdSet.has(obj.id)) {
      newDisplayObjects.push(obj);
    } else if (!inserted) {
      // Insert merged shape at the position of the first matched shape
      newDisplayObjects.push(mergedShape);
      inserted = true;
    }
    // Additional matched shapes are dropped
  }

  return replaceDisplayObjects(doc, sceneIndex, layerIndex, keyframe, newDisplayObjects);
}

// ---------------------------------------------------------------------------
// breakApart
// ---------------------------------------------------------------------------

/**
 * Break apart a SymbolInstance into its constituent display objects, placing
 * them on the parent frame at the instance's position offset.
 *
 * - For SymbolInstance: extracts display objects from the symbol's first
 *   keyframe (first layer) and offsets each by the instance's (x, y).
 * - For ShapeDisplayObject: no-op (already atomic).
 * - For unrecognised objectId: no-op.
 *
 * Returns the updated document (immutable).
 */
export function breakApart(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  objectId: string
): FlashDocument {
  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return doc;

  const target = keyframe.displayObjects.find((obj) => obj.id === objectId);
  if (!target) return doc;

  // ShapeDisplayObject is already atomic — no-op
  if (target.type === "shape") return doc;

  // DrawingObject is also atomic — no-op
  if (target.type === "drawing-object") return doc;

  // TextDisplayObject and BitmapDisplayObject — no-op
  if (target.type === "text" || target.type === "bitmap") return doc;

  // SymbolInstance: extract children from the symbol's first keyframe
  if (target.type === "instance") {
    const instance = target as SymbolInstance;

    // Find the symbol in the library
    const libraryItem = doc.library.items.find((item) => item.id === instance.symbolId);
    if (!libraryItem || libraryItem.itemType !== "symbol") return doc;

    const symbol = libraryItem as Symbol;

    // Get the first layer of the symbol's timeline
    const symbolFirstLayer = symbol.timeline.layers[0];
    if (!symbolFirstLayer) return doc;

    // Get the first keyframe of the symbol's first layer
    const symbolFirstKeyframe = symbolFirstLayer.frames.find(
      (f) => f.isKeyframe && f.index === 0
    ) ?? symbolFirstLayer.frames[0] ?? null;
    if (!symbolFirstKeyframe) return doc;

    // Offset each extracted object by the instance's (x, y) and assign new IDs
    const extractedObjects: DisplayObject[] = symbolFirstKeyframe.displayObjects.map(
      (obj) => {
        const newId = generateId();
        // All DisplayObject subtypes have id, x, y — narrow via type field
        // to keep TypeScript happy, then return the updated object.
        if (obj.type === "shape" || obj.type === "instance" ||
            obj.type === "drawing-object" || obj.type === "text" ||
            obj.type === "bitmap") {
          return { ...obj, id: newId, x: obj.x + instance.x, y: obj.y + instance.y } as DisplayObject;
        }
        // Exhaustive: unreachable, but satisfies the compiler
        return obj as DisplayObject;
      }
    );

    // Replace the instance with the extracted objects
    const newDisplayObjects: DisplayObject[] = keyframe.displayObjects.flatMap((obj) =>
      obj.id === objectId ? extractedObjects : [obj]
    );

    return replaceDisplayObjects(doc, sceneIndex, layerIndex, keyframe, newDisplayObjects);
  }

  return doc;
}

// ---------------------------------------------------------------------------
// groupObjects
// ---------------------------------------------------------------------------

/**
 * Wrap selected display objects in a GroupObject.
 * The group's position is the top-left of the bounding box of the selected objects.
 * Children positions are adjusted to be relative to the group origin.
 *
 * No-ops:
 *   - objectIds is empty
 *   - any of the specified IDs does not exist on the frame
 *   - the scene/layer/frame does not exist
 */
export function groupObjects(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  objectIds: string[]
): FlashDocument {
  if (objectIds.length === 0) return doc;

  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return doc;

  // Find all display objects with the given IDs
  const idSet = new Set(objectIds);
  const targets = keyframe.displayObjects.filter((obj) => idSet.has(obj.id));

  // Require that all IDs are found
  if (targets.length !== objectIds.length) return doc;

  // Compute bounding box (min x/y across all targets)
  const xs = targets.map((obj) => ('x' in obj ? (obj as { x: number }).x : 0));
  const ys = targets.map((obj) => ('y' in obj ? (obj as { y: number }).y : 0));
  const groupX = Math.min(...xs);
  const groupY = Math.min(...ys);

  // Build children with positions relative to the group origin
  const children: DisplayObject[] = targets.map((obj) => {
    const objX = ('x' in obj ? (obj as { x: number }).x : 0);
    const objY = ('y' in obj ? (obj as { y: number }).y : 0);
    return { ...obj, x: objX - groupX, y: objY - groupY } as DisplayObject;
  });

  const group: GroupObject = {
    id: generateId(),
    type: 'group',
    x: groupX,
    y: groupY,
    children,
  };

  // Replace the individual objects with the GroupObject, inserted at the position
  // of the first matched object in the frame order.
  const targetIdSet = new Set(objectIds);
  let inserted = false;
  const newDisplayObjects: DisplayObject[] = [];

  for (const obj of keyframe.displayObjects) {
    if (!targetIdSet.has(obj.id)) {
      newDisplayObjects.push(obj);
    } else if (!inserted) {
      newDisplayObjects.push(group);
      inserted = true;
    }
    // Additional matched objects are dropped (absorbed into the group)
  }

  return replaceDisplayObjects(doc, sceneIndex, layerIndex, keyframe, newDisplayObjects);
}

// ---------------------------------------------------------------------------
// ungroupObjects
// ---------------------------------------------------------------------------

/**
 * Extract a GroupObject's children back to the parent frame.
 * Each child's position is adjusted back to absolute stage coordinates
 * by adding the group's (x, y).
 *
 * No-ops:
 *   - groupId does not exist on the frame
 *   - the object with groupId is not a GroupObject
 *   - the scene/layer/frame does not exist
 */
export function ungroupObjects(
  doc: FlashDocument,
  sceneIndex: number,
  layerIndex: number,
  frameIndex: number,
  groupId: string
): FlashDocument {
  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIndex];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIndex);
  if (!keyframe) return doc;

  const target = keyframe.displayObjects.find((obj) => obj.id === groupId);
  if (!target) return doc;

  // Only ungroup GroupObjects
  if (target.type !== 'group') return doc;

  const group = target as GroupObject;

  // Restore each child's absolute position
  const extractedChildren: DisplayObject[] = group.children.map((child) => {
    const childX = ('x' in child ? (child as { x: number }).x : 0);
    const childY = ('y' in child ? (child as { y: number }).y : 0);
    return { ...child, id: generateId(), x: childX + group.x, y: childY + group.y } as DisplayObject;
  });

  // Replace the group with its children
  const newDisplayObjects: DisplayObject[] = keyframe.displayObjects.flatMap((obj) =>
    obj.id === groupId ? extractedChildren : [obj]
  );

  return replaceDisplayObjects(doc, sceneIndex, layerIndex, keyframe, newDisplayObjects);
}
