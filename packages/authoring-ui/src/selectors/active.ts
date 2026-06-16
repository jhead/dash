import type { FlashDocument, Timeline } from "@flash/core";
import { withSceneTimeline, withSymbolTimeline } from "../store/documentStore.js";
import type { UiState } from "../store/uiStore.js";

/**
 * The active timeline: the symbol being edited in-place (editPath top, then
 * editContext), else the active scene's timeline. Mirrors Shell's `timeline`
 * memo so commands resolve the same target Shell renders.
 */
export function resolveActiveTimeline(doc: FlashDocument, ui: UiState): Timeline {
  if (ui.editPath.length > 0) {
    const top = ui.editPath[ui.editPath.length - 1];
    const sym = doc.library.items.find((i) => i.id === top.symbolId && i.itemType === "symbol");
    if (sym && sym.itemType === "symbol") return sym.timeline;
  }
  if (ui.editContext.mode === "symbol" && ui.editContext.symbolId) {
    const sym = doc.library.items.find(
      (i) => i.id === ui.editContext.symbolId && i.itemType === "symbol"
    );
    if (sym && sym.itemType === "symbol") return sym.timeline;
  }
  const idx = Math.min(ui.activeSceneIndex, doc.scenes.length - 1);
  return doc.scenes[idx].timeline;
}

/** Context-aware timeline updater mirroring Shell's `withTimeline`. */
export function withActiveTimeline(
  doc: FlashDocument,
  ui: UiState,
  updater: (t: Timeline) => Timeline
): FlashDocument {
  if (ui.editContext.mode === "symbol" && ui.editContext.symbolId) {
    return withSymbolTimeline(doc, ui.editContext.symbolId, updater);
  }
  return withSceneTimeline(doc, ui.activeSceneIndex, updater);
}

/** Active layer index clamped to the timeline's layer range. */
export function safeLayerIndex(timeline: Timeline, activeLayerIndex: number): number {
  return Math.min(activeLayerIndex, Math.max(0, timeline.layers.length - 1));
}

/** Id of the active layer, or null when there are no layers. */
export function activeLayerId(timeline: Timeline, activeLayerIndex: number): string | null {
  return timeline.layers[safeLayerIndex(timeline, activeLayerIndex)]?.id ?? null;
}
