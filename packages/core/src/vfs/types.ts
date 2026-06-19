// ---------------------------------------------------------------------------
// ClassVfs — a pure, portable virtual-filesystem interface for AS2 .as files.
//
// This module is intentionally DOM-free and Tauri-free so `@flash/core` stays
// portable (it must import cleanly in Node, the browser, and the Tauri webview).
// Concrete backends (OPFS, IndexedDB, Tauri native FS) live in
// `@flash/authoring-ui/vfs`; this file only declares the contract they satisfy
// plus pure path/normalization helpers shared by every backend.
//
// Paths are always CLASSPATH-RELATIVE with forward slashes, mirroring the
// `AsClassFile.path` convention (e.g. `com/example/Foo.as` for the AS2 class
// `com.example.Foo`). Backends map a package path's slashes onto whatever
// nested-directory representation their storage uses.
// ---------------------------------------------------------------------------

/** A single entry returned by {@link ClassVfs.list}. */
export interface ClassVfsEntry {
  /** Classpath-relative path with forward slashes, e.g. `com/example/Foo.as`. */
  readonly path: string;
}

/**
 * A virtual filesystem scoped to one project's AS2 class files. All paths are
 * classpath-relative (see module docs). Every method is async because the real
 * backends (OPFS, IndexedDB, Tauri FS) are async; pure/in-memory backends still
 * return resolved promises to satisfy the contract.
 */
export interface ClassVfs {
  /**
   * List every `.as` file currently stored, as classpath-relative paths. Order
   * is unspecified; callers that need determinism should sort. Returns `[]` when
   * the store is empty or has never been written to.
   */
  list(): Promise<readonly ClassVfsEntry[]>;

  /**
   * Read the UTF-8 source of the file at `path`. Returns `null` if the file does
   * not exist (callers distinguish absent from empty via this, not by `""`).
   */
  read(path: string): Promise<string | null>;

  /**
   * Write (create or overwrite) the file at `path` with `source`. Intermediate
   * package directories are created as needed. Resolves once the write is
   * durable for the backend.
   */
  write(path: string, source: string): Promise<void>;

  /**
   * Remove the file at `path`. A no-op (resolves) if the file does not exist.
   * Backends should prune now-empty package directories where cheap, but callers
   * must not rely on that.
   */
  remove(path: string): Promise<void>;

  /** True if a file exists at `path`. */
  exists(path: string): Promise<boolean>;
}

/** Backend kind, useful for diagnostics and tests. */
export type ClassVfsKind = "opfs" | "indexeddb" | "tauri" | "memory";

/** A {@link ClassVfs} that reports which backend it is. */
export interface IdentifiedClassVfs extends ClassVfs {
  readonly kind: ClassVfsKind;
}
