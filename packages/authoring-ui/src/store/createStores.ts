import type { FlashDocument } from "@flash/core";
import { createDocumentStore, type DocumentStoreApi } from "./documentStore.js";
import { createUiStore, type UiStoreApi } from "./uiStore.js";

/** Bundle of per-Shell-instance stores. */
export interface Stores {
  documentStore: DocumentStoreApi;
  uiStore: UiStoreApi;
}

/**
 * Build a fresh set of stores for one Shell instance.
 *
 * Stores are vanilla (non-React) and per-instance — NOT module singletons — so
 * multiple Shells / test renders never share mutable state (avoids the
 * leaked-module-state flakiness documented in CLAUDE.md). Non-React callers
 * (agent/JSFL/test bridges) receive the handles and read via `store.getState()`.
 */
export function createStores(initialDoc: FlashDocument): Stores {
  return {
    documentStore: createDocumentStore(initialDoc),
    uiStore: createUiStore(),
  };
}
