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
import {
  rasterizePaths,
  rasterizeLayer,
  colorCounts,
  pixelDiff,
} from "./raster-oracle.js";
import { createOvalShape } from "../shapes.js";

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

  it("culled fold == full rebuild — RENDER-FAITHFUL (identical rasterized pixels)", () => {
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

    // GROUND-TRUTH RASTER ORACLE (task 1330): the abstract per-color face-area
    // comparison (sum of pathArea / faceArea) is NOT render-faithful — it can
    // both miss real regressions and report false divergences (the Δ144 artifact).
    // Instead rasterize BOTH the culled multi-object layer AND the full single-shape
    // rebuild with the SAME two-pass-fill + non-zero-winding rules the renderer uses,
    // and compare PIXELS. The culled fold (several display objects) and the full
    // whole-layer rebuild (one merged shape) must paint the SAME image.
    const W = 1540, H = 30;
    const culledRaster = rasterizeLayer(culled!, W, H);
    const fullRaster = rasterizeLayer([makeMerged(full.merged!)], W, H);
    expect(pixelDiff(culledRaster, fullRaster)).toBe(0);
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

// ===========================================================================
// REGRESSION (task 1329): the bbox cull must NOT reorder top-wins z between an
// untouched shape and a folded shape. When two EXISTING mutually-overlapping
// shapes are on a layer and a new stroke overlaps only the EARLIER-drawn one,
// the earlier shape is folded while the later (top) shape was previously left
// "untouched" and re-emitted BELOW the merged object — flipping the color of the
// existing<->existing overlap. The culled commit must be geometrically IDENTICAL
// to the full whole-layer rebuild (foldShapeIntoLayer over ALL mergeable shapes).
// ===========================================================================

describe("planar merge — bbox-cull preserves top-wins z-order (task 1329 regression)", () => {
  type Obj = { type: string; id: string; shape: Shape; x: number; y: number };
  const mk = (id: string, x: number, y: number, w: number, h: number, fill: Fill): Obj => ({
    type: "shape",
    id,
    shape: rectShape(id, x, y, w, h, fill),
    x: 0,
    y: 0,
  });
  const makeMerged = (s: Shape): Obj => ({ type: "shape", id: s.id, shape: s, x: 0, y: 0 });

  // All shapes in this regression suite live within [0..100, 0..100] stage space;
  // a slightly larger raster gives margin for the off-by-pixel cluster cases.
  const RW = 120, RH = 120;

  /**
   * RENDER-FAITHFUL per-color PIXEL count of a LAYER's display objects (task 1330).
   *
   * The previous oracle measured per-color FACE AREA by re-running
   * `buildArrangementFromShapes` on the (baked) display objects and summing
   * `faceArea` over bounded faces. That abstract re-arrangement is NOT
   * render-faithful: a point can resolve into a different abstract face than the
   * renderer paints, so the area oracle both misses real regressions and reports
   * FALSE divergences (the Δ144 leak in this task was exactly such an artifact —
   * confirmed diff=0 at the real CanvasRenderer). This now RASTERIZES the layer in
   * draw order (bottom -> top, top-wins) with the same two-pass-fill + non-zero
   * winding rules the renderer uses, and returns a map of "r,g,b,a" -> PIXEL count.
   */
  function layerColorAreas(objs: readonly { shape: Shape; x: number; y: number }[]): Map<string, number> {
    return colorCounts(rasterizeLayer(objs, RW, RH));
  }

  function expectSameColorAreas(a: Map<string, number>, b: Map<string, number>): void {
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const k of keys) {
      expect(a.get(k) ?? 0).toBe(b.get(k) ?? 0);
    }
  }

  it("MINIMAL: later existing shape (off-stroke) keeps top-wins over an earlier folded shape", () => {
    // Draw order bottom -> top: eBLUE then eRED (eRED is on top, overlaps eBLUE in
    // [50..70, 30..40] = area 200). The incoming GREEN overlaps eBLUE only (y>=45
    // misses eRED). Pre-fix, eRED was untouched and re-emitted BELOW the merged
    // (eBLUE ∪ GREEN) object, so eBLUE wrongly won the [50..70,30..40] overlap.
    const GREEN: Fill = { type: "solid", color: { r: 0, g: 255, b: 0, a: 255 } };
    const eBLUE = mk("eBLUE", 50, 30, 30, 20, BLUE); // [50..80, 30..50]
    const eRED = mk("eRED", 40, 20, 30, 20, RED); //   [40..70, 20..40], drawn LATER
    const incoming = mk("green", 30, 45, 36, 15, GREEN); // [30..66, 45..60]

    const existing = [eBLUE, eRED]; // bottom -> top

    const culled = planarMergeCommit<Obj>(existing, incoming, makeMerged);
    expect(culled).not.toBeNull();

    // Full whole-layer rebuild reference: fold ALL mergeable shapes in draw order.
    const full = foldShapeIntoLayer(existing, incoming, incoming.shape.id);
    expect(full.merged).not.toBeNull();

    const culledAreas = layerColorAreas(culled!);
    const fullAreas = layerColorAreas([makeMerged(full.merged!)]);

    // RED must keep its full area (it was drawn on top of BLUE); the existing<->
    // existing overlap [50..70,30..40]=200 belongs to RED, not BLUE.
    expectSameColorAreas(culledAreas, fullAreas);

    // Concrete guard: RED kept its full 600 (= 30*20). Pre-fix the cull left eRED
    // untouched below the merged object, so eBLUE absorbed the 200-unit overlap and
    // RED dropped to 400 — this assertion FAILS on the pre-1329 code.
    const redKey = "255,0,0,255";
    expect(culledAreas.get(redKey) ?? 0).toBeCloseTo(600, 0);
    expect(fullAreas.get(redKey) ?? 0).toBeCloseTo(600, 0);
  });

  it("randomized: culled commit == full whole-layer rebuild for 60 trials (raster pixels)", () => {
    // Deterministic PRNG (mulberry32) so the fuzz is reproducible.
    let seed = 0x1329abcd >>> 0;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const palette: Fill[] = [
      RED,
      BLUE,
      { type: "solid", color: { r: 0, g: 255, b: 0, a: 255 } },
      { type: "solid", color: { r: 255, g: 255, b: 0, a: 255 } },
    ];

    for (let trial = 0; trial < 60; trial++) {
      // 2-6 existing rects in a small field (so overlaps are frequent) + 1 stroke.
      const nExisting = ri(2, 6);
      const existing: Obj[] = [];
      for (let i = 0; i < nExisting; i++) {
        const x = ri(0, 60);
        const y = ri(0, 60);
        const w = ri(10, 40);
        const h = ri(10, 40);
        existing.push(mk("e" + i, x, y, w, h, palette[ri(0, palette.length - 1)]));
      }
      const incoming = mk(
        "stroke",
        ri(0, 60),
        ri(0, 60),
        ri(10, 40),
        ri(10, 40),
        palette[ri(0, palette.length - 1)]
      );

      const culled = planarMergeCommit<Obj>(existing, incoming, makeMerged);
      const full = foldShapeIntoLayer(existing, incoming, incoming.shape.id);
      // Both must agree on existence (a degenerate empty fold is rare here).
      if (culled === null || full.merged === null) {
        expect(culled === null).toBe(full.merged === null);
        continue;
      }

      // RENDER-FAITHFUL pixel comparison: the culled multi-object layer and the
      // full single-shape rebuild must paint the IDENTICAL image. Axis-aligned
      // integer-grid rects rasterize exactly, so the per-color pixel counts are
      // EQUAL (not merely close) when the two strategies agree.
      const culledAreas = layerColorAreas(culled);
      const fullAreas = layerColorAreas([makeMerged(full.merged)]);
      const keys = new Set([...culledAreas.keys(), ...fullAreas.keys()]);
      for (const k of keys) {
        const cv = culledAreas.get(k) ?? 0;
        const fv = fullAreas.get(k) ?? 0;
        expect(
          cv,
          `trial ${trial} color ${k}: culled=${cv} full=${fv}`
        ).toBe(fv);
      }
    }
  });

  it("transitive closure: B overlaps A but not the stroke -> B is still folded", () => {
    // A overlaps the stroke; B overlaps A but is disjoint from the stroke. B must be
    // pulled into the fold (transitive closure), not left untouched. C is fully
    // disjoint from everything and stays untouched.
    const A = mk("A", 0, 0, 30, 30, BLUE); //   [0..30, 0..30] - overlaps stroke
    const B = mk("B", 25, 0, 30, 30, RED); //   [25..55, 0..30] - overlaps A, not stroke
    const C = mk("C", 200, 200, 10, 10, BLUE); // far away, untouched
    const stroke = mk("s", 0, 0, 10, 10, RED); // [0..10, 0..10] - overlaps A only

    const existing = [A, B, C]; // bottom -> top
    const culled = planarMergeCommit<Obj>(existing, stroke, makeMerged);
    expect(culled).not.toBeNull();

    // Only C is untouched -> result is [C, merged] = 2 objects (A and B both folded).
    expect(culled!.length).toBe(2);
    expect(culled![0].id).toBe("C");

    const full = foldShapeIntoLayer(existing, stroke, stroke.shape.id);
    expectSameColorAreas(layerColorAreas(culled!), layerColorAreas([makeMerged(full.merged!)]));
  });
});

// ===========================================================================
// REGRESSION (task 1330): the >=7-shape same-color-island CLUSTER repro that the
// OLD abstract face-area oracle reported as a Δ144 "leak" (GREEN 691 -> 547). The
// fold IS render-faithful through the real CanvasRenderer (the QA E2E addendum
// confirmed diff=0/220000, flipPixels=0). The Δ144 was an ARTIFACT of measuring
// per-color faceArea on a re-arranged path-soup (locateFace resolving a point into
// a different abstract face than the renderer paints). Under the SOUND raster
// oracle — rasterizing the FOLDED result and comparing it to the ground-truth
// top-wins layered render of the same input shapes — the fold matches the screen.
// This case proves the new oracle is sound (no false divergence) AND that the old
// face-area oracle was the artifact.
// ===========================================================================

describe("planar merge — >=7-shape cluster fold IS render-faithful (task 1330 raster oracle)", () => {
  const GREEN: Fill = { type: "solid", color: { r: 0, g: 255, b: 0, a: 255 } };
  const YEL: Fill = { type: "solid", color: { r: 255, g: 255, b: 0, a: 255 } };
  // The exact repro from the task description (all x=y=0 offsets; rects [x..x+w, y..y+h]):
  //   existing (bottom->top): e0 BLUE, e1 GREEN, e2 YEL, e3 YEL, e4 BLUE, e5 RED, e6 GREEN
  //   incoming: s GREEN
  const obj = (id: string, x: number, y: number, w: number, h: number, fill: Fill) => ({
    shape: rectShape(id, x, y, w, h, fill),
    x: 0,
    y: 0,
  });

  it("the e0..e6 + s GREEN cluster: folded result == ground-truth top-wins render (pixels)", () => {
    // [x0,y0,x1,y1] -> mk via (x, y, w, h):
    const existing = [
      obj("e0", 12, 11, 16, 9, BLUE), //  [12..28, 11..20]
      obj("e1", 37, 24, 29, 32, GREEN), // [37..66, 24..56]
      obj("e2", 42, 35, 21, 32, YEL), //  [42..63, 35..67]
      obj("e3", 7, 16, 32, 35, YEL), //   [7..39, 16..51]
      obj("e4", 45, 10, 13, 26, BLUE), // [45..58, 10..36]
      obj("e5", 41, 10, 27, 33, RED), //  [41..68, 10..43]
      obj("e6", 43, 15, 12, 12, GREEN), // [43..55, 15..27]
    ];
    const incoming = obj("s", 26, 36, 29, 16, GREEN); // [26..55, 36..52]

    // (A) The merged/folded result, re-rendered.
    const full = foldShapeIntoLayer(existing, incoming, incoming.shape.id);
    expect(full.merged).not.toBeNull();

    const W = 80, H = 80;
    const foldedRaster = rasterizePaths(full.merged!.paths, W, H);

    // (B) The GROUND-TRUTH top-wins layered render of the SAME input shapes, in
    // draw order (existing bottom->top, then the incoming stroke on top) — exactly
    // what the screen shows.
    const groundTruth = rasterizeLayer([...existing, incoming], W, H);

    // RENDER-FAITHFUL: the fold reproduces the layered render PIXEL-for-PIXEL.
    // Under the OLD abstract face-area oracle this same input reported GREEN=691
    // (ground truth) vs 547 (folded) — a Δ144 FALSE divergence; the raster oracle
    // shows there is no divergence at the renderer (the fold is sound).
    expect(pixelDiff(foldedRaster, groundTruth)).toBe(0);

    // And per-color pixel counts agree exactly (so no color "leaked").
    const gt = colorCounts(groundTruth);
    const folded = colorCounts(foldedRaster);
    const keys = new Set([...gt.keys(), ...folded.keys()]);
    for (const k of keys) {
      expect(folded.get(k) ?? 0, `color ${k}`).toBe(gt.get(k) ?? 0);
    }
  });

  it("minimal: green cluster + yellow over it + a DISJOINT same-color green island folds render-faithfully", () => {
    // The "minimal variant" from the task description: a green cluster + yellow
    // over it + a disjoint same-color green island. The old face-area oracle
    // reported GREEN 643->503 / YELLOW 1336->1476; the raster oracle shows the
    // fold matches the layered render.
    const existing = [
      obj("gA", 10, 10, 40, 40, GREEN), // green cluster base
      obj("gB", 30, 20, 40, 40, GREEN), // overlaps gA (same color union)
      obj("y", 25, 25, 30, 30, YEL), //   yellow over the green cluster
      obj("island", 80, 80, 20, 20, GREEN), // DISJOINT same-color green island
    ];
    const incoming = obj("s", 15, 40, 40, 20, GREEN); // joins the cluster

    const full = foldShapeIntoLayer(existing, incoming, incoming.shape.id);
    expect(full.merged).not.toBeNull();

    const W = 120, H = 120;
    const folded = rasterizePaths(full.merged!.paths, W, H);
    const groundTruth = rasterizeLayer([...existing, incoming], W, H);
    expect(pixelDiff(folded, groundTruth)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-cycle read-back stability (task 1335)
//
// A merged shape's LIVE planar map is re-derived on demand from its committed
// per-path Shape (livePlanarShape -> buildArrangementFromShapes), and each
// selection edit commits that re-derived read-back back to the timeline. So heavy
// iterative editing runs the shape through MANY fold -> read-back -> fold cycles.
//
// The read-back of a curved fill (every oval / rounded shape) MUST converge to a
// FIXED POINT, not drift. Before the fix, consecutive quadratic arcs of one oval
// reported a near-shared-vertex "crossing" whose snapped point landed a twip off
// the true vertex; registering that split spawned a sub-twip stub edge every
// cycle. The segment count multiplied (8 -> 13 -> 19 ...) and the 45° vertices
// marched ~1 twip per cycle until the topology degenerated and the fill was LOST
// entirely (paths -> 0) after ~3 cycles. The fix (arrangement.ts shared-vertex
// guard) rejects those tangent-touch incidences so fold(read-back(x)) is a fixed
// point.
// ---------------------------------------------------------------------------
describe("planar read-back: multi-cycle stability is a fixed point (task 1335)", () => {
  /** One commit -> rebuild cycle: fold a single shape and read it back. */
  const cycle = (s: Shape): Shape =>
    planarShapeToShape(buildArrangementFromShapes([s]), "merged");

  /** Total filled-loop area of a Shape (chord shoelace). */
  const totalFillArea = (s: Shape): number =>
    s.paths.reduce((a, p) => a + (p.fill ? pathArea(p) : 0), 0);

  /** Count of non-null fill pixels of a Shape rasterized at WxH. */
  const fillPixels = (s: Shape, w: number, h: number): number => {
    const r = rasterizePaths(s.paths, w, h);
    let n = 0;
    for (const k of r.px) if (k !== null) n++;
    return n;
  };

  /** Whether two Shapes have byte-identical path/segment geometry. */
  const sameGeometry = (a: Shape, b: Shape): boolean =>
    JSON.stringify(a.paths.map((p) => [p.fill ? 1 : 0, p.stroke ? 1 : 0, p.start, p.segments])) ===
    JSON.stringify(b.paths.map((p) => [p.fill ? 1 : 0, p.stroke ? 1 : 0, p.start, p.segments]));

  const cases: [string, Shape][] = [
    ["circle", createOvalShape(40, 40, 200, 200, RED, null)],
    ["wide oval", createOvalShape(40, 60, 200, 180, RED, null)],
    ["tall oval", createOvalShape(60, 40, 180, 200, RED, null)],
    ["off-grid oval", createOvalShape(37, 53, 203, 191, BLUE, null)],
  ];

  for (const [name, authored] of cases) {
    it(`${name}: 10 commit->rebuild cycles keep area + path-count + raster pixels stable`, () => {
      const W = 240, H = 240;

      // Cycle 1 is the first commit (one-time twip snap of authored, off-grid
      // control points). From cycle 1 onward the read-back must be a FIXED POINT.
      const c1 = cycle(authored);

      // The first commit must render essentially pixel-identical to the authored
      // shape: the only change is the one-time snap of off-grid authored vertices
      // to the twip grid, which is sub-pixel and at worst nudges a few boundary
      // pixels on a heavily off-grid oval (single-commit correctness / oracle
      // invariant). This is a ONE-TIME effect — the strict fixed-point assertion
      // below proves there is NO further drift from cycle 2 onward.
      const authoredPx = fillPixels(authored, W, H);
      expect(authoredPx).toBeGreaterThan(0);
      expect(Math.abs(fillPixels(c1, W, H) - authoredPx)).toBeLessThanOrEqual(6);

      const baseArea = totalFillArea(c1);
      const basePaths = c1.paths.length;
      const baseSegs = c1.paths.reduce((n, p) => n + p.segments.length, 0);
      const basePx = fillPixels(c1, W, H);

      // The fill must survive (the pre-fix bug collapsed it to paths=0).
      expect(basePaths).toBeGreaterThan(0);
      expect(baseArea).toBeGreaterThan(0);

      let prev = c1;
      for (let i = 2; i <= 10; i++) {
        const next = cycle(prev);

        // Curve fidelity: still a single closed curved fill loop (NOT flattened
        // to a polyline, NOT fragmented into stubs).
        expect(next.paths.length).toBe(basePaths);
        const segs = next.paths.reduce((n, p) => n + p.segments.length, 0);
        expect(segs).toBe(baseSegs);
        expect(next.paths.some((p) => p.segments.some((s) => s.type === "curve"))).toBe(true);

        // Stability within epsilon: area, raster pixels do not drift.
        expect(Math.abs(totalFillArea(next) - baseArea)).toBeLessThan(0.5);
        expect(Math.abs(fillPixels(next, W, H) - basePx)).toBeLessThanOrEqual(2);

        // STRONGER: from cycle 2 the geometry is a byte-exact fixed point —
        // cycle N == cycle N-1 (and therefore == all later cycles).
        expect(sameGeometry(next, prev)).toBe(true);

        prev = next;
      }
    });
  }

  it("a stroked oval is also a fixed point across 10 cycles", () => {
    const STROKE = {
      width: 2,
      color: { r: 0, g: 0, b: 0, a: 255 },
      caps: "round" as const,
      joints: "round" as const,
    };
    const authored = createOvalShape(40, 60, 200, 180, RED, STROKE);
    const W = 240, H = 240;

    const c1 = cycle(authored);
    expect(c1.paths.length).toBeGreaterThan(0);
    const baseArea = totalFillArea(c1);
    const basePaths = c1.paths.length;
    const basePx = fillPixels(c1, W, H);
    expect(baseArea).toBeGreaterThan(0);

    let prev = c1;
    for (let i = 2; i <= 10; i++) {
      const next = cycle(prev);
      expect(next.paths.length).toBe(basePaths);
      expect(Math.abs(totalFillArea(next) - baseArea)).toBeLessThan(0.5);
      expect(Math.abs(fillPixels(next, W, H) - basePx)).toBeLessThanOrEqual(2);
      expect(sameGeometry(next, prev)).toBe(true);
      prev = next;
    }
  });
});
