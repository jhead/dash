/**
 * Two-peer CONVERGENCE under ASYNCHRONOUS (buffered) delivery — the QA repro for
 * task 1359 (silent collaborative data loss: a shape drawn by one user is
 * intermittently NOT seen / duplicated / mis-ordered by another).
 *
 * The existing `binding.test.ts` `concurrent()` helper exchanges FULL state both
 * ways in one synchronous step, and the P0 `property.test.ts` drives a SINGLE
 * source over a SYNCHRONOUS wire — every mutation is causally ordered before the
 * next, so neither can ever produce two genuinely-concurrent rewrites of the same
 * `__order` array. The real interactive path (live drawing over a network) does:
 * both peers mutate the SAME keyframe within the same network window, so their
 * order-array edits are concurrent CRDT ops.
 *
 * These tests model that with an ASYNCHRONOUS LOOPBACK BUS: every Y.Doc update is
 * BUFFERED and delivered only on an explicit `flush()`. Between flushes each peer
 * edits from its own (stale) view, exactly like real latency. The bug
 * (delete-all+insert-all `__order` rewrite) converged BOTH peers to a corrupt
 * order (a duplicated / dropped id); the CRDT-safe incremental splice converges
 * them to the exact union with a deterministic, consistent z-order.
 *
 * Each peer drives the REAL merge-on-commit REPLACE path
 * (`setKeyframeDisplayObjects`, mirroring collabAdapter's pushDoc -> REPLACE),
 * so every commit triggers a full `__order` reconcile — maximal exposure.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createDocument,
  setKeyframeDisplayObjects,
  removeDisplayObject,
  moveDisplayObjectToTop,
  addAsClass,
  removeAsClass,
  type FlashDocument,
  type Timeline,
  type ShapeDisplayObject,
  type DisplayObject,
} from "@flash/core";
import { FlashCollabBinding } from "../binding.js";
import { rebuildDoc } from "../schema.js";
import { FakeDocSource } from "./helpers.js";

// ---------------------------------------------------------------------------
// Async buffered loopback bus: updates are queued, delivered only on flush().
// ---------------------------------------------------------------------------

interface BufferedUpdate {
  from: Y.Doc;
  update: Uint8Array;
}

/**
 * Wire N Y.Docs onto a shared bus that BUFFERS updates and delivers them only
 * when `flush()` is called — modeling asynchronous network latency. An update is
 * applied to every peer EXCEPT its origin, tagged with a remote origin so the
 * receiving binding's inbound observer fires. Delivering buffered updates can
 * itself enqueue nothing new (remote-origin txns don't re-buffer), so a single
 * drain pass converges.
 */
class AsyncBus {
  private readonly docs: Y.Doc[] = [];
  private readonly queue: BufferedUpdate[] = [];
  private readonly remoteOrigin = { wire: "remote-async" };
  private readonly handlers = new Map<Y.Doc, (u: Uint8Array, origin: unknown) => void>();

  add(doc: Y.Doc): void {
    this.docs.push(doc);
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === this.remoteOrigin) return; // delivered update, don't re-buffer
      this.queue.push({ from: doc, update });
    };
    this.handlers.set(doc, handler);
    doc.on("update", handler);
  }

  /** Deliver every buffered update to all other peers. */
  flush(): void {
    // Drain in waves until the queue is empty (applying never re-buffers because
    // delivered updates carry remoteOrigin, which the handler ignores).
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.queue.length);
      for (const { from, update } of batch) {
        for (const doc of this.docs) {
          if (doc === from) continue;
          Y.applyUpdate(doc, update, this.remoteOrigin);
        }
      }
    }
  }

  destroy(): void {
    for (const [doc, handler] of this.handlers) doc.off("update", handler);
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function withScene0Timeline(doc: FlashDocument, fn: (t: Timeline) => Timeline): FlashDocument {
  const t = fn(doc.scenes[0].timeline);
  return { ...doc, scenes: doc.scenes.map((s, i) => (i === 0 ? { ...s, timeline: t } : s)) };
}

function shape(id: string): ShapeDisplayObject {
  return { type: "shape", id, x: 0, y: 0, shape: { id: `${id}-s`, paths: [] } };
}

function layer0Id(doc: FlashDocument): string {
  return doc.scenes[0].timeline.layers[0].id;
}

function frame0Objects(doc: FlashDocument): readonly DisplayObject[] {
  return doc.scenes[0].timeline.layers[0].frames[0].displayObjects;
}

/** The current display-object id list of scene0/layer0/frame0 of a Y.Doc. */
function ydocIds(yd: Y.Doc): string[] {
  return rebuildDoc(yd)
    .scenes[0].timeline.layers[0].frames[0].displayObjects.map((o) => o.id);
}

/**
 * Stand up two peers (each a real binding over its own Y.Doc) on an async bus,
 * pre-seeded with `initial` and already mutually synced.
 */
function twoPeersAsync(initial: FlashDocument) {
  const bus = new AsyncBus();
  const srcA = new FakeDocSource(initial);
  const ydocA = new Y.Doc();
  bus.add(ydocA);
  const bindingA = new FlashCollabBinding(ydocA, srcA);

  const ydocB = new Y.Doc();
  bus.add(ydocB);
  // Replicate A's seeded state into B before B's binding adopts it.
  Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA), { wire: "remote-async" });
  const srcB = new FakeDocSource(initial);
  const bindingB = new FlashCollabBinding(ydocB, srcB);

  function teardown(): void {
    bindingA.destroy();
    bindingB.destroy();
    bus.destroy();
  }
  return { bus, srcA, srcB, ydocA, ydocB, bindingA, bindingB, teardown };
}

/** Assert both peers' Y.Docs AND both sources agree on the SAME id multiset/order. */
function expectConverged(
  ydocA: Y.Doc,
  ydocB: Y.Doc,
  srcA: FakeDocSource,
  srcB: FakeDocSource,
  expectedIds: string[],
): void {
  const aIds = ydocIds(ydocA);
  const bIds = ydocIds(ydocB);
  // Convergent: both Y.Docs identical.
  expect(aIds).toEqual(bIds);
  // No duplicates anywhere.
  expect(new Set(aIds).size).toBe(aIds.length);
  // Exactly the expected union (as a set — order asserted separately/deterministically).
  expect([...aIds].sort()).toEqual([...expectedIds].sort());
  // The rebuilt sources match their Y.Docs (the app sees what converged).
  expect(frame0Objects(srcA.getDoc()).map((o) => o.id)).toEqual(aIds);
  expect(frame0Objects(srcB.getDoc()).map((o) => o.id)).toEqual(bIds);
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("async two-peer convergence — concurrent draws on the SAME keyframe", () => {
  it("the exact QA-repro sequence: no id is duplicated or dropped in __order", () => {
    // Mirrors the task's reproduced failing sequence:
    //  1. B draws B1; flush B->A
    //  2. A draws A1, A2 locally (from the post-B1 view)
    //  3. B draws B2 concurrently (also from the post-B1 view)
    //  4. flush all
    // The defective whole-array rewrite converged BOTH to [B1,B2,B1,A1,A2]
    // (B1 DUPLICATED). The fix must converge to each id exactly once.
    const base = createDocument();
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      const layerId = layer0Id(base);
      const draw = (src: FakeDocSource, ...ids: string[]) => {
        const existing = frame0Objects(src.getDoc());
        const next = [...existing, ...ids.map(shape)];
        src.set(
          withScene0Timeline(src.getDoc(), (t) =>
            setKeyframeDisplayObjects(t, layerId, 0, next),
          ),
        );
      };

      draw(srcB, "B1"); // step 1
      bus.flush(); // B1 now on both

      draw(srcA, "A1"); // step 2 (A appends to [B1])
      draw(srcA, "A2");
      draw(srcB, "B2"); // step 3 (B appends to [B1], concurrently)

      bus.flush(); // step 4 — exchange the concurrent order rewrites

      expectConverged(ydocA, ydocB, srcA, srcB, ["B1", "A1", "A2", "B2"]);
    } finally {
      teardown();
    }
  });

  it("simultaneous appends by both peers from the same base converge to the union", () => {
    const base = createDocument();
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      const layerId = layer0Id(base);
      const draw = (src: FakeDocSource, id: string) => {
        const next = [...frame0Objects(src.getDoc()), shape(id)];
        src.set(
          withScene0Timeline(src.getDoc(), (t) => setKeyframeDisplayObjects(t, layerId, 0, next)),
        );
      };
      // Both peers draw several shapes WITHOUT any intervening flush — fully
      // concurrent order rewrites against the same empty base.
      draw(srcA, "A1");
      draw(srcB, "B1");
      draw(srcA, "A2");
      draw(srcB, "B2");
      draw(srcA, "A3");

      bus.flush();

      expectConverged(ydocA, ydocB, srcA, srcB, ["A1", "A2", "A3", "B1", "B2"]);
    } finally {
      teardown();
    }
  });

  it("many randomized concurrent interleavings never lose or duplicate a shape", () => {
    // Exercise a spread of concurrent add/flush interleavings across seeds; the
    // destructive rewrite corrupted a large fraction of these (the task cites a
    // 200/200-trial CRDT-primitive corruption rate). All must converge cleanly.
    for (let seed = 1; seed <= 40; seed++) {
      const base = createDocument();
      const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
      try {
        const layerId = layer0Id(base);
        let aCount = 0;
        let bCount = 0;
        const all: string[] = [];
        const draw = (src: FakeDocSource, id: string) => {
          all.push(id);
          const next = [...frame0Objects(src.getDoc()), shape(id)];
          src.set(
            withScene0Timeline(src.getDoc(), (t) =>
              setKeyframeDisplayObjects(t, layerId, 0, next),
            ),
          );
        };
        // Deterministic pseudo-random schedule from the seed.
        let s = seed >>> 0;
        const rnd = () => {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          return s / 0x7fffffff;
        };
        for (let step = 0; step < 24; step++) {
          const r = rnd();
          if (r < 0.4) draw(srcA, `A${aCount++}`);
          else if (r < 0.8) draw(srcB, `B${bCount++}`);
          else bus.flush(); // intermittent partial sync
        }
        bus.flush();
        expectConverged(ydocA, ydocB, srcA, srcB, all);
      } finally {
        teardown();
      }
    }
  });
});

describe("async two-peer convergence — concurrent add + reorder", () => {
  it("A adds a shape while B reorders existing shapes: both survive, one z-order", () => {
    // Seed both peers with three shapes.
    let base = createDocument();
    const layerId = layer0Id(base);
    base = withScene0Timeline(base, (t) =>
      setKeyframeDisplayObjects(t, layerId, 0, [shape("s1"), shape("s2"), shape("s3")]),
    );
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      // A appends s4 (an add → order insert at tail).
      srcA.set(
        withScene0Timeline(srcA.getDoc(), (t) =>
          setKeyframeDisplayObjects(t, layerId, 0, [
            ...frame0Objects(srcA.getDoc()),
            shape("s4"),
          ]),
        ),
      );
      // B concurrently moves s3 to the top (a pure reorder of the same __order).
      srcB.set(
        withScene0Timeline(srcB.getDoc(), (t) => {
          // moveDisplayObjectToTop operates on the frame; rebuild the timeline.
          const lyr = t.layers.find((l) => l.id === layerId)!;
          const fr = lyr.frames[0];
          const movedFrame = moveDisplayObjectToTop(fr, "s3");
          return setKeyframeDisplayObjects(t, layerId, 0, movedFrame.displayObjects);
        }),
      );

      bus.flush();

      // Both converge: every shape present exactly once incl. the concurrently-added s4.
      const aIds = ydocIds(ydocA);
      expect(ydocIds(ydocB)).toEqual(aIds);
      expect(new Set(aIds).size).toBe(aIds.length);
      expect([...aIds].sort()).toEqual(["s1", "s2", "s3", "s4"]);
    } finally {
      teardown();
    }
  });
});

describe("async two-peer convergence — concurrent add + delete", () => {
  it("A adds a shape while B deletes a different shape: add survives, delete applies", () => {
    let base = createDocument();
    const layerId = layer0Id(base);
    base = withScene0Timeline(base, (t) =>
      setKeyframeDisplayObjects(t, layerId, 0, [shape("k1"), shape("k2"), shape("k3")]),
    );
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      // A appends k4.
      srcA.set(
        withScene0Timeline(srcA.getDoc(), (t) =>
          setKeyframeDisplayObjects(t, layerId, 0, [...frame0Objects(srcA.getDoc()), shape("k4")]),
        ),
      );
      // B concurrently deletes k2.
      srcB.set(
        withScene0Timeline(srcB.getDoc(), (t) => removeDisplayObject(t, layerId, 0, "k2")),
      );

      bus.flush();

      const aIds = ydocIds(ydocA);
      expect(ydocIds(ydocB)).toEqual(aIds);
      expect(new Set(aIds).size).toBe(aIds.length);
      // k2 gone, k4 present — neither concurrent op clobbered the other.
      expect([...aIds].sort()).toEqual(["k1", "k3", "k4"]);
    } finally {
      teardown();
    }
  });

  it("A deletes the SAME shape B reorders: converges with no duplicate/ghost", () => {
    let base = createDocument();
    const layerId = layer0Id(base);
    base = withScene0Timeline(base, (t) =>
      setKeyframeDisplayObjects(t, layerId, 0, [shape("d1"), shape("d2"), shape("d3")]),
    );
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      // A deletes d2.
      srcA.set(
        withScene0Timeline(srcA.getDoc(), (t) => removeDisplayObject(t, layerId, 0, "d2")),
      );
      // B concurrently moves d2 to the top (reorders the about-to-be-deleted id).
      srcB.set(
        withScene0Timeline(srcB.getDoc(), (t) => {
          const fr = t.layers.find((l) => l.id === layerId)!.frames[0];
          return setKeyframeDisplayObjects(t, layerId, 0, moveDisplayObjectToTop(fr, "d2").displayObjects);
        }),
      );

      bus.flush();

      const aIds = ydocIds(ydocA);
      expect(ydocIds(ydocB)).toEqual(aIds);
      expect(new Set(aIds).size).toBe(aIds.length);
      // d2's Y.Map entry was deleted by A, so even if its order id lingers,
      // rebuildKeyed's defensive read drops an id with no live entry → no ghost.
      expect(aIds).not.toContain("d2");
      expect([...aIds].sort()).toEqual(["d1", "d3"]);
    } finally {
      teardown();
    }
  });
});

describe("async two-peer convergence — library items + asClasses (same keyed/order pattern)", () => {
  it("concurrent asClasses adds converge with no duplicate/dropped path", () => {
    const base = addAsClass(createDocument(), { path: "p/Base.as", source: "class Base {}" });
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      srcA.set(addAsClass(srcA.getDoc(), { path: "p/A.as", source: "class A {}" }));
      srcB.set(addAsClass(srcB.getDoc(), { path: "p/B.as", source: "class B {}" }));

      bus.flush();

      const aPaths = (rebuildDoc(ydocA).asClasses ?? []).map((c) => c.path);
      const bPaths = (rebuildDoc(ydocB).asClasses ?? []).map((c) => c.path);
      expect(aPaths).toEqual(bPaths);
      expect(new Set(aPaths).size).toBe(aPaths.length);
      expect([...aPaths].sort()).toEqual(["p/A.as", "p/B.as", "p/Base.as"]);
    } finally {
      teardown();
    }
  });

  it("concurrent asClasses add + remove converge cleanly", () => {
    let base = createDocument();
    base = addAsClass(base, { path: "p/X.as", source: "class X {}" });
    base = addAsClass(base, { path: "p/Y.as", source: "class Y {}" });
    const { ydocA, ydocB, srcA, srcB, bus, teardown } = twoPeersAsync(base);
    try {
      srcA.set(addAsClass(srcA.getDoc(), { path: "p/Z.as", source: "class Z {}" }));
      srcB.set(removeAsClass(srcB.getDoc(), "p/X.as"));

      bus.flush();

      const aPaths = (rebuildDoc(ydocA).asClasses ?? []).map((c) => c.path);
      const bPaths = (rebuildDoc(ydocB).asClasses ?? []).map((c) => c.path);
      expect(aPaths).toEqual(bPaths);
      expect(new Set(aPaths).size).toBe(aPaths.length);
      expect([...aPaths].sort()).toEqual(["p/Y.as", "p/Z.as"]);
    } finally {
      teardown();
    }
  });
});
