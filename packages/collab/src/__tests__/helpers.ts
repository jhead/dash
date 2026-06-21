import * as Y from "yjs";
import type { FlashDocument } from "@flash/core";
import { FlashCollabBinding, type DocSource } from "../binding.js";

/** Tiny seeded PRNG (mulberry32) for reproducible random mutation sequences. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
export function randInt(rng: () => number, min: number, maxInclusive: number): number {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

/**
 * A mutable in-memory document source: holds the current doc and a listener set.
 * `set` replaces the doc and notifies (the local-edit path). `applyRemote`
 * replaces the doc WITHOUT notifying (mirrors replaceDoc not re-triggering an
 * outbound sync — but we still record it so tests can read the remote-applied doc).
 */
export class FakeDocSource implements DocSource {
  private doc: FlashDocument;
  private listeners = new Set<() => void>();
  remoteApplications = 0;

  constructor(initial: FlashDocument) {
    this.doc = initial;
  }
  getDoc(): FlashDocument {
    return this.doc;
  }
  /** Local edit: replace + notify (drives the outbound binding). */
  set(doc: FlashDocument): void {
    this.doc = doc;
    for (const l of [...this.listeners]) l();
  }
  applyRemote(doc: FlashDocument): void {
    this.doc = doc;
    this.remoteApplications++;
    // Notify so any downstream React-style subscribers update; the binding's
    // own onLocalChange is guarded by applyingRemote so this does not echo.
    for (const l of [...this.listeners]) l();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Wire two Y.Docs together in-process (no networking): every update on one is
 * applied to the other with a NON-local origin so the receiving binding's
 * inbound observer fires. Returns a teardown fn.
 */
export function wireYDocs(a: Y.Doc, b: Y.Doc): () => void {
  const remoteOrigin = { wire: "remote" };
  const aToB = (update: Uint8Array, origin: unknown) => {
    if (origin === remoteOrigin) return; // don't bounce
    Y.applyUpdate(b, update, remoteOrigin);
  };
  const bToA = (update: Uint8Array, origin: unknown) => {
    if (origin === remoteOrigin) return;
    Y.applyUpdate(a, update, remoteOrigin);
  };
  a.on("update", aToB);
  b.on("update", bToA);
  return () => {
    a.off("update", aToB);
    b.off("update", bToA);
  };
}

/**
 * Build a two-peer setup: peerA has the source binding; peerB is a passive
 * remote Y.Doc kept in sync over an in-process wire. Returns peerB's rebuilt
 * document accessor and a teardown.
 */
export function makeTwoPeers(initial: FlashDocument) {
  const source = new FakeDocSource(initial);
  const ydocA = new Y.Doc();
  const ydocB = new Y.Doc();
  const unwire = wireYDocs(ydocA, ydocB);
  const binding = new FlashCollabBinding(ydocA, source);
  // Sync the initial state across the wire.
  const initUpdate = Y.encodeStateAsUpdate(ydocA);
  Y.applyUpdate(ydocB, initUpdate, { wire: "remote" });
  return { source, ydocA, ydocB, binding, unwire };
}
