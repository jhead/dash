import type { ClassVfsEntry, IdentifiedClassVfs } from "./types.js";
import { normalizeClassPath } from "./path.js";

// ---------------------------------------------------------------------------
// MemoryClassVfs — a pure, dependency-free in-memory ClassVfs.
//
// Doubles as (1) the reference implementation that pins the interface contract,
// (2) the backend used by the hydrate/sync round-trip tests, and (3) a usable
// fallback in any environment that has neither OPFS nor IndexedDB nor Tauri
// (e.g. a headless Node process or SSR). It is DOM-free, so it lives in
// `@flash/core` next to the interface it satisfies.
// ---------------------------------------------------------------------------

export class MemoryClassVfs implements IdentifiedClassVfs {
  readonly kind = "memory" as const;
  private readonly files = new Map<string, string>();

  /** Optionally seed the store with initial `{ path: source }` files. */
  constructor(initial?: Readonly<Record<string, string>>) {
    if (initial) {
      for (const [path, source] of Object.entries(initial)) {
        this.files.set(normalizeClassPath(path), source);
      }
    }
  }

  list(): Promise<readonly ClassVfsEntry[]> {
    return Promise.resolve(
      [...this.files.keys()].map((path) => ({ path }))
    );
  }

  read(path: string): Promise<string | null> {
    const key = normalizeClassPath(path);
    return Promise.resolve(this.files.has(key) ? this.files.get(key)! : null);
  }

  write(path: string, source: string): Promise<void> {
    this.files.set(normalizeClassPath(path), source);
    return Promise.resolve();
  }

  remove(path: string): Promise<void> {
    this.files.delete(normalizeClassPath(path));
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(normalizeClassPath(path)));
  }
}

/** Convenience factory matching the platform-factory shape in authoring-ui. */
export function createMemoryClassVfs(
  initial?: Readonly<Record<string, string>>
): IdentifiedClassVfs {
  return new MemoryClassVfs(initial);
}
