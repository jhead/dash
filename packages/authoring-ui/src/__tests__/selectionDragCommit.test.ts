/**
 * Regression test for task 1264 — Selection-tool drag-move inconsistently snaps
 * the shape back to its original position.
 *
 * ROOT CAUSE (stale React-closure): the StageArea selection-drag pipeline is
 * incremental — onMouseMove dispatches many SMALL `onShapeMove(id, dx, dy)`
 * deltas and re-baselines the mouse origin after each, so every delta is
 * relative to the previous one and the model is expected to ACCUMULATE them.
 * The Shell drag handlers built the next document from the React-SUBSCRIBED
 * `doc` snapshot, which only refreshes on the next render. React batches
 * renders, so multiple mousemoves routinely fire against the SAME stale closure
 * doc within one frame; each rebuilt the doc from the ORIGINAL base position
 * plus only the latest tiny delta, discarding all accumulated movement and
 * snapping the shape back. commitDrag had the same defect on mouse-up.
 *
 * FIX: source the base document from the LIVE store present
 * (`documentStore.getState().history.present`) inside the drag handlers, so each
 * incremental delta accumulates on the freshest doc and the commit captures the
 * true final position.
 *
 * This test reproduces the no-render-flush race deterministically at the
 * store-handler level (the task's preferred acceptance form). It drives several
 * onShapeMove deltas back-to-back WITHOUT refreshing the rendered snapshot, then
 * commits, and asserts the committed + post-"render" position reflects the FULL
 * accumulated delta. It fails on the stale-closure source and passes on the
 * live-store source.
 */

import { describe, it, expect } from "vitest";
import {
  createDocument,
  addDisplayObject,
  updateDisplayObject,
  type FlashDocument,
  type ShapeDisplayObject,
  type Timeline as TimelineModel,
} from "@flash/core";
import {
  createDocumentStore,
  withSceneTimeline as withSceneTimelineDoc,
  type DocumentStoreApi,
} from "../store/documentStore.js";

const SCENE = 0;

function makeShape(id: string, x: number, y: number): ShapeDisplayObject {
  return {
    type: "shape" as const,
    id,
    x,
    y,
    shape: {
      id: `shape-${id}`,
      paths: [
        {
          fill: { type: "solid" as const, color: { r: 255, g: 0, b: 0, a: 255 } },
          start: { x: 0, y: 0 },
          segments: [
            { type: "line" as const, to: { x: 40, y: 0 } },
            { type: "line" as const, to: { x: 40, y: 40 } },
            { type: "line" as const, to: { x: 0, y: 40 } },
          ],
          closed: true,
        },
      ],
    },
  };
}

/** Find the (single) layer id + governing keyframe frame index in scene 0. */
function sceneLayerId(doc: FlashDocument): string {
  return doc.scenes[SCENE].timeline.layers[0].id;
}

/** Read a display object's position from the active scene timeline. */
function objPos(doc: FlashDocument, id: string): { x: number; y: number } {
  for (const layer of doc.scenes[SCENE].timeline.layers) {
    for (const f of layer.frames) {
      const o = f.displayObjects.find((d) => d.id === id);
      if (o) return { x: o.x, y: o.y };
    }
  }
  throw new Error(`object ${id} not found`);
}

/** Seed a store with one shape at (startX, startY) in scene 0's first keyframe. */
function seedStore(startX: number, startY: number): {
  store: DocumentStoreApi;
  layerId: string;
} {
  const store = createDocumentStore(createDocument());
  const base = store.getState().history.present;
  const layerId = sceneLayerId(base);
  const seeded = withSceneTimelineDoc(base, SCENE, (t) =>
    addDisplayObject(t, layerId, /*frameIndex*/ 0, makeShape("s1", startX, startY))
  );
  store.getState().replaceDoc(seeded);
  return { store, layerId };
}

/**
 * Mirror of Shell.handleShapeMove, parameterized by the DOC SOURCE so we can
 * exercise both the buggy (stale rendered snapshot) and fixed (live store)
 * variants with identical logic. `getBaseDoc()` returns the document the next
 * incremental move is built from.
 */
function makeHandleShapeMove(
  store: DocumentStoreApi,
  layerId: string,
  getBaseDoc: () => FlashDocument
) {
  return (id: string, dx: number, dy: number): void => {
    const next = withSceneTimelineDoc(getBaseDoc(), SCENE, (prev: TimelineModel) => {
      const layer = prev.layers.find((l) => l.id === layerId);
      if (!layer) return prev;
      const kf = [...layer.frames]
        .filter((f) => f.isKeyframe && f.index <= 0)
        .sort((a, b) => b.index - a.index)[0];
      if (!kf) return prev;
      const obj = kf.displayObjects.find((o) => o.id === id);
      if (!obj) return prev;
      return updateDisplayObject(prev, layerId, /*frameIndex*/ 0, id, {
        x: obj.x + dx,
        y: obj.y + dy,
      });
    });
    store.getState().replaceDoc(next);
  };
}

describe("selection-tool drag-move commit (task 1264)", () => {
  const DELTAS: Array<[number, number]> = [
    [10, 10],
    [10, 10],
    [10, 10],
    [10, 10],
    [10, 10],
  ];
  const totalDx = DELTAS.reduce((s, [d]) => s + d, 0); // 50
  const totalDy = DELTAS.reduce((s, [, d]) => s + d, 0); // 50

  it("STALE rendered-snapshot source loses accumulated deltas (reproduces the snap-back bug)", () => {
    const { store, layerId } = seedStore(100, 100);

    // Simulate the React-subscribed `doc`: captured ONCE before the gesture and
    // NOT refreshed between mousemoves (the no-render-flush race window).
    const renderedSnapshot = store.getState().history.present;
    const dragStartDoc = renderedSnapshot;
    const handleShapeMove = makeHandleShapeMove(store, layerId, () => renderedSnapshot);

    for (const [dx, dy] of DELTAS) handleShapeMove("s1", dx, dy);

    // commitDrag with the stale snapshot as the final position (mouse-up defect).
    store.getState().commitDrag(dragStartDoc, renderedSnapshot);

    const committed = objPos(store.getState().history.present, "s1");
    // The bug: only the LAST delta survives (in the live store), and the commit
    // writes back the original snapshot — so the move is discarded entirely.
    expect(committed.x).not.toBe(100 + totalDx);
    expect(committed.x).toBe(100); // snapped back to origin
    expect(committed.y).toBe(100);
  });

  it("LIVE store-present source accumulates every delta and commits the full move", () => {
    const { store, layerId } = seedStore(100, 100);

    // FIXED handler: every move reads the freshest store present, so deltas
    // accumulate even with no render between events.
    const dragStartDoc = store.getState().history.present;
    const handleShapeMove = makeHandleShapeMove(
      store,
      layerId,
      () => store.getState().history.present
    );

    for (const [dx, dy] of DELTAS) handleShapeMove("s1", dx, dy);

    // Interim (pre-commit) position already reflects the full accumulated delta.
    const interim = objPos(store.getState().history.present, "s1");
    expect(interim.x).toBe(100 + totalDx); // 150
    expect(interim.y).toBe(100 + totalDy); // 150

    // commit reads the live present as the final position.
    store.getState().commitDrag(dragStartDoc, store.getState().history.present);

    const committed = objPos(store.getState().history.present, "s1");
    expect(committed.x).toBe(150);
    expect(committed.y).toBe(150);

    // Persists across a subsequent "render" (re-reading the present) — no snap-back.
    const afterRender = objPos(store.getState().history.present, "s1");
    expect(afterRender.x).toBe(150);
    expect(afterRender.y).toBe(150);

    // The commit recorded exactly one undo step back to the pre-drag position.
    expect(store.getState().history.past.length).toBe(1);
    store.getState().undo();
    const undone = objPos(store.getState().history.present, "s1");
    expect(undone.x).toBe(100);
    expect(undone.y).toBe(100);
  });
});
