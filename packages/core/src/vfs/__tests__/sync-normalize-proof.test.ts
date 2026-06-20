import { describe, it, expect } from "vitest";
import {
  MemoryClassVfs,
  hydrateVfsFromDoc,
  syncDocFromVfs,
  normalizeClassPath,
} from "../../index.js";
import { createDocument } from "../../index.js";
import { addAsClass } from "../../model/document-mutations.js";
import type { FlashDocument } from "../../index.js";

// REGRESSION GATE for task 1317 Bug A (q3efj scenario a): syncDocFromVfs's
// add/match used to compare a NORMALIZED vfs path against the RAW
// (un-normalized) doc.asClasses[].path, while the removal pass normalized BOTH
// sides. When a doc carried a NON-normalized stored path (real flows: a
// `classes/<path>` zip entry key with a `./` prefix, a backslash path, or a
// real-FLA import), an edit through the VFS was NOT matched to the existing
// entry, so addAsClass APPENDED a duplicate instead of replacing — and the
// removal pass then KEPT the stale duplicate. Result: doc.asClasses held two
// entries for one class; the compiler emitted two DoInitActions; the no-change
// short-circuit never fired so every sync re-appended.
//
// FIX: addAsClass/updateAsClass/removeAsClass and syncDocFromVfs now match on
// the CANONICAL (normalized) path, and addAsClass + loadFla store the canonical
// form. The assertions below are the POST-FIX form (exactly ONE entry, the
// edit), so they fail loudly if the normalization match ever regresses.

describe("syncDocFromVfs path-normalization match (q3efj scenario a)", () => {
  function docWith(path: string, source: string): FlashDocument {
    return addAsClass(createDocument(), { path, source });
  }

  it("a non-normalized stored path UPDATES IN PLACE (no duplicate, no stale source)", async () => {
    // A doc whose stored class path is NOT in normalized form (e.g. loaded from a
    // zip entry key "./com/example/Foo.as", which loadFla does not normalize).
    const rawPath = "./com/example/Foo.as";
    const normPath = normalizeClassPath(rawPath); // "com/example/Foo.as"
    expect(rawPath).not.toBe(normPath);

    const doc = docWith(rawPath, "class Foo { /* v1 stale */ }");

    // Open: hydrate writes the NORMALIZED path into the VFS.
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs, { prune: true });
    expect(await vfs.read(normPath)).toBe("class Foo { /* v1 stale */ }");

    // Edit through the VFS (what the panel does on every keystroke).
    await vfs.write(normPath, "class Foo { /* v2 EDITED */ }");

    // Sync back into the doc (what save/publish/test does).
    const { doc: next } = await syncDocFromVfs(doc, vfs);

    const entries = next.asClasses ?? [];

    // FIXED: exactly ONE entry for the logical class — the edit — with the stale
    // raw-path duplicate collapsed away.
    const forFoo = entries.filter(
      (c) => normalizeClassPath(c.path) === normPath
    );
    expect(forFoo.length).toBe(1);
    expect(forFoo[0]!.source).toBe("class Foo { /* v2 EDITED */ }");
    // The stale v1 source is GONE from the doc that gets compiled/saved.
    expect(forFoo.map((c) => c.source)).not.toContain(
      "class Foo { /* v1 stale */ }"
    );
    // The surviving entry's stored path is canonical (normalized).
    expect(forFoo[0]!.path).toBe(normPath);
  });

  it("CONTROL: an already-normalized stored path updates in place (no duplicate)", async () => {
    const normPath = "com/example/Foo.as";
    const doc = docWith(normPath, "class Foo { /* v1 */ }");
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs, { prune: true });
    await vfs.write(normPath, "class Foo { /* v2 */ }");
    const { doc: next } = await syncDocFromVfs(doc, vfs);
    const forFoo = (next.asClasses ?? []).filter(
      (c) => normalizeClassPath(c.path) === normPath
    );
    expect(forFoo.length).toBe(1);
    expect(forFoo[0]!.source).toBe("class Foo { /* v2 */ }");
  });

  it("the no-change short-circuit fires for a non-normalized path (sync is a no-op)", async () => {
    const rawPath = "com\\example\\Win.as"; // backslash form (Windows / external tool)
    const normPath = normalizeClassPath(rawPath);
    const doc = docWith(rawPath, "class Win {}");
    // addAsClass now CANONICALIZES on store, so the doc already holds the
    // normalized path — and even if it didn't, syncDocFromVfs matches by
    // normalized path below.
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs, { prune: true });

    // No edit at all — just sync. A correct sync is a no-op.
    const { doc: next, changed } = await syncDocFromVfs(doc, vfs);
    // The unchanged file is NOT re-added and no duplicate appears.
    expect(changed).not.toContain(normPath);
    const forWin = (next.asClasses ?? []).filter(
      (c) => normalizeClassPath(c.path) === normPath
    );
    expect(forWin.length).toBe(1);
  });
});
