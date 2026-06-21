/**
 * Content-addressing for out-of-band assets (collab P4 / docs 37).
 *
 * Bitmaps, sounds, and video carry their bytes as a `dataUri` string. For both
 * the `.fla` zip externalization (`zip.ts`) and the P2P collab asset channel,
 * those bytes are content-addressed by a stable SHA-256 hash so a peer that
 * already holds the identical bytes never needs to receive them again, and a
 * peer that lacks them can request them by hash alone.
 *
 * This module is PURE and dependency-free: a synchronous, self-contained
 * SHA-256 that runs identically in Node, the browser, and the Tauri webview
 * (`@flash/core` must import cleanly everywhere — no `node:crypto`, no
 * `crypto.subtle` which is async-only). The hash is used in the SYNCHRONOUS
 * collab outbound diff path, so it cannot be async.
 *
 * The `asset:<hash>` reference scheme mirrors the existing zip externalization
 * (`asset:bitmaps/<id>.png` etc.) — a short string that stands in for the bytes
 * in a serialized/replicated document so the large bytes never travel inline.
 */

/** Prefix marking a `dataUri` that has been externalized to a content hash. */
export const ASSET_HASH_PREFIX = "asset-hash:";

/** True if a `dataUri` is an externalized `asset-hash:<hex>` reference. */
export function isAssetHashRef(dataUri: string): boolean {
  return dataUri.startsWith(ASSET_HASH_PREFIX);
}

/** Build the `asset-hash:<hex>` reference for a content hash. */
export function assetHashRef(hash: string): string {
  return `${ASSET_HASH_PREFIX}${hash}`;
}

/** Extract the hex hash from an `asset-hash:<hex>` reference (or null). */
export function parseAssetHashRef(dataUri: string): string | null {
  return isAssetHashRef(dataUri) ? dataUri.slice(ASSET_HASH_PREFIX.length) : null;
}

// ---------------------------------------------------------------------------
// SHA-256 (pure, synchronous, no deps) — FIPS 180-4.
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Synchronous SHA-256 of a byte buffer → lowercase hex string (64 chars). */
export function sha256Hex(bytes: Uint8Array): string {
  // Pre-processing: pad to a multiple of 64 bytes.
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padded = new Uint8Array(Math.ceil((withOne + 8) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 64-bit big-endian length in the last 8 bytes (high 32 bits stay 0 for our
  // realistic asset sizes — JS bitwise is 32-bit; lengths < 512 MB fit fine).
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0, false);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) hex += (h[i] >>> 0).toString(16).padStart(8, "0");
  return hex;
}

// ---------------------------------------------------------------------------
// dataUri <-> bytes (base64) — pure, no Buffer/atob dependency.
// ---------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Decode the base64 payload of a `data:<mime>;base64,<payload>` URI to bytes. */
export function dataUriToBytes(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(",");
  const b64 = comma === -1 ? dataUri : dataUri.slice(comma + 1);
  return base64ToBytes(b64);
}

/** Decode a base64 string to bytes (ignores whitespace, tolerates padding). */
export function base64ToBytes(b64: string): Uint8Array {
  // Keep only real base64 alphabet chars. Padding (`=`) and any other character
  // (whitespace, stray `=` mid-string) are dropped — `=` carries no bits, so
  // ignoring it everywhere matches a strict decoder's output for valid input
  // and never injects a bogus zero byte for a mid-string `=`.
  let clean = "";
  for (let i = 0; i < b64.length; i++) {
    if (B64_LOOKUP[b64.charCodeAt(i)] !== -1) clean += b64[i];
  }
  const padded = clean;
  const outLen = Math.floor((padded.length * 6) / 8);
  const out = new Uint8Array(outLen);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < padded.length; i++) {
    acc = (acc << 6) | B64_LOOKUP[padded.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Encode bytes to a base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

/** Build a `data:<mime>;base64,<payload>` URI from bytes + a MIME type. */
export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Extract the MIME type from a `data:` URI header (octet-stream fallback). */
export function mimeFromDataUri(dataUri: string): string {
  const m = /^data:([^;,]+)/.exec(dataUri);
  return m?.[1] ?? "application/octet-stream";
}

/** SHA-256 hex of a `data:` URI's decoded bytes (the asset's content hash). */
export function hashDataUri(dataUri: string): string {
  return sha256Hex(dataUriToBytes(dataUri));
}
