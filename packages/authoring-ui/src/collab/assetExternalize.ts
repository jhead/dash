/**
 * Out-of-band asset externalization for collaboration (collab P4 / docs 37).
 *
 * The design point of P4 (stated in P0): bitmap/sound/video BYTES must never
 * enter the CRDT — only an `assetId` + content hash. This module is the seam
 * that enforces it, mirroring the `.fla` zip externalization (`zip.ts`, where a
 * library item's inline `dataUri` is replaced by a short `asset:<path>`
 * reference and the bytes are stored separately).
 *
 * Two pure transforms, applied at the collab adapter boundary (NOT inside the
 * @flash/collab binding, so the P0 property test — which has no asset store —
 * keeps round-tripping `dataUri` as a plain scalar):
 *
 *   - OUTBOUND (`externalizeAssets`): before the local document is projected
 *     into the Y.Doc, replace each media item's full `dataUri` with an
 *     `asset-hash:<sha256>` reference and stash the real bytes in the local
 *     AssetStore. The Y.Doc then only ever carries the small reference.
 *
 *   - INBOUND (`internalizeAssets`): after a remote document is rebuilt from the
 *     Y.Doc, replace each `asset-hash:<hash>` reference with the real `dataUri`
 *     IF the bytes are held locally; otherwise leave the reference in place (a
 *     "missing asset" placeholder the renderer shows until the bytes arrive) and
 *     collect the hash as one to fetch over the asset channel.
 *
 * Already-externalized references pass through untouched in both directions, so
 * the transform is idempotent and a peer that simply lacks an asset never loses
 * the reference.
 */
import type { FlashDocument, LibraryItem } from "@flash/core";
import {
  assetHashRef,
  bytesToDataUri,
  dataUriToBytes,
  hashDataUri,
  isAssetHashRef,
  mimeFromDataUri,
  parseAssetHashRef,
} from "@flash/core";
import type { AssetStore } from "./assetStore.js";

/** Media item types whose bytes are externalized out of the CRDT. */
function isMediaItem(
  item: LibraryItem,
): item is Extract<LibraryItem, { dataUri: string }> {
  return (
    item.itemType === "bitmap" ||
    item.itemType === "sound" ||
    item.itemType === "video"
  );
}

/**
 * Replace inline media `dataUri`s with `asset-hash:<hash>` references, stashing
 * the bytes in `store`. Returns the SAME document reference when nothing needed
 * externalizing (so the structural-sharing diff in the binding stays a no-op).
 *
 * A `dataUri` that is empty, already an `asset-hash:` reference, or already an
 * `asset:` zip reference is left as-is.
 */
export function externalizeAssets(
  doc: FlashDocument,
  store: AssetStore,
): FlashDocument {
  let changed = false;
  const items = doc.library.items.map((item): LibraryItem => {
    if (!isMediaItem(item)) return item;
    const uri = item.dataUri;
    if (!uri || isAssetHashRef(uri) || uri.startsWith("asset:")) return item;
    if (!uri.startsWith("data:")) return item; // not inline bytes — leave alone
    const hash = hashDataUri(uri);
    if (!store.has(hash)) {
      store.put(hash, dataUriToBytes(uri), mimeFromDataUri(uri));
    }
    changed = true;
    return { ...item, dataUri: assetHashRef(hash) };
  });
  if (!changed) return doc;
  return { ...doc, library: { ...doc.library, items } };
}

/** Result of resolving a remote document's externalized asset references. */
export interface InternalizeResult {
  /** The document with locally-held assets resolved to real data URIs. */
  doc: FlashDocument;
  /** Hashes referenced by the doc whose bytes are NOT held locally (to fetch). */
  missing: string[];
}

/**
 * Replace `asset-hash:<hash>` references with the real `dataUri` for every
 * media item whose bytes are held in `store`. References whose bytes are absent
 * are left in place (the renderer treats an unresolved reference as a missing
 * asset and draws a placeholder) and their hashes are returned in `missing` so
 * the caller can request them over the asset channel.
 *
 * Returns the SAME document reference when nothing changed and nothing is
 * missing (a fully-resolved or asset-free doc), so a re-internalize is a no-op.
 */
export function internalizeAssets(
  doc: FlashDocument,
  store: AssetStore,
): InternalizeResult {
  let changed = false;
  const missingSet = new Set<string>();
  const items = doc.library.items.map((item): LibraryItem => {
    if (!isMediaItem(item)) return item;
    const hash = parseAssetHashRef(item.dataUri);
    if (hash === null) return item;
    const stored = store.get(hash);
    if (!stored) {
      missingSet.add(hash);
      return item; // leave the placeholder reference in place
    }
    changed = true;
    return { ...item, dataUri: bytesToDataUri(stored.bytes, stored.mime) };
  });
  const missing = Array.from(missingSet);
  if (!changed) return { doc, missing };
  return { doc: { ...doc, library: { ...doc.library, items } }, missing };
}

/** True if the document still references any externalized asset by hash. */
export function hasUnresolvedAssets(doc: FlashDocument): boolean {
  return doc.library.items.some(
    (item) => isMediaItem(item) && isAssetHashRef(item.dataUri),
  );
}

/** Every distinct asset hash referenced (resolved or not) by the document. */
export function referencedAssetHashes(doc: FlashDocument): string[] {
  const set = new Set<string>();
  for (const item of doc.library.items) {
    if (!isMediaItem(item)) continue;
    const hash = parseAssetHashRef(item.dataUri);
    if (hash !== null) set.add(hash);
  }
  return Array.from(set);
}

export { isAssetHashRef };
