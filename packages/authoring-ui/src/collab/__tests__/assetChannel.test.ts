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
  sha256Hex,
  type FlashDocument,
} from "@flash/core";
import { AssetStore } from "../assetStore.js";
import {
  AssetSyncEngine,
  createLoopbackTransports,
  MAX_ASSET_BYTES,
} from "../assetChannel.js";
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
    // The holder stores bytes under their CANONICAL content hash (the requester
    // verifies sha256(received) === requested hash before accepting — task 1352).
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = sha256Hex(bytes);

    const [tA, tB] = createLoopbackTransports(2);
    const holder = new AssetStore();
    holder.put(hash, bytes, "image/png");
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
    // Bytes stored under their canonical content hash (verified on accept — 1352).
    const h1Bytes = new Uint8Array([4, 5, 6]);
    const h1 = sha256Hex(h1Bytes);
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
    engReq.request(h1);
    expect(requester.has(h1)).toBe(false);

    // Holder joins with the bytes and an engine on the mesh.
    holder.put(h1, h1Bytes, "image/png");
    const engHolder = new AssetSyncEngine(tA, holder);

    // Retry fires → re-broadcast → holder answers.
    scheduled!();
    expect(requester.has(h1)).toBe(true);
    expect(Array.from(requester.get(h1)!.bytes)).toEqual([4, 5, 6]);

    engReq.destroy();
    engHolder.destroy();
  });
});

// ---------------------------------------------------------------------------
// Adversarial inbound RESPONSE hardening (task 1352): size cap + hash verify.
// The asset channel accepts RESPONSE frames from ANY joined peer, so an inbound
// frame is untrusted. These cases prove (1) an oversized RESPONSE is dropped
// without an unbounded copy and the placeholder stays, and (2) a RESPONSE whose
// sha256(bytes) != requested hash is dropped (the content-addressed store is
// never poisoned), while (3) the honest holder's correct bytes still resolve.
// ---------------------------------------------------------------------------

/** Hand-frame a RESPONSE (type=2) the way the engine's encoder does, so a test
 *  can inject crafted/oversized/wrong bytes for a hash. */
function makeResponseFrame(hash: string, mime: string, bytes: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const h = enc.encode(hash);
  const m = enc.encode(mime);
  const out = new Uint8Array(2 + h.length + 2 + m.length + bytes.length);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o++] = 2; // MSG_RESPONSE
  out[o++] = h.length;
  out.set(h, o);
  o += h.length;
  dv.setUint16(o, m.length, true);
  o += 2;
  out.set(m, o);
  o += m.length;
  out.set(bytes, o);
  return out;
}

/** A transport whose inbound frames the test drives directly (`deliver`), and
 *  which records every outbound broadcast (so we can prove no copy was made). */
function injectableTransport(): {
  transport: ReturnType<typeof createLoopbackTransports>[number];
  deliver: (frame: Uint8Array) => void;
} {
  const listeners = new Set<(f: Uint8Array) => void>();
  return {
    transport: {
      broadcast: () => {},
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      destroy: () => listeners.clear(),
    },
    deliver: (frame) => {
      for (const fn of listeners) fn(frame);
    },
  };
}

describe("AssetSyncEngine inbound RESPONSE hardening (task 1352)", () => {
  it("drops an OVERSIZED RESPONSE without internalizing it (placeholder stays, no copy)", () => {
    const { transport, deliver } = injectableTransport();
    const store = new AssetStore();
    // Spy on put so we can prove the engine never tried to internalize/copy.
    let putCalls = 0;
    const realPut = store.put.bind(store);
    store.put = (h, b, m) => {
      putCalls++;
      realPut(h, b, m);
    };
    const eng = new AssetSyncEngine(transport, store);

    // Mark the hash as wanted so the engine would otherwise accept the response.
    eng.request("oversized");

    // Body one byte over the cap. The decode layer must reject it (return null)
    // BEFORE `bytes.slice()`, so put is never reached → no unbounded allocation.
    const huge = new Uint8Array(MAX_ASSET_BYTES + 1);
    const frame = makeResponseFrame("oversized", "image/png", huge);
    deliver(frame);

    expect(store.has("oversized")).toBe(false); // placeholder stays
    expect(putCalls).toBe(0); // never internalized → no copy made
    expect(eng.outstanding()).toContain("oversized"); // still unresolved
    eng.destroy();
  });

  it("drops a HASH-MISMATCH RESPONSE: arbitrary bytes for a hash never poison the store", () => {
    const { transport, deliver } = injectableTransport();
    const store = new AssetStore();
    const eng = new AssetSyncEngine(transport, store);

    // The victim wants the bytes for `wantHash` (sha256 of the HONEST bytes).
    const honest = new Uint8Array([10, 20, 30, 40]);
    const wantHash = sha256Hex(honest);
    eng.request(wantHash);

    // A malicious peer answers `wantHash` with ARBITRARY (poisoned) bytes.
    const poisoned = new Uint8Array([99, 98, 97, 96, 95]);
    expect(sha256Hex(poisoned)).not.toBe(wantHash);
    deliver(makeResponseFrame(wantHash, "image/png", poisoned));

    // Rejected: store never poisoned, placeholder stays until correct bytes come.
    expect(store.has(wantHash)).toBe(false);
    expect(eng.outstanding()).toContain(wantHash);

    // The HONEST holder later answers with bytes that DO hash to wantHash → accepted.
    deliver(makeResponseFrame(wantHash, "image/png", honest));
    expect(store.has(wantHash)).toBe(true);
    expect(Array.from(store.get(wantHash)!.bytes)).toEqual([10, 20, 30, 40]);
    expect(eng.outstanding()).not.toContain(wantHash);
    eng.destroy();
  });

  it("a VALID RESPONSE (sha256 matches, within cap) still resolves over loopback", () => {
    // The honest 2-peer path: holder's bytes hash to the requested hash → accepted.
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const hash = sha256Hex(bytes);

    const [tA, tB] = createLoopbackTransports(2);
    const holder = new AssetStore();
    holder.put(hash, bytes, "image/png");
    const requester = new AssetStore();

    const engHolder = new AssetSyncEngine(tA, holder);
    const engReq = new AssetSyncEngine(tB, requester);

    expect(engReq.request(hash)).toBe(true);
    expect(requester.has(hash)).toBe(true);
    expect(Array.from(requester.get(hash)!.bytes)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(engReq.outstanding()).toEqual([]);

    engHolder.destroy();
    engReq.destroy();
  });
});
