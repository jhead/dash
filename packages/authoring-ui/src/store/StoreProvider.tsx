import React, { createContext, useContext, useRef } from "react";
import { useStore } from "zustand";
import type { FlashDocument } from "@flash/core";
import { createStores, type Stores } from "./createStores.js";
import type { DocumentState } from "./documentStore.js";
import type { UiState } from "./uiStore.js";

const StoresContext = createContext<Stores | null>(null);

export interface StoreProviderProps {
  initialDoc: FlashDocument;
  /** Inject pre-built stores (tests). When omitted, a fresh set is created once. */
  stores?: Stores;
  children: React.ReactNode;
}

/** Provides one per-instance set of stores to the React tree below it. */
export function StoreProvider({ initialDoc, stores, children }: StoreProviderProps): React.ReactElement {
  const ref = useRef<Stores | null>(stores ?? null);
  if (!ref.current) ref.current = createStores(initialDoc);
  return <StoresContext.Provider value={ref.current}>{children}</StoresContext.Provider>;
}

/** Raw store handles — for bridges (agent/JSFL/test) that read via getState(). */
export function useStores(): Stores {
  const s = useContext(StoresContext);
  if (!s) throw new Error("useStores must be used within a <StoreProvider>");
  return s;
}

/** Subscribe to a slice of the document store. */
export function useDocumentStore<T>(selector: (s: DocumentState) => T): T {
  return useStore(useStores().documentStore, selector);
}

/** Subscribe to a slice of the UI store. */
export function useUiStore<T>(selector: (s: UiState) => T): T {
  return useStore(useStores().uiStore, selector);
}
