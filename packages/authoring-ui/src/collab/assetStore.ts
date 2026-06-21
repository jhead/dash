/**
 * Content-addressed asset store (collab P4 / docs 37 §11).
 *
 * The CRDT carries only an `assetId` + content-hash for bitmaps/sounds/video
 * (per P0 the large bytes are intentionally kept OUT of the Y.Doc). This store
 * holds the actual bytes keyed by their SHA-256 content hash — so a peer that
 * already has the identical bytes (same hash) never needs them sent twice, and
 * the asset channel can answer a remote request for a hash from here.
 *
 * It is a thin, framework-free byte cache: in-memory only, populated as the
 * local document's assets are externalized (outbound) and as bytes arrive over
 * the asset channel (inbound). It does NOT persist — a reload re-derives it from
 * the freshly-loaded document, exactly like the renderer's image cache.
 */
import { mimeFromDataUri } from "@flash/core";

/** One stored asset: raw bytes + the MIME type recovered from its data URI. */
export interface StoredAsset {
  readonly hash: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

export class AssetStore {
  private readonly byHash = new Map<string, StoredAsset>();
  private readonly listeners = new Set<(hash: string) => void>();

  /** True if the bytes for `hash` are held locally. */
  has(hash: string): boolean {
    return this.byHash.has(hash);
  }

  /** The stored asset for `hash`, or undefined if not held locally. */
  get(hash: string): StoredAsset | undefined {
    return this.byHash.get(hash);
  }

  /** Number of distinct assets held. */
  get size(): number {
    return this.byHash.size;
  }

  /** All hashes currently held (for diagnostics / tests). */
  hashes(): string[] {
    return Array.from(this.byHash.keys());
  }

  /**
   * Store bytes under a content hash. Notifies listeners ONLY when the hash was
   * not already present (a no-op re-put never re-fires). The same hash always
   * maps to the same bytes (content-addressed), so a duplicate put is ignored.
   */
  put(hash: string, bytes: Uint8Array, mime: string): void {
    if (this.byHash.has(hash)) return;
    this.byHash.set(hash, { hash, bytes, mime });
    for (const fn of this.listeners) fn(hash);
  }

  /**
   * Subscribe to "an asset became available". Fires with the hash whenever a
   * NEW asset is stored (typically when a requested asset arrives over the
   * channel). Returns an unsubscribe function.
   */
  onAssetAvailable(listener: (hash: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop all bytes + listeners (session teardown). */
  clear(): void {
    this.byHash.clear();
    this.listeners.clear();
  }
}

/** Helper: derive the MIME for stored bytes from a data URI (octet-stream fallback). */
export function mimeForDataUri(dataUri: string): string {
  return mimeFromDataUri(dataUri);
}
