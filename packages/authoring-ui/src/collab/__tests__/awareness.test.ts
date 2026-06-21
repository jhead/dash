/**
 * Awareness controller (task 1345 P2): uiStore → awareness broadcast with
 * cursor throttling, reading a SIMULATED remote peer's state, and the built-in
 * TTL drop on disconnect.
 *
 * y-webrtc is absent in Node, so — exactly like the P1 convergence test stands
 * in y-webrtc's place — we wire two real `y-protocols/awareness` instances over
 * a loopback (`encodeAwarenessUpdate`/`applyAwarenessUpdate`) so a "remote"
 * peer's state genuinely arrives on the local instance and fires `change`.
 */
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { createUiStore } from "../../store/uiStore.js";
import type { CollabUser } from "../localUser.js";
import { attachAwareness, readPeers } from "../awareness.js";
import { uiStateToAwareness } from "../awarenessState.js";

const LOCAL: CollabUser = { id: "local", name: "Swift Otter", color: "#e6194b" };
const REMOTE: CollabUser = { id: "remote", name: "Bold Fox", color: "#3cb44b" };

/** Two awareness instances replicating updates both ways (a loopback "mesh"). */
function wirePair(): { a: Awareness; b: Awareness } {
  const a = new Awareness(new Y.Doc());
  const b = new Awareness(new Y.Doc());
  const pump = (from: Awareness, to: Awareness) => {
    from.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), "wire");
    });
  };
  pump(a, b);
  pump(b, a);
  return { a, b };
}

describe("attachAwareness — outbound projection", () => {
  it("broadcasts the local uiStore snapshot to peers", () => {
    const { a, b } = wirePair();
    const store = createUiStore();
    store.getState().setActiveSceneIndex(3);
    store.getState().setSelectedShapeIds(["s1"]);

    const ctrl = attachAwareness(a, store, LOCAL);

    // The remote instance (b) now sees `a`'s state as a peer.
    const seenOnB = readPeers(b).find((p) => p.user.id === LOCAL.id);
    expect(seenOnB).toBeDefined();
    expect(seenOnB!.scene).toBe(3);
    expect(seenOnB!.selection.shapeIds).toEqual(["s1"]);

    // A non-cursor edit propagates immediately.
    store.getState().setCurrentFrame(9);
    expect(readPeers(b).find((p) => p.user.id === LOCAL.id)!.frame).toBe(9);

    ctrl.detach();
  });

  it("throttles cursor updates, then flushes the LAST position after the window", () => {
    vi.useFakeTimers();
    try {
      const { a, b } = wirePair();
      const store = createUiStore();
      const ctrl = attachAwareness(a, store, LOCAL, { cursorThrottleMs: 50 });

      const cursorOnB = () => readPeers(b).find((p) => p.user.id === LOCAL.id)?.cursor ?? null;

      // First move broadcasts immediately.
      store.getState().setCursorPos({ x: 1, y: 1 });
      expect(cursorOnB()).toEqual({ x: 1, y: 1 });

      // Rapid moves within the window are coalesced (b still sees the first).
      store.getState().setCursorPos({ x: 2, y: 2 });
      store.getState().setCursorPos({ x: 3, y: 3 });
      expect(cursorOnB()).toEqual({ x: 1, y: 1 });

      // After the window, the trailing-edge timer flushes the LAST position.
      vi.advanceTimersByTime(50);
      expect(cursorOnB()).toEqual({ x: 3, y: 3 });

      ctrl.detach();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("readPeers — simulated remote", () => {
  it("collects a remote peer's state and excludes self", () => {
    const { a, b } = wirePair();

    // `b` is the remote; set its state directly (no uiStore needed).
    const remoteState = uiStateToAwareness(
      (() => {
        const s = createUiStore();
        s.getState().setActiveSceneIndex(5);
        s.getState().setCursorPos({ x: 40, y: 60 });
        s.getState().setEditContext({ mode: "symbol", symbolId: "sym-2", symbolName: "Box" });
        return s.getState();
      })(),
      REMOTE,
    );
    for (const [k, v] of Object.entries(remoteState)) b.setLocalStateField(k, v);

    const peers = readPeers(a);
    expect(peers).toHaveLength(1);
    expect(peers[0].user).toEqual(REMOTE);
    expect(peers[0].scene).toBe(5);
    expect(peers[0].cursor).toEqual({ x: 40, y: 60 });
    expect(peers[0].editContext).toEqual({ mode: "symbol", symbolId: "sym-2", symbolName: "Box" });

    // `a` reading its OWN states never includes itself.
    a.setLocalState({ user: LOCAL });
    expect(readPeers(a).some((p) => p.user.id === LOCAL.id)).toBe(false);
  });
});

describe("TTL — disconnect drop", () => {
  it("a peer disappears when its state is removed (graceful leave)", () => {
    const { a, b } = wirePair();
    const store = createUiStore();
    const ctrl = attachAwareness(a, store, LOCAL);

    expect(readPeers(b).some((p) => p.user.id === LOCAL.id)).toBe(true);

    // detach() broadcasts our offline state (setLocalState(null)) — the standard
    // graceful-leave path. The peer must vanish from b's view.
    ctrl.detach();
    expect(readPeers(b).some((p) => p.user.id === LOCAL.id)).toBe(false);
  });

  it("the built-in outdated-timeout reaps a peer that stops refreshing (ungraceful drop)", () => {
    // Simulate the awareness protocol's own TTL sweep: when a client's state is
    // older than `outdatedTimeout`, the internal interval calls
    // `removeAwarenessStates`, which fires `change` with the client in `removed`.
    // We invoke that exact protocol function (no custom drop logic) to prove a
    // dropped peer is reaped without a graceful leave. One-way replication
    // (a → b only) so the removal is not "healed" by a's self-re-announce — an
    // ungraceful drop is exactly the case where a is gone and cannot respond.
    const a = new Awareness(new Y.Doc());
    const b = new Awareness(new Y.Doc());
    a.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changed = added.concat(updated, removed);
      applyAwarenessUpdate(b, encodeAwarenessUpdate(a, changed), "wire");
    });

    const store = createUiStore();
    const ctrl = attachAwareness(a, store, LOCAL);

    const localClientId = a.clientID;
    expect(readPeers(b).some((p) => p.clientId === localClientId)).toBe(true);

    // a "crashes" — no graceful setLocalState(null). The peer-side TTL sweep on
    // `b` removes the stale client (this is what the 30 s _checkInterval does).
    let removedFired = false;
    b.on("change", ({ removed }: { removed: number[] }) => {
      if (removed.includes(localClientId)) removedFired = true;
    });
    removeAwarenessStates(b, [localClientId], "timeout");
    expect(removedFired).toBe(true);
    expect(readPeers(b).some((p) => p.clientId === localClientId)).toBe(false);

    ctrl.detach();
  });
});
