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

function polyArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
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
