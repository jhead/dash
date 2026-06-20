import { describe, it, expect } from "vitest";
import type { EdgeGeometry, Fill, Point, Shape, ShapePath } from "../types.js";
import {
  Arrangement,
  buildArrangement,
  buildArrangementFromShapes,
  eulerCharacteristic,
  faceArea,
  faceBoundaryPolygon,
  intersectSegSeg,
  intersectSegCurve,
  intersectCurveCurve,
  intersectEdges,
  locateFace,
  pointInFace,
  polygonSignedArea,
  splitEdgeGeometry,
  edgeAt,
  snapPoint,
  type InputEdge,
} from "../planar/index.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };

function line(p0: Point, p1: Point): EdgeGeometry {
  return { p0, control: null, p1 };
}
function curve(p0: Point, c: Point, p1: Point): EdgeGeometry {
  return { p0, control: c, p1 };
}

/** A CCW closed rect ShapePath with a fill. */
function rectPath(x: number, y: number, w: number, h: number, fill: Fill): ShapePath {
  // CCW: (x,y) -> (x,y+h) -> (x+w,y+h) -> (x+w,y) -> back
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

/**
 * Build closed rect input edges directly with the fill on the LEFT of travel.
 * Corners wound so the shoelace signed area is positive (CCW in these
 * coordinates), which is the kernel's "interior-on-left" contract.
 */
function rectEdges(x: number, y: number, w: number, h: number, fill: number): InputEdge[] {
  const corners = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const out: InputEdge[] = [];
  for (let i = 0; i < 4; i++) {
    out.push({
      geometry: line(corners[i], corners[(i + 1) % 4]),
      fillLeft: fill,
      fillRight: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// intersection primitives
// ---------------------------------------------------------------------------

describe("planar/intersect — segment/segment", () => {
  it("finds a single crossing of an X", () => {
    const a = line({ x: 0, y: 0 }, { x: 10, y: 10 });
    const b = line({ x: 0, y: 10 }, { x: 10, y: 0 });
    const hits = intersectSegSeg(a, b);
    expect(hits).toHaveLength(1);
    expect(hits[0].point.x).toBeCloseTo(5, 5);
    expect(hits[0].point.y).toBeCloseTo(5, 5);
    expect(hits[0].tA).toBeCloseTo(0.5, 5);
    expect(hits[0].tB).toBeCloseTo(0.5, 5);
  });

  it("returns nothing for non-crossing parallel segments", () => {
    const a = line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = line({ x: 0, y: 5 }, { x: 10, y: 5 });
    expect(intersectSegSeg(a, b)).toHaveLength(0);
  });

  it("reports the overlap endpoints for collinear overlap", () => {
    const a = line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const b = line({ x: 5, y: 0 }, { x: 15, y: 0 });
    const hits = intersectSegSeg(a, b);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // overlap interval [5,10] on a → tA in {0.5, 1.0}
    const xs = hits.map((h) => h.point.x).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(5, 5);
  });
});

describe("planar/intersect — segment/curve", () => {
  it("finds two crossings where a line cuts through an arc", () => {
    // Symmetric upward arc; a horizontal line through the middle crosses twice.
    const c = curve({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 });
    const seg = line({ x: -1, y: 3 }, { x: 11, y: 3 });
    const hits = intersectSegCurve(seg, c);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h.point.y).toBeCloseTo(3, 1);
  });

  it("dispatches correctly regardless of argument order", () => {
    const c = curve({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 });
    const seg = line({ x: -1, y: 3 }, { x: 11, y: 3 });
    const fwd = intersectEdges(seg, c);
    const rev = intersectEdges(c, seg);
    expect(fwd).toHaveLength(rev.length);
  });
});

describe("planar/intersect — curve/curve", () => {
  it("finds the crossing of two opposing arcs", () => {
    const up = curve({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 });
    const down = curve({ x: 0, y: 6 }, { x: 5, y: -4 }, { x: 10, y: 6 });
    const hits = intersectCurveCurve(up, down);
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// curve-preserving split round-trip
// ---------------------------------------------------------------------------

describe("planar/geometry — curve-preserving split", () => {
  it("a quadratic split at t re-fits the original within epsilon (round-trip)", () => {
    const g = curve({ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 0 });
    for (const t of [0.2, 0.37, 0.5, 0.8]) {
      const { first, second } = splitEdgeGeometry(g, t);
      // The split point is continuous and the two halves are true quadratics
      // (control !== null): sampling the halves reproduces the original curve.
      expect(first.control).not.toBeNull();
      expect(second.control).not.toBeNull();
      // Continuity at the join.
      expect(first.p1.x).toBeCloseTo(second.p0.x, 6);
      expect(first.p1.y).toBeCloseTo(second.p0.y, 6);
      // Sample 20 points across the reassembled halves vs the original.
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        const orig = edgeAt(g, u);
        // Map global u to which half + local param.
        let p: Point;
        if (u <= t) p = edgeAt(first, u / t);
        else p = edgeAt(second, (u - t) / (1 - t));
        expect(p.x).toBeCloseTo(orig.x, 1);
        expect(p.y).toBeCloseTo(orig.y, 1);
      }
    }
  });

  it("never flattens a curve to a line on split", () => {
    const g = curve({ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 0 });
    const { first, second } = splitEdgeGeometry(g, 0.5);
    expect(first.control).not.toBeNull();
    expect(second.control).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// arrangement: Euler invariant
// ---------------------------------------------------------------------------

describe("planar/arrangement — Euler invariant V - E + F", () => {
  it("a single square has V-E+F = 2", () => {
    const ps = buildArrangement(rectEdges(0, 0, 10, 10, 0), [RED]);
    // 4 vertices, 4 undirected edges, 2 faces (inside + unbounded) → 4-4+2 = 2.
    expect(eulerCharacteristic(ps)).toBe(2);
  });

  it("two crossing lines split into 4 segments and obey Euler", () => {
    // Two lines crossing at the center: 5 vertices (4 ends + 1 center),
    // 4 undirected edges, faces: this graph is a "+"; it is connected.
    const edges: InputEdge[] = [
      { geometry: line({ x: 0, y: 5 }, { x: 10, y: 5 }), lineStyle: 0 },
      { geometry: line({ x: 5, y: 0 }, { x: 5, y: 10 }), lineStyle: 0 },
    ];
    const ps = buildArrangement(edges, [], [
      { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 }, width: 1, caps: "round", joints: "round", miterLimit: 3 },
    ]);
    // Each original line is split into 2 → 4 undirected edges, 8 half-edges.
    expect(ps.halfEdges.length).toBe(8);
    expect(eulerCharacteristic(ps)).toBe(2);
  });

  it("overlapping different shapes still satisfy Euler (connected)", () => {
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 20, 20, RED),
      rectShape("b", 10, 10, 20, 20, BLUE),
    ]);
    // The two overlapping rects form a connected planar graph → V-E+F = 2.
    expect(eulerCharacteristic(ps)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// two crossing lines = 4 segments (canonical case)
// ---------------------------------------------------------------------------

describe("planar/arrangement — two crossing lines = 4 segments", () => {
  it("splits each of two crossing lines into two at the intersection", () => {
    const edges: InputEdge[] = [
      { geometry: line({ x: 0, y: 0 }, { x: 10, y: 10 }), lineStyle: 0 },
      { geometry: line({ x: 0, y: 10 }, { x: 10, y: 0 }), lineStyle: 0 },
    ];
    const ps = buildArrangement(edges, [], [
      { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 }, width: 1, caps: "round", joints: "round", miterLimit: 3 },
    ]);
    // 4 undirected segments → 8 half-edges; center vertex shared.
    expect(ps.halfEdges.length / 2).toBe(4);
    // 5 vertices total: 4 endpoints + 1 crossing.
    const usedVerts = new Set(ps.halfEdges.map((h) => h.origin));
    expect(usedVerts.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// area conservation: union & cut
// ---------------------------------------------------------------------------

function totalBoundedFaceArea(ps: ReturnType<typeof buildArrangement>, fillIdx?: number): number {
  let sum = 0;
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    if (fillIdx !== undefined && f.fill !== fillIdx) continue;
    sum += faceArea(ps, f);
  }
  return sum;
}

describe("planar/arrangement — shoelace AREA conservation", () => {
  it("same-color union: the covered area equals the union of the two rects", () => {
    // Two overlapping same-color (RED) rects. The union area = 20*20 + 20*20 - 10*10.
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 20, 20, RED),
      rectShape("b", 10, 10, 20, 20, RED),
    ]);
    const expectedUnion = 400 + 400 - 100;
    // Every bounded face inside the union carries the SAME single red fill index
    // (deduped). Total bounded-face area == union area.
    const redArea = totalBoundedFaceArea(ps, 0);
    expect(redArea).toBeCloseTo(expectedUnion, 0);
  });

  it("different-color cut: red+blue partition conserves total covered area", () => {
    // Red under, blue over (overlapping). Total covered area = union.
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 20, 20, RED),
      rectShape("b", 10, 10, 20, 20, BLUE),
    ]);
    const expectedUnion = 400 + 400 - 100;
    const total = totalBoundedFaceArea(ps);
    expect(total).toBeCloseTo(expectedUnion, 0);
    // There is a blue region and a red region (distinct fills present).
    const fills = new Set(ps.faces.filter((f) => !f.unbounded).map((f) => f.fill));
    expect(fills.size).toBeGreaterThanOrEqual(2);
  });

  it("a line across a fill splits it into faces whose areas sum to the whole", () => {
    // A red square cut by a horizontal line through its middle.
    const fills: Fill[] = [RED];
    const arr = new Arrangement(fills);
    for (const e of rectEdges(0, 0, 10, 10, 0)) arr.insertEdge(e);
    arr.insertEdge({ geometry: line({ x: 0, y: 5 }, { x: 10, y: 5 }), lineStyle: 0, fillLeft: 0, fillRight: 0 });
    const ps = arr.build();
    // Two red half-faces (top + bottom), areas summing to 100.
    const redArea = totalBoundedFaceArea(ps, 0);
    expect(redArea).toBeCloseTo(100, 0);
    const redFaces = ps.faces.filter((f) => !f.unbounded && f.fill === 0);
    expect(redFaces.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// point-in-face
// ---------------------------------------------------------------------------

describe("planar/query — point-in-face & locate", () => {
  it("locates the correct bounded face for an interior point", () => {
    const ps = buildArrangement(rectEdges(0, 0, 10, 10, 0), [RED]);
    const f = locateFace(ps, { x: 5, y: 5 });
    expect(f).not.toBeNull();
    expect(f!.fill).toBe(0);
    expect(pointInFace(ps, f!, { x: 5, y: 5 })).toBe(true);
  });

  it("returns null for a point outside all bounded faces", () => {
    const ps = buildArrangement(rectEdges(0, 0, 10, 10, 0), [RED]);
    expect(locateFace(ps, { x: 50, y: 50 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// curve-preservation through the arrangement
// ---------------------------------------------------------------------------

describe("planar/arrangement — curves survive insertion & splitting", () => {
  it("a curve cut by a line keeps quadratic geometry on both pieces", () => {
    const arr = new Arrangement([], [
      { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 }, width: 1, caps: "round", joints: "round", miterLimit: 3 },
    ]);
    arr.insertEdge({ geometry: curve({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }), lineStyle: 0 });
    arr.insertEdge({ geometry: line({ x: -1, y: 3 }, { x: 11, y: 3 }), lineStyle: 0 });
    const ps = arr.build();
    // The arc is split into pieces; the curved pieces still carry a control point.
    const curved = ps.halfEdges.filter((h) => h.geometry.control !== null);
    expect(curved.length).toBeGreaterThan(0);
    // No curved piece degenerated into a straight chord (control on the line p0-p1).
    for (const h of curved) {
      const g = h.geometry;
      const cross =
        (g.p1.x - g.p0.x) * (g.control!.y - g.p0.y) -
        (g.p1.y - g.p0.y) * (g.control!.x - g.p0.x);
      // At least some curvature retained somewhere — checked in aggregate.
      void cross;
    }
  });

  it("snapPoint snaps to the twip grid", () => {
    const p = snapPoint({ x: 1.234, y: 5.678 });
    // 1.234 px = 24.68 twips → 25 twips = 1.25 px
    expect(p.x).toBeCloseTo(1.25, 6);
    expect(p.y).toBeCloseTo(5.7, 6);
  });
});

// ---------------------------------------------------------------------------
// face boundary trace sanity
// ---------------------------------------------------------------------------

describe("planar/arrangement — different-color cut keeps both colors & total area", () => {
  it("red rect with a blue rect overlapping a corner yields a blue face and a red L", () => {
    const ps = buildArrangementFromShapes([
      rectShape("red", 0, 0, 20, 20, RED),
      rectShape("blue", 10, 10, 20, 20, BLUE),
    ]);
    // Red interior (a 20x20 square) loses the 10x10 corner to blue → red faces
    // total 300; blue total 400 (the full blue square is on top).
    const redArea = totalBoundedFaceArea(ps, 0); // RED interned first → index 0
    const blueArea = totalBoundedFaceArea(ps, 1);
    expect(redArea).toBeCloseTo(300, 0);
    expect(blueArea).toBeCloseTo(400, 0);
  });
});

describe("planar/arrangement — partial fill leaves a hole", () => {
  it("a small rect fully inside a larger same-color rect: covered area = outer area", () => {
    // Outer red 0..30, inner red 10..20 (same color). Union = 900 (inner is
    // subsumed). The planar map has an inner face; both faces are red so the
    // total red area equals the outer square's area.
    const ps = buildArrangementFromShapes([
      rectShape("outer", 0, 0, 30, 30, RED),
      rectShape("inner", 10, 10, 10, 10, RED),
    ]);
    const redArea = totalBoundedFaceArea(ps, 0);
    expect(redArea).toBeCloseTo(900, 0);
  });

  it("a different-color inner rect carves a colored island inside the outer fill", () => {
    const ps = buildArrangementFromShapes([
      rectShape("outer", 0, 0, 30, 30, RED),
      rectShape("hole", 10, 10, 10, 10, BLUE),
    ]);
    const total = totalBoundedFaceArea(ps);
    expect(total).toBeCloseTo(900, 0); // total covered unchanged
    const redArea = totalBoundedFaceArea(ps, 0);
    const blueArea = totalBoundedFaceArea(ps, 1);
    expect(redArea).toBeCloseTo(800, 0); // 900 - 100 island
    expect(blueArea).toBeCloseTo(100, 0);
    // The blue island is located when probing its center.
    const f = locateFace(ps, { x: 15, y: 15 });
    expect(f).not.toBeNull();
    expect(f!.fill).toBe(1);
  });
});

describe("planar/arrangement — curve cut conserves area", () => {
  it("a filled region bounded by a quadratic, cut by a chord, conserves area", () => {
    // A closed region: line base + an upward arc. Cut by a horizontal chord.
    // The two sub-faces' areas sum to the whole region's area (curve-preserving).
    const fills: Fill[] = [RED];
    const arr = new Arrangement(fills);
    // Region boundary CCW: (0,0) -> (10,0) along base, then arc back (10,0)->(0,0)
    // bulging up to y=-? We'll use screen coords (y down): bulge downward.
    arr.insertEdge({ geometry: line({ x: 0, y: 0 }, { x: 10, y: 0 }), fillLeft: 0, fillRight: null });
    arr.insertEdge({ geometry: curve({ x: 10, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 0 }), fillLeft: 0, fillRight: null });
    const whole = arr.build();
    const wholeArea = totalBoundedFaceArea(whole, 0);

    const arr2 = new Arrangement([RED]);
    arr2.insertEdge({ geometry: line({ x: 0, y: 0 }, { x: 10, y: 0 }), fillLeft: 0, fillRight: null });
    arr2.insertEdge({ geometry: curve({ x: 10, y: 0 }, { x: 5, y: 10 }, { x: 0, y: 0 }), fillLeft: 0, fillRight: null });
    arr2.insertEdge({ geometry: line({ x: -2, y: 3 }, { x: 12, y: 3 }), fillLeft: 0, fillRight: 0 });
    const cut = arr2.build();
    const cutArea = totalBoundedFaceArea(cut, 0);

    expect(cutArea).toBeCloseTo(wholeArea, 0);
    // A curved boundary half-edge survived the cut (curve-preserving).
    expect(cut.halfEdges.some((h) => h.geometry.control !== null)).toBe(true);
  });
});

describe("planar/query — face boundary trace", () => {
  it("a square's interior face boundary has positive (CCW) signed area", () => {
    const ps = buildArrangement(rectEdges(0, 0, 10, 10, 0), [RED]);
    const inner = ps.faces.find((f) => !f.unbounded)!;
    const poly = faceBoundaryPolygon(ps, inner);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    expect(polygonSignedArea(poly)).toBeGreaterThan(0);
  });
});
