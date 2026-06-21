/**
 * Regression — task 1361: Delete key on a selected VECTOR SHAPE.
 *
 * A vector shape selected via the Selection tool goes into the planar SUBSELECTION
 * model (a fill face / line segment), NOT selectedShapeIds. The Delete handler
 * (`Shell.handleDeleteSubSelection`) deletes the selected region(s) by replacing
 * the merged display object with the `deleteSubSelection` REMAINDER, or removing
 * the object entirely when the remainder is empty (a single-fill shape = one face).
 *
 * These tests exercise the exact production transform the Shell handler runs:
 * `livePlanarShape` → `pickAt`/`pickConnected` → `deleteSubSelection` →
 * `setKeyframeDisplayObjects`, on a real document. They are the document-side proof
 * for the e2e repro (draw a rect, select it, press Delete → shape gone).
 */
import { describe, it, expect } from "vitest";
import {
  createDocument,
  createRectShape,
  setKeyframeDisplayObjects,
  getGoverningKeyframe,
  livePlanarShape,
  pickAt,
  pickConnected,
  deleteSubSelection,
  type DisplayObject,
  type ShapeDisplayObject,
  type Fill,
  type Timeline,
} from "@flash/core";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 1 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 1 } };

/** Put one merged ShapeDisplayObject (at origin, geometry in stage space) onto the
 *  active scene's layer-0 governing keyframe — what `handleShapeCreated` produces. */
function docWithShape(shape: ShapeDisplayObject): {
  timeline: Timeline;
  layerId: string;
} {
  const doc = createDocument();
  const timeline = doc.scenes[0].timeline;
  const layerId = timeline.layers[0].id;
  const next = setKeyframeDisplayObjects(timeline, layerId, 0, [shape]);
  return { timeline: next, layerId };
}

/** Mirror of Shell.handleDeleteSubSelection's document transform. */
function applyDelete(
  timeline: Timeline,
  layerId: string,
  shapeId: string,
  keys: readonly ReturnType<typeof pickAt>[]
): DisplayObject[] {
  const layer = timeline.layers.find((l) => l.id === layerId)!;
  const kf = getGoverningKeyframe(layer, 0)!;
  const target = (kf.displayObjects as DisplayObject[]).find(
    (o): o is ShapeDisplayObject => o.type === "shape" && o.id === shapeId
  )!;
  const ps = livePlanarShape(target.shape);
  const remainder = deleteSubSelection(
    ps,
    keys.filter((k): k is NonNullable<typeof k> => k != null),
    target.shape.id
  );
  const others = (kf.displayObjects as DisplayObject[]).filter((o) => o.id !== target.id);
  const out: DisplayObject[] = [...others];
  if (remainder) {
    out.push({ type: "shape", id: target.id, shape: remainder, x: target.x, y: target.y });
  }
  const after = setKeyframeDisplayObjects(timeline, layerId, 0, out);
  const afterLayer = after.layers.find((l) => l.id === layerId)!;
  return getGoverningKeyframe(afterLayer, 0)!.displayObjects as DisplayObject[];
}

describe("Delete a selected vector shape (task 1361)", () => {
  it("single-click face delete removes a single-fill rect from the document", () => {
    const rect: ShapeDisplayObject = {
      type: "shape",
      id: "shape-1",
      shape: createRectShape(0, 0, 100, 100, RED, null),
      x: 0,
      y: 0,
    };
    const { timeline, layerId } = docWithShape(rect);

    // Selection-tool single click on the fill body → one FACE key.
    const ps = livePlanarShape(rect.shape);
    const key = pickAt(ps, { x: 50, y: 50 });
    expect(key?.kind).toBe("face");

    const after = applyDelete(timeline, layerId, "shape-1", [key]);
    // A single-fill rect is ONE face → remainder empty → display object gone.
    expect(after.find((o) => o.id === "shape-1")).toBeUndefined();
    expect(after.filter((o) => o.type === "shape")).toHaveLength(0);
  });

  it("subselection delete removes ONLY the selected sub-shape, keeping the rest", () => {
    // Two adjacent differently-coloured fills merge into one planar shape with two
    // faces. Deleting one face must leave the other intact.
    const merged: ShapeDisplayObject = {
      type: "shape",
      id: "shape-2",
      shape: {
        id: "geo",
        paths: [
          createRectShape(0, 0, 100, 50, RED, null).paths[0],
          createRectShape(0, 50, 100, 100, BLUE, null).paths[0],
        ],
      },
      x: 0,
      y: 0,
    };
    const { timeline, layerId } = docWithShape(merged);

    const ps = livePlanarShape(merged.shape);
    // Pick the TOP (red) face only.
    const key = pickAt(ps, { x: 50, y: 25 });
    expect(key?.kind).toBe("face");

    const after = applyDelete(timeline, layerId, "shape-2", [key]);
    const remaining = after.find((o): o is ShapeDisplayObject => o.id === "shape-2");
    // The shape survives (the blue half remains); it is NOT wholly removed.
    expect(remaining).toBeDefined();
    expect(remaining!.shape.paths.length).toBeGreaterThan(0);

    // And the survivor is the BOTTOM half: a point in the (deleted) top half is now
    // outside every remaining fill, while a point in the bottom half is still inside.
    const afterPs = livePlanarShape(remaining!.shape);
    expect(pickAt(afterPs, { x: 50, y: 75 })?.kind).toBe("face"); // bottom kept
    expect(pickAt(afterPs, { x: 50, y: 25 })).toBeNull(); // top gone
  });

  it("double-click connected delete removes the whole connected fill region", () => {
    const rect: ShapeDisplayObject = {
      type: "shape",
      id: "shape-3",
      shape: createRectShape(0, 0, 100, 100, RED, null),
      x: 0,
      y: 0,
    };
    const { timeline, layerId } = docWithShape(rect);

    const ps = livePlanarShape(rect.shape);
    const keys = pickConnected(ps, { x: 50, y: 50 });
    expect(keys.length).toBeGreaterThan(0);

    const after = applyDelete(timeline, layerId, "shape-3", keys);
    expect(after.find((o) => o.id === "shape-3")).toBeUndefined();
  });
});
