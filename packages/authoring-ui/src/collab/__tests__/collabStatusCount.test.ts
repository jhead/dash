/**
 * useCollabStatus participant count — DECREMENT on leave (task 1365).
 *
 * REGRESSION: the status pill count used to be derived from y-webrtc's
 * connection-level `peers` event (`Math.max(webrtcPeers, bcPeers)`), which has
 * no TTL — an unclean leave lingered in the connection map forever, so the count
 * only ever GREW (stuck at the high-water-mark) and never shrank when a user
 * left. The fix derives the count from the AWARENESS controller (the current
 * `awareness.getStates()` minus self), the same source the presence avatars use.
 *
 * This test drives the EXACT subscription the hook uses — the awareness
 * controller's `onPeersChange` callback, counting `getPeers().length` on every
 * change, just like `useCollabStatus`'s effect — over a real loopback awareness
 * mesh, and asserts the count goes UP on join and BACK DOWN on:
 *   1. a graceful leave (`controller.detach()` → `setLocalState(null)`), and
 *   2. an ungraceful drop reaped by the built-in outdated-timeout
 *      (`removeAwarenessStates(..., "timeout")`).
 * It also replays the user's reported A/B+/B-/C+/C- sequence and asserts
 * 1/2/1/2/1 participants (count = peers + 1 local), which the old monotonic
 * connection-event count would have shown as 1/2/2/3/3.
 */
import { describe, it, expect } from "vitest";
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

const LOCAL: CollabUser = { id: "local", name: "Swift Otter", color: "#e6194b" };
const PEER_B: CollabUser = { id: "peer-b", name: "Bold Fox", color: "#3cb44b" };
const PEER_C: CollabUser = { id: "peer-c", name: "Cool Cat", color: "#4363d8" };

/**
 * A loopback awareness mesh: each instance replicates its updates to all others,
 * standing in for y-webrtc (absent in Node). Returns the instances + the local
 * controller wired to a uiStore (exactly what a CollabSession holds).
 */
function makeMesh(...users: CollabUser[]): {
  instances: Awareness[];
  localController: ReturnType<typeof attachAwareness>;
} {
  const instances = users.map(() => new Awareness(new Y.Doc()));
  // Full-mesh bidirectional replication.
  for (const from of instances) {
    from.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changed = added.concat(updated, removed);
        const update = encodeAwarenessUpdate(from, changed);
        for (const to of instances) {
          if (to !== from) applyAwarenessUpdate(to, update, "wire");
        }
      },
    );
  }
  // instances[0] is the LOCAL peer driven by a real controller (the one the hook
  // would subscribe to). The rest are remote peers we set state on directly.
  const localController = attachAwareness(instances[0], createUiStore(), users[0]);
  return { instances, localController };
}

/** Announce a remote peer by writing its identity into its own awareness state. */
function announce(remote: Awareness, user: CollabUser): void {
  remote.setLocalState({ user });
}

describe("useCollabStatus count — derives from awareness, DECREMENTS on leave (task 1365)", () => {
  it("goes UP on a peer join and BACK DOWN on a graceful leave (detach → setLocalState(null))", () => {
    const { instances, localController } = makeMesh(LOCAL, PEER_B);
    const [, bAware] = instances;

    // Mirror the hook: count from the controller's onPeersChange callback.
    const counts: number[] = [localController.getPeers().length];
    localController.onPeersChange((peers) => counts.push(peers.length));

    // Solo: no remote peers yet.
    expect(localController.getPeers().length).toBe(0);

    // B joins → count climbs to 1.
    announce(bAware, PEER_B);
    expect(localController.getPeers().length).toBe(1);

    // B leaves gracefully (its controller detach() / setLocalState(null)) → the
    // count must DECREMENT back to 0 (the bug: it stayed at 1).
    bAware.setLocalState(null);
    expect(localController.getPeers().length).toBe(0);

    // The hook's subscription saw the rise AND the fall.
    expect(counts).toContain(1);
    expect(counts[counts.length - 1]).toBe(0);

    localController.detach();
  });

  it("DECREMENTS when an ungraceful drop is reaped by the built-in outdated-timeout", () => {
    // ONE-WAY replication (b → local only): an ungraceful drop is exactly the
    // case where b is gone and cannot re-announce, so the local-side TTL sweep is
    // not "healed" by b replying. (Mirrors awareness.test.ts's ungraceful-drop
    // setup; a bidirectional mesh would re-heal the removal.)
    const localAware = new Awareness(new Y.Doc());
    const bAware = new Awareness(new Y.Doc());
    bAware.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changed = added.concat(updated, removed);
        applyAwarenessUpdate(localAware, encodeAwarenessUpdate(bAware, changed), "wire");
      },
    );
    const localController = attachAwareness(localAware, createUiStore(), LOCAL);

    announce(bAware, PEER_B);
    expect(localController.getPeers().length).toBe(1);

    const bClientId = bAware.clientID;
    // B "crashes" — no graceful leave. The local instance's own TTL sweep (the
    // 30 s _checkInterval) removes the stale client via removeAwarenessStates.
    removeAwarenessStates(localAware, [bClientId], "timeout");

    // The count must DROP — the old connection-event source had no TTL and would
    // have stuck at 1 forever.
    expect(localController.getPeers().length).toBe(0);

    localController.detach();
  });

  it("replays the user's A/B+/B-/C+/C- sequence → 1/2/1/2/1 participants (peers+1 local)", () => {
    const { instances, localController } = makeMesh(LOCAL, PEER_B, PEER_C);
    const [, bAware, cAware] = instances;

    // Participant count as the pill shows it: remote peers + the local user.
    const participants = () => localController.getPeers().length + 1;

    // A alone.
    expect(participants()).toBe(1);

    // B joins → 2.
    announce(bAware, PEER_B);
    expect(participants()).toBe(2);

    // B leaves → back to 1 (the bug showed 2).
    bAware.setLocalState(null);
    expect(participants()).toBe(1);

    // C joins → 2 (the bug showed 3 = stale B + C + A).
    announce(cAware, PEER_C);
    expect(participants()).toBe(2);

    // C leaves → 1 (the bug showed 3).
    cAware.setLocalState(null);
    expect(participants()).toBe(1);

    localController.detach();
  });

  it("counts the CURRENT set, never an append-only high-water-mark across churn", () => {
    const { instances, localController } = makeMesh(LOCAL, PEER_B, PEER_C);
    const [, bAware, cAware] = instances;

    // Both peers present → 2.
    announce(bAware, PEER_B);
    announce(cAware, PEER_C);
    expect(localController.getPeers().length).toBe(2);

    // Both leave → 0. A monotonic counter would still report 2.
    bAware.setLocalState(null);
    cAware.setLocalState(null);
    expect(localController.getPeers().length).toBe(0);

    // Sanity: getPeers() reflects the live state map (no stale identities).
    expect(readPeers(instances[0])).toHaveLength(0);

    localController.detach();
  });
});
