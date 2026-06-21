/**
 * Multi-peer (5+) convergence + reconnection edge cases over a loopback mesh
 * (task 1348 P5 hardening).
 *
 * y-webrtc needs a real WebRTC stack (absent in Node), so — exactly like P1's
 * convergence test — we stand in the provider's place by replicating each Y.Doc's
 * `update` to every other peer's Y.Doc (a full mesh, mirroring y-webrtc's mesh),
 * and drive REAL @flash/core mutations through real stores + real `attachCollab`
 * bindings. The point P5 adds over P1's 2-peer test:
 *
 *   1. FIVE+ peers: an edit on any peer reaches ALL others and every store's
 *      document converges to the identical value — the N^2-mesh fan-out that the
 *      peer-count warning is about, proven correct (Yjs guarantees convergence
 *      regardless of N; the warning is about PERFORMANCE, not correctness).
 *   2. RECONNECTION: a peer drops off the wire, the rest keep editing, the peer
 *      reconnects, re-syncs via the state-vector protocol (an initial
 *      encodeStateAsUpdate exchange, as a real first-sync does), and converges —
 *      including the edits it missed while disconnected, and its OWN offline
 *      edits propagate to everyone.
 *   3. PEER CHURN: peers leave (detach) and a fresh peer joins mid-session; the
 *      survivors + the newcomer all converge.
 */
import { addScene, createDocument, renameScene } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { attachCollab } from "../../store/collabAdapter.js";
import { createDocumentStore } from "../../store/documentStore.js";
import type { DocumentStoreApi } from "../../store/documentStore.js";

const WIRE = "wire";

/**
 * A full-mesh loopback bus: each registered Y.Doc's local updates are applied to
 * every other registered Y.Doc. A doc can be detached (simulating a drop) and
 * re-attached (simulating a reconnect — the caller does the state-vector catch-up
 * exchange, like a real first sync).
 */
class MeshBus {
  private docs = new Set<Y.Doc>();
  private handlers = new Map<Y.Doc, (u: Uint8Array, origin: unknown) => void>();

  add(doc: Y.Doc): void {
    if (this.docs.has(doc)) return;
    const handler = (update: Uint8Array, origin: unknown): void => {
      if (origin === WIRE) return; // don't re-broadcast a wire-applied update
      for (const other of this.docs) {
        if (other !== doc) Y.applyUpdate(other, update, WIRE);
      }
    };
    doc.on("update", handler);
    this.handlers.set(doc, handler);
    this.docs.add(doc);
  }

  /** Detach a doc from the bus (peer drops). Its handler stops firing. */
  remove(doc: Y.Doc): void {
    const handler = this.handlers.get(doc);
    if (handler) doc.off("update", handler);
    this.handlers.delete(doc);
    this.docs.delete(doc);
  }

  /** Bring `doc` back and catch it (and the mesh) up via a state exchange. */
  reconnect(doc: Y.Doc): void {
    // Pull the current mesh state into the reconnecting doc, and push its own
    // (possibly offline-edited) state out — exactly what a provider's first sync
    // does on reconnect (state-vector diff exchange).
    for (const other of this.docs) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), WIRE);
    }
    const mine = Y.encodeStateAsUpdate(doc);
    for (const other of this.docs) {
      Y.applyUpdate(other, mine, WIRE);
    }
    this.add(doc);
  }
}

interface Peer {
  store: DocumentStoreApi;
  ydoc: Y.Doc;
  detach: () => void;
  doc: () => FlashDocument;
}

/** Spin up a host peer that seeds `hostDoc`. */
function makeHost(bus: MeshBus, hostDoc: FlashDocument): Peer {
  const ydoc = new Y.Doc();
  const store = createDocumentStore(hostDoc);
  const binding = attachCollab(store, ydoc);
  bus.add(ydoc);
  return {
    store,
    ydoc,
    detach: () => binding.detach(),
    doc: () => store.getState().history.present,
  };
}

/** Spin up a joiner that adopts the current mesh state (late-join). */
function makeJoiner(bus: MeshBus, seed: Y.Doc): Peer {
  const ydoc = new Y.Doc();
  // First sync: the joiner receives the existing session state.
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seed), WIRE);
  bus.add(ydoc);
  const store = createDocumentStore(createDocument());
  const binding = attachCollab(store, ydoc);
  return {
    store,
    ydoc,
    detach: () => binding.detach(),
    doc: () => store.getState().history.present,
  };
}

function sceneNames(p: Peer): string[] {
  return p.doc().scenes.map((s) => s.name);
}

describe("multi-peer (5+) convergence over a loopback mesh", () => {
  it("an edit on ANY of 6 peers reaches all others and all converge", () => {
    const bus = new MeshBus();
    const seed = createDocument();
    const host = makeHost(
      bus,
      renameScene(seed, seed.scenes[0].id, "Shared Scene"),
    );

    // 5 joiners adopt the host's session → 6 peers total (> the P1 2-peer test).
    const joiners = Array.from({ length: 5 }, () => makeJoiner(bus, host.ydoc));
    const peers: Peer[] = [host, ...joiners];

    // Every peer adopted the host's document on join.
    for (const p of peers) {
      expect(p.doc().scenes[0].name).toBe("Shared Scene");
    }

    // Each peer adds a distinctly-named scene; every add must reach all 6.
    peers.forEach((p, i) => {
      p.store.getState().pushDoc(addScene(p.doc(), `Scene from peer ${i}`));
    });

    for (const p of peers) {
      const names = sceneNames(p);
      for (let i = 0; i < peers.length; i++) {
        expect(names).toContain(`Scene from peer ${i}`);
      }
    }

    // All 6 documents are byte-for-byte identical.
    const ref = host.doc();
    for (const p of joiners) expect(p.doc()).toEqual(ref);

    for (const p of peers) p.detach();
  });
});

describe("reconnection edge cases", () => {
  it("a dropped peer reconnects and re-syncs missed + offline edits", () => {
    const bus = new MeshBus();
    const seed = createDocument();
    const host = makeHost(bus, renameScene(seed, seed.scenes[0].id, "Base"));
    const b = makeJoiner(bus, host.ydoc);
    const c = makeJoiner(bus, host.ydoc);

    // C drops off the mesh (signaling/peer drop). It can still edit locally.
    bus.remove(c.ydoc);

    // While C is gone, the host and B keep editing — C must NOT see these yet.
    host.store.getState().pushDoc(addScene(host.doc(), "Added while C gone"));
    b.store.getState().pushDoc(addScene(b.doc(), "Added by B while C gone"));
    expect(sceneNames(c)).not.toContain("Added while C gone");

    // C makes an OFFLINE edit of its own.
    c.store.getState().pushDoc(addScene(c.doc(), "C offline edit"));
    expect(sceneNames(host)).not.toContain("C offline edit");

    // C reconnects: the state-vector exchange catches everyone up both ways.
    bus.reconnect(c.ydoc);

    // C now sees the edits it missed...
    expect(sceneNames(c)).toContain("Added while C gone");
    expect(sceneNames(c)).toContain("Added by B while C gone");
    // ...and C's offline edit reached the host + B.
    expect(sceneNames(host)).toContain("C offline edit");
    expect(sceneNames(b)).toContain("C offline edit");

    // Everyone converges.
    expect(b.doc()).toEqual(host.doc());
    expect(c.doc()).toEqual(host.doc());

    host.detach();
    b.detach();
    c.detach();
  });

  it("survives peer churn: a peer leaves and a fresh peer joins mid-session", () => {
    const bus = new MeshBus();
    const seed = createDocument();
    const host = makeHost(bus, renameScene(seed, seed.scenes[0].id, "Room"));
    const b = makeJoiner(bus, host.ydoc);

    host.store.getState().pushDoc(addScene(host.doc(), "First"));
    expect(sceneNames(b)).toContain("First");

    // B leaves the session entirely (graceful detach + drop off the mesh).
    b.detach();
    bus.remove(b.ydoc);

    // The host keeps editing alone, then a brand-new peer D joins mid-session.
    host.store.getState().pushDoc(addScene(host.doc(), "Second"));
    const d = makeJoiner(bus, host.ydoc);

    // D adopts the full current state (both edits), not just the seed.
    expect(sceneNames(d)).toContain("First");
    expect(sceneNames(d)).toContain("Second");

    // A new edit on D reaches the host; both converge.
    d.store.getState().pushDoc(addScene(d.doc(), "Third from D"));
    expect(sceneNames(host)).toContain("Third from D");
    expect(d.doc()).toEqual(host.doc());

    host.detach();
    d.detach();
  });
});
