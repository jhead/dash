/**
 * Task 1431 — an eraser DRAG must coalesce into ONE undo entry.
 *
 * Flash 8 treats a whole eraser gesture (pointerdown→pointerup) as a SINGLE
 * undoable edit. The bug: StageArea's interactive eraser called
 * onShapeUpdate/onShapeDelete on EVERY pointermove, and each of those pushed a
 * history entry (pushDoc), so a one-second scrub produced dozens of undo steps —
 * Ctrl+Z then un-did only a single 1-sample sliver.
 *
 * FIX (mirrors the shape-move dragStartDocRef pattern): per-increment erase edits
 * go through `replaceDoc` (NO history entry) accumulating on the LIVE store
 * present, and a SINGLE history step is committed at gesture end via `commitDrag`
 * from the pre-gesture snapshot.
 *
 * This test reproduces the store-handler behaviour deterministically (the task's
 * preferred acceptance form): it seeds a mergeable shape, replays a multi-sample
 * eraser drag (each increment erasing the LIVE geometry via the real
 * `planarEraseShape`), and asserts exactly ONE undo entry is recorded and a
 * single undo restores the pre-gesture artwork. A contrast case drives the OLD
 * per-move `pushDoc` path and shows it records N entries.
 */

import { describe, it, expect } from "vitest";
import {
  createDocument,
  addDisplayObject,
  updateDisplayObject,
  planarEraseShape,
  buildEraserPolygon,
  type FlashDocument,
  type Shape,
  type ShapeDisplayObject,
} from "@flash/core";
import {
  createDocumentStore,
  withSceneTimeline as withSceneTimelineDoc,
  type DocumentStoreApi,
} from "../store/documentStore.js";

const SCENE = 0;
const RED = { type: "solid" as const, color: { r: 255, g: 0, b: 0, a: 255 } };

/** A 200×100 solid-red rect merged-style shape placed at the origin. */
function makeRect(id: string): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: {
      id: `shape-${id}`,
      paths: [
        {
          fill: RED,
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 0, y: 100 } },
            { type: "line", to: { x: 200, y: 100 } },
            { type: "line", to: { x: 200, y: 0 } },
            { type: "line", to: { x: 0, y: 0 } },
          ],
          closed: true,
        },
      ],
    },
  };
}

function sceneLayerId(doc: FlashDocument): string {
  return doc.scenes[SCENE].timeline.layers[0].id;
}

/** Read a display object's shape from scene 0's keyframe. */
function objShape(doc: FlashDocument, id: string): Shape {
  for (const layer of doc.scenes[SCENE].timeline.layers) {
    for (const f of layer.frames) {
      const o = f.displayObjects.find((d) => d.id === id);
      if (o && o.type === "shape") return o.shape;
    }
  }
  throw new Error(`shape object ${id} not found`);
}

/** Total signed fill area (abs) of a shape — proxy for "how much red remains". */
function fillArea(shape: Shape): number {
  let a = 0;
  for (const p of shape.paths) {
    let sum = 0;
    let prev = p.start;
    for (const seg of p.segments) {
      sum += prev.x * seg.to.y - seg.to.x * prev.y;
      prev = seg.to;
    }
    a += sum / 2;
  }
  return Math.abs(a);
}

function seedStore(): { store: DocumentStoreApi; layerId: string } {
  const store = createDocumentStore(createDocument());
  const base = store.getState().history.present;
  const layerId = sceneLayerId(base);
  const seeded = withSceneTimelineDoc(base, SCENE, (t) =>
    addDisplayObject(t, layerId, /*frameIndex*/ 0, makeRect("s1"))
  );
  // Seed via replaceDoc so the seeding is not itself an undo entry.
  store.getState().replaceDoc(seeded);
  return { store, layerId };
}

// A horizontal drag sweeping the eraser across the rect in several samples.
const SAMPLES: Array<{ x: number; y: number }> = [
  { x: 10, y: 50 },
  { x: 50, y: 50 },
  { x: 90, y: 50 },
  { x: 130, y: 50 },
  { x: 170, y: 50 },
  { x: 190, y: 50 },
];
const RADIUS = 10;

/** Build the per-increment swept eraser stamp (mirrors StageArea's onMouseMove). */
function stampFor(prev: { x: number; y: number }, cur: { x: number; y: number }) {
  const swept =
    Math.hypot(cur.x - prev.x, cur.y - prev.y) < 0.01 ? [cur] : [prev, cur];
  return buildEraserPolygon(swept, RADIUS);
}

describe("eraser drag coalesces into ONE undo entry (task 1431)", () => {
  it("FIXED: N pointermove increments via replaceDoc + one commitDrag = ONE history entry", () => {
    const { store, layerId } = seedStore();
    const areaBefore = fillArea(objShape(store.getState().history.present, "s1"));
    expect(store.getState().history.past.length).toBe(0);

    // Gesture: snapshot the pre-gesture doc ONCE, then each increment reads the
    // LIVE present, erases, and replaceDocs (no history) — exactly the fixed
    // handleEraseGestureUpdate flow.
    let dragStartDoc: FlashDocument | null = null;
    for (let i = 1; i < SAMPLES.length; i++) {
      if (dragStartDoc === null) dragStartDoc = store.getState().history.present;
      const live = store.getState().history.present;
      const cur = objShape(live, "s1");
      const { shape: next } = planarEraseShape(cur, stampFor(SAMPLES[i - 1], SAMPLES[i]));
      if (next === cur) continue; // no-op increment — no store write (task 1431)
      const nextDoc = withSceneTimelineDoc(live, SCENE, (t) =>
        updateDisplayObject(t, layerId, 0, "s1", { shape: next! })
      );
      store.getState().replaceDoc(nextDoc);
    }
    // pointerup commit — ONE undo step for the whole gesture.
    store.getState().commitDrag(dragStartDoc!, store.getState().history.present);

    // Exactly ONE history entry recorded.
    expect(store.getState().history.past.length).toBe(1);
    // The gesture actually eroded the fill.
    const areaAfter = fillArea(objShape(store.getState().history.present, "s1"));
    expect(areaAfter).toBeLessThan(areaBefore);

    // A single undo restores the full pre-gesture artwork.
    store.getState().undo();
    const restored = fillArea(objShape(store.getState().history.present, "s1"));
    expect(restored).toBeCloseTo(areaBefore, 5);
    expect(store.getState().history.past.length).toBe(0);
  });

  it("OLD per-move pushDoc path records N entries — proves the coalescing is meaningful", () => {
    const { store, layerId } = seedStore();
    expect(store.getState().history.past.length).toBe(0);

    let writes = 0;
    for (let i = 1; i < SAMPLES.length; i++) {
      const live = store.getState().history.present;
      const cur = objShape(live, "s1");
      const { shape: next } = planarEraseShape(cur, stampFor(SAMPLES[i - 1], SAMPLES[i]));
      if (next === cur) continue;
      const nextDoc = withSceneTimelineDoc(live, SCENE, (t) =>
        updateDisplayObject(t, layerId, 0, "s1", { shape: next! })
      );
      store.getState().pushDoc(nextDoc); // OLD behaviour: one history entry per move
      writes++;
    }

    // The old path stacks one undo step per erasing increment (> 1).
    expect(writes).toBeGreaterThan(1);
    expect(store.getState().history.past.length).toBe(writes);
  });
});
