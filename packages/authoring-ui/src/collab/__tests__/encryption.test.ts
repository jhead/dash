/**
 * End-to-end encryption verification (task 1348 P5).
 *
 * The room password `k` (the secret half of the share link, §8.2) is what makes
 * the session private: y-webrtc derives an AES-GCM key from it (PBKDF2, salted by
 * the room name) and encrypts EVERY message — both the document-sync updates and
 * the awareness/presence updates — before they leave the browser. A peer without
 * the exact `k` cannot derive the key, so it can neither join nor read any state.
 *
 * This test exercises the REAL y-webrtc crypto module (`y-webrtc/src/crypto.js`)
 * — the same `deriveKey`/`encrypt`/`decrypt` the live `WebrtcProvider` uses — so
 * it proves the actual encryption path, not a re-implementation. We:
 *
 *   1. Build a real Yjs document UPDATE (what the doc-sync channel carries) and a
 *      real AWARENESS update (what the presence channel carries).
 *   2. Encrypt each with the key derived from the CORRECT password.
 *   3. Prove the correct key round-trips it back to the identical bytes, and that
 *      a WRONG password / WRONG room-salt key CANNOT decrypt it (AES-GCM auth
 *      tag failure), so a peer with the wrong `k` reads nothing.
 *
 * Node 22 ships WebCrypto as a global, so `crypto.subtle` is available here
 * exactly as in the browser.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";

// Load the ACTUAL crypto module y-webrtc uses for every message (doc +
// awareness). y-webrtc's package `exports` map does not expose the `src/`
// subpath, so we resolve the real source file on disk (next to the package
// entry) and import it by file URL — this is the genuine `deriveKey`/`encrypt`/
// `decrypt` the live `WebrtcProvider` runs, not a re-implementation.
interface YWebrtcCrypto {
  deriveKey(secret: string, roomName: string): PromiseLike<CryptoKey>;
  encrypt(data: Uint8Array, key: CryptoKey | null): PromiseLike<Uint8Array>;
  decrypt(data: Uint8Array, key: CryptoKey | null): PromiseLike<Uint8Array>;
}
const require = createRequire(import.meta.url);
const yWebrtcEntry = require.resolve("y-webrtc");
// .../y-webrtc/dist/y-webrtc.cjs  ->  .../y-webrtc/src/crypto.js
const cryptoPath = yWebrtcEntry.replace(/dist[\\/].*$/, "src/crypto.js");
const { deriveKey, encrypt, decrypt } = (await import(
  pathToFileURL(cryptoPath).href
)) as unknown as YWebrtcCrypto;

const ROOM = "room-abc123";
const RIGHT_PW = "correct-horse-battery-staple-256bit-key";
const WRONG_PW = "correct-horse-battery-staple-256bit-keyX";

/** A non-trivial document update: a real FlashDocument-shaped Y.Doc edit. */
function makeDocUpdate(): Uint8Array {
  const ydoc = new Y.Doc();
  const root = ydoc.getMap("doc");
  ydoc.transact(() => {
    root.set("id", "doc-1");
    root.set("secret", "TOP-SECRET-SCENE-NAME");
    const scenes = new Y.Array<unknown>();
    root.set("scenes", scenes);
    scenes.push(["Confidential Scene"]);
  });
  return Y.encodeStateAsUpdate(ydoc);
}

/** A real awareness update carrying presence (cursor/name/etc.). */
function makeAwarenessUpdate(): Uint8Array {
  const aw = new Awareness(new Y.Doc());
  aw.setLocalState({
    user: { id: "u1", name: "Secret Collaborator", color: "#abcdef" },
    cursor: { x: 123, y: 456 },
  });
  return encodeAwarenessUpdate(aw, [aw.clientID]);
}

describe("E2E encryption — the room password protects doc + awareness", () => {
  it("the CORRECT key round-trips a document update; a WRONG key cannot read it", async () => {
    const update = makeDocUpdate();
    const rightKey = await deriveKey(RIGHT_PW, ROOM);
    const wrongKey = await deriveKey(WRONG_PW, ROOM);

    const cipher = await encrypt(update, rightKey);
    // The ciphertext is not the plaintext (it is actually encrypted on the wire).
    expect(Buffer.from(cipher).equals(Buffer.from(update))).toBe(false);
    // The plaintext secret does not appear verbatim in the ciphertext bytes.
    expect(Buffer.from(cipher).includes(Buffer.from("TOP-SECRET-SCENE-NAME"))).toBe(
      false,
    );

    // Right key: exact round-trip.
    const decrypted = await decrypt(cipher, rightKey);
    expect(Buffer.from(decrypted).equals(Buffer.from(update))).toBe(true);

    // Wrong key: AES-GCM auth-tag failure — cannot read it at all.
    await expect(decrypt(cipher, wrongKey)).rejects.toBeTruthy();

    // And a doc rebuilt from the right-key plaintext recovers the secret; the
    // wrong-key path never yields plaintext, so it can recover nothing.
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, decrypted);
    expect(rebuilt.getMap("doc").get("secret")).toBe("TOP-SECRET-SCENE-NAME");
  });

  it("the CORRECT key round-trips an awareness update; a WRONG key cannot read it", async () => {
    const update = makeAwarenessUpdate();
    const rightKey = await deriveKey(RIGHT_PW, ROOM);
    const wrongKey = await deriveKey(WRONG_PW, ROOM);

    const cipher = await encrypt(update, rightKey);
    expect(
      Buffer.from(cipher).includes(Buffer.from("Secret Collaborator")),
    ).toBe(false);

    const decrypted = await decrypt(cipher, rightKey);
    expect(Buffer.from(decrypted).equals(Buffer.from(update))).toBe(true);
    await expect(decrypt(cipher, wrongKey)).rejects.toBeTruthy();

    // The right-key plaintext applies to a fresh Awareness and reveals presence.
    const aw = new Awareness(new Y.Doc());
    applyAwarenessUpdate(aw, decrypted, "test");
    const states = [...aw.getStates().values()] as Array<{
      user?: { name?: string };
    }>;
    expect(states.some((s) => s.user?.name === "Secret Collaborator")).toBe(true);
  });

  it("the room name is part of the salt — same password, different room ≠ same key", async () => {
    // Two peers must agree on BOTH the room and the password; a different room
    // salt yields a different key, so cross-room ciphertext cannot be read.
    const update = makeDocUpdate();
    const keyRoomA = await deriveKey(RIGHT_PW, "room-A");
    const keyRoomB = await deriveKey(RIGHT_PW, "room-B");

    const cipher = await encrypt(update, keyRoomA);
    expect(Buffer.from(await decrypt(cipher, keyRoomA)).equals(Buffer.from(update))).toBe(
      true,
    );
    await expect(decrypt(cipher, keyRoomB)).rejects.toBeTruthy();
  });
});
