import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createClassVfs } from "../vfs/factory.js";
import {
  IndexedDbClassVfs,
  hydrateVfsFromDoc,
  syncDocFromVfs,
} from "../vfs/index.js";
import { createDocument, addAsClass } from "@flash/core";
import type { FlashDocument } from "@flash/core";

describe("createClassVfs (platform factory)", () => {
  function setNavigator(value: unknown): void {
    Object.defineProperty(globalThis, "navigator", {
      value,
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    // No Tauri, no OPFS => exercise OPFS-vs-fallback selection.
    setNavigator(undefined);
    delete (globalThis as Record<string, unknown>).window;
  });

  it("falls back to memory when no storage is available", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.indexedDB;
    g.indexedDB = undefined;
    try {
      expect(createClassVfs().kind).toBe("memory");
    } finally {
      g.indexedDB = saved;
    }
  });

  it("picks OPFS when navigator.storage.getDirectory exists", () => {
    setNavigator({
      storage: { getDirectory: () => Promise.resolve({}) },
    });
    expect(createClassVfs().kind).toBe("opfs");
  });
});

describe("hydrate/sync round-trip against the IndexedDB fallback backend", () => {
  function docWith(files: Array<[string, string]>): FlashDocument {
    let doc = createDocument();
    for (const [p, s] of files) doc = addAsClass(doc, { path: p, source: s });
    return doc;
  }

  it("doc -> IndexedDB VFS -> doc preserves classes and reflects edits", async () => {
    const vfs = new IndexedDbClassVfs({
      indexedDB: new IDBFactory(),
      dbName: "roundtrip",
    });
    const doc = docWith([
      ["com/example/Foo.as", "class Foo {}"],
      ["Bar.as", "class Bar {}"],
    ]);

    // Open: hydrate the backend from the embedded classes.
    await hydrateVfsFromDoc(doc, vfs);
    expect(await vfs.read("com/example/Foo.as")).toBe("class Foo {}");

    // Edit through the VFS (as the panel/editor would).
    await vfs.write("com/example/Foo.as", "class Foo { var x; }");
    await vfs.write("Baz.as", "class Baz {}");
    await vfs.remove("Bar.as");

    // Save: reconcile back into the document.
    const { doc: next, changed, removed } = await syncDocFromVfs(doc, vfs);
    const byPath = new Map((next.asClasses ?? []).map((c) => [c.path, c.source]));
    expect(byPath.get("com/example/Foo.as")).toBe("class Foo { var x; }");
    expect(byPath.get("Baz.as")).toBe("class Baz {}");
    expect(byPath.has("Bar.as")).toBe(false);
    expect([...changed].sort()).toEqual(["Baz.as", "com/example/Foo.as"]);
    expect(removed).toEqual(["Bar.as"]);
  });
});
