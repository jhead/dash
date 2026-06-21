/**
 * Signaling-server configuration for the y-webrtc transport (task 1344 P1).
 *
 * IMPORTANT — what the signaling server is and is NOT:
 *   The signaling server's ONLY job is to broker the initial WebRTC handshake:
 *   it relays SDP offers/answers and ICE candidates so two browsers can discover
 *   each other and open a direct peer-to-peer connection. Once that connection is
 *   established, ALL document bytes flow peer-to-peer over WebRTC and never touch
 *   the signaling server.
 *
 *   The signaling server NEVER sees:
 *     - the document contents (they go P2P over WebRTC),
 *     - the room password `k` (it is derived into an AES-GCM key client-side and
 *       every y-webrtc message is end-to-end encrypted with it; `k` lives only in
 *       the share-link fragment, which browsers never transmit).
 *
 * The PRIMARY default below is OUR OWN serverless signaling server — a Cloudflare
 * Worker + Durable Object that speaks y-webrtc's exact pub/sub signaling protocol
 * (see `workers/signaling/` and docs/37-collab.md §13.5). It is a drop-in for the
 * stock y-webrtc transport: the client is unchanged, only this URL points at our
 * worker instead of a third-party public server. As a handshake-only broker it
 * never sees document bytes or the room password (see the file header above).
 *
 * A public Yjs server is kept as a SECONDARY fallback so a session can still
 * signal if our worker is unreachable (a peer connects to ALL listed servers and
 * any one is sufficient to broker the handshake). The whole list is user-editable
 * (Share dialog → Signaling-server field) so a session can point at a self-hosted
 * server instead.
 */

/**
 * Default signaling servers. Primary = our own Cloudflare Worker
 * (`signal.dash.jxh.io`, deployed from `workers/signaling/`); secondary = a
 * public Yjs server for redundancy. Handshake-only; multiple entries give
 * redundancy and a peer connects to all of them.
 */
export const DEFAULT_SIGNALING_SERVERS: readonly string[] = [
  "wss://signal.dash.jxh.io",
  "wss://y-webrtc-eu.fly.dev",
];

/** localStorage key for a user-overridden signaling server list. */
const SIGNALING_STORAGE_KEY = "flash8.collab.signaling";

function readLocalStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(SIGNALING_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Normalize a user-supplied signaling-server string (newline- or comma-
 * separated) into a clean list of `ws://`/`wss://` URLs. Returns the default
 * when the input has no valid entries, so a session always has somewhere to
 * signal.
 */
export function parseSignalingServers(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_SIGNALING_SERVERS];
  const urls = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\//i.test(s));
  return urls.length > 0 ? urls : [...DEFAULT_SIGNALING_SERVERS];
}

/**
 * The signaling servers to use for a new session: the user's stored override if
 * present and valid, otherwise the public default.
 */
export function getSignalingServers(): string[] {
  return parseSignalingServers(readLocalStorage());
}

/** Persist a user-edited signaling-server list (empty string clears override). */
export function setSignalingServers(raw: string): void {
  try {
    if (raw.trim() === "") {
      globalThis.localStorage?.removeItem(SIGNALING_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(SIGNALING_STORAGE_KEY, raw);
    }
  } catch {
    /* localStorage unavailable (e.g. SSR/tests): no-op */
  }
}
