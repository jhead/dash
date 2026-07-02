// Pure, portable AS2 class virtual-filesystem layer (task 1300 P2).
//
// `@flash/core` owns the INTERFACE + path helpers + the in-memory reference
// backend + the doc<->vfs hydrate/sync bridge. The platform backends (OPFS,
// IndexedDB, Tauri native FS with the desktop disk mirror) live in
// `@flash/authoring-ui/vfs` because they depend on the DOM / Tauri.
export type {
  ClassVfs,
  ClassVfsEntry,
  ClassVfsKind,
  IdentifiedClassVfs,
} from "./types.js";
export {
  normalizeClassPath,
  splitClassPath,
  joinClassPath,
  isAsFile,
  InvalidClassPathError,
} from "./path.js";
export { MemoryClassVfs, createMemoryClassVfs } from "./memory.js";
export {
  hydrateVfsFromDoc,
  syncDocFromVfs,
} from "./sync.js";
export type { HydrateResult, SyncResult, SyncRemoveMode } from "./sync.js";
