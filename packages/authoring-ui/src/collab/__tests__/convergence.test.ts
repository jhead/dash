/**
 * Two-peer convergence over a loopback wire (task 1344 P1).
 *
 * y-webrtc itself needs a real WebRTC stack (not present in Node), so this test
 * stands in the SAME place y-webrtc sits — replicating Yjs updates between two
 * Y.Docs — using Yjs's own update protocol (`encodeStateAsUpdate` /
 * `applyUpdate`). That is exactly what a provider does over the network; the
 * binding (P0) and the start/join semantics (P1) are exercised end-to-end:
 *
 *   peer A: createDocumentStore -> attachCollab(storeA, ydocA)  (host: seeds)
 *   peer B: attachCollab(storeB, ydocB) AFTER ydocB has ydocA's state (joiner:
 *           adopts) — mirrors joinCollab waiting for first sync before binding.
 *   wire:   each Y.Doc 'update' event is applied to the other (loopback).
 *
 * We then edit on each side through the REAL @flash/core mutations + the store,
 * and assert both stores' documents converge to the same value.
 */
import { addScene, createDocument, renameScene } from "@flash/core";
import type { FlashDocument } from "@flash/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { attachCollab } from "../../store/collabAdapter.js";
import { createDocumentStore } from "../../store/documentStore.js";

/** Wire two Y.Docs so each one's updates are applied to the other. */
function loopback(a: Y.Doc, b: Y.Doc): () => void {
  const aToB = (update: Uint8Array, origin: unknown) => {
    if (origin === "wire") return; // don't echo a wire-applied update back
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

describe("two-peer convergence over a loopback wire", () => {
  it("edits on either peer converge to the same document", () => {
    // Distinguish the host's doc by its scene name so adoption is observable.
    const seed = createDocument();
    const hostDoc = renameScene(seed, seed.scenes[0].id, "Shared Scene");

    // HOST (peer A): attach first → seeds the local doc into ydocA.
    const ydocA = new Y.Doc();
    const storeA = createDocumentStore(hostDoc);
    const a = attachCollab(storeA, ydocA);

    // JOINER (peer B): bring the wire up so ydocB receives ydocA's state, THEN
    // attach — the binding sees a populated Y.Doc and ADOPTS it (late-join).
    const ydocB = new Y.Doc();
    const stopWire = loopback(ydocA, ydocB);
    // Initial state sync (what the provider's first sync does).
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "wire");
    const storeB = createDocumentStore(createDocument());
    const b = attachCollab(storeB, ydocB);

    const docA = (): FlashDocument => storeA.getState().history.present;
    const docB = (): FlashDocument => storeB.getState().history.present;

    // B adopted A's document on join.
    expect(docB().scenes[0].name).toBe("Shared Scene");

    // Edit on A: add a scene. It should appear on B.
    storeA.getState().pushDoc(addScene(docA(), "Scene from A"));
    expect(docB().scenes.map((s) => s.name)).toContain("Scene from A");

    // Edit on B: rename a scene. It should appear on A.
    const firstSceneId = docB().scenes[0].id;
    storeB.getState().pushDoc(renameScene(docB(), firstSceneId, "Renamed by B"));
    const renamedOnA = docA().scenes.find((s) => s.id === firstSceneId);
    expect(renamedOnA?.name).toBe("Renamed by B");

    // Both peers converge to identical documents.
    expect(docA()).toEqual(docB());

    a.detach();
    b.detach();
    stopWire();
  });

  it("a remote edit does NOT create a local undo entry on the receiving peer", () => {
    const initial = createDocument();
    const ydocA = new Y.Doc();
    const storeA = createDocumentStore(initial);
    const a = attachCollab(storeA, ydocA);

    const ydocB = new Y.Doc();
    const stopWire = loopback(ydocA, ydocB);
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), "wire");
    const storeB = createDocumentStore(createDocument());
    const b = attachCollab(storeB, ydocB);

    const undoDepthB = () => storeB.getState().history.past.length;
    const before = undoDepthB();

    // A edits; B receives it via applyRemote (= replaceDoc, not pushDoc).
    storeA.getState().pushDoc(addScene(storeA.getState().history.present, "X"));

    // B's undo stack did NOT grow from the remote edit.
    expect(undoDepthB()).toBe(before);

    a.detach();
    b.detach();
    stopWire();
  });
});
