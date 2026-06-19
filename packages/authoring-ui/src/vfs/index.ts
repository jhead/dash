// Cross-platform AS2 class virtual-filesystem backends (task 1300 P2).
//
// `@flash/core` owns the pure ClassVfs INTERFACE + path helpers + the in-memory
// reference backend + the doc<->vfs hydrate/sync bridge (re-exported from there).
// This module adds the platform backends that depend on the DOM / Tauri:
//   * WebClassVfs        — OPFS (navigator.storage.getDirectory)
//   * IndexedDbClassVfs  — OPFS fallback (IndexedDB)
//   * TauriClassVfs      — native FS disk mirror under classes/ (Flash 8 style)
//   * createClassVfs     — platform factory (isTauri()/OPFS/IndexedDB probes)

export { WebClassVfs, createWebClassVfs, isOpfsAvailable } from "./opfs.js";
export type { WebClassVfsOptions } from "./opfs.js";

export {
  IndexedDbClassVfs,
  createIndexedDbClassVfs,
  isIndexedDbAvailable,
} from "./indexeddb.js";
export type { IndexedDbClassVfsOptions } from "./indexeddb.js";

export {
  TauriClassVfs,
  createTauriClassVfs,
  isTauri,
  deriveClassesRoot,
} from "./tauri.js";
export type { TauriClassVfsOptions } from "./tauri.js";

export { createClassVfs } from "./factory.js";
export type { CreateClassVfsOptions } from "./factory.js";

// Re-export the pure core layer so consumers (the P4 Classes panel) can import
// the full VFS surface from a single module.
export type {
  ClassVfs,
  ClassVfsEntry,
  ClassVfsKind,
  IdentifiedClassVfs,
  HydrateResult,
  SyncResult,
} from "@flash/core";
export {
  MemoryClassVfs,
  createMemoryClassVfs,
  normalizeClassPath,
  splitClassPath,
  joinClassPath,
  isAsFile,
  InvalidClassPathError,
  hydrateVfsFromDoc,
  syncDocFromVfs,
} from "@flash/core";
