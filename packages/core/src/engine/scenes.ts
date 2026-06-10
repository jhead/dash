/**
 * Scene management functions for FlashDocument.
 * All operations are immutable — they return a new FlashDocument.
 */

import type { DisplayObject } from "./types.js";
import type { Frame, Layer, Scene, FlashDocument } from "../model/types.js";
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
  return `scene-${Date.now().toString(36)}-${++_counter}`;
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

/** Deep-clone a single Layer, giving it a new ID and new display object IDs. */
function cloneLayerWithNewIds(layer: Layer): Layer {
  return {
    ...layer,
    id: newId(),
    frames: layer.frames.map(cloneFrameWithNewIds),
  };
}

/** Build a default new scene. */
function buildNewScene(doc: FlashDocument, name?: string): Scene {
  const sceneName = name ?? `Scene ${doc.scenes.length + 1}`;
  return {
    id: newId(),
    name: sceneName,
    timeline: {
      layers: [
        {
          id: newId(),
          name: "Layer 1",
          type: "normal",
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#ff0000",
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [createFrame(0)],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a new scene after `afterIdx` (0-based).
 * Defaults to appending at the end when afterIdx is undefined.
 */
export function addScene(
  doc: FlashDocument,
  afterIdx?: number,
  name?: string
): FlashDocument {
  const scenes = doc.scenes;
  const newScene = buildNewScene(doc, name);

  let insertAt: number;
  if (afterIdx === undefined) {
    insertAt = scenes.length;
  } else {
    insertAt = Math.max(0, Math.min(afterIdx + 1, scenes.length));
  }

  const newScenes = [
    ...scenes.slice(0, insertAt),
    newScene,
    ...scenes.slice(insertAt),
  ];

  return { ...doc, scenes: newScenes };
}

/**
 * Delete a scene by index.
 * No-op (returns doc unchanged) if only 1 scene remains.
 */
export function deleteScene(
  doc: FlashDocument,
  sceneIdx: number
): FlashDocument {
  const scenes = doc.scenes;
  if (scenes.length <= 1) return doc;
  if (sceneIdx < 0 || sceneIdx >= scenes.length) return doc;

  const newScenes = scenes.filter((_, i) => i !== sceneIdx);
  return { ...doc, scenes: newScenes };
}

/**
 * Move a scene from `fromIdx` to `toIdx`. Clamps to valid range.
 */
export function reorderScene(
  doc: FlashDocument,
  fromIdx: number,
  toIdx: number
): FlashDocument {
  const scenes = [...doc.scenes];
  if (fromIdx < 0 || fromIdx >= scenes.length) return doc;

  const clampedTo = Math.max(0, Math.min(toIdx, scenes.length - 1));
  if (fromIdx === clampedTo) return doc;

  const [moved] = scenes.splice(fromIdx, 1);
  scenes.splice(clampedTo, 0, moved);

  return { ...doc, scenes };
}

/**
 * Rename a scene by index.
 */
export function renameScene(
  doc: FlashDocument,
  sceneIdx: number,
  name: string
): FlashDocument {
  const scenes = doc.scenes;
  if (sceneIdx < 0 || sceneIdx >= scenes.length) return doc;

  const newScenes = scenes.map((s, i) =>
    i === sceneIdx ? { ...s, name } : s
  );
  return { ...doc, scenes: newScenes };
}

/**
 * Duplicate a scene (deep copy).
 * Generates new IDs for the scene itself, all layers, and all display objects.
 * The duplicate is inserted immediately after the source scene.
 */
export function duplicateScene(
  doc: FlashDocument,
  sceneIdx: number
): FlashDocument {
  const scenes = doc.scenes;
  if (sceneIdx < 0 || sceneIdx >= scenes.length) return doc;

  const source = scenes[sceneIdx];
  const cloned: Scene = {
    ...source,
    id: newId(),
    timeline: {
      layers: source.timeline.layers.map(cloneLayerWithNewIds),
    },
  };

  const newScenes = [
    ...scenes.slice(0, sceneIdx + 1),
    cloned,
    ...scenes.slice(sceneIdx + 1),
  ];

  return { ...doc, scenes: newScenes };
}
