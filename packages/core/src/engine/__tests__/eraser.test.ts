import { describe, it, expect } from "vitest";
import {
  buildEraserPolygon,
  subtractPolygon,
  eraseShape,
} from "../eraser.js";
import type { Point, Shape, ShapePath, Fill } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

/** Build a closed rectangular fill ShapePath from (x,y) sized w×h. */
function rectPath(x: number, y: number, w: number, h: number, fill: Fill = RED): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x, y: y + h } },
      { type: "line", to: { x, y } },
    ],
    fill,
    closed: true,
  };
}

function rectShape(x: number, y: number, w: number, h: number): Shape {
  return { id: "s1", paths: [rectPath(x, y, w, h)] };
}

/** A regular polygon (CCW) approximating a circle. */
function circle(cx: number, cy: number, r: number, n = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function signedPolyArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function polyArea(poly: readonly Point[]): number {
  return Math.abs(signedPolyArea(poly));
}

function bboxOf(poly: readonly Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function shapeArea(shape: Shape): number {
  // Sum of |signed area| per path — for split loops this counts total drawn area.
  // (Holes carry opposite winding; for our split-case tests we sum the absolute
  // areas of the surviving outer loops only, which is what we assert on.)
  return shape.paths.reduce((acc, p) => {
    const poly: Point[] = [p.start];
    let prev = p.start;
    for (const seg of p.segments) {
      if (seg.type === "line") poly.push(seg.to);
      else poly.push(seg.to);
      prev = seg.to;
    }
    return acc + polyArea(poly);
  }, 0);
}

// ---------------------------------------------------------------------------
// subtractPolygon — core boolean
// ---------------------------------------------------------------------------

describe("subtractPolygon", () => {
  it("disjoint clip leaves subject unchanged", () => {
    const subject = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    const clip = circle(100, 100, 5);
    const res = subtractPolygon(subject, clip);
    expect(res).toHaveLength(1);
    expect(polyArea(res[0])).toBeCloseTo(100, 1);
  });

  it("clip fully covering subject erases everything", () => {
    const subject = [
      { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 },
    ];
    const clip = circle(15, 15, 100); // huge disk swallows the rect
    const res = subtractPolygon(subject, clip);
    expect(res).toHaveLength(0);
  });

  it("clip biting one edge reduces area but keeps a single loop", () => {
    // 100x100 square, erase a disk centered on the right edge midpoint.
    const subject = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const clip = circle(100, 50, 20);
    const res = subtractPolygon(subject, clip);
    expect(res.length).toBeGreaterThanOrEqual(1);
    const total = res.reduce((a, l) => a + polyArea(l), 0);
    // Removed ~half a disk of r=20 → ~628 units. Remaining < 10000, > 9000.
    expect(total).toBeLessThan(10000);
    expect(total).toBeGreaterThan(9000);
  });

  it("clip slicing all the way through splits into two loops", () => {
    // Tall thin disk-band cutting a wide short rect vertically in the middle.
    const subject = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 0, y: 20 },
    ];
    // A vertical capsule cutting through the middle: model as a tall thin rect.
    const clip = [
      { x: 45, y: -10 }, { x: 55, y: -10 }, { x: 55, y: 30 }, { x: 45, y: 30 },
    ];
    const res = subtractPolygon(subject, clip);
    expect(res.length).toBe(2);
    const areas = res.map(polyArea).sort((a, b) => a - b);
    // Each half is 45 wide × 20 tall = 900.
    expect(areas[0]).toBeCloseTo(900, 0);
    expect(areas[1]).toBeCloseTo(900, 0);
  });

  // --- Edge-crossing / collinear degeneracy regression (task 1281) -----------
  //
  // Follow-up to task 1263: an eraser whose clip edge is COLLINEAR with a
  // subject edge (or whose corner sits exactly on it) hit a Greiner–Hormann
  // degeneracy — the naive trace found an odd crossing count, walked the whole
  // subject ring, and returned the subject UNCHANGED. The old bounds-only
  // `looksSane` accepted that no-op (its area ≤ the subject's), so the eraser
  // removed NOTHING when a stroke crossed the shape's boundary edge.

  it("a clip edge collinear with a subject edge still carves a notch (regression)", () => {
    // 200×200 rect at (60,60); an eraser capsule straddling the TOP edge whose
    // LEFT side runs exactly along the subject's left edge (x=60) and whose
    // bottom-left corner sits on it. Before the fix this returned area 40000
    // (the full subject, unchanged); it must now remove the overlapping notch.
    const subject = [
      { x: 60, y: 60 }, { x: 260, y: 60 }, { x: 260, y: 260 }, { x: 60, y: 260 },
    ];
    const clip = [
      { x: 60, y: 44 }, { x: 160, y: 44 }, { x: 160, y: 76 }, { x: 60, y: 76 },
    ];
    const res = subtractPolygon(subject, clip);
    expect(res.length).toBeGreaterThanOrEqual(1);
    const total = res.reduce((a, l) => a + polyArea(l), 0);
    // The clip overlaps the subject in a 100×16 = 1600 notch (y 60..76, x 60..160).
    expect(total).toBeLessThan(39000);
    expect(total).toBeCloseTo(38400, -1);
  });

  it("an eraser disk straddling the top boundary edge removes area (regression)", () => {
    // Disk centered ON the top edge (y=60), half inside / half outside. The old
    // boolean returned the subject unchanged for this boundary-straddling clip.
    const subject = [
      { x: 60, y: 60 }, { x: 260, y: 60 }, { x: 260, y: 260 }, { x: 60, y: 260 },
    ];
    const clip = circle(160, 60, 16);
    const res = subtractPolygon(subject, clip);
    // Before the fix this returned the PRISTINE single 40000 loop (a no-op cut).
    // The boundary-straddling disk must now actually cut: the in-subject half of
    // the disk is removed — either by reshaping the outline or by a boundary-
    // crossing hole loop the non-zero winding rule subtracts. Assert the cut is
    // real, i.e. the net signed area (outer loops minus holes) dropped below the
    // pristine subject area.
    const net = res.reduce((a, l) => a + signedPolyArea(l), 0);
    expect(Math.abs(net)).toBeLessThan(39800);
    expect(Math.abs(net)).toBeGreaterThan(39000);
    // And it is no longer the untouched single 40000 loop.
    expect(res.length === 1 && Math.abs(polyArea(res[0]) - 40000) < 1).toBe(false);
  });

  it("a clip that only touches a subject edge removes nothing (no spurious sliver)", () => {
    // The clip's bottom edge lies exactly ON the subject's top edge (y=60) with
    // no interior overlap. The fix must NOT let perturbation jitter carve a
    // sliver here — a pure tangency leaves the subject pristine.
    const subject = [
      { x: 60, y: 60 }, { x: 260, y: 60 }, { x: 260, y: 260 }, { x: 60, y: 260 },
    ];
    const clip = [
      { x: 80, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 60 }, { x: 80, y: 60 },
    ];
    const res = subtractPolygon(subject, clip);
    expect(res).toHaveLength(1);
    expect(polyArea(res[0])).toBeCloseTo(40000, 0);
  });

  it("clip strictly inside punches a hole (subject + reversed clip)", () => {
    const subject = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const clip = circle(50, 50, 10);
    const res = subtractPolygon(subject, clip);
    // Outer loop preserved plus a hole loop.
    expect(res.length).toBe(2);
    const outer = res.find((l) => polyArea(l) > 1000)!;
    const hole = res.find((l) => polyArea(l) < 1000)!;
    expect(outer).toBeTruthy();
    expect(hole).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildEraserPolygon
// ---------------------------------------------------------------------------

describe("buildEraserPolygon", () => {
  it("single point yields one disk loop of roughly the right area", () => {
    const loops = buildEraserPolygon([{ x: 0, y: 0 }], 10);
    expect(loops).toHaveLength(1);
    // 24-gon area is slightly under πr²=314.
    expect(polyArea(loops[0])).toBeGreaterThan(290);
    expect(polyArea(loops[0])).toBeLessThan(320);
  });

  it("a drag produces loops that together span the swept band", () => {
    const loops = buildEraserPolygon(
      [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      10
    );
    // By design the drag yields per-sample disks + a bridging capsule (NOT a
    // pre-unioned hull — eraseShape subtracts them cumulatively). Their combined
    // bbox must cover the whole swept band.
    expect(loops.length).toBeGreaterThanOrEqual(1);
    const all = loops.flat();
    const b = bboxOf(all);
    expect(b.minX).toBeLessThanOrEqual(-9);
    expect(b.maxX).toBeGreaterThanOrEqual(59);
    expect(b.minY).toBeCloseTo(-10, 0);
    expect(b.maxY).toBeCloseTo(10, 0);
  });
});

// ---------------------------------------------------------------------------
// eraseShape — the acceptance scenario
// ---------------------------------------------------------------------------

describe("eraseShape", () => {
  it("erasing PART of a filled rect keeps the shape, reduces its area (acceptance)", () => {
    const shape = rectShape(0, 0, 100, 100);
    const before = shapeArea(shape);
    // Erase a small disk out of the middle.
    const eraser = buildEraserPolygon([{ x: 50, y: 50 }], 10);
    const result = eraseShape(shape, eraser);

    // The shape STILL EXISTS (not null) ...
    expect(result).not.toBeNull();
    // ... and its geometry changed (more paths: outer + hole, or reduced area).
    const after = shapeArea(result!);
    expect(result!.paths.length).toBeGreaterThanOrEqual(1);
    // Either a hole was punched (2 loops) or area shrank — geometry definitely
    // differs from the pristine single 100x100 loop.
    expect(after).not.toBeCloseTo(before, 0);
  });

  it("erasing a small circle from the middle splits into outer + hole loops", () => {
    const shape = rectShape(0, 0, 100, 100);
    const eraser = buildEraserPolygon([{ x: 50, y: 50 }], 12);
    const result = eraseShape(shape, eraser)!;
    expect(result).not.toBeNull();
    expect(result.paths.length).toBe(2); // outer fill + hole
  });

  it("erasing a notch out of an edge keeps one connected fill", () => {
    const shape = rectShape(0, 0, 100, 100);
    const eraser = buildEraserPolygon([{ x: 100, y: 50 }], 15);
    const result = eraseShape(shape, eraser)!;
    expect(result).not.toBeNull();
    const after = shapeArea(result);
    expect(after).toBeLessThan(10000);
    expect(after).toBeGreaterThan(9000);
  });

  it("erasing across the whole shape (full cover) removes it (returns null)", () => {
    const shape = rectShape(0, 0, 20, 20);
    const eraser = buildEraserPolygon([{ x: 10, y: 10 }], 100);
    const result = eraseShape(shape, eraser);
    expect(result).toBeNull();
  });

  it("preserves the fill on surviving paths", () => {
    const shape = rectShape(0, 0, 100, 100);
    const eraser = buildEraserPolygon([{ x: 100, y: 50 }], 15);
    const result = eraseShape(shape, eraser)!;
    for (const p of result.paths) {
      expect(p.fill).toEqual(RED);
    }
  });

  it("respects the fills:false option (does not touch fills)", () => {
    const shape = rectShape(0, 0, 100, 100);
    const eraser = buildEraserPolygon([{ x: 50, y: 50 }], 12);
    const result = eraseShape(shape, eraser, { fills: false })!;
    expect(result).not.toBeNull();
    // Fill path untouched → single original path remains.
    expect(result.paths.length).toBe(1);
    expect(shapeArea(result)).toBeCloseTo(10000, 0);
  });

  it("a drag erases a continuous band, splitting a wide rect", () => {
    // Wide short rect; drag the eraser vertically through it at x=50.
    const shape = rectShape(0, 0, 100, 30);
    const eraser = buildEraserPolygon(
      [{ x: 50, y: -5 }, { x: 50, y: 35 }],
      8
    );
    const result = eraseShape(shape, eraser)!;
    expect(result).not.toBeNull();
    // Should split into two pieces (left + right of the cut band).
    expect(result.paths.length).toBe(2);
    const total = shapeArea(result);
    // Removed roughly a 16-wide band over 30 tall = ~480; remaining ~2520.
    expect(total).toBeLessThan(3000);
    expect(total).toBeGreaterThan(2000);
  });

  it("a stroke running along the top boundary edge to the corner removes area (regression, task 1281)", () => {
    // Drag the eraser ALONG the top edge from the top-left corner inward. The
    // capsule body is collinear with the top edge and the first disk is centered
    // on the corner — the exact degeneracy that made the eraser a no-op for
    // boundary-edge strokes. It must now carve a notch out of the top edge.
    const shape = rectShape(60, 60, 200, 200);
    const before = shapeArea(shape);
    const eraser = buildEraserPolygon([{ x: 60, y: 60 }, { x: 160, y: 60 }], 16);
    const result = eraseShape(shape, eraser);
    expect(result).not.toBeNull();
    const after = shapeArea(result!);
    // Before the fix `after` equalled `before` (nothing removed). Require a
    // meaningful reduction of the OUTER fill area (sum the largest loop only, so
    // a punched hole's loop area does not mask the cut).
    const outer = result!.paths
      .map((p) => {
        const poly: Point[] = [p.start];
        for (const seg of p.segments) poly.push(seg.to);
        return polyArea(poly);
      })
      .reduce((m, a) => Math.max(m, a), 0);
    expect(outer).toBeLessThan(before - 100);
  });

  it("a horizontal eraser band crossing the top edge reduces the filled area (acceptance, task 1281)", () => {
    // The task's acceptance case: a horizontal band that ENTERS across the top
    // boundary edge of a filled rect must reduce its filled area, not no-op.
    const shape = rectShape(60, 60, 200, 200);
    const eraser = buildEraserPolygon([{ x: 130, y: 60 }, { x: 190, y: 60 }], 16);
    const result = eraseShape(shape, eraser);
    expect(result).not.toBeNull();
    // The outer fill loop must be smaller than the pristine 200×200 = 40000.
    const outer = result!.paths
      .map((p) => {
        const poly: Point[] = [p.start];
        for (const seg of p.segments) poly.push(seg.to);
        return polyArea(poly);
      })
      .reduce((m, a) => Math.max(m, a), 0);
    expect(outer).toBeLessThan(40000 - 100);
  });

  it("does not mutate the input shape", () => {
    const shape = rectShape(0, 0, 100, 100);
    const origPaths = shape.paths;
    const origLen = shape.paths.length;
    const eraser = buildEraserPolygon([{ x: 50, y: 50 }], 12);
    eraseShape(shape, eraser);
    expect(shape.paths).toBe(origPaths);
    expect(shape.paths.length).toBe(origLen);
  });

  it("empty eraser leaves the shape untouched", () => {
    const shape = rectShape(0, 0, 100, 100);
    const result = eraseShape(shape, []);
    expect(result).toBe(shape);
  });
});
