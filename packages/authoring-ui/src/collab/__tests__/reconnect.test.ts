/**
 * Reconnection / signaling-health controller (task 1348 P5).
 *
 * `attachReconnect` does two jobs (see reconnect.ts):
 *   1. RE-BROADCAST presence whenever a NEW peer connection appears (provider
 *      'peers' with `added`), so churn/reconnect re-syncs awareness even though
 *      the document re-syncs on its own.
 *   2. Track SIGNALING HEALTH from the provider's `status` event and fan changes
 *      out to listeners.
 *
 * We drive it with a tiny event-emitter provider mock (the real WebrtcProvider
 * needs WebRTC) and a real `y-protocols/awareness` loopback pair so the presence
 * re-broadcast is observed genuinely arriving on a peer.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { attachAwareness } from "../awareness.js";
import { attachReconnect, type ReconnectProviderLike } from "../reconnect.js";
import { createUiStore } from "../../store/uiStore.js";
import { readPeers } from "../awareness.js";
import type { CollabUser } from "../localUser.js";

const LOCAL: CollabUser = { id: "local", name: "Swift Otter", color: "#e6194b" };

/** A minimal provider mock: emits 'peers'/'status' and reports `connected`. */
class MockProvider implements ReconnectProviderLike {
  connected = true;
  private listeners = new Map<string, Set<(e: never) => void>>();
  on(event: string, cb: (e: never) => void): void {
    let s = this.listeners.get(event);
    if (!s) this.listeners.set(event, (s = new Set()));
    s.add(cb);
  }
  off(event: string, cb: (e: never) => void): void {
    this.listeners.get(event)?.delete(cb);
  }
  emit(event: string, e: unknown): void {
    for (const cb of this.listeners.get(event) ?? [])
      (cb as (e: unknown) => void)(e);
  }
}

/** Two awareness instances replicating updates both ways (loopback mesh). */
function wirePair(): { a: Awareness; b: Awareness } {
  const a = new Awareness(new Y.Doc());
  const b = new Awareness(new Y.Doc());
  const pump = (from: Awareness, to: Awareness) =>
    from.on(
      "update",
      ({
        added,
        updated,
        removed,
      }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changed = added.concat(updated, removed);
        applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), "wire");
      },
    );
  pump(a, b);
  pump(b, a);
  return { a, b };
}

describe("attachReconnect — presence re-broadcast on new peer", () => {
  it("re-flushes local awareness when a peer is ADDED (churn/reconnect)", () => {
    const { a, b } = wirePair();
    const store = createUiStore();
    store.getState().setActiveSceneIndex(2);
    const ctrl = attachAwareness(a, store, LOCAL);
    const provider = new MockProvider();
    const reconnect = attachReconnect(provider, { awarenessController: ctrl });

    // Simulate a peer dropping our presence from B's view (an ungraceful drop:
    // B never got our offline broadcast). Then a NEW connection appears.
    b.getStates().delete(a.clientID);
    expect(readPeers(b).find((p) => p.user.id === LOCAL.id)).toBeUndefined();

    // Provider reports a newly-added peer → controller re-broadcasts our state.
    provider.emit("peers", {
      added: [42],
      removed: [],
      webrtcPeers: [42],
      bcPeers: [],
    });

    // B sees us again with the right scene, with no field change on our side.
    const seen = readPeers(b).find((p) => p.user.id === LOCAL.id);
    expect(seen).toBeDefined();
    expect(seen!.scene).toBe(2);

    reconnect.detach();
    ctrl.detach();
  });

  it("does NOT re-flush when only a peer is REMOVED", () => {
    const store = createUiStore();
    const { a } = wirePair();
    const ctrl = attachAwareness(a, store, LOCAL);
    let flushes = 0;
    const wrapped = { ...ctrl, flush: () => (flushes++, ctrl.flush()) };
    const provider = new MockProvider();
    const reconnect = attachReconnect(provider, { awarenessController: wrapped });

    provider.emit("peers", { added: [], removed: [7], webrtcPeers: [], bcPeers: [] });
    expect(flushes).toBe(0);

    provider.emit("peers", { added: [9], removed: [], webrtcPeers: [9], bcPeers: [] });
    expect(flushes).toBe(1);

    reconnect.detach();
    ctrl.detach();
  });
});

describe("attachReconnect — signaling health", () => {
  it("reports the initial signaling state and fans changes out", () => {
    const provider = new MockProvider();
    provider.connected = true;
    const reconnect = attachReconnect(provider);
    expect(reconnect.signalingConnected()).toBe(true);

    const seen: boolean[] = [];
    reconnect.onSignalingChange((c) => seen.push(c));

    // A drop, then a recovery — only changes are emitted (no dup for same value).
    provider.emit("status", { connected: false });
    provider.emit("status", { connected: false });
    provider.emit("status", { connected: true });

    expect(seen).toEqual([false, true]);
    expect(reconnect.signalingConnected()).toBe(true);

    reconnect.detach();
  });

  it("detach removes provider handlers (no further callbacks)", () => {
    const provider = new MockProvider();
    const reconnect = attachReconnect(provider);
    const seen: boolean[] = [];
    reconnect.onSignalingChange((c) => seen.push(c));
    reconnect.detach();
    provider.emit("status", { connected: false });
    expect(seen).toEqual([]);
  });
});
