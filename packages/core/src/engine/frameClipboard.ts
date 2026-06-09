import type { Frame, Layer, FlashDocument } from '../model/types.js';
import { createFrame } from '../model/timeline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrameClipboard {
  /** Frames copied from each layer, parallel arrays indexed by layer position */
  readonly layerFrames: ReadonlyArray<ReadonlyArray<Frame>>;
  readonly layerCount: number;
  readonly frameCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone a single frame (shallow-spread of all scalar fields +
 * a new array for displayObjects with each object spread).
 */
function cloneFrame(frame: Frame): Frame {
  return {
    ...frame,
    displayObjects: frame.displayObjects.map((o) => ({ ...o })),
  };
}

/**
 * Given a layer's frames array and a [startFrame, endFrame] range, return
 * only the keyframes whose index falls within the range (inclusive).
 * The returned frames have their indices rebased to 0 (i.e., index 0 =
 * startFrame in the source layer).
 */
function sliceLayerFrames(
  layer: Layer,
  startFrame: number,
  endFrame: number
): ReadonlyArray<Frame> {
  if (startFrame > endFrame) return [];

  const inRange = layer.frames.filter(
    (f) => f.index >= startFrame && f.index <= endFrame
  );

  // Rebase indices so the clipboard always starts at 0
  return inRange.map((f) => cloneFrame({ ...f, index: f.index - startFrame }));
}

/**
 * Replace frames in [atFrame, atFrame+spanCount-1] with the given replacement
 * keyframes (already rebased to 0-origin in the clipboard).
 * spanCount is the total span length (clipboard.frameCount), which may be
 * larger than replacements.length since only keyframes are stored.
 * Ensures there is always a keyframe at index 0 in the resulting layer.
 */
function replaceFramesInLayer(
  layer: Layer,
  atFrame: number,
  replacements: ReadonlyArray<Frame>,
  spanCount: number
): Layer {
  const pasteEnd = atFrame + spanCount - 1;

  // Keep frames entirely outside the paste window
  const kept = layer.frames.filter(
    (f) => f.index < atFrame || f.index > pasteEnd
  );

  // Rebase the clipboard frames to the target position
  const incoming = replacements.map((f) => cloneFrame({ ...f, index: f.index + atFrame }));

  const merged = [...kept, ...incoming].sort((a, b) => a.index - b.index);

  // Ensure a keyframe exists at index 0
  const hasFrameZero = merged.some((f) => f.index === 0 && f.isKeyframe);
  const finalFrames: Frame[] = hasFrameZero
    ? merged
    : [createFrame(0), ...merged];

  // Update frameCount: at least as large as the paste end + 1
  const newFrameCount = Math.max(layer.frameCount, pasteEnd + 1);

  return { ...layer, frames: finalFrames, frameCount: newFrameCount };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy frames [startFrame, endFrame] (inclusive, 0-based) from the given
 * layer IDs.  If layerIds is empty, copies from all layers.
 */
export function copyFrames(
  doc: FlashDocument,
  sceneIndex: number,
  layerIds: string[],
  startFrame: number,
  endFrame: number
): FrameClipboard {
  const scene = doc.scenes[sceneIndex];
  if (!scene) {
    return { layerFrames: [], layerCount: 0, frameCount: 0 };
  }

  const targetLayers: Layer[] =
    layerIds.length === 0
      ? [...scene.timeline.layers]
      : scene.timeline.layers.filter((l) => layerIds.includes(l.id));

  const count = Math.max(0, endFrame - startFrame + 1);
  if (count === 0) {
    return {
      layerFrames: targetLayers.map(() => []),
      layerCount: targetLayers.length,
      frameCount: 0,
    };
  }

  const layerFrames = targetLayers.map((layer) =>
    sliceLayerFrames(layer, startFrame, endFrame)
  );

  return {
    layerFrames,
    layerCount: targetLayers.length,
    frameCount: count,
  };
}

/**
 * Paste clipboard contents into the timeline at the target frame.
 * Pastes into the same layers the frames were copied from (matched by
 * position/index within the provided layerIds list).
 * Overwrites existing frames in the paste range.
 */
export function pasteFrames(
  doc: FlashDocument,
  sceneIndex: number,
  layerIds: string[],
  atFrame: number,
  clipboard: FrameClipboard
): FlashDocument {
  if (clipboard.frameCount === 0) return doc;

  const scene = doc.scenes[sceneIndex];
  if (!scene) return doc;

  const targetLayers: Layer[] =
    layerIds.length === 0
      ? [...scene.timeline.layers]
      : scene.timeline.layers.filter((l) => layerIds.includes(l.id));

  // Build a map of layerId -> updated layer
  const updatedLayerMap = new Map<string, Layer>();

  targetLayers.forEach((layer, idx) => {
    const frames = clipboard.layerFrames[idx];
    if (!frames) return;
    updatedLayerMap.set(
      layer.id,
      replaceFramesInLayer(layer, atFrame, frames, clipboard.frameCount)
    );
  });

  if (updatedLayerMap.size === 0) return doc;

  const newLayers = scene.timeline.layers.map((l) =>
    updatedLayerMap.has(l.id) ? updatedLayerMap.get(l.id)! : l
  );

  const newScene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };

  const newScenes = doc.scenes.map((s, i) =>
    i === sceneIndex ? newScene : s
  );

  return { ...doc, scenes: newScenes };
}

/**
 * Cut frames: copy then replace with blank keyframes.
 * Returns { newDoc, clipboard }.
 */
export function cutFrames(
  doc: FlashDocument,
  sceneIndex: number,
  layerIds: string[],
  startFrame: number,
  endFrame: number
): { newDoc: FlashDocument; clipboard: FrameClipboard } {
  const clipboard = copyFrames(doc, sceneIndex, layerIds, startFrame, endFrame);

  if (clipboard.frameCount === 0) {
    return { newDoc: doc, clipboard };
  }

  const scene = doc.scenes[sceneIndex];
  if (!scene) return { newDoc: doc, clipboard };

  const targetLayers: Layer[] =
    layerIds.length === 0
      ? [...scene.timeline.layers]
      : scene.timeline.layers.filter((l) => layerIds.includes(l.id));

  // Build blank replacement frames for each position in the cut range
  const blankReplacements: Frame[] = Array.from(
    { length: endFrame - startFrame + 1 },
    (_, i) =>
      createFrame(i, {
        isKeyframe: true,
        isEmpty: true,
        displayObjects: [],
      })
  );

  const updatedLayerMap = new Map<string, Layer>();

  targetLayers.forEach((layer) => {
    updatedLayerMap.set(
      layer.id,
      replaceFramesInLayer(
        layer,
        startFrame,
        blankReplacements,
        blankReplacements.length
      )
    );
  });

  const newLayers = scene.timeline.layers.map((l) =>
    updatedLayerMap.has(l.id) ? updatedLayerMap.get(l.id)! : l
  );

  const newScene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };

  const newScenes = doc.scenes.map((s, i) =>
    i === sceneIndex ? newScene : s
  );

  return { newDoc: { ...doc, scenes: newScenes }, clipboard };
}
