/**
 * Align and distribute display objects (Modify > Align).
 *
 * All operations are pure functions — they return a new FlashDocument
 * without mutating the input.
 */

import type { FlashDocument, Frame, Layer, Scene } from '../model/types.js';
import type { DisplayObject } from './types.js';
import { getTransformedBounds } from './bounds.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AlignEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'hCenter'
  | 'vCenter';

export type DistributeAxis = 'horizontal' | 'vertical';

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
// Align
// ---------------------------------------------------------------------------

/**
 * Align selected objects to each other (or to stage if alignToStage=true).
 * All objectIds must exist in the given frame.
 */
export function alignObjects(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectIds: string[],
  edge: AlignEdge,
  alignToStage: boolean
): FlashDocument {
  if (objectIds.length === 0) return doc;

  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const idSet = new Set(objectIds);
  const targets = keyframe.displayObjects.filter((o) => idSet.has(o.id));
  if (targets.length === 0) return doc;

  // Compute bounds for each target object.
  const boundsList = targets.map((o) => ({
    obj: o,
    bounds: getTransformedBounds(o),
  }));

  const stageWidth = doc.properties.width;
  const stageHeight = doc.properties.height;

  // Determine the alignment target value.
  let target: number;
  switch (edge) {
    case 'left':
      target = alignToStage
        ? 0
        : Math.min(...boundsList.map((b) => b.bounds.x));
      break;
    case 'right':
      target = alignToStage
        ? stageWidth
        : Math.max(...boundsList.map((b) => b.bounds.x + b.bounds.width));
      break;
    case 'top':
      target = alignToStage
        ? 0
        : Math.min(...boundsList.map((b) => b.bounds.y));
      break;
    case 'bottom':
      target = alignToStage
        ? stageHeight
        : Math.max(...boundsList.map((b) => b.bounds.y + b.bounds.height));
      break;
    case 'hCenter': {
      if (alignToStage) {
        target = stageWidth / 2;
      } else {
        const centers = boundsList.map((b) => b.bounds.x + b.bounds.width / 2);
        target = centers.reduce((sum, c) => sum + c, 0) / centers.length;
      }
      break;
    }
    case 'vCenter': {
      if (alignToStage) {
        target = stageHeight / 2;
      } else {
        const centers = boundsList.map((b) => b.bounds.y + b.bounds.height / 2);
        target = centers.reduce((sum, c) => sum + c, 0) / centers.length;
      }
      break;
    }
  }

  // Build a map of id → dx/dy offset to apply.
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const { obj, bounds } of boundsList) {
    let dx = 0;
    let dy = 0;
    switch (edge) {
      case 'left':
        dx = target - bounds.x;
        break;
      case 'right':
        dx = target - (bounds.x + bounds.width);
        break;
      case 'top':
        dy = target - bounds.y;
        break;
      case 'bottom':
        dy = target - (bounds.y + bounds.height);
        break;
      case 'hCenter':
        dx = target - (bounds.x + bounds.width / 2);
        break;
      case 'vCenter':
        dy = target - (bounds.y + bounds.height / 2);
        break;
    }
    offsets.set(obj.id, { dx, dy });
  }

  // Apply offsets to all display objects in the keyframe.
  const newDisplayObjects: readonly DisplayObject[] = keyframe.displayObjects.map(
    (o) => {
      const offset = offsets.get(o.id);
      if (!offset) return o;
      const { dx, dy } = offset;
      const objX = 'x' in o ? (o as { x: number }).x : 0;
      const objY = 'y' in o ? (o as { y: number }).y : 0;
      return { ...o, x: objX + dx, y: objY + dy } as DisplayObject;
    }
  );

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newDisplayObjects);
}

// ---------------------------------------------------------------------------
// Distribute
// ---------------------------------------------------------------------------

/**
 * Distribute objects evenly along an axis.
 * Requires at least 3 objects; with fewer, returns doc unchanged.
 */
export function distributeObjects(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  objectIds: string[],
  axis: DistributeAxis
): FlashDocument {
  if (objectIds.length < 3) return doc;

  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  const keyframe = findKeyframe(layer, frameIdx);
  if (!keyframe) return doc;

  const idSet = new Set(objectIds);
  const targets = keyframe.displayObjects.filter((o) => idSet.has(o.id));
  if (targets.length < 3) return doc;

  // Compute bounds for all targets.
  type ObjWithBounds = {
    obj: DisplayObject;
    bounds: ReturnType<typeof getTransformedBounds>;
  };

  const entries: ObjWithBounds[] = targets.map((o) => ({
    obj: o,
    bounds: getTransformedBounds(o),
  }));

  // Build a map of id → new x/y position.
  const newPositions = new Map<string, { x: number; y: number }>();

  if (axis === 'horizontal') {
    // Sort by center x.
    const sorted = [...entries].sort(
      (a, b) =>
        a.bounds.x + a.bounds.width / 2 - (b.bounds.x + b.bounds.width / 2)
    );

    const leftmost = sorted[0];
    const rightmost = sorted[sorted.length - 1];
    const totalSpan = rightmost.bounds.x + rightmost.bounds.width - leftmost.bounds.x;
    const sumWidths = sorted.reduce((s, e) => s + e.bounds.width, 0);
    const gap = (totalSpan - sumWidths) / (sorted.length - 1);

    // Place each object so the gaps between them are equal.
    let cursor = leftmost.bounds.x;
    for (const entry of sorted) {
      const objX = 'x' in entry.obj ? (entry.obj as { x: number }).x : 0;
      const objY = 'y' in entry.obj ? (entry.obj as { y: number }).y : 0;
      // dx = new left edge - current left edge
      const dx = cursor - entry.bounds.x;
      newPositions.set(entry.obj.id, { x: objX + dx, y: objY });
      cursor += entry.bounds.width + gap;
    }
  } else {
    // Sort by center y.
    const sorted = [...entries].sort(
      (a, b) =>
        a.bounds.y + a.bounds.height / 2 - (b.bounds.y + b.bounds.height / 2)
    );

    const topmost = sorted[0];
    const bottommost = sorted[sorted.length - 1];
    const totalSpan =
      bottommost.bounds.y + bottommost.bounds.height - topmost.bounds.y;
    const sumHeights = sorted.reduce((s, e) => s + e.bounds.height, 0);
    const gap = (totalSpan - sumHeights) / (sorted.length - 1);

    let cursor = topmost.bounds.y;
    for (const entry of sorted) {
      const objX = 'x' in entry.obj ? (entry.obj as { x: number }).x : 0;
      const objY = 'y' in entry.obj ? (entry.obj as { y: number }).y : 0;
      const dy = cursor - entry.bounds.y;
      newPositions.set(entry.obj.id, { x: objX, y: objY + dy });
      cursor += entry.bounds.height + gap;
    }
  }

  // Apply new positions to all display objects in the keyframe.
  const newDisplayObjects: readonly DisplayObject[] = keyframe.displayObjects.map(
    (o) => {
      const pos = newPositions.get(o.id);
      if (!pos) return o;
      return { ...o, x: pos.x, y: pos.y } as DisplayObject;
    }
  );

  return replaceDisplayObjects(doc, sceneIdx, layerIdx, keyframe, newDisplayObjects);
}
