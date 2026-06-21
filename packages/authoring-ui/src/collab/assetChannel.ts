/**
 * Peer-to-peer asset channel (collab P4 / docs 37 §11).
 *
 * Transports content-addressed asset BYTES between peers, out-of-band from the
 * CRDT. The protocol is LAZY and pull-based:
 *
 *   - A peer that lacks the bytes for a referenced hash broadcasts a REQUEST.
 *   - A peer that holds those bytes answers with a RESPONSE carrying the bytes.
 *   - The requester stores the bytes in its AssetStore (which fires
 *     `onAssetAvailable`, letting the UI resolve the placeholder → real asset).
 *
 * The engine is transport-AGNOSTIC: it talks to an `AssetTransport` (broadcast a
 * framed message / receive framed messages). The production transport rides the
 * encrypted y-webrtc mesh (see `webrtcAssetTransport`); tests use an in-process
 * loopback transport (mirroring P1's convergence-test wire, since y-webrtc needs
 * a real WebRTC stack absent in Node). This keeps the request/response logic
 * fully unit-testable without a browser.
 *
 * Framing (all integers little-endian):
 *   byte 0           : message type (1 = REQUEST, 2 = RESPONSE)
 *   REQUEST  : [type][u8 hashLen][hash utf8]
 *   RESPONSE : [type][u8 hashLen][hash utf8][u16 mimeLen][mime utf8][bytes…]
 */
import type { AssetStore } from "./assetStore.js";

const MSG_REQUEST = 1;
const MSG_RESPONSE = 2;

/**
 * A bidirectional, content-agnostic byte transport for the asset channel.
 * `broadcast` sends a framed message to all peers; `onMessage` receives framed
 * messages from peers (the engine never sees individual peer identities — a
 * request is answered by whoever has the bytes).
 */
export interface AssetTransport {
  /** Send a framed message to all connected peers. */
  broadcast(frame: Uint8Array): void;
  /** Subscribe to incoming framed messages. Returns an unsubscribe function. */
  onMessage(listener: (frame: Uint8Array) => void): () => void;
  /** Tear the transport down. */
  destroy(): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function encodeRequest(hash: string): Uint8Array {
  const h = enc.encode(hash);
  const out = new Uint8Array(2 + h.length);
  out[0] = MSG_REQUEST;
  out[1] = h.length;
  out.set(h, 2);
  return out;
}

function encodeResponse(hash: string, mime: string, bytes: Uint8Array): Uint8Array {
  const h = enc.encode(hash);
  const m = enc.encode(mime);
  const out = new Uint8Array(2 + h.length + 2 + m.length + bytes.length);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o++] = MSG_RESPONSE;
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

type Decoded =
  | { type: "request"; hash: string }
  | { type: "response"; hash: string; mime: string; bytes: Uint8Array }
  | null;

function decode(frame: Uint8Array): Decoded {
  if (frame.length < 2) return null;
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const type = frame[0];
  if (type === MSG_REQUEST) {
    const hashLen = frame[1];
    if (frame.length < 2 + hashLen) return null;
    const hash = dec.decode(frame.subarray(2, 2 + hashLen));
    return { type: "request", hash };
  }
  if (type === MSG_RESPONSE) {
    const hashLen = frame[1];
    let o = 2;
    if (frame.length < o + hashLen + 2) return null;
    const hash = dec.decode(frame.subarray(o, o + hashLen));
    o += hashLen;
    const mimeLen = dv.getUint16(o, true);
    o += 2;
    if (frame.length < o + mimeLen) return null;
    const mime = dec.decode(frame.subarray(o, o + mimeLen));
    o += mimeLen;
    const bytes = frame.subarray(o);
    return { type: "response", hash, mime, bytes };
  }
  return null;
}

export interface AssetSyncEngineOptions {
  /**
   * How long to wait before re-broadcasting a still-unfulfilled request
   * (default 4 s). A peer holding the asset may join after the first request.
   */
  retryMs?: number;
  /** Injected timer (tests). Defaults to setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Drives the lazy request/response asset protocol over an `AssetTransport`,
 * backed by an `AssetStore`. Owns retry timers for outstanding requests and
 * answers incoming requests from the store.
 */
export class AssetSyncEngine {
  private readonly unsubscribe: () => void;
  private readonly pending = new Map<string, unknown>(); // hash → retry handle
  private destroyed = false;
  private readonly retryMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly transport: AssetTransport,
    private readonly store: AssetStore,
    options: AssetSyncEngineOptions = {},
  ) {
    this.retryMs = options.retryMs ?? 4000;
    this.setTimer =
      options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.unsubscribe = transport.onMessage((frame) => this.handle(frame));
    // When ANY asset becomes available locally (e.g. arrived via a response, or
    // was externalized locally), clear a matching outstanding request.
    this.storeUnsub = store.onAssetAvailable((hash) => this.resolvePending(hash));
  }

  private readonly storeUnsub: () => void;

  /**
   * Request the bytes for `hash` if not already held locally. Idempotent: a
   * second request for an in-flight hash is ignored (the existing retry stands).
   * Returns true if a request was issued (i.e. the asset is actually missing).
   */
  request(hash: string): boolean {
    if (this.destroyed) return false;
    if (this.store.has(hash)) return false;
    if (this.pending.has(hash)) return false;
    this.broadcastRequest(hash);
    return true;
  }

  /** Request every hash in the list that is missing locally. */
  requestMany(hashes: Iterable<string>): void {
    for (const h of hashes) this.request(h);
  }

  /** Hashes with an outstanding (unfulfilled) request. */
  outstanding(): string[] {
    return Array.from(this.pending.keys());
  }

  private broadcastRequest(hash: string): void {
    // Arm the retry timer and record the pending entry BEFORE broadcasting: a
    // synchronous transport (the in-process loopback) can deliver the response
    // during `broadcast()`, which fires `onAssetAvailable` → `resolvePending`;
    // that must find the pending entry to clear it.
    const handle = this.setTimer(() => {
      // Still missing after the retry window? Re-broadcast (a holder may have
      // joined since). Stop once the store has it.
      if (this.destroyed || this.store.has(hash)) {
        this.pending.delete(hash);
        return;
      }
      this.pending.delete(hash);
      this.broadcastRequest(hash);
    }, this.retryMs);
    this.pending.set(hash, handle);
    this.transport.broadcast(encodeRequest(hash));
  }

  private resolvePending(hash: string): void {
    // Key PRESENCE is the "pending" authority (a timer handle may legitimately
    // be `undefined`/0), so test for `has`, not `handle !== undefined`.
    if (!this.pending.has(hash)) return;
    this.clearTimer(this.pending.get(hash));
    this.pending.delete(hash);
  }

  private handle(frame: Uint8Array): void {
    if (this.destroyed) return;
    const msg = decode(frame);
    if (!msg) return;
    if (msg.type === "request") {
      // Answer only if we hold the bytes. Multiple holders may answer; the
      // requester's store dedups by hash (a second put is a no-op).
      const stored = this.store.get(msg.hash);
      if (stored) {
        this.transport.broadcast(
          encodeResponse(stored.hash, stored.mime, stored.bytes),
        );
      }
      return;
    }
    // RESPONSE: store the bytes (fires onAssetAvailable → resolves placeholder).
    // Defensive: ignore a response we did not need or already have.
    if (msg.type === "response" && !this.store.has(msg.hash)) {
      // Copy out of the shared frame buffer — `subarray` aliases it.
      this.store.put(msg.hash, msg.bytes.slice(), msg.mime);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const handle of this.pending.values()) this.clearTimer(handle);
    this.pending.clear();
    this.storeUnsub();
    this.unsubscribe();
    this.transport.destroy();
  }
}

// ---------------------------------------------------------------------------
// Loopback transport (tests / in-process 2-peer) — mirrors P1's convergence wire
// ---------------------------------------------------------------------------

/**
 * Connect two (or more) in-process transports into a broadcast mesh: a frame
 * broadcast by one is delivered to all the others (never echoed to the sender).
 * Returns the connected transports.
 */
export function createLoopbackTransports(count: number): AssetTransport[] {
  const nodes: {
    listeners: Set<(f: Uint8Array) => void>;
  }[] = [];
  for (let i = 0; i < count; i++) nodes.push({ listeners: new Set() });

  return nodes.map((self, idx): AssetTransport => ({
    broadcast: (frame) => {
      // Deliver to every OTHER node, asynchronously-but-synchronously here (the
      // loopback is in-process; tests can rely on synchronous delivery).
      for (let j = 0; j < nodes.length; j++) {
        if (j === idx) continue;
        for (const fn of nodes[j].listeners) fn(frame);
      }
    },
    onMessage: (listener) => {
      self.listeners.add(listener);
      return () => self.listeners.delete(listener);
    },
    destroy: () => {
      self.listeners.clear();
    },
  }));
}
