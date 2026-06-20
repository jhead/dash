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

// PROOF for task q3efj (scenario a): syncDocFromVfs's add/match `===` compares a
// NORMALIZED vfs path against the RAW (un-normalized) doc.asClasses[].path, while
// the removal pass normalizes BOTH sides. When a doc carries a NON-normalized
// stored path (real flows: a `classes/<path>` zip entry key with a `./` prefix,
// a backslash path, or a real-FLA import), an edit through the VFS is NOT matched
// to the existing entry, so addAsClass APPENDS a duplicate instead of replacing —
// and the removal pass then KEEPS the stale duplicate (its normalized path is in
// the vfs set). Result: doc.asClasses holds two entries for one class; the
// compiler emits two DoInitActions for it; the no-change short-circuit never
// fires so every sync re-appends.

describe("syncDocFromVfs path-normalization match (q3efj scenario a)", () => {
  function docWith(path: string, source: string): FlashDocument {
    return addAsClass(createDocument(), { path, source });
  }

  it("PROOF: a non-normalized stored path duplicates instead of updating, leaking the stale source", async () => {
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

    // BUG: two entries for the same logical class survive — the stale raw-path one
    // plus the edited normalized one.
    const forFoo = entries.filter(
      (c) => normalizeClassPath(c.path) === normPath
    );
    // Demonstrate the duplication concretely.
    expect(forFoo.length).toBe(2);

    // The stale v1 source is STILL present in the doc that gets compiled/saved.
    const sources = forFoo.map((c) => c.source);
    expect(sources).toContain("class Foo { /* v1 stale */ }"); // <-- data NOT cleaned up
    expect(sources).toContain("class Foo { /* v2 EDITED */ }");

    // A correct sync would have exactly ONE entry (the edit), proving the loss:
    // the editor surface shows v2, but the persisted doc still carries v1.
    // This assertion documents the EXPECTED (post-fix) behaviour and currently fails-by-design
    // if uncommented:
    //   expect(forFoo.length).toBe(1);
    //   expect(forFoo[0].source).toBe("class Foo { /* v2 EDITED */ }");
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

  it("PROOF: the no-change short-circuit never fires for a non-normalized path (re-appends every sync)", async () => {
    const rawPath = "com\\example\\Win.as"; // backslash form (Windows / external tool)
    const normPath = normalizeClassPath(rawPath);
    const doc = docWith(rawPath, "class Win {}");
    const vfs = new MemoryClassVfs();
    await hydrateVfsFromDoc(doc, vfs, { prune: true });

    // No edit at all — just sync. A correct sync is a no-op; this one mutates.
    const { doc: next, changed } = await syncDocFromVfs(doc, vfs);
    // The unchanged file is reported as "changed" (re-added) and a duplicate appears.
    expect(changed).toContain(normPath);
    const forWin = (next.asClasses ?? []).filter(
      (c) => normalizeClassPath(c.path) === normPath
    );
    expect(forWin.length).toBe(2);
  });
});
