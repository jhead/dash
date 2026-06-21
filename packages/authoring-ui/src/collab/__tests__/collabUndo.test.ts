/**
 * Per-origin collaborative undo (task 1346 P3).
 *
 * Verifies the three contract points of P3 over a loopback wire (same in-process
 * Yjs replication the P1 convergence test uses, since y-webrtc needs a real
 * WebRTC stack absent in Node):
 *
 *   1. COLLAB: peer A's undo reverts ONLY A's last edit — never B's concurrent
 *      edit — and redo re-applies it. The undone state flows back through the
 *      binding's inbound `replaceDoc` into A's store, so the UI would re-render.
 *   2. SOLO: with no collab session, snapshot undo/redo is unchanged.
 *   3. Session-end (`detach`) restores the snapshot undo stack frozen at start.
 */
import { addScene, createDocument, renameScene } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { attachCollab } from "../../store/collabAdapter.js";
import { createDocumentStore } from "../../store/documentStore.js";

/** Wire two Y.Docs so each one's updates are applied to the other (loopback). */
function loopback(a: Y.Doc, b: Y.Doc): () => void {
  const aToB = (update: Uint8Array, origin: unknown) => {
    if (origin === "wire") return;
    Y.applyUpdate(b, update, "wire");
  };
  const bToA = (update: Uint8Array, origin: unknown) => {
    if (origin === "wire") return;
    Y.applyUpdate(a, update, "wire");
  };
  a.on("update", aToB);
  b.on("update", bToA);
  return () => {
    a.off("update", aToB);
    b.off("update", bToA);
  };
}

/** Stand up a 2-peer session: A hosts (seeds), B late-joins (adopts). */
function twoPeerSession(seed: FlashDocument) {
  const ydocA = new Y.Doc();
  const storeA = createDocumentStore(seed);
  const a = attachCollab(storeA, ydocA);

  const ydocB = new Y.Doc();
  const stopWire = loopback(ydocA, ydocB);
  Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "wire");
  const storeB = createDocumentStore(createDocument());
  const b = attachCollab(storeB, ydocB);

  const docA = (): FlashDocument => storeA.getState().history.present;
  const docB = (): FlashDocument => storeB.getState().history.present;
  return { storeA, storeB, a, b, docA, docB, stopWire };
}

describe("collab per-origin undo (P3)", () => {
  it("A's undo reverts only A's edit, not B's concurrent edit; redo re-applies it", () => {
    const seed = renameScene(createDocument(), createDocument().scenes[0].id, "Base");
    const { storeA, storeB, a, b, docA, docB, stopWire } = twoPeerSession(seed);

    // Both peers start from the same shared document.
    expect(docB().scenes.map((s) => s.name)).toEqual(docA().scenes.map((s) => s.name));
    const baseSceneCount = docA().scenes.length;

    // A adds a scene "A-scene"; B adds a scene "B-scene". Both converge on both.
    storeA.getState().pushDoc(addScene(docA(), "A-scene"));
    storeB.getState().pushDoc(addScene(docB(), "B-scene"));

    expect(docA().scenes.map((s) => s.name)).toContain("A-scene");
    expect(docA().scenes.map((s) => s.name)).toContain("B-scene");
    expect(docB().scenes.map((s) => s.name)).toContain("A-scene");
    expect(docB().scenes.map((s) => s.name)).toContain("B-scene");
    expect(docA().scenes.length).toBe(baseSceneCount + 2);

    // A undoes. It must remove ONLY A's scene; B's scene survives on BOTH peers.
    storeA.getState().undo();

    expect(docA().scenes.map((s) => s.name)).not.toContain("A-scene");
    expect(docA().scenes.map((s) => s.name)).toContain("B-scene");
    // The undone state propagated to B too (A's add was reverted in the shared doc),
    // but B's own edit is untouched.
    expect(docB().scenes.map((s) => s.name)).not.toContain("A-scene");
    expect(docB().scenes.map((s) => s.name)).toContain("B-scene");
    expect(docA().scenes.length).toBe(baseSceneCount + 1);

    // A's undo flowed back into A's store via the binding's replaceDoc (UI render
    // would reflect it) WITHOUT polluting the frozen snapshot stack.
    expect(storeA.getState().history.past.length).toBe(0);

    // A redoes: A's scene comes back, B's still present, both peers converge.
    storeA.getState().redo();
    expect(docA().scenes.map((s) => s.name)).toContain("A-scene");
    expect(docA().scenes.map((s) => s.name)).toContain("B-scene");
    expect(docB().scenes.map((s) => s.name)).toContain("A-scene");
    expect(docB().scenes.map((s) => s.name)).toContain("B-scene");
    expect(docA()).toEqual(docB());

    a.detach();
    b.detach();
    stopWire();
  });

  it("B's undo reverts only B's edit (symmetry: each peer tracks its own origin)", () => {
    const { storeA, storeB, a, b, docA, docB, stopWire } = twoPeerSession(createDocument());

    storeA.getState().pushDoc(addScene(docA(), "A-scene"));
    storeB.getState().pushDoc(addScene(docB(), "B-scene"));

    // B undoes — removes ONLY B's scene; A's scene survives everywhere.
    storeB.getState().undo();
    expect(docB().scenes.map((s) => s.name)).toContain("A-scene");
    expect(docB().scenes.map((s) => s.name)).not.toContain("B-scene");
    expect(docA().scenes.map((s) => s.name)).toContain("A-scene");
    expect(docA().scenes.map((s) => s.name)).not.toContain("B-scene");

    a.detach();
    b.detach();
    stopWire();
  });

  it("solo undo/redo is unchanged when no collab session is active", () => {
    const store = createDocumentStore(createDocument());
    const base = store.getState().history.present;

    store.getState().pushDoc(addScene(base, "S1"));
    const afterPush = store.getState().history.present;
    expect(afterPush.scenes.map((s) => s.name)).toContain("S1");
    expect(store.getState().history.past.length).toBe(1);

    // Snapshot undo restores the exact previous document reference.
    store.getState().undo();
    expect(store.getState().history.present).toBe(base);
    expect(store.getState().history.past.length).toBe(0);
    expect(store.getState().history.future.length).toBe(1);

    // Snapshot redo restores the pushed document reference.
    store.getState().redo();
    expect(store.getState().history.present).toBe(afterPush);
    expect(store.getState().history.past.length).toBe(1);
  });

  it("session-end restores the snapshot undo stack frozen at session start", () => {
    const store = createDocumentStore(createDocument());

    // SOLO edit before the session — builds a real snapshot undo entry.
    store.getState().pushDoc(addScene(store.getState().history.present, "Solo"));
    expect(store.getState().history.past.length).toBe(1);

    // START a session: snapshot stack frozen; undo/redo now go to the UndoManager.
    const ydoc = new Y.Doc();
    const session = attachCollab(store, ydoc);

    // A collab-session edit. Snapshot undo stack stays frozen (does NOT grow).
    store.getState().pushDoc(addScene(store.getState().history.present, "Collab"));
    expect(store.getState().history.past.length).toBe(1); // unchanged during session

    // In-session undo routes to the UndoManager (reverts the collab edit),
    // NOT the snapshot reducer — so the frozen snapshot present is untouched.
    store.getState().undo();
    expect(store.getState().history.present.scenes.map((s) => s.name)).not.toContain("Collab");

    // END the session: snapshot undo restored onto the current present.
    session.detach();
    const afterEnd = store.getState().history.present;
    expect(store.getState().history.past.length).toBe(1); // the frozen Solo entry

    // Solo undo now works again and steps back to the pre-Solo document.
    store.getState().undo();
    expect(store.getState().history.present.scenes.map((s) => s.name)).not.toContain("Solo");
    expect(store.getState().history.future).toContain(afterEnd);
  });
});
