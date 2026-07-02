import { describe, it, expect } from "vitest";
import {
  MemoryClassVfs,
  createMemoryClassVfs,
  normalizeClassPath,
  splitClassPath,
  joinClassPath,
  isAsFile,
  InvalidClassPathError,
  hydrateVfsFromDoc,
  syncDocFromVfs,
  createDocument,
  addAsClass,
} from "../../index.js";
import type { FlashDocument } from "../../index.js";

describe("normalizeClassPath", () => {
  it("passes through a clean classpath path", () => {
    expect(normalizeClassPath("com/example/Foo.as")).toBe("com/example/Foo.as");
  });

  it("converts backslashes and collapses repeated slashes", () => {
    expect(normalizeClassPath("com\\\\example//Foo.as")).toBe("com/example/Foo.as");
  });

  it("strips a leading ./ or /", () => {
    expect(normalizeClassPath("./com/Foo.as")).toBe("com/Foo.as");
    expect(normalizeClassPath("/com/Foo.as")).toBe("com/Foo.as");
  });

  it("strips a trailing slash", () => {
    expect(normalizeClassPath("com/Foo.as/")).toBe("com/Foo.as");
  });

  it("rejects .. traversal", () => {
    expect(() => normalizeClassPath("../etc/passwd")).toThrow(InvalidClassPathError);
    expect(() => normalizeClassPath("com/../../x")).toThrow(InvalidClassPathError);
  });

  it("rejects an empty / dot-only path", () => {
    expect(() => normalizeClassPath("")).toThrow(InvalidClassPathError);
    expect(() => normalizeClassPath(".")).toThrow(InvalidClassPathError);
    expect(() => normalizeClassPath("/")).toThrow(InvalidClassPathError);
  });

  it("rejects a NUL byte", () => {
    expect(() => normalizeClassPath("a\0b.as")).toThrow(InvalidClassPathError);
  });
});

describe("splitClassPath / joinClassPath / isAsFile", () => {
  it("splits dirs from leaf file", () => {
    expect(splitClassPath("com/example/Foo.as")).toEqual({
      dirs: ["com", "example"],
      file: "Foo.as",
    });
  });

  it("splits a top-level file into empty dirs", () => {
    expect(splitClassPath("Foo.as")).toEqual({ dirs: [], file: "Foo.as" });
  });

  it("joins segments and normalizes", () => {
    expect(joinClassPath("com", "example", "Foo.as")).toBe("com/example/Foo.as");
    expect(joinClassPath("com/", "", "Foo.as")).toBe("com/Foo.as");
  });

  it("detects .as files case-insensitively", () => {
    expect(isAsFile("Foo.as")).toBe(true);
    expect(isAsFile("Foo.AS")).toBe(true);
    expect(isAsFile("Foo.txt")).toBe(false);
  });
});

describe("MemoryClassVfs", () => {
  it("reports its kind", () => {
    expect(new MemoryClassVfs().kind).toBe("memory");
  });

  it("write/read/exists/list/remove round-trip", async () => {
    const vfs = new MemoryClassVfs();
    expect(await vfs.exists("com/Foo.as")).toBe(false);
    expect(await vfs.read("com/Foo.as")).toBeNull();

    await vfs.write("com/Foo.as", "class Foo {}");
    expect(await vfs.exists("com/Foo.as")).toBe(true);
    expect(await vfs.read("com/Foo.as")).toBe("class Foo {}");

    await vfs.write("com/example/Bar.as", "class Bar {}");
    const list = (await vfs.list()).map((e) => e.path).sort();
    expect(list).toEqual(["com/Foo.as", "com/example/Bar.as"]);

    await vfs.remove("com/Foo.as");
    expect(await vfs.exists("com/Foo.as")).toBe(false);
    expect((await vfs.list()).map((e) => e.path)).toEqual(["com/example/Bar.as"]);
  });

  it("normalizes paths on every operation", async () => {
    const vfs = new MemoryClassVfs();
    await vfs.write("./com\\Foo.as", "x");
    expect(await vfs.read("com/Foo.as")).toBe("x");
  });

  it("remove of a missing file is a no-op", async () => {
    const vfs = new MemoryClassVfs();
    await expect(vfs.remove("nope.as")).resolves.toBeUndefined();
  });

  it("seeds from an initial map", async () => {
    const vfs = createMemoryClassVfs({ "a/B.as": "src" });
    expect(await vfs.read("a/B.as")).toBe("src");
  });
});

describe("hydrateVfsFromDoc / syncDocFromVfs round-trip", () => {
  function docWithClasses(files: Array<[string, string]>): FlashDocument {
    let doc = createDocument();
    for (const [path, source] of files) doc = addAsClass(doc, { path, source });
    return doc;
  }

  it("hydrate populates the VFS from doc.asClasses", async () => {
    const doc = docWithClasses([
      ["com/example/Foo.as", "class Foo {}"],
      ["Bar.as", "class Bar {}"],
    ]);
    const vfs = new MemoryClassVfs();
    const res = await hydrateVfsFromDoc(doc, vfs);
    expect(res.written.sort()).toEqual(["Bar.as", "com/example/Foo.as"]);
    expect(await vfs.read("com/example/Foo.as")).toBe("class Foo {}");
    expect(await vfs.read("Bar.as")).toBe("class Bar {}");
  });

  it("hydrate of a class-free doc writes nothing", async () => {
    const vfs = new MemoryClassVfs();
    const res = await hydrateVfsFromDoc(createDocument(), vfs);
    expect(res.written).toEqual([]);
    expect(await vfs.list()).toEqual([]);
  });

  it("hydrate with prune deletes VFS files absent from the doc", async () => {
    const vfs = new MemoryClassVfs({ "Stale.as": "old" });
    const doc = docWithClasses([["Foo.as", "class Foo {}"]]);
    await hydrateVfsFromDoc(doc, vfs, { prune: true });
    expect(await vfs.exists("Stale.as")).toBe(false);
    expect(await vfs.read("Foo.as")).toBe("class Foo {}");
  });

  it("hydrate without prune leaves extra VFS files untouched", async () => {
    const vfs = new MemoryClassVfs({ "External.as": "edited externally" });
    const doc = docWithClasses([["Foo.as", "class Foo {}"]]);
    await hydrateVfsFromDoc(doc, vfs);
    expect(await vfs.read("External.as")).toBe("edited externally");
  });

  it("sync pulls VFS edits back into doc.asClasses", async () => {
    const doc = docWithClasses([["Foo.as", "class Foo {}"]]);
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs);
    // Edit through the VFS, add a new file, and delete one.
    await vfs.write("Foo.as", "class Foo { var x; }");
    await vfs.write("com/Baz.as", "class Baz {}");

    const { doc: next, changed, removed } = await syncDocFromVfs(doc, vfs);
    expect(changed.sort()).toEqual(["Foo.as", "com/Baz.as"]);
    expect(removed).toEqual([]);
    const byPath = new Map((next.asClasses ?? []).map((c) => [c.path, c.source]));
    expect(byPath.get("Foo.as")).toBe("class Foo { var x; }");
    expect(byPath.get("com/Baz.as")).toBe("class Baz {}");
  });

  it("sync drops classes deleted from the VFS", async () => {
    const doc = docWithClasses([
      ["Foo.as", "class Foo {}"],
      ["Bar.as", "class Bar {}"],
    ]);
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs);
    await vfs.remove("Bar.as");

    const { doc: next, changed, removed } = await syncDocFromVfs(doc, vfs);
    expect(changed).toEqual([]);
    expect(removed).toEqual(["Bar.as"]);
    expect((next.asClasses ?? []).map((c) => c.path)).toEqual(["Foo.as"]);
  });

  it("sync is a no-op when nothing changed (no needless churn)", async () => {
    const doc = docWithClasses([["Foo.as", "class Foo {}"]]);
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs);
    const { doc: next, changed, removed } = await syncDocFromVfs(doc, vfs);
    expect(changed).toEqual([]);
    expect(removed).toEqual([]);
    expect(next).toBe(doc); // same reference => zero mutations
  });

  it("full doc -> vfs -> doc round-trip preserves classes", async () => {
    const doc = docWithClasses([
      ["com/example/Foo.as", "class Foo {}"],
      ["com/example/util/Helper.as", "class Helper {}"],
    ]);
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs);
    const { doc: next } = await syncDocFromVfs(doc, vfs);
    const orig = new Map((doc.asClasses ?? []).map((c) => [c.path, c.source]));
    const round = new Map((next.asClasses ?? []).map((c) => [c.path, c.source]));
    expect(round).toEqual(orig);
  });

  it("sync ignores non-.as files in the VFS", async () => {
    const doc = createDocument();
    const vfs = new MemoryClassVfs({ "notes.txt": "ignore me", "Foo.as": "class Foo {}" });
    const { doc: next, changed } = await syncDocFromVfs(doc, vfs);
    expect(changed).toEqual(["Foo.as"]);
    expect((next.asClasses ?? []).map((c) => c.path)).toEqual(["Foo.as"]);
  });

  // --- task 1390: remove-mode governs pruning of doc-only classes ------------
  //
  // In a collab session a class can be present in `doc.asClasses` (merged from a
  // remote peer via the per-class CRDT) but NOT yet mirrored into the local VFS.
  // The default "all" prune treats that as a deletion and drops it, pushing a
  // delete that wipes the peer's class for everyone. The remove-mode lets the
  // edit-time reconcile keep such classes.
  describe("remove mode (task 1390 concurrent-class drop)", () => {
    // Build a doc holding a LOCAL class (mirrored to the VFS) and a REMOTE class
    // that only exists in the doc (merged from a peer, not yet in the local VFS).
    async function localPlusRemote(): Promise<{
      doc: FlashDocument;
      vfs: MemoryClassVfs;
    }> {
      let doc = docWithClasses([["Local.as", "class Local {}"]]);
      const vfs = new MemoryClassVfs();
      await hydrateVfsFromDoc(doc, vfs); // VFS mirrors ONLY Local.as
      // A remote peer's class merges into the doc but is not in the local VFS.
      doc = addAsClass(doc, { path: "Remote.as", source: "class Remote {}" });
      return { doc, vfs };
    }

    it('DEFAULT ("all") drops a doc-only class (legacy save-time behaviour)', async () => {
      const { doc, vfs } = await localPlusRemote();
      const { doc: next, removed } = await syncDocFromVfs(doc, vfs);
      expect(removed).toEqual(["Remote.as"]);
      expect((next.asClasses ?? []).map((c) => c.path)).toEqual(["Local.as"]);
    });

    it('"none" NEVER drops a doc-only class — the remote peer\'s class survives', async () => {
      const { doc, vfs } = await localPlusRemote();
      const { doc: next, removed } = await syncDocFromVfs(doc, vfs, {
        remove: "none",
      });
      expect(removed).toEqual([]);
      const paths = (next.asClasses ?? []).map((c) => c.path).sort();
      expect(paths).toEqual(["Local.as", "Remote.as"]);
      // And the same reference is returned when nothing actually changed.
      expect(next).toBe(doc);
    });

    it("a Set drops ONLY the explicitly-removed path, keeping the remote class", async () => {
      // Local user removed Local.as via the VFS; a remote peer's Remote.as is in
      // the doc but not the VFS. Prune only Local.as.
      const { doc, vfs } = await localPlusRemote();
      await vfs.remove("Local.as");
      const { doc: next, removed } = await syncDocFromVfs(doc, vfs, {
        remove: new Set(["Local.as"]),
      });
      expect(removed).toEqual(["Local.as"]);
      const paths = (next.asClasses ?? []).map((c) => c.path);
      expect(paths).toEqual(["Remote.as"]);
    });
  });
});
