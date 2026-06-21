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
 * The SOLE default below is OUR OWN serverless signaling server — a Cloudflare
 * Worker + Durable Object that speaks y-webrtc's exact pub/sub signaling protocol
 * (see `workers/signaling/` and docs/37-collab.md §13.5). It is a drop-in for the
 * stock y-webrtc transport: the client is unchanged, only this URL points at our
 * worker instead of a third-party public server. As a handshake-only broker it
 * never sees document bytes or the room password (see the file header above).
 *
 * No third-party fallback is shipped by default. A peer connects to ALL listed
 * servers simultaneously, and a public Yjs signaling server observes the room id
 * (sent plaintext as the pub/sub topic) and connecting peers' IP addresses — so a
 * public fallback in the default list would leak room metadata to an external
 * observer even while our own worker is up and working. Dropping it keeps room
 * metadata on our own infrastructure only. The trade-off is intentional:
 * redundancy is traded for privacy, so a session cannot signal if our worker is
 * down (the Share dialog surfaces a "Signaling server unreachable" banner). The
 * whole list is still user-editable (Share dialog → Signaling-server field) so a
 * session can add its own server(s) or point at a self-hosted one.
 */

/**
 * Default signaling servers. The SOLE default is our own Cloudflare Worker
 * (`signal.dash.jxh.io`, deployed from `workers/signaling/`) — handshake-only, so
 * it never sees document bytes or the room password. No third-party fallback is
 * included by default (privacy: a public relay would observe room ids + peer IPs);
 * users can add their own server(s) via the Share dialog.
 */
export const DEFAULT_SIGNALING_SERVERS: readonly string[] = [
  "wss://signal.dash.jxh.io",
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
 * present and valid, otherwise the built-in default (our own worker).
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
