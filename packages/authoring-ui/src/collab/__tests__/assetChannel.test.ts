/**
 * Out-of-band asset channel (collab P4) — hash, externalize/internalize, and the
 * lazy request/response protocol over a loopback transport. No WebRTC, no React.
 */
import { describe, it, expect } from "vitest";
import {
  createDocument,
  addLibraryItem,
  createBitmap,
  bytesToDataUri,
  hashDataUri,
  isAssetHashRef,
  parseAssetHashRef,
  type FlashDocument,
} from "@flash/core";
import { AssetStore } from "../assetStore.js";
import { AssetSyncEngine, createLoopbackTransports } from "../assetChannel.js";
import {
  externalizeAssets,
  internalizeAssets,
  referencedAssetHashes,
  hasUnresolvedAssets,
} from "../assetExternalize.js";

function pngDataUri(seed: number): string {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + seed) & 0xff;
  return bytesToDataUri(bytes, "image/png");
}

function docWithBitmap(uri: string): FlashDocument {
  const doc = createDocument();
  const lib = addLibraryItem(
    doc.library,
    createBitmap("Pic", { dataUri: uri, originalWidth: 8, originalHeight: 8 }),
  );
  return { ...doc, library: lib };
}

describe("externalize / internalize", () => {
  it("externalize replaces the bitmap dataUri with an asset-hash ref and stashes bytes", () => {
    const uri = pngDataUri(1);
    const doc = docWithBitmap(uri);
    const store = new AssetStore();

    const ext = externalizeAssets(doc, store);
    const item = ext.library.items.find((i) => i.itemType === "bitmap")!;
    expect(isAssetHashRef((item as { dataUri: string }).dataUri)).toBe(true);
    const hash = parseAssetHashRef((item as { dataUri: string }).dataUri)!;
    expect(hash).toBe(hashDataUri(uri));
    // Bytes are held in the store, not the doc.
    expect(store.has(hash)).toBe(true);
    expect(store.size).toBe(1);
  });

  it("externalize is idempotent and returns the same reference when nothing to do", () => {
    const store = new AssetStore();
    const doc = docWithBitmap(pngDataUri(2));
    const ext1 = externalizeAssets(doc, store);
    const ext2 = externalizeAssets(ext1, store); // already externalized
    expect(ext2).toBe(ext1);
  });

  it("internalize resolves a ref when the bytes are held; reports missing otherwise", () => {
    const uri = pngDataUri(3);
    const sourceStore = new AssetStore();
    const ext = externalizeAssets(docWithBitmap(uri), sourceStore);
    const hash = hashDataUri(uri);

    // Peer with NO bytes: ref stays a placeholder, hash reported missing.
    const emptyStore = new AssetStore();
    const r1 = internalizeAssets(ext, emptyStore);
    expect(hasUnresolvedAssets(r1.doc)).toBe(true);
    expect(r1.missing).toEqual([hash]);

    // Peer that now has the bytes: ref resolves back to the original dataUri.
    const stored = sourceStore.get(hash)!;
    emptyStore.put(stored.hash, stored.bytes, stored.mime);
    const r2 = internalizeAssets(ext, emptyStore);
    expect(hasUnresolvedAssets(r2.doc)).toBe(false);
    expect(r2.missing).toEqual([]);
    const item = r2.doc.library.items.find((i) => i.itemType === "bitmap")!;
    expect((item as { dataUri: string }).dataUri).toBe(uri);
  });

  it("referencedAssetHashes lists the externalized hashes", () => {
    const store = new AssetStore();
    const ext = externalizeAssets(docWithBitmap(pngDataUri(4)), store);
    expect(referencedAssetHashes(ext)).toEqual([hashDataUri(pngDataUri(4))]);
  });
});

describe("AssetSyncEngine request/response over loopback", () => {
  it("a requester fetches missing bytes from a holder by hash", () => {
    const uri = pngDataUri(5);
    const hash = hashDataUri(uri);

    const [tA, tB] = createLoopbackTransports(2);
    const holder = new AssetStore();
    holder.put(hash, new Uint8Array([1, 2, 3]), "image/png");
    const requester = new AssetStore();

    const engHolder = new AssetSyncEngine(tA, holder);
    const engReq = new AssetSyncEngine(tB, requester);

    expect(requester.has(hash)).toBe(false);
    const issued = engReq.request(hash); // synchronous loopback delivery
    expect(issued).toBe(true);

    // Holder answered; requester now holds the bytes (no outstanding request).
    expect(requester.has(hash)).toBe(true);
    expect(Array.from(requester.get(hash)!.bytes)).toEqual([1, 2, 3]);
    expect(engReq.outstanding()).toEqual([]);

    engHolder.destroy();
    engReq.destroy();
  });

  it("a request for a hash already held locally issues nothing", () => {
    const [tA] = createLoopbackTransports(1);
    const store = new AssetStore();
    store.put("abc", new Uint8Array([9]), "image/png");
    const eng = new AssetSyncEngine(tA, store);
    expect(eng.request("abc")).toBe(false);
    eng.destroy();
  });

  it("a missing asset stays outstanding when no peer can answer, and retries", () => {
    let scheduled: (() => void) | null = null;
    const [tA] = createLoopbackTransports(1); // alone — nobody answers
    const store = new AssetStore();
    const eng = new AssetSyncEngine(tA, store, {
      retryMs: 100,
      setTimer: (fn) => {
        scheduled = fn;
        return 1;
      },
      clearTimer: () => {
        scheduled = null;
      },
    });
    expect(eng.request("nope")).toBe(true);
    expect(eng.outstanding()).toEqual(["nope"]);
    expect(scheduled).not.toBeNull();
    // Fire the retry: still missing, so it re-broadcasts (stays outstanding).
    scheduled!();
    expect(eng.outstanding()).toEqual(["nope"]);
    eng.destroy();
  });

  it("late-joining holder answers a re-broadcast retry", () => {
    let scheduled: (() => void) | null = null;
    const [tA, tB] = createLoopbackTransports(2);
    const requester = new AssetStore();
    const holder = new AssetStore();
    // Holder has no engine yet (it 'joins' between request and retry).
    const engReq = new AssetSyncEngine(tB, requester, {
      retryMs: 100,
      setTimer: (fn) => {
        scheduled = fn;
        return 1;
      },
      clearTimer: () => {
        scheduled = null;
      },
    });
    engReq.request("h1");
    expect(requester.has("h1")).toBe(false);

    // Holder joins with the bytes and an engine on the mesh.
    holder.put("h1", new Uint8Array([4, 5, 6]), "image/png");
    const engHolder = new AssetSyncEngine(tA, holder);

    // Retry fires → re-broadcast → holder answers.
    scheduled!();
    expect(requester.has("h1")).toBe(true);
    expect(Array.from(requester.get("h1")!.bytes)).toEqual([4, 5, 6]);

    engReq.destroy();
    engHolder.destroy();
  });
});
