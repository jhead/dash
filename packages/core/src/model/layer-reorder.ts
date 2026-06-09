/**
 * Layer reorder operations for a Timeline.
 *
 * All functions are pure — they return a new Timeline and never mutate the
 * original. If the operation is a no-op (e.g. moving the top layer further up)
 * the original Timeline reference is returned unchanged.
 */

import type { Timeline } from "./types.js";

/**
 * Swap the layer at `layerId` with the layer immediately above it (lower index).
 * No-op if the layer is already at index 0 or not found.
 */
export function moveLayerUp(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex((l) => l.id === layerId);
  if (idx <= 0) return timeline;
  const layers = [...timeline.layers];
  [layers[idx - 1], layers[idx]] = [layers[idx], layers[idx - 1]];
  return { ...timeline, layers };
}

/**
 * Swap the layer at `layerId` with the layer immediately below it (higher index).
 * No-op if the layer is at the last index or not found.
 */
export function moveLayerDown(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex((l) => l.id === layerId);
  if (idx < 0 || idx >= timeline.layers.length - 1) return timeline;
  const layers = [...timeline.layers];
  [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
  return { ...timeline, layers };
}

/**
 * Move the layer at `layerId` to index 0 (the top of the stack).
 * No-op if the layer is already at index 0 or not found.
 */
export function moveLayerToTop(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex((l) => l.id === layerId);
  if (idx <= 0) return timeline;
  const layers = [...timeline.layers];
  const [layer] = layers.splice(idx, 1);
  layers.unshift(layer);
  return { ...timeline, layers };
}

/**
 * Move the layer at `layerId` to the last index (the bottom of the stack).
 * No-op if the layer is already at the last index or not found.
 */
export function moveLayerToBottom(timeline: Timeline, layerId: string): Timeline {
  const idx = timeline.layers.findIndex((l) => l.id === layerId);
  if (idx < 0 || idx === timeline.layers.length - 1) return timeline;
  const layers = [...timeline.layers];
  const [layer] = layers.splice(idx, 1);
  layers.push(layer);
  return { ...timeline, layers };
}

/**
 * Move the layer at `layerId` to the position immediately before `targetId`.
 * No-op if either layer is not found or if they are the same layer.
 */
export function moveLayerBefore(
  timeline: Timeline,
  layerId: string,
  targetId: string
): Timeline {
  const fromIdx = timeline.layers.findIndex((l) => l.id === layerId);
  const toIdx = timeline.layers.findIndex((l) => l.id === targetId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return timeline;
  const layers = [...timeline.layers];
  const [layer] = layers.splice(fromIdx, 1);
  const newToIdx = layers.findIndex((l) => l.id === targetId);
  layers.splice(newToIdx, 0, layer);
  return { ...timeline, layers };
}
