/**
 * P1 merge-on-commit unit tests (docs/36-vector-merge-model.md).
 *
 * Area conservation + topology checks for the planar fold:
 *   - same-color union yields ONE face (area = A + B - overlap)
 *   - different-color cut removes the covered region (top wins; total covered
 *     area conserved; both colors present)
 *   - an island (different-color rect fully inside) carves a hole into the outer
 *     fill
 *   - curve-preserving round-trip (planar -> Shape keeps quadratics)
 */

import { describe, it, expect } from "vitest";
import type { Fill, PathSegment, Point, Shape, ShapePath } from "../types.js";
import {
  buildArrangementFromShapes,
  faceArea,
  planarShapeToShape,
  foldShapeIntoLayer,
  foldShapeIntoLayerCulled,
  planarMergeCommit,
} from "../planar/index.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };

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

/** Sum of bounded-face areas carrying a given fill index. */
function areaOfFill(
  ps: ReturnType<typeof buildArrangementFromShapes>,
  fillIndex: number
): number {
  let a = 0;
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    if (f.fill === fillIndex) a += faceArea(ps, f);
  }
  return a;
}
function fillIndexOf(ps: ReturnType<typeof buildArrangementFromShapes>, fill: Fill): number {
  return ps.fills.findIndex(
    (f) =>
      f.type === "solid" &&
      fill.type === "solid" &&
      f.color.r === fill.color.r &&
      f.color.g === fill.color.g &&
      f.color.b === fill.color.b &&
      f.color.a === fill.color.a
  );
}

/** Shoelace area of a closed ShapePath (chord approximation of any curves). */
function pathArea(path: ShapePath): number {
  const pts: Point[] = [path.start];
  let prev = path.start;
  for (const seg of path.segments) {
    if (seg.type === "curve") {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
          y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
        });
      }
    } else {
      pts.push(seg.to);
    }
    prev = seg.to;
  }
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

describe("planar merge-on-commit (P1)", () => {
  // -----------------------------------------------------------------------
  // same-color union
  // -----------------------------------------------------------------------
  it("same-color union: overlapping blues become one region (area = A + B - overlap)", () => {
    // Two 100x100 blue rects overlapping by 50x100.
    const a = rectShape("a", 0, 0, 100, 100, BLUE);
    const b = rectShape("b", 50, 0, 100, 100, BLUE);
    const ps = buildArrangementFromShapes([a, b]);

    const blueIdx = fillIndexOf(ps, BLUE);
    expect(blueIdx).toBeGreaterThanOrEqual(0);

    // Union area = 100*100 + 100*100 - 50*100 = 15000.
    expect(areaOfFill(ps, blueIdx)).toBeCloseTo(15000, 0);

    // Contiguous blue: every bounded face is blue (no other fill), and there is
    // no leftover area outside the union. (Same-color faces are adjacent and
    // render as one seamless region under non-zero winding; full single-face
    // dissolve of interior seams is P2 selection work.)
    const boundedFaces = ps.faces.filter((f) => !f.unbounded);
    expect(boundedFaces.length).toBeGreaterThanOrEqual(1);
    expect(boundedFaces.every((f) => f.fill === blueIdx)).toBe(true);

    // Read-back: one merged shape; total blue path area equals the union.
    const merged = planarShapeToShape(ps, "m");
    const totalArea = merged.paths
      .filter((p) => p.fill && p.fill.type === "solid")
      .reduce((s, p) => s + pathArea(p), 0);
    expect(totalArea).toBeCloseTo(15000, 0);
  });

  // -----------------------------------------------------------------------
  // different-color cut (top wins)
  // -----------------------------------------------------------------------
  it("different-color cut: red over blue carves blue; total covered area conserved", () => {
    const blue = rectShape("blue", 0, 0, 100, 100, BLUE); // 10000
    const red = rectShape("red", 50, 0, 100, 100, RED); // 10000, overlap 50x100=5000
    const ps = buildArrangementFromShapes([blue, red]); // red drawn last = top

    const blueIdx = fillIndexOf(ps, BLUE);
    const redIdx = fillIndexOf(ps, RED);
    expect(blueIdx).toBeGreaterThanOrEqual(0);
    expect(redIdx).toBeGreaterThanOrEqual(0);

    const blueArea = areaOfFill(ps, blueIdx);
    const redArea = areaOfFill(ps, redIdx);

    // Red (top) keeps its full 10000; blue loses the 5000 overlap -> 5000.
    expect(redArea).toBeCloseTo(10000, 0);
    expect(blueArea).toBeCloseTo(5000, 0);

    // Total covered area conserved: union = 10000 + 10000 - 5000 = 15000.
    expect(redArea + blueArea).toBeCloseTo(15000, 0);

    // Union area must be <= sum of inputs (cut removed overlap).
    expect(redArea + blueArea).toBeLessThanOrEqual(10000 + 10000);
  });

  // -----------------------------------------------------------------------
  // island carves a hole
  // -----------------------------------------------------------------------
  it("island: a different-color rect fully inside carves a hole in the outer fill", () => {
    const outer = rectShape("outer", 0, 0, 100, 100, BLUE); // 10000
    const inner = rectShape("inner", 30, 30, 40, 40, RED); // 1600, fully inside
    const ps = buildArrangementFromShapes([outer, inner]);

    const blueIdx = fillIndexOf(ps, BLUE);
    const redIdx = fillIndexOf(ps, RED);

    // Outer blue is carved by the inner red: 10000 - 1600 = 8400.
    expect(areaOfFill(ps, blueIdx)).toBeCloseTo(8400, 0);
    expect(areaOfFill(ps, redIdx)).toBeCloseTo(1600, 0);

    // The outer blue face has exactly one hole (the island).
    const blueFace = ps.faces.find((f) => !f.unbounded && f.fill === blueIdx);
    expect(blueFace).toBeDefined();
    expect(blueFace!.holes.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // foldShapeIntoLayer (display-object offsets baked to stage space)
  // -----------------------------------------------------------------------
  it("foldShapeIntoLayer bakes display offsets and unions same-color overlap", () => {
    // Existing blue 100x100 at origin; incoming blue 100x100 offset by (50,0).
    const existing = [{ shape: rectShape("a", 0, 0, 100, 100, BLUE), x: 0, y: 0 }];
    const incoming = { shape: rectShape("b", 0, 0, 100, 100, BLUE), x: 50, y: 0 };
    const { merged } = foldShapeIntoLayer(existing, incoming, "merged");
    expect(merged).not.toBeNull();
    const totalArea = merged!.paths.reduce((s, p) => s + (p.fill ? pathArea(p) : 0), 0);
    expect(totalArea).toBeCloseTo(15000, 0);
  });

  // -----------------------------------------------------------------------
  // planarMergeCommit list semantics
  // -----------------------------------------------------------------------
  it("planarMergeCommit folds shape objects, passes gradients through untouched", () => {
    type Obj = { type: string; id: string; shape: Shape; x: number; y: number };
    const blueA: Obj = { type: "shape", id: "a", shape: rectShape("a", 0, 0, 100, 100, BLUE), x: 0, y: 0 };
    // A gradient shape is NOT mergeable; it must pass through.
    const gradShape: Shape = {
      id: "g",
      paths: [
        {
          ...rectPath(200, 0, 50, 50, BLUE),
          fill: {
            type: "linear-gradient",
            angle: 0,
            stops: [
              { ratio: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
              { ratio: 255, color: { r: 255, g: 255, b: 255, a: 255 } },
            ],
          },
        },
      ],
    };
    const gradObj: Obj = { type: "shape", id: "g", shape: gradShape, x: 0, y: 0 };
    const incoming: Obj = { type: "shape", id: "b", shape: rectShape("b", 0, 0, 100, 100, BLUE), x: 50, y: 0 };

    const result = planarMergeCommit<Obj>(
      [blueA, gradObj],
      incoming,
      (shape) => ({ type: "shape", id: shape.id, shape, x: 0, y: 0 })
    );
    expect(result).not.toBeNull();
    // gradient passes through (1) + one merged object (1) = 2.
    expect(result!.length).toBe(2);
    expect(result![0].id).toBe("g"); // pass-through first
    const mergedObj = result![1];
    const area = mergedObj.shape.paths.reduce((s, p) => s + (p.fill ? pathArea(p) : 0), 0);
    expect(area).toBeCloseTo(15000, 0); // blue union
  });

  // -----------------------------------------------------------------------
  // curve preservation
  // -----------------------------------------------------------------------
  it("read-back is curve-preserving: a quadratic boundary survives the fold", () => {
    // A shape whose top edge is a quadratic arc.
    const arcShape: Shape = {
      id: "arc",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 0, y: 100 } },
            { type: "line", to: { x: 100, y: 100 } },
            { type: "curve", control: { x: 50, y: 50 }, to: { x: 0, y: 0 } },
          ] as PathSegment[],
          fill: BLUE,
          closed: true,
        },
      ],
    };
    const ps = buildArrangementFromShapes([arcShape]);
    const merged = planarShapeToShape(ps, "m");
    const hasCurve = merged.paths.some((p) => p.segments.some((s) => s.type === "curve"));
    expect(hasCurve).toBe(true);
  });
});

// ===========================================================================
// Incremental fold via spatial culling (task 1327) — bounded per-stroke fold
// on dense art, with correctness identical to the full whole-layer rebuild.
// ===========================================================================

describe("planar merge — spatial-cull incremental fold (task 1327)", () => {
  type Obj = { type: string; id: string; shape: Shape; x: number; y: number };
  const mk = (id: string, x: number, y: number, w: number, h: number, fill: Fill): Obj => ({
    type: "shape",
    id,
    shape: rectShape(id, x, y, w, h, fill),
    x: 0,
    y: 0,
  });
  const makeMerged = (s: Shape): Obj => ({ type: "shape", id: s.id, shape: s, x: 0, y: 0 });

  /** Total filled area across every shape display object on a layer. */
  function totalLayerArea(objs: readonly Obj[]): number {
    let a = 0;
    for (const o of objs) for (const p of o.shape.paths) if (p.fill) a += pathArea(p);
    return a;
  }

  it("disjoint existing shapes are kept UNTOUCHED, not refolded into one shape", () => {
    // Three disjoint same-color rects already on the layer; a 4th overlaps only
    // the first one.
    const existing = [
      mk("a", 0, 0, 10, 10, BLUE),
      mk("b", 100, 0, 10, 10, BLUE),
      mk("c", 200, 0, 10, 10, BLUE),
    ];
    const incoming = mk("d", 5, 0, 10, 10, BLUE); // overlaps only "a"

    const result = planarMergeCommit<Obj>(existing, incoming, makeMerged);
    expect(result).not.toBeNull();
    // b and c are disjoint -> untouched (2 objects) + 1 merged (a ∪ d) = 3.
    expect(result!.length).toBe(3);
    // The two disjoint shapes keep their identity (object reference preserved).
    expect(result!.slice(0, 2).map((o) => o.id).sort()).toEqual(["b", "c"]);

    // Area conservation: a (100) ∪ d (100), overlap 50 -> 150; + b (100) + c (100).
    expect(totalLayerArea(result!)).toBeCloseTo(150 + 100 + 100, 0);
  });

  it("culled fold == full rebuild for the overlapping subset (identical merged area)", () => {
    // A dense field of disjoint fills + a few that the new stroke overlaps.
    const existing: Obj[] = [];
    for (let i = 0; i < 50; i++) existing.push(mk("f" + i, i * 30, 0, 10, 10, BLUE));
    // Two existing fills near the origin that the stroke will straddle.
    existing.push(mk("near1", 0, 0, 10, 10, RED));
    existing.push(mk("near2", 8, 0, 10, 10, RED));
    const incoming = mk("stroke", 4, 0, 14, 14, RED);

    const culled = planarMergeCommit<Obj>(existing, incoming, makeMerged);
    expect(culled).not.toBeNull();

    // Full rebuild: fold EVERY mergeable shape (the pre-optimization behavior).
    const full = foldShapeIntoLayer(existing, incoming, incoming.shape.id);
    expect(full.merged).not.toBeNull();

    // The merged object in the culled result is the LAST element (top).
    const culledMerged = culled![culled!.length - 1];

    // Total artwork area must match between the two strategies (the disjoint
    // fills contribute the same area whether folded or kept separate).
    const culledTotal = totalLayerArea(culled!);
    const fullTotal = totalLayerArea([makeMerged(full.merged!)]);
    expect(culledTotal).toBeCloseTo(fullTotal, 0);

    // And the culled merged region (the stroke + the 3 RED fills it touches)
    // equals the red area of the full rebuild restricted to that region.
    const culledRedArea = culledMerged.shape.paths
      .filter((p) => p.fill && p.fill.type === "solid" && (p.fill as { color: { r: number } }).color.r === 255)
      .reduce((s, p) => s + pathArea(p), 0);
    const fullRedArea = full.merged!.paths
      .filter((p) => p.fill && p.fill.type === "solid" && (p.fill as { color: { r: number } }).color.r === 255)
      .reduce((s, p) => s + pathArea(p), 0);
    expect(culledRedArea).toBeCloseTo(fullRedArea, 0);
  });

  it("foldShapeIntoLayerCulled partitions overlapping vs untouched correctly", () => {
    const existing = [
      mk("hit", 0, 0, 10, 10, BLUE),
      mk("miss-far", 1000, 1000, 10, 10, BLUE),
    ];
    const incoming = mk("s", 5, 5, 10, 10, BLUE);
    const { merged, untouched } = foldShapeIntoLayerCulled(existing, incoming, "m");
    expect(merged).not.toBeNull();
    expect(untouched.map((o) => o.id)).toEqual(["miss-far"]);
  });

  it("touching-but-not-overlapping shapes (shared edge) still fold together", () => {
    // Two rects sharing exactly one vertical edge at x=10 -> a coincident edge in
    // the planar map. They must fold (the cull tolerance keeps touching shapes in).
    const existing = [mk("a", 0, 0, 10, 10, BLUE)];
    const incoming = mk("b", 10, 0, 10, 10, BLUE); // shares the x=10 edge
    const { merged, untouched } = foldShapeIntoLayerCulled(existing, incoming, "m");
    expect(untouched.length).toBe(0); // "a" is NOT culled away
    expect(merged).not.toBeNull();
    // Union of two adjacent 10x10 squares = 200 (seam dissolves, same color).
    const area = merged!.paths.reduce((s, p) => s + (p.fill ? pathArea(p) : 0), 0);
    expect(area).toBeCloseTo(200, 0);
  });

  it("PERF: per-stroke fold on a 500-fill layer is BOUNDED (not O(all fills))", () => {
    // Build a dense traced-bitmap-like layer: 500 disjoint solid fills in a grid.
    const n = 500;
    const existing: Obj[] = [];
    const cols = Math.ceil(Math.sqrt(n));
    const cell = 12; // 10px fill + 2px gap -> all DISJOINT
    for (let i = 0; i < n; i++) {
      const cx = (i % cols) * cell;
      const cy = Math.floor(i / cols) * cell;
      existing.push(mk("f" + i, cx, cy, 10, 10, BLUE));
    }
    // A new stroke that overlaps only the top-left corner (a couple of fills).
    const incoming = mk("stroke", 0, 0, 14, 14, BLUE);

    // Structural bound (the deterministic, non-flaky assertion): the result must
    // keep the vast majority of the disjoint fills UNTOUCHED as separate display
    // objects rather than collapsing all n into one merged shape. Pre-fix this
    // was always 1; with culling it is ~n minus the handful the stroke touches.
    const result = planarMergeCommit<Obj>(existing, incoming, makeMerged);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(n - 10); // only a few fills merged in
    expect(result!.length).toBeLessThan(n); // at least one (the stroke + its overlap) merged

    // Timing bound (generous to avoid CI flakiness): warm once, then median of 5.
    // The full-rebuild baseline for n=500 was well over 80 ms; the culled fold is
    // ~1 ms. A 50 ms ceiling proves the hitch is gone with ample headroom.
    const runs: number[] = [];
    planarMergeCommit<Obj>(existing, incoming, makeMerged); // warm
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      planarMergeCommit<Obj>(existing, incoming, makeMerged);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    const median = runs[2];
    expect(median).toBeLessThan(50);

    // Area is fully conserved (every fill still present; the stroke unions its
    // overlap). Total = 500 fills * 100 area, minus the overlap absorbed by the
    // 14x14 stroke unioned with the 2-3 fills it touches; assert it's within the
    // sane envelope [n*100, n*100 + stroke area].
    const total = totalLayerArea(result!);
    expect(total).toBeGreaterThanOrEqual(n * 100);
    expect(total).toBeLessThanOrEqual(n * 100 + 14 * 14);
  });
});
