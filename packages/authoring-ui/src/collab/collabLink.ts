/**
 * Shareable collaboration link — parse / generate (task 1344 P1).
 *
 * The link puts BOTH secrets in the URL **fragment** (`#…`) so they are never
 * sent to any server in an HTTP request: browsers do not transmit the fragment,
 * and the y-webrtc signaling server only ever brokers the WebRTC handshake — it
 * never sees the room password (`k`).
 *
 * NOTE: the signaling server DOES see the room NAME. The fragment isn't sent
 * over HTTP, but y-webrtc uses the room name as the pub/sub TOPIC it
 * subscribes/publishes to over the WebSocket, in plaintext — so the relay
 * observes the (128-bit random) room id plus peer IPs. It still never sees the
 * password `k` nor any document bytes (those flow P2P over WebRTC). See
 * docs/37-collab.md for the full signaling-server privacy scope.
 *
 *   #room=<random-room-id>&k=<E2E-password>
 *
 *   - `room` is the y-webrtc room NAME. Peers in the same room find each other
 *     through the signaling server's broadcast (the room name IS the plaintext
 *     pub/sub topic), but the actual document bytes are exchanged peer-to-peer
 *     over WebRTC.
 *   - `k` is the y-webrtc room PASSWORD. y-webrtc derives an AES-GCM key from it
 *     (PBKDF2) and end-to-end-encrypts every WebRTC and BroadcastChannel message,
 *     so a peer cannot join — or read any doc bytes — without `k`. Keeping `k` in
 *     the fragment is what makes the share link itself the capability.
 *
 * This module is PURE (no Yjs, no network): it only formats and parses the
 * fragment, and mints fresh room/key values with the Web Crypto RNG. It is fully
 * unit-testable on its own.
 */

/** A parsed collaboration invite: the room id + its end-to-end key. */
export interface CollabLink {
  /** y-webrtc room name (also the share-link room id). */
  room: string;
  /** y-webrtc room password = the end-to-end encryption secret. */
  key: string;
}

/** The fragment keys, kept in one place so parse/generate cannot drift. */
const ROOM_PARAM = "room";
const KEY_PARAM = "k";

/**
 * Random byte counts for a generated room id / key. 16 bytes = 128 bits of
 * entropy for the room id (unguessable enough to avoid collisions on the public
 * signaling server); 32 bytes = 256 bits for the E2E password (the real secret,
 * never transmitted).
 */
const ROOM_ID_BYTES = 16;
const KEY_BYTES = 32;

/** Resolve a usable Web Crypto instance in browser, Node 18+, and tests. */
function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("Web Crypto API unavailable: cannot generate a collab link");
  }
  return c;
}

/** base64url (no padding) — URL-fragment safe, no `+`/`/`/`=`. */
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function"
      ? btoa(bin)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  getCrypto().getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Mint a fresh, cryptographically-random room id + end-to-end key. */
export function generateCollabLink(): CollabLink {
  return {
    room: randomToken(ROOM_ID_BYTES),
    key: randomToken(KEY_BYTES),
  };
}

/**
 * Build the fragment string (including the leading `#`) for a link. Values are
 * URI-encoded so a hand-supplied link with arbitrary characters still round-trips.
 */
export function collabLinkToFragment(link: CollabLink): string {
  const params = new URLSearchParams();
  params.set(ROOM_PARAM, link.room);
  params.set(KEY_PARAM, link.key);
  return `#${params.toString()}`;
}

/**
 * Build a full shareable URL: the given base (typically `location.origin +
 * location.pathname`) plus the secret fragment. The fragment is what carries the
 * room + key; the base is just where the editor is hosted.
 */
export function buildShareUrl(baseUrl: string, link: CollabLink): string {
  const hashIdx = baseUrl.indexOf("#");
  const clean = hashIdx === -1 ? baseUrl : baseUrl.slice(0, hashIdx);
  return clean + collabLinkToFragment(link);
}

/**
 * Parse a collaboration link out of a URL fragment (or a full URL/href). Returns
 * `null` when the fragment does not carry BOTH a `room` and a `k` — i.e. a normal
 * (non-collab) URL never accidentally starts a session.
 *
 * Accepts:
 *   - a bare fragment:  `#room=abc&k=def` or `room=abc&k=def`
 *   - a full URL/href:  `https://app/#room=abc&k=def`
 */
export function parseCollabLink(input: string): CollabLink | null {
  if (!input) return null;
  const hashIdx = input.indexOf("#");
  const fragment = hashIdx === -1 ? input : input.slice(hashIdx + 1);
  if (!fragment) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(fragment);
  } catch {
    return null;
  }
  const room = params.get(ROOM_PARAM);
  const key = params.get(KEY_PARAM);
  if (!room || !key) return null;
  return { room, key };
}
