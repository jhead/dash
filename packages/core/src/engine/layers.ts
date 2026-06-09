/**
 * Layer management functions for FlashDocument.
 * All operations are immutable — they return a new FlashDocument.
 */

import type { DisplayObject } from "./types.js";
import type { Frame, Layer, LayerType, FlashDocument } from "../model/types.js";
import { createFrame } from "../model/timeline.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Generate a new unique ID using crypto.randomUUID when available. */
let _counter = 0;
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `layer-${Date.now().toString(36)}-${++_counter}`;
}

/** Deep-clone a single Frame, giving all DisplayObjects new IDs. */
function cloneFrameWithNewIds(frame: Frame): Frame {
  return {
    ...frame,
    displayObjects: frame.displayObjects.map((o: DisplayObject) => ({
      ...o,
      id: newId(),
    })),
  };
}

/**
 * Build a new blank layer that matches the scene's existing frame length.
 */
function buildNewLayer(
  existingLayers: readonly Layer[],
  name: string,
  type: LayerType = "normal"
): Layer {
  const frameCount =
    existingLayers.length > 0
      ? Math.max(...existingLayers.map((l) => l.frameCount))
      : 1;

  return {
    id: newId(),
    name,
    type,
    visible: true,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frameCount: Math.max(1, frameCount),
    frames: [createFrame(0)],
  };
}

/** Replace the layers array for a given scene index and return a new document. */
function withLayers(
  doc: FlashDocument,
  sceneIdx: number,
  layers: readonly Layer[]
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;
  const newScene = {
    ...scene,
    timeline: { ...scene.timeline, layers },
  };
  return {
    ...doc,
    scenes: doc.scenes.map((s, i) => (i === sceneIdx ? newScene : s)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a new empty layer after `afterLayerIdx` (0-based).
 * Defaults to appending at the end when afterLayerIdx is undefined.
 */
export function addLayer(
  doc: FlashDocument,
  sceneIdx: number,
  afterLayerIdx?: number,
  type?: LayerType,
  name?: string
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layers = scene.timeline.layers;
  const layerName = name ?? `Layer ${layers.length + 1}`;
  const newLayer = buildNewLayer(layers, layerName, type ?? "normal");

  let insertAt: number;
  if (afterLayerIdx === undefined) {
    insertAt = layers.length;
  } else {
    insertAt = Math.max(0, Math.min(afterLayerIdx + 1, layers.length));
  }

  const newLayers = [
    ...layers.slice(0, insertAt),
    newLayer,
    ...layers.slice(insertAt),
  ];

  return withLayers(doc, sceneIdx, newLayers);
}

/**
 * Delete a layer by index.
 * No-op (returns doc unchanged) if only 1 layer remains.
 */
export function deleteLayer(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layers = scene.timeline.layers;
  if (layers.length <= 1) return doc;
  if (layerIdx < 0 || layerIdx >= layers.length) return doc;

  const newLayers = layers.filter((_, i) => i !== layerIdx);
  return withLayers(doc, sceneIdx, newLayers);
}

/**
 * Move a layer from `fromIdx` to `toIdx`. Clamps to valid range.
 */
export function reorderLayer(
  doc: FlashDocument,
  sceneIdx: number,
  fromIdx: number,
  toIdx: number
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layers = [...scene.timeline.layers];
  if (fromIdx < 0 || fromIdx >= layers.length) return doc;

  const clampedTo = Math.max(0, Math.min(toIdx, layers.length - 1));
  if (fromIdx === clampedTo) return doc;

  const [moved] = layers.splice(fromIdx, 1);
  layers.splice(clampedTo, 0, moved);

  return withLayers(doc, sceneIdx, layers);
}

/**
 * Rename a layer by index.
 */
export function renameLayer(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  name: string
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layers = scene.timeline.layers;
  if (layerIdx < 0 || layerIdx >= layers.length) return doc;

  const newLayers = layers.map((l, i) => (i === layerIdx ? { ...l, name } : l));
  return withLayers(doc, sceneIdx, newLayers);
}

/**
 * Set the collapsed state of a folder layer.
 * Returns doc unchanged when sceneIdx or layerIdx are out of range.
 * Child layers (those whose parentFolderId matches this layer's id) are
 * unaffected — only the `collapsed` flag on the target layer changes.
 */
export function setLayerCollapsed(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  collapsed: boolean
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layers = scene.timeline.layers;
  if (layerIdx < 0 || layerIdx >= layers.length) return doc;

  const newLayers = layers.map((l, i) =>
    i === layerIdx ? { ...l, collapsed } : l
  );
  return withLayers(doc, sceneIdx, newLayers);
}

/**
 * Duplicate a layer (deep copy).
 * Generates new IDs for the layer itself and all display objects in all frames.
 * The duplicate is inserted immediately after the source layer.
 */
export function duplicateLayer(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layers = scene.timeline.layers;
  if (layerIdx < 0 || layerIdx >= layers.length) return doc;

  const source = layers[layerIdx];
  const cloned: Layer = {
    ...source,
    id: newId(),
    frames: source.frames.map(cloneFrameWithNewIds),
  };

  const newLayers = [
    ...layers.slice(0, layerIdx + 1),
    cloned,
    ...layers.slice(layerIdx + 1),
  ];

  return withLayers(doc, sceneIdx, newLayers);
}
