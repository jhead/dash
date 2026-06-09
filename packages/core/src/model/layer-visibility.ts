import type { Layer, Timeline } from "./types.js";

export function setLayerOutlineMode(
  timeline: Timeline,
  layerId: string,
  outlineMode: boolean,
  outlineColor?: string
): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) =>
      l.id === layerId
        ? { ...l, outlineMode, ...(outlineColor !== undefined ? { outlineColor } : {}) }
        : l
    ),
  };
}

export function getVisibleLayers(timeline: Timeline): readonly Layer[] {
  return timeline.layers.filter((l) => l.visible);
}

export function setAllLayersVisible(timeline: Timeline, visible: boolean): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) => ({ ...l, visible })),
  };
}

export function setAllLayersLocked(timeline: Timeline, locked: boolean): Timeline {
  return {
    ...timeline,
    layers: timeline.layers.map((l) => ({ ...l, locked })),
  };
}
