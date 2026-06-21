/**
 * Production asset transport over the y-webrtc mesh (collab P4 / docs 37 §11).
 *
 * The asset channel's request/response frames ride the SAME WebRTC peer
 * connections y-webrtc already maintains for the CRDT — there is no new server,
 * no second signaling connection, and no extra encryption to manage (the bytes
 * travel over the established, already-DTLS-encrypted simple-peer data channels;
 * the y-webrtc room password gates who can connect at all).
 *
 * y-webrtc's own message reader (`readMessage`) only understands message types
 * 0–4 and `console.error`s on anything else, so we cannot cleanly add a new
 * top-level y-webrtc message type. Instead we frame our asset messages with a
 * 4-byte MAGIC prefix and add our OWN `data` listener on each peer connection:
 * frames that start with the magic are consumed by us; everything else is left
 * for y-webrtc's handler. Our magic-prefixed frames also reach y-webrtc's
 * handler (both listeners fire), where they hit the unknown-type branch — a
 * benign `console.error` with no functional effect (it returns an empty reply).
 * We accept that minor log noise in exchange for not forking y-webrtc.
 *
 * Honest limit: large assets are sent as a single data-channel message. simple-
 * peer chunks large buffers internally, but very large bitmaps/sounds may still
 * stress a browser's data-channel buffer; chunked transfer + backpressure is a
 * documented follow-up. For typical authoring assets this is sufficient.
 */
import type { WebrtcProvider } from "y-webrtc";
import type { AssetTransport } from "./assetChannel.js";

/** 4-byte magic identifying an asset-channel frame ("DAS1"). */
const MAGIC = new Uint8Array([0x44, 0x41, 0x53, 0x31]);

function hasMagic(buf: Uint8Array): boolean {
  if (buf.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (buf[i] !== MAGIC[i]) return false;
  return true;
}

function toUint8(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return null;
}

/** A minimal view of the simple-peer connection objects y-webrtc exposes. */
interface PeerLike {
  send(data: Uint8Array): void;
  on(event: "data", cb: (data: unknown) => void): void;
  off?(event: "data", cb: (data: unknown) => void): void;
  removeListener?(event: "data", cb: (data: unknown) => void): void;
}
interface WebrtcConnLike {
  connected?: boolean;
  peer: PeerLike;
}
interface RoomLike {
  webrtcConns: Map<string, WebrtcConnLike>;
}

/**
 * Build an `AssetTransport` riding the provider's WebRTC connections. Polls for
 * new peer connections (y-webrtc adds them as peers join) and attaches our
 * data listener to each. Broadcast prefixes the magic and sends to every
 * connected peer.
 */
export function webrtcAssetTransport(provider: WebrtcProvider): AssetTransport {
  const listeners = new Set<(frame: Uint8Array) => void>();
  const wired = new WeakSet<PeerLike>();
  let destroyed = false;

  const onPeerData = (data: unknown) => {
    if (destroyed) return;
    const buf = toUint8(data);
    if (!buf || !hasMagic(buf)) return; // not ours — y-webrtc handles it
    const frame = buf.subarray(MAGIC.length);
    for (const fn of listeners) fn(frame);
  };

  const room = (): RoomLike | undefined =>
    (provider as unknown as { room?: RoomLike }).room;

  const wireExistingConns = () => {
    const r = room();
    if (!r) return;
    for (const conn of r.webrtcConns.values()) {
      const peer = conn.peer;
      if (!peer || wired.has(peer)) continue;
      wired.add(peer);
      peer.on("data", onPeerData);
    }
  };

  // y-webrtc has no "new connection" event, so poll for new peers. The interval
  // is light (a Map scan) and only runs for the session's lifetime.
  wireExistingConns();
  const poll = setInterval(wireExistingConns, 1000) as unknown as ReturnType<
    typeof setInterval
  >;

  const broadcast = (frame: Uint8Array) => {
    if (destroyed) return;
    const out = new Uint8Array(MAGIC.length + frame.length);
    out.set(MAGIC, 0);
    out.set(frame, MAGIC.length);
    const r = room();
    if (!r) return;
    for (const conn of r.webrtcConns.values()) {
      if (conn.connected === false) continue;
      try {
        conn.peer.send(out);
      } catch {
        // A peer that dropped mid-send — ignore; retry logic re-requests later.
      }
    }
  };

  return {
    broadcast,
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy: () => {
      destroyed = true;
      clearInterval(poll);
      listeners.clear();
      // Best-effort detach; peers are usually destroyed with the provider.
      const r = room();
      if (r) {
        for (const conn of r.webrtcConns.values()) {
          const peer = conn.peer;
          const off = peer?.off ?? peer?.removeListener;
          if (off && peer) off.call(peer, "data", onPeerData);
        }
      }
    },
  };
}
