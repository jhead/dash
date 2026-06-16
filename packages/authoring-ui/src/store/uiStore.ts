import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Per-instance ephemeral UI state (NOT persisted to the document / undo stack).
 *
 * Phase 0 seeds only the `selection` slice as the pattern template. Phase 2
 * migrates the remaining ~60 `useState` values out of Shell into sliced groups
 * here (tool, view, frame/playback, editContext/editPath, scene/layer, panels,
 * dialogs, resize). Keep each slice's state + setters colocated.
 */
export interface UiState {
  // --- selection slice -----------------------------------------------------
  /** Selected display-object IDs (draw/selection tool). */
  selectedShapeIds: string[];
  /** Selected placed-symbol instance, or null. */
  selectedInstanceId: string | null;
  setSelectedShapeIds: (ids: string[]) => void;
  toggleSelectedShapeId: (id: string) => void;
  setSelectedInstanceId: (id: string | null) => void;
  clearSelection: () => void;
}

export type UiStoreApi = StoreApi<UiState>;

export function createUiStore(): UiStoreApi {
  return createStore<UiState>((set) => ({
    selectedShapeIds: [],
    selectedInstanceId: null,
    setSelectedShapeIds: (ids) => set({ selectedShapeIds: ids }),
    toggleSelectedShapeId: (id) =>
      set((s) => ({
        selectedShapeIds: s.selectedShapeIds.includes(id)
          ? s.selectedShapeIds.filter((x) => x !== id)
          : [...s.selectedShapeIds, id],
      })),
    setSelectedInstanceId: (id) => set({ selectedInstanceId: id }),
    clearSelection: () => set({ selectedShapeIds: [], selectedInstanceId: null }),
  }));
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectSelectedShapeIds = (s: UiState): string[] => s.selectedShapeIds;
/** Backward-compat single selection: the id when exactly one shape is selected. */
export const selectSelectedShapeId = (s: UiState): string | null =>
  s.selectedShapeIds.length === 1 ? s.selectedShapeIds[0] : null;
export const selectSelectedInstanceId = (s: UiState): string | null => s.selectedInstanceId;
