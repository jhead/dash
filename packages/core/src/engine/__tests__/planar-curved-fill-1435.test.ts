/**
 * Task 1435 — curved-boundary face fill classification.
 *
 * Fill-region classification used INSCRIBED 6-chord polygons (`chordPolygon` in
 * build.ts) for region membership and a flattened-boundary point test inside
 * `faceInteriorPoint` (query.ts). For faces bounded by quadratic arcs the
 * representative interior point can land in the sub-0.1px sagitta band between
 * the true arc and its inscribed chords — one mis-sampled point then flips the
 * fill of the ENTIRE face (a 124px² round-dab crescent classified fill=null →
 * ~98px² unpainted). Straight-edge inputs (square nib, rects) are exactly
 * immune because a chord IS the line segment.
 *
 * These tests were written FAILING-FIRST against the audit's two repros:
 *   - 2-sample round dab (30,30)→(34,33), half=12: the crescent of disk B not
 *     covered by disk A classified null (~391 unpainted half-px grid points).
 *   - dense self-overlap loop (spacing 3px): 1021+ unpainted interior points.
 * plus a parity gate (every face classifies as a fine-sampled true-curve
 * oracle says) and a straight-edge invariance gate (old chord classifier ==
 * new exact classifier for line-only inputs).
 *
 * The raster oracle here is renderer-faithful and INDEPENDENT of the kernel:
 * per-Fill-object nonzero winding over densely flattened loops (64 chords per
 * quadratic — sagitta < 1e-3 px, far below the 0.35px assertion margin).
 */

import { describe, it, expect } from "vitest";
import type { EdgeGeometry, Fill, Point, Shape, ShapePath } from "../types.js";
import { buildBrushRibbon, type BrushStampSample } from "../planar/brushpaint.js";
import { buildArrangementFromShapes } from "../planar/build.js";
import { foldShapeIntoLayer } from "../planar/merge.js";
import {
  faceInteriorPoint,
  pointInPolygon,
  shapePathToEdgeGeometries,
} from "../planar/query.js";
import { edgeAt } from "../planar/geometry.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };

/** Chords per quadratic for the independent dense-flattening oracle. */
const ORACLE_CHORDS = 64;

// ---------------------------------------------------------------------------
// Independent raster oracle (renderer-faithful nonzero winding)
// ---------------------------------------------------------------------------

/** Densely flatten one closed path to a polygon (oracle only). */
function densePoly(path: ShapePath, chords = ORACLE_CHORDS): Point[] {
  const poly: Point[] = [];
  for (const g of shapePathToEdgeGeometries(path)) {
    if (poly.length === 0) poly.push(g.p0);
    if (g.control === null) poly.push(g.p1);
    else for (let i = 1; i <= chords; i++) poly.push(edgeAt(g, i / chords));
  }
  return poly;
}

/**
 * Renderer-faithful painted test over a grid: paths grouped by Fill OBJECT
 * reference, each group evaluated with the NONZERO winding rule (this is what
 * `renderShape` does — holes share the outer loop's Fill and cut via winding),
 * then a point is painted when ANY group covers it (all-one-color repros).
 * Row-scanline implementation so dense rasters stay fast.
 */
function paintedGrid(
  shape: Shape,
  xs: readonly number[],
  ys: readonly number[]
): boolean[][] {
  const groups = new Map<Fill, Point[][]>();
  for (const p of shape.paths) {
    if (!p.fill || !p.closed) continue;
    let bucket = groups.get(p.fill);
    if (!bucket) {
      bucket = [];
      groups.set(p.fill, bucket);
    }
    bucket.push(densePoly(p));
  }
  const painted: boolean[][] = ys.map(() => xs.map(() => false));
  for (const polys of groups.values()) {
    for (let yi = 0; yi < ys.length; yi++) {
      const y = ys[yi];
      // Signed crossings of the horizontal line at y.
      const crossings: { x: number; sign: number }[] = [];
      for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[j];
          const b = poly[i];
          if (a.y > y === b.y > y) continue;
          const x = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
          crossings.push({ x, sign: b.y > a.y ? 1 : -1 });
        }
      }
      crossings.sort((c, d) => c.x - d.x);
      // winding(x) = sum of signs of crossings strictly right of x.
      let k = 0;
      let windRight = 0;
      for (const c of crossings) windRight += c.sign;
      for (let xi = 0; xi < xs.length; xi++) {
        const x = xs[xi];
        while (k < crossings.length && crossings[k].x <= x) {
          windRight -= crossings[k].sign;
          k++;
        }
        if (windRight !== 0) painted[yi][xi] = true;
      }
    }
  }
  return painted;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function samples(pts: readonly Point[], half: number): BrushStampSample[] {
  return pts.map((p) => ({ x: p.x, y: p.y, half }));
}

/** Min distance from a point to a polyline. */
function distToPolyline(pt: Point, pts: readonly Point[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    best = Math.min(best, Math.hypot(pt.x - px, pt.y - py));
  }
  return best;
}

/** Resample a polyline at (approximately) fixed arc-length spacing. */
function resample(pts: readonly Point[], spacing: number): Point[] {
  const out: Point[] = [{ ...pts[0] }];
  let carried = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    let d = spacing - carried;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carried = segLen - (d - spacing);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-9) out.push({ ...last });
  return out;
}

function gridRange(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * Count interior grid points (dist(pt, spine) <= half - 0.35, 0.5px grid) left
 * UNPAINTED by the committed (folded) shape. Must be zero — the audit's exact
 * acceptance criterion; the square nib scores zero on the same construction.
 */
function unpaintedInteriorCount(spine: readonly Point[], half: number): number {
  const ribbon = buildBrushRibbon("ribbon", samples(spine, half), RED);
  const { merged } = foldShapeIntoLayer([], { shape: ribbon, x: 0, y: 0 }, "m");
  expect(merged).not.toBeNull();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of spine) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const xs = gridRange(minX - half, maxX + half, 0.5);
  const ys = gridRange(minY - half, maxY + half, 0.5);
  const painted = paintedGrid(merged!, xs, ys);
  let unpainted = 0;
  for (let yi = 0; yi < ys.length; yi++) {
    for (let xi = 0; xi < xs.length; xi++) {
      if (painted[yi][xi]) continue;
      if (distToPolyline({ x: xs[xi], y: ys[yi] }, spine) <= half - 0.35) unpainted++;
    }
  }
  return unpainted;
}

// ---------------------------------------------------------------------------
// Classification oracle (fine-sampled true-curve membership, per acceptance)
// ---------------------------------------------------------------------------

/**
 * Re-derive the expected face fill exactly as `assignFaceFillsBySampling`
 * defines it (per-(shape, Fill-object) groups in draw order, even-odd parity
 * within a group, last covering group wins) — but with membership tested
 * against DENSELY flattened true curves instead of the kernel's test.
 * Returns the winning Fill object, or null.
 */
function oracleFillAt(shapes: readonly Shape[], pt: Point): Fill | null {
  let resolved: Fill | null = null;
  for (const shape of shapes) {
    const byFill = new Map<Fill, Point[][]>();
    const order: Fill[] = [];
    for (const path of shape.paths) {
      if (!path.fill || !path.closed) continue;
      let bucket = byFill.get(path.fill);
      if (!bucket) {
        bucket = [];
        byFill.set(path.fill, bucket);
        order.push(path.fill);
      }
      bucket.push(densePoly(path));
    }
    for (const fill of order) {
      let enclosures = 0;
      for (const poly of byFill.get(fill)!) if (pointInPolygon(pt, poly)) enclosures++;
      if (enclosures % 2 === 1) resolved = fill;
    }
  }
  return resolved;
}

/** Oracle result is stable under small jitter (skip boundary-ambiguous points). */
function oracleStableAt(shapes: readonly Shape[], pt: Point): Fill | null | "unstable" {
  const base = oracleFillAt(shapes, pt);
  for (const [dx, dy] of [
    [0.01, 0],
    [-0.01, 0],
    [0, 0.01],
    [0, -0.01],
  ]) {
    if (oracleFillAt(shapes, { x: pt.x + dx, y: pt.y + dy }) !== base) return "unstable";
  }
  return base;
}

function solidColorKey(f: Fill | null): string {
  if (f === null) return "null";
  if (f.type !== "solid") return JSON.stringify(f);
  return `${f.color.r},${f.color.g},${f.color.b},${f.color.a}`;
}

/**
 * Assert every bounded face of the arrangement built from `shapes` carries the
 * fill the fine-sampled true-curve oracle assigns to its interior point.
 */
function assertParityWithOracle(shapes: readonly Shape[]): {
  faces: number;
  checked: number;
} {
  const ps = buildArrangementFromShapes(shapes);
  let checked = 0;
  let faces = 0;
  const mismatches: string[] = [];
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    faces++;
    const pt = faceInteriorPoint(ps, f);
    if (!pt) continue;
    const expected = oracleStableAt(shapes, pt);
    if (expected === "unstable") continue;
    checked++;
    const actual = f.fill === null || f.fill === undefined ? null : ps.fills[f.fill];
    if (solidColorKey(actual) !== solidColorKey(expected)) {
      mismatches.push(
        `face ${f.id} at (${pt.x.toFixed(2)},${pt.y.toFixed(2)}): kernel=${solidColorKey(actual)} oracle=${solidColorKey(expected)}`
      );
    }
  }
  expect(mismatches, mismatches.join("\n")).toHaveLength(0);
  return { faces, checked };
}

// ---------------------------------------------------------------------------
// The audit's self-overlap loop spine
// ---------------------------------------------------------------------------

const LOOP_SPINE: Point[] = [
  { x: 20, y: 50 },
  { x: 40, y: 48 },
  { x: 60, y: 47 },
  { x: 80, y: 49 },
  { x: 100, y: 50 },
  { x: 102, y: 30 },
  { x: 100, y: 12 },
  { x: 80, y: 10 },
  { x: 62, y: 12 },
  { x: 60, y: 30 },
  { x: 60, y: 50 },
  { x: 60, y: 70 },
  { x: 61, y: 90 },
];

// ---------------------------------------------------------------------------
// Repro 1: the 2-sample round dab crescent (audit: ~391 unpainted, 124px² face)
// ---------------------------------------------------------------------------

describe("planar curved-fill classification — round dab crescent (task 1435)", () => {
  const spine: Point[] = [
    { x: 30, y: 30 },
    { x: 34, y: 33 },
  ];
  const half = 12;

  it("the committed 2-sample dab paints its FULL footprint (zero unpainted interior points)", () => {
    expect(unpaintedInteriorCount(spine, half)).toBe(0);
  });

  it("no dab face whose interior point is inside a true disk classifies null (the crescent)", () => {
    const ribbon = buildBrushRibbon("dab", samples(spine, half), RED);
    const ps = buildArrangementFromShapes([ribbon]);
    // Direct regression: every bounded face whose interior point the TRUE-curve
    // oracle places inside the ribbon must carry the fill — in particular the
    // 124px² crescent of disk B outside disk A.
    let coveredFatFaces = 0;
    for (const f of ps.faces) {
      if (f.unbounded) continue;
      const pt = faceInteriorPoint(ps, f);
      if (!pt) continue;
      const expected = oracleStableAt([ribbon], pt);
      if (expected === "unstable" || expected === null) continue;
      coveredFatFaces++;
      expect(f.fill, `face ${f.id} at (${pt.x},${pt.y}) must not be null`).not.toBeNull();
    }
    expect(coveredFatFaces).toBeGreaterThan(0);
  });

  it("parity: every dab face classifies as the fine-sampled true-curve oracle", () => {
    const ribbon = buildBrushRibbon("dab", samples(spine, half), RED);
    const { checked } = assertParityWithOracle([ribbon]);
    expect(checked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Repro 2: dense self-overlap loop (audit: 1021 unpainted at spacing 3, half 8)
//
// What this task fixed here (three stacked kernel defects, measured):
//   1. Classification (build.ts/query.ts): exact curve membership — gated by
//      the parity assertions and the dab repro above.
//   2. intersect.ts spread-cluster resolution: a SHALLOW transversal crossing
//      (e.g. two stamped disks 2.33px apart crossing at 23°) smeared into 6–7
//      twip-distinct split points; a near-tangent LENS (disk spacing ≈ 2r) was
//      collapsed to ONE point, dropping a real crossing. Both shattered the
//      arrangement (Euler ≠ 2) → un-locatable faces → cracks.
//   3. arrangement.ts split canonicalization: crossings from DIFFERENT edge
//      pairs landing in ADJACENT twip cells minted vertices 1 twip apart
//      joined by degenerate stubs that corrupted the rotation rings (three
//      stamped disks → Euler −2).
// With all three fixed, the capsule ribbon at half 8 and the disk-only chain
// at half 8/4 raster with ZERO cracks.
//
// KNOWN RESIDUAL (task 1434's charter — brushpaint.ts, owned by the sibling
// task): the capsule ribbon at half 4 still cracks (~81 points): the capsule
// corner vertices are NOT vertices of the (squircle) disk stamp boundary, so
// the union seal breaks along the tangent seams (observed: a 989px² face
// containing BOTH the loop's background hole and in-stamp points — no point
// sampler can classify a straddling face). 1434's tangent-vertex stamp
// construction + round-vs-square parity harness covers that gate.
// ---------------------------------------------------------------------------

/** A round disk stamp path (same 4 corner-control quads as brushpaint's diskPath). */
function diskStampPath(cx: number, cy: number, r: number, fill: Fill): ShapePath {
  return {
    start: { x: cx + r, y: cy },
    segments: [
      { type: "curve", control: { x: cx + r, y: cy + r }, to: { x: cx, y: cy + r } },
      { type: "curve", control: { x: cx - r, y: cy + r }, to: { x: cx - r, y: cy } },
      { type: "curve", control: { x: cx - r, y: cy - r }, to: { x: cx, y: cy - r } },
      { type: "curve", control: { x: cx + r, y: cy - r }, to: { x: cx + r, y: cy } },
    ],
    closed: true,
    fill,
  };
}

/** Disk-only stamp union along the spine (distinct Fill object per disk). */
function diskChainShape(spine: readonly Point[], half: number): Shape {
  return {
    id: "disk-chain",
    paths: spine.map((p) => diskStampPath(p.x, p.y, half, { ...RED })),
  };
}

/** Unpainted count for the disk-only chain: interior = within half-0.35 of a SAMPLE. */
function unpaintedDiskChainCount(spine: readonly Point[], half: number): number {
  const chain = diskChainShape(spine, half);
  const { merged } = foldShapeIntoLayer([], { shape: chain, x: 0, y: 0 }, "m");
  expect(merged).not.toBeNull();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of spine) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const xs = gridRange(minX - half, maxX + half, 0.5);
  const ys = gridRange(minY - half, maxY + half, 0.5);
  const painted = paintedGrid(merged!, xs, ys);
  let unpainted = 0;
  for (let yi = 0; yi < ys.length; yi++) {
    for (let xi = 0; xi < xs.length; xi++) {
      if (painted[yi][xi]) continue;
      const pt = { x: xs[xi], y: ys[yi] };
      let d = Infinity;
      for (const s of spine) d = Math.min(d, Math.hypot(pt.x - s.x, pt.y - s.y));
      if (d <= half - 0.35) unpainted++;
    }
  }
  return unpainted;
}

describe("planar curved-fill classification — dense self-overlap loop (task 1435)", () => {
  it("capsule ribbon, spacing 3, half 8: zero unpainted interior points", () => {
    const spine = resample(LOOP_SPINE, 3);
    expect(unpaintedInteriorCount(spine, 8)).toBe(0);
  });

  it("disk-only chain, spacing 3, half 8: zero unpainted interior points", () => {
    const spine = resample(LOOP_SPINE, 3);
    expect(unpaintedDiskChainCount(spine, 8)).toBe(0);
  });

  it("disk-only chain, spacing 3, half 4 (default brush size 8): zero unpainted interior points", () => {
    const spine = resample(LOOP_SPINE, 3);
    expect(unpaintedDiskChainCount(spine, 4)).toBe(0);
  });

  it("parity: every capsule-ribbon loop face classifies as the fine-sampled true-curve oracle", () => {
    const spine = resample(LOOP_SPINE, 3);
    const ribbon = buildBrushRibbon("loop", samples(spine, 8), RED);
    const { checked } = assertParityWithOracle([ribbon]);
    expect(checked).toBeGreaterThan(0);
  });

  it("parity: every disk-chain face classifies as the fine-sampled true-curve oracle", () => {
    const spine = resample(LOOP_SPINE, 3);
    const chain = diskChainShape(spine, 8);
    const { checked } = assertParityWithOracle([chain]);
    expect(checked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Kernel micro-regressions distilled from the dense-loop failure (task 1435):
// the exact minimal disk configurations that shattered the arrangement.
// ---------------------------------------------------------------------------

describe("planar curved-fill classification — kernel topology micro-repros (task 1435)", () => {
  const euler = (shapes: readonly Shape[]) => {
    const ps = buildArrangementFromShapes(shapes);
    // V − E + F must be 2 for a connected planar subdivision (3 when the input
    // splits into two disjoint components).
    const used = new Set<number>();
    for (const he of ps.halfEdges) used.add(he.origin);
    return used.size - ps.halfEdges.length / 2 + ps.faces.length;
  };

  it("two overlapping disks with a SHALLOW (23°) boundary crossing build a valid arrangement", () => {
    // Pre-fix: the crossing smeared into 6–7 twip-distinct split points
    // (intersect.ts spread cluster) → Euler −1, un-locatable faces.
    const chain = diskChainShape(
      [
        { x: 100.16122923207902, y: 13.451063088711262 },
        { x: 98.46763555485029, y: 11.84676355548503 },
      ],
      8
    );
    expect(euler([chain])).toBe(2);
  });

  it("two disks at near-tangent spacing (d ≈ 2r) keep BOTH lens crossings", () => {
    // Pre-fix: the two genuine crossings 3.3px apart merged into one cluster
    // and the parallel-tangent pin collapsed them to ONE point → Euler 1.
    const chain = diskChainShape(
      [
        { x: 64.85097817092018, y: 47.48490218290798 },
        { x: 60, y: 32.219109083363455 },
      ],
      8
    );
    expect(euler([chain])).toBe(2);
  });

  it("three closely-stacked disks canonicalize adjacent-twip split points to shared vertices", () => {
    // Pre-fix: crossings from different disk pairs snapped into ADJACENT twip
    // cells → vertices 1 twip apart joined by degenerate stubs → rotation-ring
    // corruption → Euler −2 and whole coverage regions in no bounded face.
    const chain = diskChainShape(
      [
        { x: 60.81, y: 86.198 },
        { x: 60.96, y: 89.195 },
        { x: 61.0, y: 90.0 },
      ],
      8
    );
    expect(euler([chain])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Straight-edge invariance: chord classification IS exact for line segments,
// so the fix must not change any straight-edge result.
// ---------------------------------------------------------------------------

/** The OLD inscribed-chord region classifier, replicated verbatim as reference. */
function chordFillAt(shapes: readonly Shape[], pt: Point): Fill | null {
  let resolved: Fill | null = null;
  for (const shape of shapes) {
    const byFill = new Map<Fill, Point[][]>();
    const order: Fill[] = [];
    for (const path of shape.paths) {
      if (!path.fill || !path.closed) continue;
      const poly: Point[] = [];
      for (const g of shapePathToEdgeGeometries(path)) {
        if (poly.length === 0) poly.push(g.p0);
        if (g.control === null) poly.push(g.p1);
        else for (let i = 1; i <= 6; i++) poly.push(edgeAt(g, i / 6));
      }
      let bucket = byFill.get(path.fill);
      if (!bucket) {
        bucket = [];
        byFill.set(path.fill, bucket);
        order.push(path.fill);
      }
      bucket.push(poly);
    }
    for (const fill of order) {
      let enclosures = 0;
      for (const poly of byFill.get(fill)!) if (pointInPolygon(pt, poly)) enclosures++;
      if (enclosures % 2 === 1) resolved = fill;
    }
  }
  return resolved;
}

function rectShape(id: string, x0: number, y0: number, x1: number, y1: number, fill: Fill): Shape {
  const path: ShapePath = {
    start: { x: x0, y: y0 },
    segments: [
      { type: "line", to: { x: x1, y: y0 } },
      { type: "line", to: { x: x1, y: y1 } },
      { type: "line", to: { x: x0, y: y1 } },
      { type: "line", to: { x: x0, y: y0 } },
    ],
    closed: true,
    fill,
  };
  return { id, paths: [path] };
}

describe("planar curved-fill classification — straight-edge inputs UNCHANGED (task 1435)", () => {
  it("overlapping rects classify identically under the old chord classifier", () => {
    const shapes = [
      rectShape("a", 0, 0, 40, 40, RED),
      rectShape("b", 20, 20, 60, 60, BLUE),
      rectShape("c", -10, 10, 15, 30, RED),
    ];
    const ps = buildArrangementFromShapes(shapes);
    let checked = 0;
    for (const f of ps.faces) {
      if (f.unbounded) continue;
      const pt = faceInteriorPoint(ps, f);
      if (!pt) continue;
      checked++;
      const actual = f.fill === null || f.fill === undefined ? null : ps.fills[f.fill];
      const reference = chordFillAt(shapes, pt);
      expect(solidColorKey(actual)).toBe(solidColorKey(reference));
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("a square-nib self-crossing stroke (all line segments) classifies identically", () => {
    const crossing: Point[] = [
      { x: 20, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 10 },
      { x: 60, y: 10 },
      { x: 60, y: 90 },
    ];
    const ribbon = buildBrushRibbon("sq", samples(crossing, 8), RED, "square");
    const ps = buildArrangementFromShapes([ribbon]);
    let checked = 0;
    for (const f of ps.faces) {
      if (f.unbounded) continue;
      const pt = faceInteriorPoint(ps, f);
      if (!pt) continue;
      checked++;
      const actual = f.fill === null || f.fill === undefined ? null : ps.fills[f.fill];
      const reference = chordFillAt([ribbon], pt);
      expect(solidColorKey(actual)).toBe(solidColorKey(reference));
    }
    expect(checked).toBeGreaterThan(5);
  });
});
