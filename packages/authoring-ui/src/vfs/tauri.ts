import {
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
  remove as fsRemove,
  exists as fsExists,
} from "@tauri-apps/plugin-fs";
import type { IdentifiedClassVfs, ClassVfsEntry } from "@flash/core";
import { normalizeClassPath, splitClassPath, isAsFile } from "@flash/core";

// ---------------------------------------------------------------------------
// TauriClassVfs — native filesystem backend (the DESKTOP DISK MIRROR).
//
// On Tauri, AS2 classes are written as REAL files on disk, Flash 8
// external-classpath style: rooted at a `classes/` directory beside the project
// `.fla` so they are editable in an external editor (VS Code etc.) and version-
// controllable. The `.fla` embed (doc.asClasses) stays authoritative for
// portability; `syncDocFromVfs` reconciles the on-disk edits back into the
// document on save (see @flash/core vfs/sync).
//
// A classpath-relative path maps onto nested OS directories under the root:
//   <classesRoot>/com/example/Foo.as
// Path joining uses forward slashes; Tauri's fs plugin accepts `/` on every
// platform (the Rust side normalizes), and `mkdir({recursive:true})` creates
// intermediate package directories.
// ---------------------------------------------------------------------------

/** True when running inside a Tauri desktop app (mirrors useFileActions). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface TauriClassVfsOptions {
  /**
   * Absolute path to the project's `classes/` directory (the external-classpath
   * root). Typically derived from the `.fla` path: `<dir>/classes`.
   */
  readonly classesRoot: string;
}

export class TauriClassVfs implements IdentifiedClassVfs {
  readonly kind = "tauri" as const;
  private readonly root: string;

  constructor(options: TauriClassVfsOptions) {
    // Strip a trailing slash so joins are clean.
    this.root = options.classesRoot.replace(/[/\\]+$/, "");
  }

  /** Absolute on-disk path for a classpath-relative path. */
  private abs(path: string): string {
    return `${this.root}/${normalizeClassPath(path)}`;
  }

  /** Absolute on-disk path for a directory segment list. */
  private absDir(dirs: readonly string[]): string {
    return dirs.length > 0 ? `${this.root}/${dirs.join("/")}` : this.root;
  }

  async list(): Promise<readonly ClassVfsEntry[]> {
    if (!(await fsExists(this.root))) return [];
    const out: ClassVfsEntry[] = [];
    await this.walk("", out);
    return out;
  }

  /** Recursive directory walk collecting `.as` files (classpath-relative). */
  private async walk(prefix: string, out: ClassVfsEntry[]): Promise<void> {
    const dirAbs = prefix ? `${this.root}/${prefix}` : this.root;
    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(dirAbs);
    } catch {
      return;
    }
    for (const entry of entries) {
      const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await this.walk(childPath, out);
      } else if (entry.isFile && isAsFile(entry.name)) {
        out.push({ path: childPath });
      }
    }
  }

  async read(path: string): Promise<string | null> {
    const abs = this.abs(path);
    try {
      if (!(await fsExists(abs))) return null;
      return await readTextFile(abs);
    } catch {
      return null;
    }
  }

  async write(path: string, source: string): Promise<void> {
    const { dirs } = splitClassPath(path);
    if (dirs.length > 0) {
      await mkdir(this.absDir(dirs), { recursive: true });
    } else {
      await mkdir(this.root, { recursive: true });
    }
    await writeTextFile(this.abs(path), source);
  }

  async remove(path: string): Promise<void> {
    const abs = this.abs(path);
    try {
      if (await fsExists(abs)) {
        await fsRemove(abs);
      }
    } catch {
      // not found / already gone => no-op per contract
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await fsExists(this.abs(path));
    } catch {
      return false;
    }
  }
}

/** Factory matching the platform-factory shape. */
export function createTauriClassVfs(
  options: TauriClassVfsOptions
): IdentifiedClassVfs {
  return new TauriClassVfs(options);
}

/**
 * Derive the conventional `classes/` directory beside a project `.fla` path.
 * `/Users/me/game/movie.fla` -> `/Users/me/game/classes`. Returns `null` if no
 * directory can be derived (e.g. a bare filename with no separator).
 */
export function deriveClassesRoot(flaPath: string): string | null {
  const norm = flaPath.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx < 0) return null;
  return `${norm.slice(0, idx)}/classes`;
}
