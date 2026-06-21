/**
 * FlashCollabBinding — wires a local document source to a Y.Doc.
 *
 *  OUTBOUND: when the local document changes, diff it against the last-synced
 *  document (structural-sharing: descend only where references differ) and apply
 *  the delta to the Y.Doc inside ONE transaction tagged with `localOrigin`.
 *
 *  INBOUND: observe the Y.Doc deeply; on any update whose transaction origin is
 *  NOT `localOrigin` (i.e. it came from a remote peer / another binding), rebuild
 *  the document from the Y.Doc and hand it to `applyRemote` — which the host
 *  wires to `replaceDoc` (NOT pushDoc), so a remote edit never creates a local
 *  undo entry.
 *
 * No networking lives here: the Y.Doc is the sync boundary. A provider
 * (y-webrtc / y-websocket / an in-process test wire) replicates updates between
 * two Y.Docs; the binding only ever talks to its own Y.Doc.
 */
import * as Y from "yjs";
import type { FlashDocument } from "@flash/core";
import { materializeDoc, diffDoc, rebuildDoc } from "./schema.js";

/**
 * The minimal local-document interface the binding needs. The authoring-ui
 * adapter satisfies this from the zustand document store: `getDoc` reads
 * `history.present`, `applyRemote` calls `replaceDoc`, and `subscribe` fires on
 * every store change.
 */
export interface DocSource {
  /** Current authoritative document. */
  getDoc(): FlashDocument;
  /** Apply a remote-originated document WITHOUT creating an undo entry. */
  applyRemote(doc: FlashDocument): void;
  /** Subscribe to local document changes; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void;
}

export interface FlashCollabBindingOptions {
  /**
   * Transaction origin used to tag outbound (local) writes so the inbound
   * observer can ignore them. Defaults to a fresh unique symbol-like object.
   */
  localOrigin?: unknown;
}

export class FlashCollabBinding {
  readonly ydoc: Y.Doc;
  readonly localOrigin: unknown;
  private readonly source: DocSource;
  private readonly root: Y.Map<unknown>;
  /** The document we last projected into / rebuilt from the Y.Doc. */
  private lastSynced: FlashDocument;
  private unsubscribeStore: (() => void) | null = null;
  private readonly observer: (events: Y.YEvent<any>[], txn: Y.Transaction) => void;
  /** Guard so a remote-applied replaceDoc doesn't immediately echo back out. */
  private applyingRemote = false;
  private destroyed = false;

  constructor(ydoc: Y.Doc, source: DocSource, options: FlashCollabBindingOptions = {}) {
    this.ydoc = ydoc;
    this.source = source;
    this.localOrigin = options.localOrigin ?? { collab: "local-origin" };
    this.root = ydoc.getMap("doc");

    const initial = source.getDoc();

    // Seed the Y.Doc. If it is already populated (a second peer joining an
    // existing doc), adopt the Y.Doc's state instead of overwriting it.
    if (this.root.size === 0) {
      ydoc.transact(() => materializeDoc(ydoc, initial), this.localOrigin);
      this.lastSynced = initial;
    } else {
      const adopted = rebuildDoc(ydoc);
      this.lastSynced = adopted;
      this.applyingRemote = true;
      try {
        source.applyRemote(adopted);
      } finally {
        this.applyingRemote = false;
      }
    }

    // INBOUND.
    this.observer = (_events, txn) => {
      if (this.destroyed) return;
      if (txn.origin === this.localOrigin) return; // ignore our own writes
      const rebuilt = rebuildDoc(this.ydoc);
      this.lastSynced = rebuilt;
      this.applyingRemote = true;
      try {
        this.source.applyRemote(rebuilt);
      } finally {
        this.applyingRemote = false;
      }
    };
    this.root.observeDeep(this.observer);

    // OUTBOUND.
    this.unsubscribeStore = source.subscribe(() => this.onLocalChange());
  }

  /** Force an outbound sync of the current local document (normally automatic). */
  flush(): void {
    this.onLocalChange();
  }

  private onLocalChange(): void {
    if (this.destroyed) return;
    if (this.applyingRemote) return; // change caused by our own applyRemote
    const next = this.source.getDoc();
    if (next === this.lastSynced) return; // referentially unchanged: nothing to do
    const prev = this.lastSynced;
    this.ydoc.transact(() => diffDoc(this.ydoc, prev, next), this.localOrigin);
    this.lastSynced = next;
  }

  /** Detach all listeners. Does not destroy the Y.Doc (the caller owns it). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.unobserveDeep(this.observer);
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
  }
}

/**
 * Convenience: project a FlashDocument into a brand-new Y.Doc in one call.
 * Used by tests and by a provider that needs an initial Y.Doc to share.
 */
export function flashDocToYDoc(doc: FlashDocument, origin: unknown = { collab: "init" }): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => materializeDoc(ydoc, doc), origin);
  return ydoc;
}

/** Convenience: rebuild a FlashDocument from a Y.Doc. */
export function yDocToFlashDoc(ydoc: Y.Doc): FlashDocument {
  return rebuildDoc(ydoc);
}
