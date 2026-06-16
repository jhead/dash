import type {
  Timeline,
  Library,
  Frame,
  DisplayObject,
  ShapeDisplayObject,
  TextDisplayObject,
  BitmapDisplayObject,
  SymbolInstance,
  BitmapItem,
  SoundItem,
} from "@flash/core";

/**
 * Pure derivations over the document model. Extracted from Shell's useMemo bodies
 * so section components (Phase 6) and commands (Phase 4) can reuse them, and so
 * they are unit-testable without React. Memoization stays at the call site
 * (Shell wraps these in useMemo with the right deps).
 */

/**
 * The keyframe governing `frame` on a layer: the latest keyframe at or before
 * `frame`. Returns null when the layer is missing, hidden, or locked (callers
 * use these collections for interaction/hit-testing, which excludes such layers).
 */
export function activeKeyframeForLayer(
  timeline: Timeline,
  layerIndex: number,
  frame: number
): Frame | null {
  const layer = timeline.layers[layerIndex];
  if (!layer || !layer.visible || layer.locked) return null;
  const kf = [...layer.frames]
    .filter((f) => f.isKeyframe && f.index <= frame)
    .sort((a, b) => b.index - a.index)[0];
  return kf ?? null;
}

function displayObjectsOfType<T extends DisplayObject>(
  timeline: Timeline,
  layerIndex: number,
  frame: number,
  type: T["type"]
): T[] {
  const kf = activeKeyframeForLayer(timeline, layerIndex, frame);
  if (!kf) return [];
  return kf.displayObjects.filter((o): o is T => o.type === type);
}

export const shapeDisplayObjectsAt = (t: Timeline, layerIndex: number, frame: number): ShapeDisplayObject[] =>
  displayObjectsOfType<ShapeDisplayObject>(t, layerIndex, frame, "shape");

export const textDisplayObjectsAt = (t: Timeline, layerIndex: number, frame: number): TextDisplayObject[] =>
  displayObjectsOfType<TextDisplayObject>(t, layerIndex, frame, "text");

export const bitmapDisplayObjectsAt = (t: Timeline, layerIndex: number, frame: number): BitmapDisplayObject[] =>
  displayObjectsOfType<BitmapDisplayObject>(t, layerIndex, frame, "bitmap");

export const symbolInstancesAt = (t: Timeline, layerIndex: number, frame: number): SymbolInstance[] =>
  displayObjectsOfType<SymbolInstance>(t, layerIndex, frame, "instance");

export const bitmapLibraryItems = (library: Library): BitmapItem[] =>
  library.items.filter((i): i is BitmapItem => i.itemType === "bitmap");

export const soundLibraryItems = (library: Library): SoundItem[] =>
  library.items.filter((i): i is SoundItem => i.itemType === "sound");

/** Map of library item id → display name (used to resolve instance names). */
export function instanceNamesOf(library: Library): Record<string, string> {
  const names: Record<string, string> = {};
  for (const item of library.items) names[item.id] = item.name;
  return names;
}
