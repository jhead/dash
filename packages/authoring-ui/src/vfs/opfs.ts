import type { IdentifiedClassVfs, ClassVfsEntry } from "@flash/core";
import { normalizeClassPath, splitClassPath } from "@flash/core";
import { withQuotaMapping } from "./quota.js";

// ---------------------------------------------------------------------------
// WebClassVfs — OPFS (Origin Private File System) backend.
//
// Maps a classpath-relative path 1:1 onto nested OPFS directories: each package
// segment becomes a directory handle and the leaf `.as` file is a file handle
// under it. e.g. `com/example/Foo.as` ->
//   root / <subdir> / com / example / Foo.as
//
// `navigator.storage.getDirectory()` returns the per-origin root. We scope every
// project under a single named subdirectory (default `dash-classes`) so the VFS
// never collides with other OPFS users in the same origin and a future
// per-project scope is a one-line change (pass a different `rootDirName`).
//
// Availability: gated on `navigator.storage?.getDirectory` being a function.
// `isOpfsAvailable()` is the canonical probe the factory uses to choose this vs
// the IndexedDB fallback.
// ---------------------------------------------------------------------------

const DEFAULT_ROOT_DIR = "dash-classes";

/** True if OPFS (navigator.storage.getDirectory) is usable in this environment. */
export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

export interface WebClassVfsOptions {
  /** Name of the OPFS subdirectory that roots this VFS. Defaults to `dash-classes`. */
  readonly rootDirName?: string;
}

export class WebClassVfs implements IdentifiedClassVfs {
  readonly kind = "opfs" as const;
  private readonly rootDirName: string;

  constructor(options?: WebClassVfsOptions) {
    this.rootDirName = options?.rootDirName ?? DEFAULT_ROOT_DIR;
  }

  /** Resolve the per-VFS scope directory under the OPFS origin root. */
  private async rootDir(create: boolean): Promise<FileSystemDirectoryHandle> {
    const origin = await navigator.storage.getDirectory();
    return origin.getDirectoryHandle(this.rootDirName, { create });
  }

  /**
   * Walk/create the nested package directories for `dirs`, returning the deepest
   * handle. With `create:false` a missing intermediate dir throws (caught by
   * callers that translate it to "not found").
   */
  private async resolveDir(
    base: FileSystemDirectoryHandle,
    dirs: readonly string[],
    create: boolean
  ): Promise<FileSystemDirectoryHandle> {
    let dir = base;
    for (const seg of dirs) {
      dir = await dir.getDirectoryHandle(seg, { create });
    }
    return dir;
  }

  async list(): Promise<readonly ClassVfsEntry[]> {
    let root: FileSystemDirectoryHandle;
    try {
      root = await this.rootDir(false);
    } catch {
      return []; // root dir not created yet => empty
    }
    const out: ClassVfsEntry[] = [];
    await this.walk(root, "", out);
    return out;
  }

  /** Depth-first directory walk collecting `.as` files as classpath paths. */
  private async walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
    out: ClassVfsEntry[]
  ): Promise<void> {
    // `entries()` is an async iterator of [name, handle] in the spec/Chromium,
    // but is not yet in TS's DOM lib — access it through a structural cast.
    const iterable = dir as unknown as {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    };
    for await (const [name, handle] of iterable.entries()) {
      const childPath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        await this.walk(handle as FileSystemDirectoryHandle, childPath, out);
      } else {
        out.push({ path: childPath });
      }
    }
  }

  async read(path: string): Promise<string | null> {
    const { dirs, file } = splitClassPath(path);
    let root: FileSystemDirectoryHandle;
    try {
      root = await this.rootDir(false);
      const dir = await this.resolveDir(root, dirs, false);
      const fileHandle = await dir.getFileHandle(file, { create: false });
      const blob = await fileHandle.getFile();
      return await blob.text();
    } catch {
      return null; // any missing segment => not found
    }
  }

  async write(path: string, source: string): Promise<void> {
    // A full origin-storage budget makes createWritable/write/close reject with
    // a QuotaExceededError. Map it to a typed ClassVfsQuotaError (task 1404) so
    // the caller surfaces a one-time warning instead of the rejection being
    // swallowed as an unobserved fire-and-forget promise.
    await withQuotaMapping(path, async () => {
      const { dirs, file } = splitClassPath(path);
      const root = await this.rootDir(true);
      const dir = await this.resolveDir(root, dirs, true);
      const fileHandle = await dir.getFileHandle(file, { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(source);
      } finally {
        // close() is where a buffered quota overrun typically surfaces; keep it
        // inside the mapped body so that rejection is translated too.
        await writable.close();
      }
    });
  }

  async remove(path: string): Promise<void> {
    const { dirs, file } = splitClassPath(path);
    let root: FileSystemDirectoryHandle;
    try {
      root = await this.rootDir(false);
      const dir = await this.resolveDir(root, dirs, false);
      await dir.removeEntry(file);
    } catch {
      // not found => no-op, per the ClassVfs contract
      return;
    }
    // Best-effort prune of now-empty package directories (deepest first).
    await this.prune(root!, dirs).catch(() => undefined);
  }

  /** Remove trailing empty package directories left after a file removal. */
  private async prune(
    root: FileSystemDirectoryHandle,
    dirs: readonly string[]
  ): Promise<void> {
    for (let i = dirs.length; i > 0; i--) {
      const parentDirs = dirs.slice(0, i - 1);
      const leaf = dirs[i - 1]!;
      let parent: FileSystemDirectoryHandle;
      try {
        parent = await this.resolveDir(root, parentDirs, false);
      } catch {
        return;
      }
      const child = await parent.getDirectoryHandle(leaf, { create: false });
      const childKeys = child as unknown as { keys(): AsyncIterable<string> };
      let empty = true;
      for await (const _ of childKeys.keys()) {
        void _;
        empty = false;
        break;
      }
      if (!empty) return; // stop at the first non-empty ancestor
      await parent.removeEntry(leaf);
    }
  }

  async exists(path: string): Promise<boolean> {
    return (await this.read(path)) !== null;
  }
}

/** Factory matching the platform-factory shape. */
export function createWebClassVfs(options?: WebClassVfsOptions): IdentifiedClassVfs {
  return new WebClassVfs(options);
}

export { normalizeClassPath };
