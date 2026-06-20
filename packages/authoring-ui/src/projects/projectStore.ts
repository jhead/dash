// ---------------------------------------------------------------------------
// projectStore — IndexedDB-backed store for browser-persistent projects.
//
// WHY IndexedDB and not localStorage: a Dash project is a serialized `.fla`
// (saveFla → Uint8Array) that can be multi-MB once it embeds bitmaps/sounds.
// localStorage caps out at ~5 MB and stores only strings; IndexedDB stores
// binary blobs and has a far larger quota. We mirror the established
// `IndexedDbClassVfs` pattern (injectable IDBFactory for fake-indexeddb tests,
// promisified requests, awaited transaction completion).
//
// Storage model — ONE database (`dash-projects`) with a single object store
// (`projects`) keyed by the project NAME string. Each record:
//
//   { schemaVersion, name, bytes (Uint8Array), updatedAt, sizeBytes, thumbnail? }
//
// The autosave "current working" slot is just a reserved name
// (CURRENT_WORKING_KEY) so F5 restores the exact in-progress state regardless of
// whether the project has been named via Save As yet. A named Save As / Save
// writes BOTH the named record and the current-working record so a reload after
// a save restores into the named project.
//
// The small bits — the active project name and the recent-projects list — live
// in localStorage (see recentProjects.ts), mirroring preferences.ts hygiene:
// they are tiny, must be read synchronously on first render, and survive an
// IndexedDB wipe.
// ---------------------------------------------------------------------------

/** Current on-disk schema for a stored project record. Bump on breaking changes. */
export const PROJECT_SCHEMA_VERSION = 1;

/**
 * Reserved project name for the debounced autosave slot. Restored on app load so
 * a refresh recovers in-progress (possibly unnamed) work. Chosen to never
 * collide with a user-chosen name (the Save-As prompt rejects it / it is hidden
 * from the recent list).
 */
export const CURRENT_WORKING_KEY = "__dash_current__";

const DEFAULT_DB_NAME = "dash-projects";
const STORE = "projects";

/** Metadata describing a stored project (no bytes — cheap to enumerate). */
export interface ProjectMeta {
  /** Project name (the IndexedDB key). For the autosave slot this is CURRENT_WORKING_KEY. */
  readonly name: string;
  /** Epoch-ms of the last write. */
  readonly updatedAt: number;
  /** Serialized `.fla` byte length. */
  readonly sizeBytes: number;
  /** Optional small data-URI stage thumbnail (PNG). */
  readonly thumbnail?: string;
  /**
   * Optional monotonic write sequence (defense-in-depth, task 1316). When a
   * caller supplies a `seq` to {@link ProjectStore.put}, the store rejects a
   * write whose `seq` is STRICTLY LESS than the slot's current `seq` — so an
   * out-of-order stale autosave can never clobber a newer write to the same slot
   * even if the in-process generation guard is somehow bypassed. Writes without a
   * `seq` (legacy / explicit saves) always win.
   */
  readonly seq?: number;
}

/** A full stored project record (metadata + the serialized `.fla` bytes). */
export interface ProjectRecord extends ProjectMeta {
  readonly schemaVersion: number;
  readonly bytes: Uint8Array;
}

export interface ProjectStoreOptions {
  /** Database name. Defaults to `dash-projects`. */
  readonly dbName?: string;
  /** Injectable IDBFactory (defaults to the global `indexedDB`). For tests. */
  readonly indexedDB?: IDBFactory;
}

/** True if IndexedDB is usable (real browser or an injected factory). */
export function isProjectStoreAvailable(factory?: IDBFactory): boolean {
  if (factory) return true;
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/** Promisify an IDBRequest. */
function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Thrown when a write fails because the browser storage quota is exceeded. The
 * caller (autosave) treats this as non-fatal — the in-memory document is
 * untouched; only persistence is skipped — and surfaces a one-time warning.
 */
export class ProjectQuotaError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ProjectQuotaError";
    this.cause = cause;
  }
}

function isQuotaError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED"
    );
  }
  return err instanceof Error && /quota/i.test(err.message);
}

/**
 * IndexedDB-backed project store. One instance per app (the live store) or one
 * per test (a fresh injected IDBFactory).
 */
export class ProjectStore {
  private readonly dbName: string;
  private readonly factory: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options?: ProjectStoreOptions) {
    this.dbName = options?.dbName ?? DEFAULT_DB_NAME;
    const factory =
      options?.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (!factory) {
      throw new Error("ProjectStore: no IndexedDB factory available");
    }
    this.factory = factory;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = this.factory.open(this.dbName, PROJECT_SCHEMA_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // keyPath "name" → the record IS the value, keyed by its own name.
          db.createObjectStore(STORE, { keyPath: "name" });
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

  /** Await transaction completion so writes are durable before resolving. */
  private txDone(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = store.transaction;
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  /**
   * Persist a project's serialized bytes under `name`. Overwrites any existing
   * record with the same name. Throws {@link ProjectQuotaError} on quota
   * exhaustion so the autosave caller can degrade gracefully.
   */
  async put(
    name: string,
    bytes: Uint8Array,
    extra?: { updatedAt?: number; thumbnail?: string; seq?: number }
  ): Promise<ProjectMeta> {
    const record: ProjectRecord = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      name,
      bytes,
      updatedAt: extra?.updatedAt ?? Date.now(),
      sizeBytes: bytes.byteLength,
      ...(extra?.thumbnail ? { thumbnail: extra.thumbnail } : {}),
      ...(typeof extra?.seq === "number" ? { seq: extra.seq } : {}),
    };
    try {
      // A single readwrite transaction does the read-guard AND the write so the
      // seq comparison is atomic (no interleaving put on the same slot).
      const store = await this.tx("readwrite");
      if (typeof extra?.seq === "number") {
        const existing = normalizeRecord(
          (await reqAsync(store.get(name))) as unknown
        );
        if (existing && typeof existing.seq === "number" && extra.seq < existing.seq) {
          // Stale out-of-order write — keep the newer record. Resolve with the
          // EXISTING metadata so the caller treats it as a no-op success.
          await this.txDone(store);
          return {
            name: existing.name,
            updatedAt: existing.updatedAt,
            sizeBytes: existing.sizeBytes,
            ...(existing.thumbnail ? { thumbnail: existing.thumbnail } : {}),
            ...(typeof existing.seq === "number" ? { seq: existing.seq } : {}),
          };
        }
      }
      await reqAsync(store.put(record));
      await this.txDone(store);
    } catch (err) {
      if (isQuotaError(err)) {
        throw new ProjectQuotaError(
          `Storage quota exceeded saving project "${name}".`,
          err
        );
      }
      throw err;
    }
    return {
      name: record.name,
      updatedAt: record.updatedAt,
      sizeBytes: record.sizeBytes,
      ...(record.thumbnail ? { thumbnail: record.thumbnail } : {}),
      ...(typeof record.seq === "number" ? { seq: record.seq } : {}),
    };
  }

  /**
   * Read a stored project record by name, or null if absent. Returns null (and
   * does not throw) on a parse/schema mismatch so a single corrupt record never
   * bricks restore-on-load.
   */
  async get(name: string): Promise<ProjectRecord | null> {
    try {
      const store = await this.tx("readonly");
      const value = (await reqAsync(store.get(name))) as unknown;
      return normalizeRecord(value);
    } catch {
      return null;
    }
  }

  /** Delete a project by name. No-op if it does not exist. */
  async delete(name: string): Promise<void> {
    const store = await this.tx("readwrite");
    await reqAsync(store.delete(name));
    await this.txDone(store);
  }

  /**
   * List all stored project metadata (no bytes), most-recently-updated first.
   * The reserved current-working slot is excluded so it never shows as a named
   * project. Corrupt records are skipped.
   */
  async list(): Promise<readonly ProjectMeta[]> {
    let values: unknown[];
    try {
      const store = await this.tx("readonly");
      values = (await reqAsync(store.getAll())) as unknown[];
    } catch {
      return [];
    }
    const metas: ProjectMeta[] = [];
    for (const value of values) {
      const rec = normalizeRecord(value);
      if (!rec) continue;
      if (rec.name === CURRENT_WORKING_KEY) continue;
      metas.push({
        name: rec.name,
        updatedAt: rec.updatedAt,
        sizeBytes: rec.sizeBytes,
        ...(rec.thumbnail ? { thumbnail: rec.thumbnail } : {}),
      });
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  /** True if a project (or the current-working slot) exists under `name`. */
  async has(name: string): Promise<boolean> {
    try {
      const store = await this.tx("readonly");
      const key = await reqAsync(store.getKey(name));
      return key !== undefined;
    } catch {
      return false;
    }
  }
}

/**
 * Validate and coerce a raw IndexedDB value into a ProjectRecord, or null when
 * the value is missing required fields / has an unsupported schema. Future
 * schema versions migrate here; today only v1 exists, so a higher version is
 * tolerated by reading the known fields and an unknown shape is rejected.
 */
function normalizeRecord(value: unknown): ProjectRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") return null;
  const bytes = v.bytes;
  if (bytes instanceof Uint8Array) {
    return finishRecord(v, bytes);
  }
  // IndexedDB may hand back an ArrayBuffer depending on the implementation.
  if (bytes instanceof ArrayBuffer) {
    return finishRecord(v, new Uint8Array(bytes));
  }
  return null;
}

function finishRecord(v: Record<string, unknown>, bytes: Uint8Array): ProjectRecord {
  const schemaVersion =
    typeof v.schemaVersion === "number" ? v.schemaVersion : PROJECT_SCHEMA_VERSION;
  const updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : Date.now();
  const sizeBytes =
    typeof v.sizeBytes === "number" ? v.sizeBytes : bytes.byteLength;
  const thumbnail = typeof v.thumbnail === "string" ? v.thumbnail : undefined;
  const seq = typeof v.seq === "number" ? v.seq : undefined;
  return {
    schemaVersion,
    name: v.name as string,
    bytes,
    updatedAt,
    sizeBytes,
    ...(thumbnail ? { thumbnail } : {}),
    ...(typeof seq === "number" ? { seq } : {}),
  };
}

/** The live (browser-global) project store, created lazily on first use. */
let liveStore: ProjectStore | null = null;

/**
 * Return the shared live ProjectStore, or null when IndexedDB is unavailable
 * (SSR, privacy mode, ancient webview). Callers must tolerate null and skip
 * persistence.
 */
export function getProjectStore(): ProjectStore | null {
  if (!isProjectStoreAvailable()) return null;
  if (!liveStore) {
    try {
      liveStore = new ProjectStore();
    } catch {
      return null;
    }
  }
  return liveStore;
}
