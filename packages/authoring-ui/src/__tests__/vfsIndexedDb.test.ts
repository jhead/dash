import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  IndexedDbClassVfs,
  isIndexedDbAvailable,
} from "../vfs/indexeddb.js";

// fake-indexeddb provides a spec-compliant IndexedDB under Node, injected via
// the backend's `indexedDB` option (no real browser / jsdom needed).

describe("isIndexedDbAvailable", () => {
  it("is true when an explicit factory is provided", () => {
    expect(isIndexedDbAvailable(new IDBFactory())).toBe(true);
  });
});

describe("IndexedDbClassVfs (OPFS fallback)", () => {
  let vfs: IndexedDbClassVfs;

  beforeEach(() => {
    // Fresh DB name per test so stores never leak between cases.
    vfs = new IndexedDbClassVfs({
      indexedDB: new IDBFactory(),
      dbName: `test-${Math.random().toString(36).slice(2)}`,
    });
  });

  it("reports kind indexeddb", () => {
    expect(vfs.kind).toBe("indexeddb");
  });

  it("write/read/exists round-trip keyed by classpath path", async () => {
    expect(await vfs.exists("com/example/Foo.as")).toBe(false);
    expect(await vfs.read("com/example/Foo.as")).toBeNull();
    await vfs.write("com/example/Foo.as", "class Foo {}");
    expect(await vfs.exists("com/example/Foo.as")).toBe(true);
    expect(await vfs.read("com/example/Foo.as")).toBe("class Foo {}");
  });

  it("normalizes the path key (backslashes / leading ./)", async () => {
    await vfs.write("./com\\Foo.as", "x");
    expect(await vfs.read("com/Foo.as")).toBe("x");
    expect(await vfs.exists("com/Foo.as")).toBe(true);
  });

  it("list enumerates all stored paths", async () => {
    await vfs.write("com/Foo.as", "a");
    await vfs.write("com/example/Bar.as", "b");
    await vfs.write("Top.as", "c");
    const paths = (await vfs.list()).map((e) => e.path).sort();
    expect(paths).toEqual(["Top.as", "com/Foo.as", "com/example/Bar.as"]);
  });

  it("overwrites an existing file", async () => {
    await vfs.write("Foo.as", "v1");
    await vfs.write("Foo.as", "v2");
    expect(await vfs.read("Foo.as")).toBe("v2");
  });

  it("remove deletes a file; remove of a missing file is a no-op", async () => {
    await vfs.write("Foo.as", "x");
    await vfs.remove("Foo.as");
    expect(await vfs.exists("Foo.as")).toBe(false);
    await expect(vfs.remove("Foo.as")).resolves.toBeUndefined();
  });

  it("writes are durable across a fresh handle to the same DB", async () => {
    const factory = new IDBFactory();
    const name = "persist-db";
    const a = new IndexedDbClassVfs({ indexedDB: factory, dbName: name });
    await a.write("Keep.as", "kept");
    const b = new IndexedDbClassVfs({ indexedDB: factory, dbName: name });
    expect(await b.read("Keep.as")).toBe("kept");
  });
});
