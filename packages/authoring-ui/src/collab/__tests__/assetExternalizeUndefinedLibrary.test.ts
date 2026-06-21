/**
 * Regression (task 1363, HIGH full-app crash): the collab P4 asset externalize
 * step must DEGRADE — never throw — on a document whose `library` (or
 * `library.items`) is undefined/malformed.
 *
 * The reported crash: the agent `doc_load` tool admits an unvalidated doc with
 * no `library` into `history.present`; a local store change then fires the collab
 * outbound `onLocalChange` subscription -> `getDoc` -> `externalizeAssets`, which
 * did `doc.library.items.map(...)` and threw an UNCATCHABLE TypeError (it runs
 * inside the Yjs/store subscription callback), taking down the whole app.
 *
 * These cases prove all four transforms in `assetExternalize.ts` treat an absent
 * library as empty (no throw) and round-trip a library-less doc to an equal doc.
 */
import { describe, it, expect } from "vitest";
import { createDocument, type FlashDocument } from "@flash/core";
import { AssetStore } from "../assetStore.js";
import {
  externalizeAssets,
  internalizeAssets,
  referencedAssetHashes,
  hasUnresolvedAssets,
} from "../assetExternalize.js";

/** A doc with NO library at all (the exact shape the reported crash produced). */
function docWithoutLibrary(): FlashDocument {
  const { library: _omit, ...rest } = createDocument();
  void _omit;
  return rest as unknown as FlashDocument;
}

/** A doc whose `library` exists but whose `items` is not an array. */
function docWithMalformedLibrary(): FlashDocument {
  const doc = createDocument();
  return {
    ...doc,
    library: { items: undefined, folders: [] },
  } as unknown as FlashDocument;
}

describe("collab externalize — undefined / malformed library (task 1363)", () => {
  it("externalizeAssets does NOT throw on a doc with undefined library", () => {
    const store = new AssetStore();
    const doc = docWithoutLibrary();
    expect(() => externalizeAssets(doc, store)).not.toThrow();
    // Absent library => nothing to externalize => SAME doc reference back.
    expect(externalizeAssets(doc, store)).toBe(doc);
  });

  it("externalizeAssets does NOT throw on a doc with malformed library.items", () => {
    const store = new AssetStore();
    const doc = docWithMalformedLibrary();
    expect(() => externalizeAssets(doc, store)).not.toThrow();
    expect(externalizeAssets(doc, store)).toBe(doc);
  });

  it("internalizeAssets does NOT throw on a doc with undefined library", () => {
    const store = new AssetStore();
    const doc = docWithoutLibrary();
    expect(() => internalizeAssets(doc, store)).not.toThrow();
    const result = internalizeAssets(doc, store);
    expect(result.doc).toBe(doc);
    expect(result.missing).toEqual([]);
  });

  it("hasUnresolvedAssets / referencedAssetHashes degrade on undefined library", () => {
    const doc = docWithoutLibrary();
    expect(() => hasUnresolvedAssets(doc)).not.toThrow();
    expect(() => referencedAssetHashes(doc)).not.toThrow();
    expect(hasUnresolvedAssets(doc)).toBe(false);
    expect(referencedAssetHashes(doc)).toEqual([]);
  });

  it("round-trips a library-less doc unchanged (externalize then internalize)", () => {
    const store = new AssetStore();
    const doc = docWithoutLibrary();
    const externalized = externalizeAssets(doc, store);
    const { doc: internalized, missing } = internalizeAssets(externalized, store);
    expect(missing).toEqual([]);
    // No bytes were ever moved into the store; the doc is byte-for-byte identical.
    expect(internalized).toEqual(doc);
  });

  it("a doc WITH a normal empty library still round-trips (no regression)", () => {
    const store = new AssetStore();
    const doc = createDocument(); // library = { items: [], folders: [] }
    const externalized = externalizeAssets(doc, store);
    expect(externalized).toBe(doc);
    const { doc: internalized, missing } = internalizeAssets(externalized, store);
    expect(internalized).toBe(doc);
    expect(missing).toEqual([]);
    expect(hasUnresolvedAssets(doc)).toBe(false);
    expect(referencedAssetHashes(doc)).toEqual([]);
  });
});
