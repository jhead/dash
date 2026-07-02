import type { IdentifiedClassVfs, ClassVfsEntry } from "@flash/core";
import { normalizeClassPath } from "@flash/core";
import { withQuotaMapping } from "./quota.js";

// ---------------------------------------------------------------------------
// IndexedDbClassVfs — the OPFS fallback for browsers without
// `navigator.storage.getDirectory` (older Safari/Firefox, some embedded
// webviews). IndexedDB is available essentially everywhere a browser runs.
//
// Storage model: ONE object store (`files`) keyed by the normalized
// classpath-relative path string (e.g. `com/example/Foo.as`), value = source
// text. There is no real directory tree (IndexedDB has none) — the "nested
// package" structure is implicit in the slash-delimited key, which is exactly
// the classpath path the ClassVfs contract speaks in. `list()` enumerates keys.
//
// The IDBFactory is injectable (`options.indexedDB`) so the unit tests can pass
// `fake-indexeddb` under Node/vitest without a real browser.
// ---------------------------------------------------------------------------

const DEFAULT_DB_NAME = "dash-classes";
const STORE = "files";

/** True if IndexedDB is usable (real browser or an injected factory). */
export function isIndexedDbAvailable(factory?: IDBFactory): boolean {
  if (factory) return true;
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

export interface IndexedDbClassVfsOptions {
  /** Database name. Defaults to `dash-classes`. */
  readonly dbName?: string;
  /** Injectable IDBFactory (defaults to the global `indexedDB`). For tests. */
  readonly indexedDB?: IDBFactory;
}

/** Promisify an IDBRequest. */
function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbClassVfs implements IdentifiedClassVfs {
  readonly kind = "indexeddb" as const;
  private readonly dbName: string;
  private readonly factory: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options?: IndexedDbClassVfsOptions) {
    this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
    const factory = options?.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (!factory) {
      throw new Error("IndexedDbClassVfs: no IndexedDB factory available");
    }
    this.factory = factory;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.openDb();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<readonly ClassVfsEntry[]> {
    const store = await this.tx("readonly");
    const keys = (await reqAsync(store.getAllKeys())) as IDBValidKey[];
    return keys
      .filter((k): k is string => typeof k === "string")
      .map((path) => ({ path }));
  }

  async read(path: string): Promise<string | null> {
    const key = normalizeClassPath(path);
    const store = await this.tx("readonly");
    const value = await reqAsync(store.get(key));
    return typeof value === "string" ? value : null;
  }

  async write(path: string, source: string): Promise<void> {
    // Mirror the OPFS backend: translate a QuotaExceededError into a typed
    // ClassVfsQuotaError (task 1404) so a full-storage failure is a surfaceable
    // warning, not a swallowed rejection.
    await withQuotaMapping(path, async () => {
      const key = normalizeClassPath(path);
      const store = await this.tx("readwrite");
      await reqAsync(store.put(source, key));
      await this.txDone(store);
    });
  }

  async remove(path: string): Promise<void> {
    const key = normalizeClassPath(path);
    const store = await this.tx("readwrite");
    await reqAsync(store.delete(key));
    await this.txDone(store);
  }

  async exists(path: string): Promise<boolean> {
    const key = normalizeClassPath(path);
    const store = await this.tx("readonly");
    // getKey resolves to the key if present, undefined otherwise — cheaper than get.
    const found = await reqAsync(store.getKey(key));
    return found !== undefined;
  }

  /** Await transaction completion so writes are durable before resolving. */
  private txDone(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = store.transaction;
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
}

/** Factory matching the platform-factory shape. */
export function createIndexedDbClassVfs(
  options?: IndexedDbClassVfsOptions
): IdentifiedClassVfs {
  return new IndexedDbClassVfs(options);
}
