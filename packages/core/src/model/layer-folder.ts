/**
 * Folder-layer utilities — pure, immutable helpers for querying and mutating
 * the folder / child-layer relationship stored on Timeline layers.
 */

import type { Layer, Timeline } from "./types.js";

/**
 * Return all layers whose parentFolderId matches the given folderId.
 */
export function getLayersInFolder(
  timeline: Timeline,
  folderId: string
): Layer[] {
  return timeline.layers.filter((l) => l.parentFolderId === folderId);
}

/**
 * Return all layers that are at the top level (parentFolderId === null).
 */
export function getTopLevelLayers(timeline: Timeline): Layer[] {
  return timeline.layers.filter((l) => l.parentFolderId === null);
}

/**
 * Return a new Timeline with the `collapsed` flag toggled on the specified
 * folder layer.  Non-folder layers are left unchanged (no-op).
 */
export function setFolderCollapsed(
  timeline: Timeline,
  folderId: string,
  collapsed: boolean
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) =>
      l.id === folderId && l.type === "folder" ? { ...l, collapsed } : l
    ),
  };
}

/**
 * Return the nesting depth of a layer (0 = top-level, 1 = direct child of a
 * folder, etc.).  Walks up the parentFolderId chain until it reaches null.
 */
export function getLayerDepth(timeline: Timeline, layerId: string): number {
  let depth = 0;
  let layer = timeline.layers.find((l) => l.id === layerId);
  while (layer && layer.parentFolderId !== null) {
    depth++;
    layer = timeline.layers.find((l) => l.id === layer!.parentFolderId);
  }
  return depth;
}
