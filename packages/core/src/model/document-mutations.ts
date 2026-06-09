import type { FlashDocument, Scene, DocumentProperties, GridSettings, Guide, RulerUnits } from "./types.js";
import { createScene } from "./scene.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// Scene operations
// ---------------------------------------------------------------------------

/**
 * Add a new scene to the end of the document.
 */
export function addScene(doc: FlashDocument, name?: string): FlashDocument {
  const sceneName = name ?? `Scene ${doc.scenes.length + 1}`;
  const newScene = createScene(sceneName);
  return {
    ...doc,
    scenes: [...doc.scenes, newScene],
  };
}

/**
 * Remove a scene by id. No-op if not found or only one scene remains.
 */
export function removeScene(doc: FlashDocument, sceneId: string): FlashDocument {
  if (doc.scenes.length <= 1) return doc;
  const filtered = doc.scenes.filter((s) => s.id !== sceneId);
  // If nothing was filtered out (not found), return unchanged
  if (filtered.length === doc.scenes.length) return doc;
  return { ...doc, scenes: filtered };
}

/**
 * Rename a scene.
 */
export function renameScene(doc: FlashDocument, sceneId: string, name: string): FlashDocument {
  return {
    ...doc,
    scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, name } : s)),
  };
}

/**
 * Move a scene (by id) to a new index (0-based). Clamps to valid range.
 */
export function moveScene(doc: FlashDocument, sceneId: string, newIndex: number): FlashDocument {
  const fromIndex = doc.scenes.findIndex((s) => s.id === sceneId);
  if (fromIndex === -1) return doc;
  return reorderScenes(doc, fromIndex, newIndex);
}

/**
 * Move a scene from one index to another (0-based). Clamps to valid range.
 */
export function reorderScenes(doc: FlashDocument, fromIndex: number, toIndex: number): FlashDocument {
  const scenes = [...doc.scenes];
  const clamped = Math.max(0, Math.min(fromIndex, scenes.length - 1));
  const clampedTo = Math.max(0, Math.min(toIndex, scenes.length - 1));
  if (clamped === clampedTo) return doc;
  const [scene] = scenes.splice(clamped, 1);
  scenes.splice(clampedTo, 0, scene);
  return { ...doc, scenes };
}

/**
 * Duplicate a scene (deep copy, new id for the scene). Inserted after the source.
 */
export function duplicateScene(doc: FlashDocument, sceneId: string): FlashDocument {
  const index = doc.scenes.findIndex((s) => s.id === sceneId);
  if (index === -1) return doc;
  const source = doc.scenes[index];
  const copy: Scene = {
    ...source,
    id: generateId(),
    name: `${source.name} copy`,
    // Deep-copy layers/frames via spread; ids are timeline-local so reuse is fine
    timeline: {
      layers: source.timeline.layers.map((layer) => ({
        ...layer,
        frames: layer.frames.map((frame) => ({
          ...frame,
          displayObjects: [...frame.displayObjects],
        })),
      })),
    },
  };
  const scenes = [
    ...doc.scenes.slice(0, index + 1),
    copy,
    ...doc.scenes.slice(index + 1),
  ];
  return { ...doc, scenes };
}

// ---------------------------------------------------------------------------
// Document properties
// ---------------------------------------------------------------------------

/**
 * Return a new document with merged properties.
 */
export function updateDocumentProperties(
  doc: FlashDocument,
  updates: Partial<DocumentProperties>
): FlashDocument {
  return {
    ...doc,
    properties: { ...doc.properties, ...updates },
  };
}

/**
 * Set the document width.
 */
export function setDocumentWidth(doc: FlashDocument, width: number): FlashDocument {
  return { ...doc, properties: { ...doc.properties, width } };
}

/**
 * Set the document height.
 */
export function setDocumentHeight(doc: FlashDocument, height: number): FlashDocument {
  return { ...doc, properties: { ...doc.properties, height } };
}

/**
 * Set the document frame rate.
 */
export function setFrameRate(doc: FlashDocument, frameRate: number): FlashDocument {
  return { ...doc, properties: { ...doc.properties, frameRate } };
}

/**
 * Set the document background color.
 */
export function setBackgroundColor(doc: FlashDocument, backgroundColor: string): FlashDocument {
  return { ...doc, properties: { ...doc.properties, backgroundColor } };
}

/**
 * Set the document ruler units.
 */
export function setRulerUnits(doc: FlashDocument, rulerUnits: RulerUnits): FlashDocument {
  return { ...doc, properties: { ...doc.properties, rulerUnits } };
}

/**
 * Update just the grid settings.
 */
export function updateGridSettings(
  doc: FlashDocument,
  updates: Partial<GridSettings>
): FlashDocument {
  return {
    ...doc,
    properties: {
      ...doc.properties,
      grid: { ...doc.properties.grid, ...updates },
    },
  };
}

// ---------------------------------------------------------------------------
// Guides
// ---------------------------------------------------------------------------

/**
 * Add a guide to the document.
 */
export function addGuide(doc: FlashDocument, guide: Guide): FlashDocument {
  return {
    ...doc,
    properties: {
      ...doc.properties,
      guides: [...doc.properties.guides, guide],
    },
  };
}

/**
 * Remove a guide by id.
 */
export function removeGuide(doc: FlashDocument, guideId: string): FlashDocument {
  return {
    ...doc,
    properties: {
      ...doc.properties,
      guides: doc.properties.guides.filter((g) => g.id !== guideId),
    },
  };
}

/**
 * Update a guide's position.
 */
export function moveGuide(doc: FlashDocument, guideId: string, position: number): FlashDocument {
  return {
    ...doc,
    properties: {
      ...doc.properties,
      guides: doc.properties.guides.map((g) =>
        g.id === guideId ? { ...g, position } : g
      ),
    },
  };
}
