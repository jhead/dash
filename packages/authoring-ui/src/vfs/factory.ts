import type { IdentifiedClassVfs } from "@flash/core";
import { createMemoryClassVfs } from "@flash/core";
import { isTauri, createTauriClassVfs, deriveClassesRoot } from "./tauri.js";
import { isOpfsAvailable, createWebClassVfs } from "./opfs.js";
import { isIndexedDbAvailable, createIndexedDbClassVfs } from "./indexeddb.js";

// ---------------------------------------------------------------------------
// Platform factory — picks the right ClassVfs backend for the current runtime,
// mirroring the `isTauri()` detection used by hooks/useFileActions.ts.
//
//   Tauri desktop  -> TauriClassVfs (native FS, the disk mirror under classes/)
//   Web + OPFS     -> WebClassVfs (OPFS)
//   Web, no OPFS   -> IndexedDbClassVfs (fallback)
//   Otherwise      -> MemoryClassVfs (headless Node / SSR; from @flash/core)
//
// The web/tauri selection is intentionally lazy on capability probes so the same
// build runs in both shells and degrades gracefully.
// ---------------------------------------------------------------------------

export interface CreateClassVfsOptions {
  /**
   * Project `.fla` path on Tauri. Used to derive the on-disk `classes/` root for
   * the disk mirror. When absent on Tauri, the factory falls back to the web
   * backend (OPFS/IndexedDB) so an unsaved/untitled desktop document still gets
   * a working VFS until it is saved to a path.
   */
  readonly flaPath?: string;
  /** Override the explicit classes root (takes precedence over `flaPath`). */
  readonly classesRoot?: string;
  /** Override the OPFS/IndexedDB scope name (per-origin namespacing). */
  readonly storageName?: string;
}

/**
 * Create the appropriate {@link ClassVfs} for the current platform. The returned
 * VFS reports its `kind` for diagnostics/tests.
 */
export function createClassVfs(
  options?: CreateClassVfsOptions
): IdentifiedClassVfs {
  // Desktop: native FS disk mirror, IF we know where to root it.
  if (isTauri()) {
    const root =
      options?.classesRoot ??
      (options?.flaPath ? deriveClassesRoot(options.flaPath) : null);
    if (root) {
      return createTauriClassVfs({ classesRoot: root });
    }
    // Untitled desktop doc with no path yet — fall through to the web backend.
  }

  // Browser (and pathless desktop): OPFS preferred, IndexedDB fallback.
  if (isOpfsAvailable()) {
    return createWebClassVfs(
      options?.storageName ? { rootDirName: options.storageName } : undefined
    );
  }
  if (isIndexedDbAvailable()) {
    return createIndexedDbClassVfs(
      options?.storageName ? { dbName: options.storageName } : undefined
    );
  }

  // Headless / no storage at all — in-memory (pure, from @flash/core).
  return createMemoryClassVfs();
}
