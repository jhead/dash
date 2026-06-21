/**
 * Opt-in transport semantics (task 1344 P1) with a MOCKED y-webrtc provider, so
 * no real WebRTC / signaling / network is touched. Proves:
 *   - DEFAULT OFF: no provider is constructed until startCollab/joinCollab runs.
 *   - START seeds the host doc into a fresh Y.Doc and surfaces a share link.
 *   - JOIN constructs the provider FIRST and binds AFTER first sync (so the P0
 *     binding adopts the remote state — late-join), then merges.
 *   - The provider is given the room id as name and the key as `password` (E2E),
 *     and the signaling list (handshake-only).
 */
import { createDocument, renameScene } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

/** A doc whose first scene name is `label`, so adoption is observable. */
function docNamed(label: string): FlashDocument {
  const d = createDocument();
  return renameScene(d, d.scenes[0].id, label);
}
function firstSceneName(store: { getState: () => { history: { present: FlashDocument } } }): string {
  return store.getState().history.present.scenes[0].name;
}

/** Track every provider the session constructs + capture its constructor args. */
interface MockProviderRecord {
  roomName: string;
  doc: Y.Doc;
  opts: { signaling?: string[]; password?: string };
  destroyed: boolean;
  emitSynced: () => void;
}
const providers: MockProviderRecord[] = [];

vi.mock("y-webrtc", () => {
  class WebrtcProvider {
    roomName: string;
    doc: Y.Doc;
    private listeners = new Map<string, Array<(e: unknown) => void>>();
    private rec: MockProviderRecord;
    constructor(
      roomName: string,
      doc: Y.Doc,
      opts: { signaling?: string[]; password?: string } = {},
    ) {
      this.roomName = roomName;
      this.doc = doc;
      this.rec = {
        roomName,
        doc,
        opts,
        destroyed: false,
        emitSynced: () => this.emit("synced", { synced: true }),
      };
      providers.push(this.rec);
    }
    on(event: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(event) ?? [];
      arr.push(cb);
      this.listeners.set(event, arr);
    }
    off(event: string, cb: (e: unknown) => void): void {
      const arr = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        arr.filter((f) => f !== cb),
      );
    }
    private emit(event: string, e: unknown): void {
      for (const cb of this.listeners.get(event) ?? []) cb(e);
    }
    destroy(): void {
      this.rec.destroyed = true;
    }
  }
  return { WebrtcProvider };
});

// Import AFTER the mock is registered.
const { startCollab, joinCollab, generateCollabLink, parseCollabLink } =
  await import("../index.js");
const { createDocumentStore } = await import("../../store/documentStore.js");

beforeEach(() => {
  providers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opt-in transport — default OFF", () => {
  it("constructs NO provider until startCollab/joinCollab is called", () => {
    // Merely creating a store + parsing a (non-collab) URL does nothing.
    createDocumentStore(createDocument());
    expect(parseCollabLink("https://app/")).toBeNull();
    expect(providers.length).toBe(0);
  });
});

describe("startCollab (host)", () => {
  it("seeds the local doc into a fresh Y.Doc and returns a share link", () => {
    const store = createDocumentStore(createDocument());
    const session = startCollab(store, { signaling: ["wss://test.example"] });

    // Exactly one provider, wired with the room name + E2E password + signaling.
    expect(providers.length).toBe(1);
    expect(providers[0].roomName).toBe(session.link.room);
    expect(providers[0].opts.password).toBe(session.link.key);
    expect(providers[0].opts.signaling).toEqual(["wss://test.example"]);

    // The host's document was seeded into the session Y.Doc.
    const root = session.ydoc.getMap("doc");
    expect(root.size).toBeGreaterThan(0);

    // The share link parses back to this session's room/key.
    const url = session.shareUrl("https://app/");
    expect(parseCollabLink(url)).toEqual(session.link);

    session.stop();
    expect(providers[0].destroyed).toBe(true);
  });

  it("reuses a supplied link instead of minting a new one", () => {
    const store = createDocumentStore(createDocument());
    const link = generateCollabLink();
    const session = startCollab(store, { link, signaling: ["wss://x"] });
    expect(session.link).toEqual(link);
    expect(providers[0].roomName).toBe(link.room);
    session.stop();
  });
});

describe("joinCollab (joiner) — adopt on first sync", () => {
  it("binds only AFTER the provider syncs, adopting the remote document", async () => {
    const link = generateCollabLink();

    // Simulate an existing host session's Y.Doc state arriving on the joiner's
    // Y.Doc right when the provider syncs (what a real first sync delivers).
    const hostStore = createDocumentStore(docNamed("Existing Session"));
    // Build the host's Y.Doc state via the same seeding path startCollab uses.
    const hostSession = startCollab(hostStore, { link, signaling: ["wss://x"] });
    const hostState = Y.encodeStateAsUpdate(hostSession.ydoc);

    const joinerStore = createDocumentStore(docNamed("local placeholder"));
    const joinPromise = joinCollab(joinerStore, link, {
      signaling: ["wss://x"],
      syncTimeoutMs: 1000,
    });

    // The joiner's provider exists; the binding has NOT yet adopted anything
    // (still the local placeholder) because we have not synced.
    const joinerProvider = providers[providers.length - 1];
    expect(firstSceneName(joinerStore)).toBe("local placeholder");

    // Deliver the host's state to the joiner's Y.Doc, then fire 'synced'.
    Y.applyUpdate(joinerProvider.doc, hostState, "wire");
    joinerProvider.emitSynced();

    const session = await joinPromise;

    // The joiner adopted the existing session's document.
    expect(firstSceneName(joinerStore)).toBe("Existing Session");
    expect(session.link).toEqual(link);

    session.stop();
    hostSession.stop();
  });

  it("binds anyway after the sync timeout (empty/fresh room)", async () => {
    const link = generateCollabLink();
    const store = createDocumentStore(createDocument());
    const session = await joinCollab(store, link, {
      signaling: ["wss://x"],
      syncTimeoutMs: 1, // fire immediately; no peer ever syncs
    });
    // Binding attached; the empty room means our local doc seeds the session.
    expect(session.ydoc.getMap("doc").size).toBeGreaterThan(0);
    session.stop();
  });
});
