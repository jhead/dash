import { describe, it, expect } from "vitest";
import type { Fill, Point, Shape, ShapePath, Stroke } from "../types.js";
import {
  planarEraseShape,
  faucetEraseShape,
  buildEraserStamp,
  livePlanarShape,
  buildArrangementFromShapes,
  planarShapeToShape,
  buildSelectedFaceFilter,
  pickAt,
  faceArea,
  locateFace,
  pointInPolygon,
  edgeAt,
} from "../planar/index.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const STROKE: Stroke = {
  color: { r: 0, g: 0, b: 0, a: 255 },
  width: 2,
  caps: "round",
  joints: "round",
  miterLimit: 3,
};

/** A CCW closed rect ShapePath with a fill. */
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

/** A stroke-only open line shape. */
function strokeLineShape(id: string, x0: number, y0: number, x1: number, y1: number): Shape {
  return {
    id,
    paths: [
      {
        start: { x: x0, y: y0 },
        segments: [{ type: "line", to: { x: x1, y: y1 } }],
        closed: false,
        stroke: STROKE,
      },
    ],
  };
}

/** A single quadratic stroke (open) from p0 through control c to p1. */
function quadStrokeShape(id: string, p0: Point, c: Point, p1: Point): Shape {
  return {
    id,
    paths: [
      {
        start: p0,
        segments: [{ type: "curve", control: c, to: p1 }],
        closed: false,
        stroke: STROKE,
      },
    ],
  };
}

/** Count fill paths / stroke paths in a Shape. */
function countPaths(shape: Shape | null): { fills: number; strokes: number } {
  if (!shape) return { fills: 0, strokes: 0 };
  let fills = 0;
  let strokes = 0;
  for (const p of shape.paths) {
    if (p.fill) fills++;
    else if (p.stroke) strokes++;
  }
  return { fills, strokes };
}

/** Shoelace signed area of a flattened path (curves chord-sampled). */
function pathNetArea(p: ShapePath): number {
  const pts: Point[] = [{ x: p.start.x, y: p.start.y }];
  let prev = p.start;
  for (const seg of p.segments) {
    if (seg.type === "line") {
      pts.push({ x: seg.to.x, y: seg.to.y });
    } else {
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
          y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
        });
      }
    }
    prev = seg.to;
  }
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const u = pts[i];
    const v = pts[(i + 1) % n];
    a += u.x * v.y - v.x * u.y;
  }
  return a / 2;
}

/**
 * Net filled area of a Shape: sum of each fill loop's signed area. Outer loops
 * are CCW (positive), hole loops are CW (negative), so the sum is the true area
 * with holes subtracted — the renderer's non-zero-winding result.
 */
function totalFillArea(shape: Shape | null): number {
  if (!shape) return 0;
  let a = 0;
  for (const p of shape.paths) {
    if (p.fill) a += pathNetArea(p);
  }
  return Math.abs(a);
}

/** Total length of all stroke (no-fill) paths, chord-approximated. */
function totalStrokeLength(shape: Shape | null): number {
  if (!shape) return 0;
  let len = 0;
  for (const p of shape.paths) {
    if (p.fill || !p.stroke) continue;
    let prev = p.start;
    for (const seg of p.segments) {
      if (seg.type === "line") {
        len += Math.hypot(seg.to.x - prev.x, seg.to.y - prev.y);
      } else {
        let pp = prev;
        for (let i = 1; i <= 8; i++) {
          const t = i / 8;
          const mt = 1 - t;
          const q = {
            x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
            y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
          };
          len += Math.hypot(q.x - pp.x, q.y - pp.y);
          pp = q;
        }
      }
      prev = seg.to;
    }
  }
  return len;
}

/** Does the shape have any curve segment? */
function hasCurve(shape: Shape | null): boolean {
  if (!shape) return false;
  return shape.paths.some((p) => p.segments.some((s) => s.type === "curve"));
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("planar/P4 — eraser on the planar arrangement", () => {
  it("erase splits a face: a band cut clean through a fill yields two faces", () => {
    const fill = rectShape("f", 0, 0, 100, 100, BLUE);
    // A vertical eraser band crossing the whole rect at x≈50.
    const stamp = buildEraserStamp(
      [
        { x: 50, y: -20 },
        { x: 50, y: 120 },
      ],
      8
    );
    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" }, "f");
    expect(shape).not.toBeNull();
    // The fill is split into two independent regions.
    const ps = buildArrangementFromShapes([shape!]);
    const filledFaces = ps.faces.filter((f) => !f.unbounded && f.fill !== null);
    expect(filledFaces.length).toBeGreaterThanOrEqual(2);
  });

  it("erase reduces fill area by ~the band area", () => {
    const fill = rectShape("f", 0, 0, 100, 100, BLUE);
    const before = totalFillArea(fill);
    expect(before).toBeCloseTo(10000, -1);
    const stamp = buildEraserStamp(
      [
        { x: 50, y: -20 },
        { x: 50, y: 120 },
      ],
      8
    );
    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" });
    const after = totalFillArea(shape);
    // Band ≈ 16px wide × 100px tall ≈ 1600; allow generous tolerance for the
    // disk caps / capsule overlap.
    expect(after).toBeLessThan(before);
    expect(before - after).toBeGreaterThan(1000);
    expect(before - after).toBeLessThan(3000);
  });

  it("erasing fully covers the shape -> null", () => {
    const fill = rectShape("f", 0, 0, 20, 20, BLUE);
    const stamp = buildEraserStamp([{ x: 10, y: 10 }], 40);
    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" });
    expect(shape).toBeNull();
  });

  it("erasing an island in the middle leaves a hole (outer fill survives)", () => {
    const fill = rectShape("f", 0, 0, 100, 100, BLUE);
    const stamp = buildEraserStamp([{ x: 50, y: 50 }], 15);
    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" });
    expect(shape).not.toBeNull();
    const after = totalFillArea(shape);
    const before = totalFillArea(fill);
    // The disk (~707px²) is carved out of the middle; the surrounding fill stays.
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(before - 1200);
    expect(after).toBeGreaterThan(8000);
  });
});

describe("planar/P4 — angled cut splits a band into two surviving sides (task 1332)", () => {
  // A horizontal brush band: x=0..200, y=95..105 (10px thick), solid fill.
  // A brush stroke is a CLOSED FILLED outline polygon (engine/brushtool.ts), so
  // we model it as a filled rect — exactly the QA repro.
  const band = (): Shape => rectShape("band", 0, 95, 200, 10, BLUE);

  /** x-extent of all fill loops in a Shape. */
  function fillXExtent(shape: Shape | null): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const p of shape?.paths ?? []) {
      if (!p.fill) continue;
      for (const pt of [p.start, ...p.segments.map((s) => s.to)]) {
        min = Math.min(min, pt.x);
        max = Math.max(max, pt.x);
      }
    }
    return { min, max };
  }

  /** Count bounded filled faces of a Shape's own arrangement. */
  function filledFaceCount(shape: Shape | null): number {
    if (!shape) return 0;
    const ps = buildArrangementFromShapes([shape]);
    return ps.faces.filter((f) => !f.unbounded && f.fill !== null).length;
  }

  // The QA-filed BUG case: an angled capsule drag whose endpoints lie OUTSIDE
  // the band on OPPOSITE sides, crossing both parallel edges of the band. Before
  // the fix this returned ONE fill with x-extent [0,96] — the entire right half
  // (x~110..200) was dropped (it leaked into the unbounded face).
  it("angled cut leaves BOTH sides spanning the full original x-extent", () => {
    const stamp = buildEraserStamp(
      [
        { x: 90, y: 90 }, // above the band, left of centre
        { x: 110, y: 112 }, // below the band, right of centre
      ],
      6
    );
    const { shape } = planarEraseShape(band(), stamp, { mode: "normal" }, "band");
    expect(shape).not.toBeNull();

    // Two surviving regions (left + right of the cut).
    expect(filledFaceCount(shape)).toBeGreaterThanOrEqual(2);

    // Both sides survive: the x-extent must still span (essentially) 0..200.
    const ext = fillXExtent(shape);
    expect(ext.min).toBeLessThanOrEqual(1);
    expect(ext.max).toBeGreaterThanOrEqual(199);
  });

  it("angled cut conserves area: only the eraser swath is removed", () => {
    const fill = band();
    const before = totalFillArea(fill); // 200 * 10 = 2000
    expect(before).toBeCloseTo(2000, -1);
    const stamp = buildEraserStamp(
      [
        { x: 90, y: 90 },
        { x: 110, y: 112 },
      ],
      6
    );
    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" });
    const after = totalFillArea(shape);
    // The swath through the 10px-tall band removes only a modest bite — NOT
    // half the shape. Pre-fix this dropped to ~910 (>half lost).
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(1500); // far more than half survives
    expect(before - after).toBeLessThan(400); // only the eraser bite removed
  });

  it("a steeper / fatter angled cut still splits cleanly into two full-span sides", () => {
    const stamp = buildEraserStamp(
      [
        { x: 90, y: 90 },
        { x: 110, y: 112 },
      ],
      10 // wider eraser
    );
    const { shape } = planarEraseShape(band(), stamp, { mode: "normal" }, "band");
    expect(shape).not.toBeNull();
    expect(filledFaceCount(shape)).toBeGreaterThanOrEqual(2);
    const ext = fillXExtent(shape);
    expect(ext.min).toBeLessThanOrEqual(1);
    expect(ext.max).toBeGreaterThanOrEqual(199);
  });

  it("matches axis-aligned behaviour: a perpendicular cut also leaves both full-span sides", () => {
    const stamp = buildEraserStamp(
      [
        { x: 100, y: 88 },
        { x: 100, y: 112 },
      ],
      6
    );
    const { shape } = planarEraseShape(band(), stamp, { mode: "normal" }, "band");
    expect(shape).not.toBeNull();
    expect(filledFaceCount(shape)).toBeGreaterThanOrEqual(2);
    const ext = fillXExtent(shape);
    expect(ext.min).toBeLessThanOrEqual(1);
    expect(ext.max).toBeGreaterThanOrEqual(199);
  });
});

describe("planar/P4 — eraser stamp-overlap union (task 1327 regression)", () => {
  /** UNION (any-loop) point-in-eraser — the CORRECT containment for the stamp. */
  const inEraserUnion = (pt: Point, loops: readonly (readonly Point[])[]): boolean =>
    loops.some((loop) => loop.length >= 3 && pointInPolygon(pt, loop));

  /** Number of loops a point is covered by (the stamp's geometric coverage). */
  const eraserCoverage = (pt: Point, loops: readonly (readonly Point[])[]): number =>
    loops.reduce((n, l) => n + (l.length >= 3 && pointInPolygon(pt, l) ? 1 : 0), 0);

  /**
   * NON-ZERO winding number of all FILL loops of `shape` at `pt`. The eraser
   * read-back emits a hole as a CW (negative) loop nested in its CCW (positive)
   * outer loop, so the renderer's non-zero winding cuts it; a net winding of 0 at
   * `pt` means NO fill covers that point (it was erased). A surviving un-erased
   * sliver would show net winding != 0 inside the sweep.
   */
  function netFillWinding(shape: Shape | null, pt: Point): number {
    if (!shape) return 0;
    let w = 0;
    for (const p of shape.paths) {
      if (!p.fill) continue;
      // Flatten the (already poly-line, curves chord-sampled) loop and ray-cast
      // with a SIGNED crossing count = winding number.
      const pts: Point[] = [{ x: p.start.x, y: p.start.y }];
      let prev = p.start;
      for (const seg of p.segments) {
        if (seg.type === "line") {
          pts.push({ x: seg.to.x, y: seg.to.y });
        } else {
          for (let i = 1; i <= 12; i++) {
            const t = i / 12;
            const mt = 1 - t;
            pts.push({
              x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
              y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
            });
          }
        }
        prev = seg.to;
      }
      for (let i = 0, n = pts.length; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (a.y <= pt.y) {
          if (b.y > pt.y && cross(a, b, pt) > 0) w++;
        } else if (b.y <= pt.y && cross(a, b, pt) < 0) {
          w--;
        }
      }
    }
    return w;
  }
  const cross = (a: Point, b: Point, p: Point): number =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

  it("overlapping disk+capsule drag leaves NO un-erased fill inside the sweep", () => {
    // A horizontal drag whose disk caps and bridging capsule OVERLAP heavily —
    // the exact case the old even-odd parity test mis-classified: a point
    // covered by an EVEN number of loops (disk⋂capsule) read as OUTSIDE, so the
    // fill there survived as a sliver. The drag runs well inside a solid fill.
    const fill = rectShape("f", 0, 0, 120, 120, BLUE);
    const stamp = buildEraserStamp(
      [
        { x: 40, y: 60 },
        { x: 80, y: 60 },
      ],
      14
    );
    // Sanity: disk + capsule + disk = 3 loops, and the capsule overlaps both end
    // disks, so points exist covered TWICE (the even-odd bug's trigger). Pick the
    // disk⋂capsule overlap explicitly and confirm coverage is even (== 2).
    expect(stamp.length).toBe(3);
    const overlapPt = { x: 50, y: 60 }; // between the left disk centre and the body
    expect(eraserCoverage(overlapPt, stamp)).toBe(2);

    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" }, "f");
    expect(shape).not.toBeNull();

    // KEY assertion: scan a dense grid over the eraser sweep's bounding box; at
    // EVERY point inside the union the output's net fill winding must be 0 (fully
    // erased). Under the old even-odd test the overlap zone survived (winding 1).
    let coveredInsideSweep = 0;
    let surviving = 0;
    for (let x = 22; x <= 98; x += 2) {
      for (let y = 44; y <= 76; y += 2) {
        const pt = { x, y };
        if (!inEraserUnion(pt, stamp)) continue;
        coveredInsideSweep++;
        if (netFillWinding(shape, pt) !== 0) surviving++;
      }
    }
    expect(coveredInsideSweep).toBeGreaterThan(100); // the grid really hits the sweep
    expect(surviving).toBe(0); // nothing left un-erased anywhere in the sweep
  });

  it("plus-shaped overlap of two bands erases the central crossing (no spurious survivor)", () => {
    // Two crossing erase bands over a big fill. Even-odd cancelled where the two
    // bands' loops overlap (covered an even number of times — e.g. the centre),
    // leaving a spurious filled island; the union test erases the whole plus.
    const fill = rectShape("f", 0, 0, 200, 200, BLUE);
    const horiz = buildEraserStamp(
      [
        { x: 60, y: 100 },
        { x: 140, y: 100 },
      ],
      16
    );
    const vert = buildEraserStamp(
      [
        { x: 100, y: 60 },
        { x: 100, y: 140 },
      ],
      16
    );
    const stamp = [...horiz, ...vert];
    // The centre is covered by BOTH bands — an even coverage the old parity test
    // mis-read as outside.
    expect(eraserCoverage({ x: 100, y: 100 }, stamp)).toBeGreaterThanOrEqual(2);

    const { shape } = planarEraseShape(fill, stamp, { mode: "normal" }, "f");
    expect(shape).not.toBeNull();

    let coveredInsideSweep = 0;
    let surviving = 0;
    for (let x = 40; x <= 160; x += 2) {
      for (let y = 40; y <= 160; y += 2) {
        const pt = { x, y };
        if (!inEraserUnion(pt, stamp)) continue;
        coveredInsideSweep++;
        if (netFillWinding(shape, pt) !== 0) surviving++;
      }
    }
    expect(coveredInsideSweep).toBeGreaterThan(100);
    expect(surviving).toBe(0);
    // The centre of the crossing must be erased (the even-odd spurious survivor).
    expect(netFillWinding(shape, { x: 100, y: 100 })).toBe(0);
    // ... while a corner well outside the plus is still filled (didn't over-erase).
    expect(netFillWinding(shape, { x: 10, y: 10 })).not.toBe(0);
  });
});

describe("planar/P4 — stroke trim keeps quadratics", () => {
  it("erasing across a quadratic stroke keeps true quadratics on both halves", () => {
    // An arc from (0,50) bowing up through (50,0) to (100,50).
    const arc = quadStrokeShape("a", { x: 0, y: 50 }, { x: 50, y: -30 }, { x: 100, y: 50 });
    // Erase a small band at the top of the arc (around x=50).
    const stamp = buildEraserStamp(
      [
        { x: 50, y: -40 },
        { x: 50, y: 30 },
      ],
      6
    );
    const { shape } = planarEraseShape(arc, stamp, { mode: "normal" });
    expect(shape).not.toBeNull();
    // The arc should be trimmed into TWO surviving stroke pieces, both curved.
    const strokePaths = shape!.paths.filter((p) => p.stroke && !p.fill);
    expect(strokePaths.length).toBeGreaterThanOrEqual(2);
    expect(hasCurve(shape)).toBe(true);
    // Curve round-trip: sample the surviving curve pieces and verify they lie on
    // the original arc within epsilon (the kernel split with de Casteljau).
    const onArc = (p: Point): number => {
      // Original arc Q(t) = (1-t)^2 P0 + 2(1-t)t C + t^2 P1; minimize distance.
      let best = Infinity;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const mt = 1 - t;
        const qx = mt * mt * 0 + 2 * mt * t * 50 + t * t * 100;
        const qy = mt * mt * 50 + 2 * mt * t * -30 + t * t * 50;
        best = Math.min(best, Math.hypot(p.x - qx, p.y - qy));
      }
      return best;
    };
    for (const path of strokePaths) {
      for (const seg of path.segments) {
        if (seg.type === "curve") {
          const g = { p0: path.start, control: seg.control, p1: seg.to };
          for (let i = 0; i <= 10; i++) {
            const d = onArc(edgeAt(g, i / 10));
            // Snapped to twips (1/20 px) + sampling tolerance.
            expect(d).toBeLessThan(1.0);
          }
        }
      }
    }
  });
});

describe("planar/P4 — eraser modes", () => {
  it("Erase Fills mode: erases fills, keeps strokes", () => {
    // Build a merged shape: a filled rect crossed by a stroke line.
    const merged = mergeShapes([
      rectShape("r", 0, 0, 100, 100, BLUE),
      strokeLineShape("s", -10, 50, 110, 50),
    ]);
    const before = countPaths(merged);
    expect(before.fills).toBeGreaterThanOrEqual(2); // split by the stroke
    expect(before.strokes).toBeGreaterThanOrEqual(1);

    // Erase right over the middle (covers both fill + stroke).
    const stamp = buildEraserStamp([{ x: 50, y: 50 }], 20);
    const fillsOnly = planarEraseShape(merged, stamp, { mode: "fills" }).shape;
    // Strokes preserved (none removed in fills mode) — total length unchanged.
    expect(totalStrokeLength(fillsOnly)).toBeCloseTo(totalStrokeLength(merged), 0);
    // Fill area reduced.
    expect(totalFillArea(fillsOnly)).toBeLessThan(totalFillArea(merged));
  });

  it("Erase Lines mode: erases strokes, keeps fills", () => {
    const merged = mergeShapes([
      rectShape("r", 0, 0, 100, 100, BLUE),
      strokeLineShape("s", -10, 50, 110, 50),
    ]);
    const stamp = buildEraserStamp([{ x: 50, y: 50 }], 20);
    const linesOnly = planarEraseShape(merged, stamp, { mode: "lines" }).shape;
    // Fill area unchanged (fills not touched).
    expect(totalFillArea(linesOnly)).toBeCloseTo(totalFillArea(merged), -1);
    // Stroke under the eraser removed -> total stroke length is shorter.
    expect(totalStrokeLength(linesOnly)).toBeLessThan(totalStrokeLength(merged));
  });

  it("Normal mode: erases both fills and strokes", () => {
    const merged = mergeShapes([
      rectShape("r", 0, 0, 100, 100, BLUE),
      strokeLineShape("s", -10, 50, 110, 50),
    ]);
    const stamp = buildEraserStamp([{ x: 50, y: 50 }], 20);
    const normal = planarEraseShape(merged, stamp, { mode: "normal" }).shape;
    expect(totalFillArea(normal)).toBeLessThan(totalFillArea(merged));
  });

  it("Erase Inside mode: only erases the fill the gesture started in", () => {
    // Two adjacent rects of different colors, then erase across the seam but
    // started inside the BLUE one.
    const merged = mergeShapes([
      rectShape("b", 0, 0, 50, 100, BLUE),
      rectShape("r", 50, 0, 50, 100, RED),
    ]);
    const blueBefore = colorArea(merged, BLUE);
    const redBefore = colorArea(merged, RED);
    expect(blueBefore).toBeGreaterThan(0);
    expect(redBefore).toBeGreaterThan(0);
    // Erase a band straddling x=50 (the seam), started inside the blue (x=40).
    const stamp = buildEraserStamp(
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      14
    );
    const out = planarEraseShape(merged, stamp, {
      mode: "inside",
      insideAt: { x: 40, y: 50 },
    }).shape;
    const blueAfter = colorArea(out, BLUE);
    const redAfter = colorArea(out, RED);
    // Blue lost area; red is untouched (inside mode confined to blue).
    expect(blueAfter).toBeLessThan(blueBefore);
    expect(redAfter).toBeCloseTo(redBefore, -1);
  });

  it("Erase Inside spares a DISJOINT same-color region (task 1399)", () => {
    // Two spatially-disjoint BLUE rects. buildArrangementFromShapes de-dupes
    // fills by color, so both share ONE fill index. An eraser that passes over
    // BOTH, started inside rect1, must confine Erase-Inside to rect1's connected
    // fill — keying on the fill INDEX would (wrongly) also bite rect2.
    const merged = mergeShapes([
      rectShape("b1", 0, 0, 40, 40, BLUE),
      rectShape("b2", 100, 0, 40, 40, BLUE),
    ]);
    const box = (s: Shape | null, xmin: number, xmax: number): number => {
      if (!s) return 0;
      let a = 0;
      for (const p of s.paths) {
        if (!p.fill) continue;
        const cx =
          (p.start.x + p.segments.reduce((t, seg) => t + seg.to.x, 0)) /
          (1 + p.segments.length);
        if (cx >= xmin && cx <= xmax) a += pathNetArea(p);
      }
      return Math.abs(a);
    };
    const r1Before = box(merged, -10, 70);
    const r2Before = box(merged, 70, 160);
    expect(r1Before).toBeCloseTo(1600, -1);
    expect(r2Before).toBeCloseTo(1600, -1);
    // A horizontal eraser stroke sweeping through BOTH rects (y≈20).
    const stamp = buildEraserStamp(
      [
        { x: 20, y: 20 },
        { x: 120, y: 20 },
      ],
      8
    );
    const out = planarEraseShape(merged, stamp, {
      mode: "inside",
      insideAt: { x: 20, y: 20 },
    }).shape;
    const r1After = box(out, -10, 70);
    const r2After = box(out, 70, 160);
    // rect1 (the started-in fill) lost the swept band; rect2 is fully spared.
    expect(r1After).toBeLessThan(r1Before);
    expect(r2After).toBeCloseTo(r2Before, -1);
  });

  it("Erase Selected mode: only erases the selected fill", () => {
    const merged = mergeShapes([
      rectShape("b", 0, 0, 50, 100, BLUE),
      rectShape("r", 50, 0, 50, 100, RED),
    ]);
    const blueBefore = colorArea(merged, BLUE);
    const redBefore = colorArea(merged, RED);
    const stamp = buildEraserStamp(
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      14
    );
    // Select only RED (predicate: interior point x>50 is red).
    const out = planarEraseShape(merged, stamp, {
      mode: "selected",
      selectedFaceFilter: (pt) => pt.x > 50,
    }).shape;
    const blueAfter = colorArea(out, BLUE);
    const redAfter = colorArea(out, RED);
    expect(redAfter).toBeLessThan(redBefore);
    expect(blueAfter).toBeCloseTo(blueBefore, -1);
  });

  it("buildSelectedFaceFilter turns a sub-selection into the Erase-Selected predicate (task 1428)", () => {
    const merged = mergeShapes([
      rectShape("b", 0, 0, 50, 100, BLUE),
      rectShape("r", 50, 0, 50, 100, RED),
    ]);
    const blueBefore = colorArea(merged, BLUE);
    const redBefore = colorArea(merged, RED);
    const live = livePlanarShape(merged);
    // Sub-select ONLY the red fill (interior x>50).
    const redKey = pickAt(live, { x: 75, y: 50 });
    expect(redKey?.kind).toBe("face");
    const filter = buildSelectedFaceFilter(live, [redKey!]);
    expect(filter).not.toBeNull();
    // The predicate accepts the red interior and rejects the blue interior.
    expect(filter!({ x: 75, y: 50 })).toBe(true);
    expect(filter!({ x: 25, y: 50 })).toBe(false);
    const stamp = buildEraserStamp(
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      14
    );
    const out = planarEraseShape(merged, stamp, {
      mode: "selected",
      selectedFaceFilter: filter!,
    }).shape;
    expect(colorArea(out, RED)).toBeLessThan(redBefore);
    expect(colorArea(out, BLUE)).toBeCloseTo(blueBefore, -1);
  });

  it("buildSelectedFaceFilter is null when only a line SEGMENT is selected (strokes never select a fill)", () => {
    const merged = mergeShapes([
      rectShape("r", 0, 0, 100, 100, BLUE),
      strokeLineShape("s", -10, 50, 110, 50),
    ]);
    const live = livePlanarShape(merged);
    const segKey = pickAt(live, { x: 50, y: 50 }); // on the stroke line
    expect(segKey?.kind).toBe("segment");
    expect(buildSelectedFaceFilter(live, [segKey!])).toBeNull();
    expect(buildSelectedFaceFilter(live, [])).toBeNull();
  });
});

describe("planar/P4 — faucet (whole fill / whole line)", () => {
  it("faucet click on a fill deletes that whole fill, leaves the other", () => {
    const merged = mergeShapes([
      rectShape("b", 0, 0, 50, 100, BLUE),
      rectShape("r", 50, 0, 50, 100, RED),
    ]);
    const { shape } = faucetEraseShape(merged, { x: 25, y: 50 });
    expect(shape).not.toBeNull();
    expect(colorArea(shape, BLUE)).toBeCloseTo(0, -1);
    expect(colorArea(shape, RED)).toBeGreaterThan(0);
  });

  it("faucet click on a stroke deletes the whole line, leaves the fill", () => {
    const merged = mergeShapes([
      rectShape("r", 0, 0, 100, 100, BLUE),
      strokeLineShape("s", -10, 50, 110, 50),
    ]);
    const before = countPaths(merged);
    expect(before.strokes).toBeGreaterThanOrEqual(1);
    // Click ON the stroke line (y=50).
    const { shape } = faucetEraseShape(merged, { x: 50, y: 50 });
    expect(shape).not.toBeNull();
    const after = countPaths(shape);
    expect(after.strokes).toBe(0);
    // Fill survives.
    expect(totalFillArea(shape)).toBeGreaterThan(0);
  });

  // Task 1432: clicking one of two CROSSING lines must delete ONLY the clicked
  // line, not both. The old flood-fill BFS jumped across the crossing vertex into
  // the perpendicular line and wiped everything.
  it("faucet on one of two crossing lines leaves the other line intact", () => {
    const merged = mergeShapes([
      strokeLineShape("h", 0, 50, 100, 50), // horizontal
      strokeLineShape("v", 50, 0, 50, 100), // vertical, crosses at (50,50)
    ]);
    expect(countPaths(merged).strokes).toBeGreaterThanOrEqual(2);
    // Click on the horizontal line's LEFT arm (away from the crossing).
    const { shape } = faucetEraseShape(merged, { x: 10, y: 50 });
    expect(shape).not.toBeNull();
    // The vertical line must survive: a stroke should still pass through a point
    // on the vertical arm that is NOT on the (now-deleted) horizontal line.
    const survivor = livePlanarShape(shape!);
    const stroked = survivor.halfEdges.filter(
      (he) => he.lineStyle !== null && he.lineStyle !== undefined,
    );
    expect(stroked.length).toBeGreaterThan(0);
    // Some surviving stroke lies on the vertical arm (x≈50) well away from y=50.
    const onVertical = stroked.some((he) => {
      const m = edgeAt(he.geometry, 0.5);
      return Math.abs(m.x - 50) < 2 && (m.y < 40 || m.y > 60);
    });
    expect(onVertical).toBe(true);
    // And NO surviving stroke lies on the horizontal arm we clicked (y≈50, x<40).
    const onClickedArm = stroked.some((he) => {
      const m = edgeAt(he.geometry, 0.5);
      return Math.abs(m.y - 50) < 2 && m.x < 40;
    });
    expect(onClickedArm).toBe(false);
  });

  // Task 1432: a style boundary (black line touching a red line) is never crossed.
  it("faucet on a black line touching a red line leaves the red line", () => {
    const black = strokeLineShape("b", 0, 0, 50, 0); // uses STROKE (black)
    const redStroke: Stroke = { ...STROKE, color: { r: 255, g: 0, b: 0, a: 255 } };
    const red: Shape = {
      id: "r",
      paths: [
        {
          start: { x: 50, y: 0 },
          segments: [{ type: "line", to: { x: 100, y: 0 } }],
          closed: false,
          stroke: redStroke,
        },
      ],
    };
    const merged = mergeShapes([black, red]);
    // Click on the black arm.
    const { shape } = faucetEraseShape(merged, { x: 25, y: 0 });
    expect(shape).not.toBeNull();
    const survivor = livePlanarShape(shape!);
    const stroked = survivor.halfEdges.filter(
      (he) => he.lineStyle !== null && he.lineStyle !== undefined,
    );
    // Red arm (x in 50..100) survives; black arm (x in 0..50) is gone.
    const redSurvives = stroked.some((he) => {
      const m = edgeAt(he.geometry, 0.5);
      return m.x > 50 && m.x < 100;
    });
    const blackGone = !stroked.some((he) => {
      const m = edgeAt(he.geometry, 0.5);
      return m.x > 0 && m.x < 50;
    });
    expect(redSurvives).toBe(true);
    expect(blackGone).toBe(true);
  });

  // Task 1432: faucet on a fill deletes ONLY that contiguous fill region.
  it("faucet on a fill deletes only that contiguous fill", () => {
    // Two spatially-disjoint SAME-color fills — de-duped to one fill index by the
    // arrangement, so a fill-index match would wrongly bite both. The faucet's
    // connected-component walk must delete only the clicked silhouette.
    const merged = mergeShapes([
      rectShape("a", 0, 0, 40, 100, BLUE),
      rectShape("b", 60, 0, 40, 100, BLUE),
    ]);
    const before = totalFillArea(merged);
    expect(before).toBeGreaterThan(0);
    const { shape } = faucetEraseShape(merged, { x: 20, y: 50 }); // inside rect "a"
    expect(shape).not.toBeNull();
    const after = totalFillArea(shape);
    // Roughly half the fill remains (the untouched disjoint rect "b").
    expect(after).toBeGreaterThan(0);
    expect(after).toBeCloseTo(before / 2, -2);
    // The far rect "b" must still be pickable as a fill.
    const live = livePlanarShape(shape!);
    const farFace = locateFace(live, { x: 80, y: 50 });
    expect(farFace?.fill).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// helpers that depend on the read-back
// ---------------------------------------------------------------------------

/** Merge several shapes into one via the planar arrangement read-back. */
function mergeShapes(shapes: Shape[]): Shape {
  const ps = buildArrangementFromShapes(shapes);
  // Reuse planarShapeToShape via the eraser's no-op (mode that erases nothing):
  // simplest is to read it directly.
  return planarShapeToShapeLocal(ps, "m");
}

// Avoid importing planarShapeToShape twice; re-import here.
import { planarShapeToShape as planarShapeToShapeLocal } from "../planar/index.js";

/** Net area covered by a particular fill color in a shape (holes subtracted). */
function colorArea(shape: Shape | null, fill: Fill): number {
  if (!shape) return 0;
  let a = 0;
  for (const p of shape.paths) {
    if (!p.fill || p.fill.type !== "solid" || fill.type !== "solid") continue;
    if (
      p.fill.color.r === fill.color.r &&
      p.fill.color.g === fill.color.g &&
      p.fill.color.b === fill.color.b
    ) {
      a += pathNetArea(p);
    }
  }
  return Math.abs(a);
}

// keep livePlanarShape referenced (used indirectly by faucet)
void livePlanarShape;

// ---------------------------------------------------------------------------
// Interior erased holes must PERSIST across rebuilds (task 1425).
//
// The interactive eraser chains a planar rebuild per pointermove (each move
// erases into the PREVIOUS result). Before the fix, assignFaceFillsBySampling
// was last-covering-wins with no parity, so a read-back hole loop (which carries
// the outer fill) re-filled the hole on the next rebuild — only the LAST stamp
// stayed erased and the whole swept trail behind the cursor re-filled.
// ---------------------------------------------------------------------------

describe("planar eraser — interior holes persist across rebuilds (task 1425)", () => {
  /** True when the point resolves to NO fill (an erased hole) in a rebuilt map. */
  function isEmptyAt(shape: Shape, pt: Point): boolean {
    const ps = buildArrangementFromShapes([shape]);
    const face = locateFace(ps, pt);
    return (face?.fill ?? null) === null;
  }

  it("REPRO 1: a chained 3-increment interactive erase leaves ALL stamp centers erased", () => {
    // Red rect 0..200 x 0..100; sweep the eraser along y=50 like StageArea does:
    // each segment erases into the previous result.
    let cur: Shape = rectShape("sq", 0, 0, 200, 100, RED);
    const xs = [30, 50, 70, 90];
    for (let i = 1; i < xs.length; i++) {
      const stamp = buildEraserStamp(
        [{ x: xs[i - 1], y: 50 }, { x: xs[i], y: 50 }],
        8
      );
      const res = planarEraseShape(cur, stamp);
      expect(res.shape).not.toBeNull();
      cur = res.shape!;
    }
    // Every stamp center along the swept trail must remain erased (a hole).
    for (const cx of [50, 70, 90]) {
      expect(isEmptyAt(cur, { x: cx, y: 50 })).toBe(true);
    }
    // The un-erased body is still filled.
    expect(isEmptyAt(cur, { x: 150, y: 20 })).toBe(false);
  });

  it("REPRO 2: erase a hole, then an overlapping commit does NOT refill the hole", () => {
    const square = rectShape("sq", 0, 0, 100, 100, RED);
    const holed = planarEraseShape(square, buildEraserStamp([{ x: 50, y: 50 }], 15)).shape!;
    expect(isEmptyAt(holed, { x: 50, y: 50 })).toBe(true);

    // An overlapping blue rect at the corner pulls the whole shape through the
    // kernel again (a real overlapping merge commit). The interior hole must stay.
    const blue = rectShape("blue", 80, 80, 60, 60, BLUE);
    const ps = buildArrangementFromShapes([holed, blue]);
    const merged = planarShapeToShape(ps, "merged");
    expect(isEmptyAt(merged, { x: 50, y: 50 })).toBe(true);
  });

  it("REPRO 3: picking (livePlanarShape/locateFace) sees the erased hole as EMPTY", () => {
    const square = rectShape("sq", 0, 0, 100, 100, RED);
    const holed = planarEraseShape(square, buildEraserStamp([{ x: 50, y: 50 }], 15)).shape!;
    // The LIVE planar map used by paint-bucket / selection / faucet.
    const live = livePlanarShape(holed);
    const face = locateFace(live, { x: 50, y: 50 });
    expect(face?.fill ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// task 1431 — a no-op increment must return the SAME Shape object reference so
// callers (StageArea) can cheaply detect it (`next === shape`) and skip the
// geometry / history churn a rebuilt-but-unchanged Shape would otherwise cause.
// ---------------------------------------------------------------------------
describe("planar eraser — no-op increment returns the identical object (task 1431)", () => {
  it("a stamp that intersects NOTHING returns the original reference (identity-equal)", () => {
    const square = rectShape("sq", 0, 0, 100, 100, RED);
    // A stamp placed far from the shape: it passes usableLoops (>=3 pts) but
    // erases no face and trims no stroke.
    const stamp = buildEraserStamp([{ x: 500, y: 500 }], 10);
    const { shape: next } = planarEraseShape(square, stamp);
    expect(next).toBe(square);
  });

  it("Erase Lines over a FILL-ONLY shape erases nothing -> identical reference", () => {
    const square = rectShape("sq", 0, 0, 100, 100, RED);
    // The stamp sits right on the fill, but "lines" mode never touches fills and
    // there are no strokes to trim -> a true no-op.
    const stamp = buildEraserStamp([{ x: 50, y: 50 }], 20);
    const { shape: next } = planarEraseShape(square, stamp, { mode: "lines" });
    expect(next).toBe(square);
  });

  it("a stamp that DOES erase returns a NEW object (contrast)", () => {
    const square = rectShape("sq", 0, 0, 100, 100, RED);
    const stamp = buildEraserStamp([{ x: 50, y: 50 }], 15);
    const { shape: next } = planarEraseShape(square, stamp);
    expect(next).not.toBe(square);
    expect(next).not.toBeNull();
  });
});
