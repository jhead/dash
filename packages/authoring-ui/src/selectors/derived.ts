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
  Layer,
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

/**
 * Whether a layer's contents can be directly selected by clicking on the stage
 * (Flash 8 semantics). Locked and hidden layers are never selectable; guide
 * layers and folder rows hold no directly-selectable stage content. Normal,
 * mask, masked, and guided layers are selectable.
 *
 * This is the gate for both cross-layer hit-testing AND the auto-switch target:
 * clicking an object on a layer that fails this check must neither select the
 * object nor change the active layer (matching Flash).
 */
export function isLayerStageSelectable(layer: Layer | undefined | null): boolean {
  if (!layer) return false;
  if (!layer.visible || layer.locked) return false;
  if (layer.type === "guide" || layer.type === "folder") return false;
  return true;
}

/**
 * Selectable display objects on a SINGLE non-active layer at `frame`, grouped by
 * the kinds StageArea hit-tests (shapes, symbol instances, text). Bitmaps are
 * intentionally excluded — the Selection tool's pointer-down only hit-tests
 * shapes/instances/text for whole-object selection (bitmaps live inside the
 * shape/instance hit paths in practice), matching the active-layer arrays.
 */
export interface LayerSelectables {
  readonly layerIndex: number;
  readonly shapes: ShapeDisplayObject[];
  readonly instances: SymbolInstance[];
  readonly texts: TextDisplayObject[];
}

/**
 * Build the per-layer selectable-object breakdown for every layer EXCEPT
 * `activeLayerIndex` that is stage-selectable (visible && !locked && not a
 * guide/folder). Used as a fallback hit-test pass so clicking an object on
 * another layer selects it AND makes that layer active (Flash 8 auto-switch).
 *
 * Layers are returned in z-order (index 0 = topmost) so callers can resolve the
 * front-most hit by iterating in order. The active layer is omitted because its
 * objects are already covered by the primary (active-layer) hit-test arrays.
 */
export function otherLayerSelectables(
  timeline: Timeline,
  activeLayerIndex: number,
  frame: number
): LayerSelectables[] {
  const out: LayerSelectables[] = [];
  for (let li = 0; li < timeline.layers.length; li++) {
    if (li === activeLayerIndex) continue;
    const layer = timeline.layers[li];
    if (!isLayerStageSelectable(layer)) continue;
    const kf = activeKeyframeForLayer(timeline, li, frame);
    if (!kf) continue;
    const shapes: ShapeDisplayObject[] = [];
    const instances: SymbolInstance[] = [];
    const texts: TextDisplayObject[] = [];
    for (const o of kf.displayObjects) {
      if (o.type === "shape") shapes.push(o as ShapeDisplayObject);
      else if (o.type === "instance") instances.push(o as SymbolInstance);
      else if (o.type === "text") texts.push(o as TextDisplayObject);
    }
    if (shapes.length || instances.length || texts.length) {
      out.push({ layerIndex: li, shapes, instances, texts });
    }
  }
  return out;
}

/**
 * Resolve the index of the layer that owns the display object with `objectId`
 * at `frame`, considering ONLY stage-selectable layers (so a hit on a locked/
 * hidden/guide layer never drives the active-layer auto-switch). Returns -1 when
 * the object is not found on any selectable layer.
 */
export function ownerSelectableLayerIndex(
  timeline: Timeline,
  objectId: string,
  frame: number
): number {
  for (let li = 0; li < timeline.layers.length; li++) {
    const layer = timeline.layers[li];
    if (!isLayerStageSelectable(layer)) continue;
    const kf = activeKeyframeForLayer(timeline, li, frame);
    if (!kf) continue;
    if (kf.displayObjects.some((o) => o.id === objectId)) return li;
  }
  return -1;
}

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
