/**
 * Layer rendering utilities.
 *
 * Determines which layers contribute to visual output at render time.
 * Guide layers are authoring-only constructs and must be excluded from
 * the rendered output; they are never written into the SWF display list.
 */

import type { Timeline, Layer } from "../model/types.js";

/**
 * Returns layers that should be rendered (excludes guide layers).
 * Invisible layers are also excluded regardless of type.
 */
export function getRenderedLayers(timeline: Timeline): Layer[] {
  return timeline.layers.filter(
    (layer) => layer.type !== "guide" && layer.visible
  );
}

/**
 * Returns layers that act as clip masks.
 * Only visible mask-type layers are included.
 */
export function getMaskLayers(timeline: Timeline): Layer[] {
  return timeline.layers.filter(
    (layer) => layer.type === "mask" && layer.visible
  );
}

/**
 * Returns whether a layer contributes to the visual output.
 * Guide layers and invisible layers are not renderable.
 */
export function isRenderableLayer(layer: Layer): boolean {
  return layer.type !== "guide" && layer.visible;
}
