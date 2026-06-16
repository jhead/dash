export { historyReducer } from "./history.js";
export type { HistoryAction } from "./history.js";

export {
  createDocumentStore,
  selectDoc,
  selectLibrary,
  selectProperties,
  selectCanUndo,
  selectCanRedo,
  selectUndoDepth,
  selectRedoDepth,
  withProperties,
  withLibrary,
  withSceneTimeline,
  withSymbolTimeline,
} from "./documentStore.js";
export type { DocumentState, DocumentStoreApi } from "./documentStore.js";

export {
  createUiStore,
  selectSelectedShapeIds,
  selectSelectedShapeId,
  selectSelectedInstanceId,
} from "./uiStore.js";
export type { UiState, UiStoreApi } from "./uiStore.js";

export { createStores } from "./createStores.js";
export type { Stores } from "./createStores.js";

export {
  StoreProvider,
  useStores,
  useDocumentStore,
  useUiStore,
} from "./StoreProvider.js";
export type { StoreProviderProps } from "./StoreProvider.js";
