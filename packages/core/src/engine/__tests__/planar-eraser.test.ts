import { describe, it, expect } from "vitest";
import type { Fill, Point, Shape, ShapePath, Stroke } from "../types.js";
import {
  planarEraseShape,
  faucetEraseShape,
  buildEraserStamp,
  livePlanarShape,
  buildArrangementFromShapes,
  faceArea,
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
