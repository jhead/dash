/**
 * Task 1428 — "Erase Selected Fills" wiring.
 *
 * The planar eraser's "selected" mode is a silent no-op unless the caller supplies
 * a `selectedFaceFilter`. Before this task NEITHER StageArea (interactive erase) NOR
 * Shell (agent/oracle bridge) built one, so the shipped mode erased nothing.
 * `resolveSelectedFaceFilter` is the single shared decision both callers now use;
 * this test locks in the behavior so the wiring can't silently regress:
 *   - whole-object selection  → erase every fill in the selected object,
 *   - partial sub-selection   → erase only the selected face regions,
 *   - nothing selected        → erase nothing (each object is skipped),
 *   - selection on ANOTHER object → this object is skipped.
 *
 * It also drives the FULL erase path (resolve → planarEraseShape) over two fills
 * with only one selected, matching the task's acceptance: the selected fill loses
 * area, the unselected fill is untouched, and with no selection both are intact.
 */
import { describe, it, expect } from "vitest";
import {
  buildArrangementFromShapes,
  planarShapeToShape,
  planarEraseShape,
  buildEraserStamp,
  livePlanarShape,
  pickAt,
  type Fill,
  type Shape,
  type ShapePath,
} from "@flash/core";
import { resolveSelectedFaceFilter } from "../eraserSelection.js";

const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

function rectPath(x: number, y: number, w: number, h: number, fill: Fill): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x, y: y + h } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x, y } },
    ],
    fill,
    closed: true,
  };
}
function rectShape(id: string, x: number, y: number, w: number, h: number, fill: Fill): Shape {
  return { id, paths: [rectPath(x, y, w, h, fill)] };
}
/** Merge shapes into one via the planar read-back (mirrors the merge-drawing fold). */
function mergeShapes(id: string, shapes: Shape[]): Shape {
  return planarShapeToShape(buildArrangementFromShapes(shapes), id);
}
function colorArea(shape: Shape | null, fill: Fill): number {
  if (!shape) return 0;
  let a = 0;
  for (const p of shape.paths) {
    if (!p.fill || p.fill.type !== "solid" || fill.type !== "solid") continue;
    const c = p.fill.color;
    if (c.r !== fill.color.r || c.g !== fill.color.g || c.b !== fill.color.b) continue;
    // Shoelace area of the (line-only) polygon.
    let sum = 0;
    let prev = p.start;
    for (const seg of p.segments) {
      sum += prev.x * seg.to.y - seg.to.x * prev.y;
      prev = seg.to;
    }
    a += Math.abs(sum) / 2;
  }
  return a;
}

describe("resolveSelectedFaceFilter (task 1428 wiring)", () => {
  const shape = rectShape("s", 0, 0, 50, 50, BLUE);

  it("whole-object selection → a filter that accepts every fill", () => {
    const res = resolveSelectedFaceFilter("s", shape, {
      selectedShapeIds: ["s"],
      subSelection: null,
    });
    expect(res.kind).toBe("filter");
    if (res.kind === "filter") {
      expect(res.filter({ x: 25, y: 25 })).toBe(true);
      expect(res.filter({ x: 1, y: 1 })).toBe(true);
    }
  });

  it("nothing selected → skip (the no-op that leaves the object untouched)", () => {
    const res = resolveSelectedFaceFilter("s", shape, {
      selectedShapeIds: [],
      subSelection: null,
    });
    expect(res.kind).toBe("skip");
  });

  it("selection on ANOTHER object → skip", () => {
    const res = resolveSelectedFaceFilter("s", shape, {
      selectedShapeIds: ["other"],
      subSelection: { shapeId: "other", keys: [] },
    });
    expect(res.kind).toBe("skip");
  });

  it("partial sub-selection → filter accepts only the selected face region", () => {
    const merged = mergeShapes("m", [
      rectShape("b", 0, 0, 50, 100, BLUE),
      rectShape("r", 50, 0, 50, 100, RED),
    ]);
    const redKey = pickAt(livePlanarShape(merged), { x: 75, y: 50 });
    expect(redKey?.kind).toBe("face");
    const res = resolveSelectedFaceFilter("m", merged, {
      selectedShapeIds: [],
      subSelection: { shapeId: "m", keys: [redKey!] },
    });
    expect(res.kind).toBe("filter");
    if (res.kind === "filter") {
      expect(res.filter({ x: 75, y: 50 })).toBe(true); // red = selected
      expect(res.filter({ x: 25, y: 50 })).toBe(false); // blue = not selected
    }
  });

  it("sub-selection of only a segment (no faces) → skip", () => {
    const merged = mergeShapes("m", [rectShape("b", 0, 0, 50, 100, BLUE)]);
    // A face key that resolves to nothing / no faces at all.
    const res = resolveSelectedFaceFilter("m", merged, {
      selectedShapeIds: [],
      subSelection: { shapeId: "m", keys: [] },
    });
    expect(res.kind).toBe("skip");
  });
});

describe("Erase Selected Fills end-to-end (task 1428 acceptance)", () => {
  // Two disjoint fills, kept as SEPARATE display objects (Flash 8 merge culling).
  const objs = [
    { id: "blue", shape: rectShape("blue", 0, 0, 50, 50, BLUE) },
    { id: "red", shape: rectShape("red", 100, 0, 50, 50, RED) },
  ];
  // An eraser sweep crossing BOTH fills.
  const stamp = buildEraserStamp(
    [
      { x: 25, y: 25 },
      { x: 125, y: 25 },
    ],
    14
  );

  /** Run the caller wiring for every object under the eraser in "selected" mode. */
  function eraseSelected(selectedShapeIds: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const obj of objs) {
      const res = resolveSelectedFaceFilter(obj.id, obj.shape, {
        selectedShapeIds,
        subSelection: null,
      });
      if (res.kind === "skip") {
        out[obj.id] = colorArea(obj.shape, obj.id === "blue" ? BLUE : RED);
        continue;
      }
      const next = planarEraseShape(obj.shape, stamp, {
        mode: "selected",
        selectedFaceFilter: res.filter,
      }).shape;
      out[obj.id] = colorArea(next, obj.id === "blue" ? BLUE : RED);
    }
    return out;
  }

  const blueFull = colorArea(objs[0].shape, BLUE);
  const redFull = colorArea(objs[1].shape, RED);

  it("erases area from the SELECTED fill only, leaving the unselected fill intact", () => {
    const after = eraseSelected(["red"]);
    expect(after.red).toBeLessThan(redFull); // selected → erased
    expect(after.blue).toBeCloseTo(blueFull, -1); // unselected → untouched
  });

  it("with nothing selected it erases nothing", () => {
    const after = eraseSelected([]);
    expect(after.blue).toBeCloseTo(blueFull, -1);
    expect(after.red).toBeCloseTo(redFull, -1);
  });
});
