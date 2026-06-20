import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  ProjectStore,
  ProjectQuotaError,
  CURRENT_WORKING_KEY,
  PROJECT_SCHEMA_VERSION,
} from "../projects/projectStore.js";

function freshStore(): ProjectStore {
  return new ProjectStore({
    indexedDB: new IDBFactory(),
    dbName: `test-${Math.random().toString(36).slice(2)}`,
  });
}

function bytesOf(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("ProjectStore (IndexedDB round-trip)", () => {
  let store: ProjectStore;
  beforeEach(() => {
    store = freshStore();
  });

  it("round-trips bytes + metadata under a name", async () => {
    const data = bytesOf("hello world fla bytes");
    const meta = await store.put("My Project", data);
    expect(meta.name).toBe("My Project");
    expect(meta.sizeBytes).toBe(data.byteLength);
    expect(meta.updatedAt).toBeGreaterThan(0);

    const rec = await store.get("My Project");
    expect(rec).not.toBeNull();
    expect(rec!.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(new TextDecoder().decode(rec!.bytes)).toBe("hello world fla bytes");
    expect(rec!.sizeBytes).toBe(data.byteLength);
  });

  it("returns null for a missing project", async () => {
    expect(await store.get("nope")).toBeNull();
    expect(await store.has("nope")).toBe(false);
  });

  it("overwrites an existing project with the same name", async () => {
    await store.put("p", bytesOf("v1"));
    await store.put("p", bytesOf("v2-longer"));
    const rec = await store.get("p");
    expect(new TextDecoder().decode(rec!.bytes)).toBe("v2-longer");
  });

  it("lists projects most-recent-first and excludes the current-working slot", async () => {
    await store.put("alpha", bytesOf("a"), { updatedAt: 1000 });
    await store.put("beta", bytesOf("b"), { updatedAt: 3000 });
    await store.put("gamma", bytesOf("c"), { updatedAt: 2000 });
    await store.put(CURRENT_WORKING_KEY, bytesOf("working"), { updatedAt: 9999 });

    const list = await store.list();
    expect(list.map((m) => m.name)).toEqual(["beta", "gamma", "alpha"]);
    expect(list.some((m) => m.name === CURRENT_WORKING_KEY)).toBe(false);
  });

  it("deletes a project", async () => {
    await store.put("doomed", bytesOf("x"));
    expect(await store.has("doomed")).toBe(true);
    await store.delete("doomed");
    expect(await store.has("doomed")).toBe(false);
    expect(await store.get("doomed")).toBeNull();
  });

  it("stores an optional thumbnail", async () => {
    await store.put("thumbed", bytesOf("x"), { thumbnail: "data:image/png;base64,AAA" });
    const rec = await store.get("thumbed");
    expect(rec!.thumbnail).toBe("data:image/png;base64,AAA");
  });

  it("persists the current-working autosave slot independently", async () => {
    await store.put(CURRENT_WORKING_KEY, bytesOf("in-progress"));
    const rec = await store.get(CURRENT_WORKING_KEY);
    expect(rec).not.toBeNull();
    expect(new TextDecoder().decode(rec!.bytes)).toBe("in-progress");
  });

  it("wraps a quota failure in ProjectQuotaError (graceful fallback)", async () => {
    // Inject a factory whose object-store put() throws a QuotaExceededError.
    const quotaStore = new ProjectStore({
      dbName: `quota-${Math.random().toString(36).slice(2)}`,
      indexedDB: makeQuotaFactory(),
    });
    await expect(quotaStore.put("p", bytesOf("x"))).rejects.toBeInstanceOf(
      ProjectQuotaError
    );
  });

  // ----- monotonic seq guard (defense-in-depth, task 1316) -----

  it("rejects an out-of-order stale write (lower seq) to the same slot", async () => {
    await store.put("Slot", bytesOf("newer"), { seq: 10 });
    // A stale write with a lower seq arrives late — it must NOT clobber.
    const meta = await store.put("Slot", bytesOf("stale-older"), { seq: 5 });
    expect(meta.seq).toBe(10); // returns the EXISTING (kept) metadata
    const rec = await store.get("Slot");
    expect(new TextDecoder().decode(rec!.bytes)).toBe("newer");
  });

  it("accepts an equal-or-higher seq write", async () => {
    await store.put("Slot", bytesOf("v10"), { seq: 10 });
    await store.put("Slot", bytesOf("v10b"), { seq: 10 }); // equal seq wins (re-save)
    expect(new TextDecoder().decode((await store.get("Slot"))!.bytes)).toBe("v10b");
    await store.put("Slot", bytesOf("v11"), { seq: 11 });
    expect(new TextDecoder().decode((await store.get("Slot"))!.bytes)).toBe("v11");
  });

  it("a seq-less write always wins (explicit saves are unconditional)", async () => {
    await store.put("Slot", bytesOf("v10"), { seq: 10 });
    await store.put("Slot", bytesOf("unconditional")); // no seq → overwrites
    expect(new TextDecoder().decode((await store.get("Slot"))!.bytes)).toBe(
      "unconditional"
    );
  });
});

/**
 * A minimal IDBFactory whose object-store `put` throws a quota-style error,
 * exercising the ProjectStore quota-mapping path without filling real storage.
 */
function makeQuotaFactory(): IDBFactory {
  const quotaErr = (() => {
    try {
      return new DOMException("quota", "QuotaExceededError");
    } catch {
      const e = new Error("QuotaExceededError");
      e.name = "QuotaExceededError";
      return e;
    }
  })();
  const fakeStore = {
    put: () => {
      throw quotaErr;
    },
  };
  const fakeTx = { objectStore: () => fakeStore };
  const fakeDb = {
    objectStoreNames: { contains: () => true },
    transaction: () => fakeTx,
    createObjectStore: () => fakeStore,
  };
  const open = () => {
    const req: Record<string, unknown> = { result: fakeDb };
    queueMicrotask(() => {
      (req.onsuccess as undefined | (() => void))?.();
    });
    return req;
  };
  return { open } as unknown as IDBFactory;
}
