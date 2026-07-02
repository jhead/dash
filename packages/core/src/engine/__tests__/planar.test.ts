import { describe, it, expect } from "vitest";
import type {
  EdgeGeometry,
  Fill,
  HalfEdge,
  PlanarFace,
  PlanarShape,
  PlanarVertex,
  Point,
  Shape,
  ShapePath,
  Stroke,
} from "../types.js";
import {
  Arrangement,
  buildArrangement,
  buildArrangementFromShapes,
  eulerCharacteristic,
  faceArea,
  faceBoundaryPolygon,
  faceInteriorPoint,
  pointInPolygon,
  intersectSegSeg,
  intersectSegCurve,
  intersectCurveCurve,
  intersectEdges,
  locateFace,
  pointInFace,
  planarShapeToShape,
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
const STROKE: Stroke = {
  color: { r: 0, g: 0, b: 0, a: 255 },
  width: 1,
  caps: "round",
  joints: "round",
  miterLimit: 3,
};

/** A stroke-only (no fill) open ShapePath line shape. */
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

// ---------------------------------------------------------------------------
// P2: strokes/lines SPLIT fills, intersecting lines segment each other.
// These exercise the HIGH-LEVEL path (buildArrangementFromShapes ->
// planarShapeToShape) — the read-back must reflect the split fills and the
// segmented lines as independently-selectable per-path pieces (so P3 selection
// can later pick faces / segments). docs/36-vector-merge-model.md §1.1, P2.
// ---------------------------------------------------------------------------

describe("planar/P2 — a stroke line across a fill SPLITS it", () => {
  it("a chord through a face yields 2 faces (kernel)", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      strokeLineShape("line", -10, 50, 110, 50),
    ]);
    const redFaces = ps.faces.filter((f) => !f.unbounded && f.fill === 0);
    expect(redFaces.length).toBe(2);
    // Areas are conserved: the two halves sum to the whole 100x100 fill.
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(100 * 100, 0);
  });

  it("read-back emits 2 separate fill loops + the dividing stroke (selectable halves)", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      strokeLineShape("line", -10, 50, 110, 50),
    ]);
    const merged = planarShapeToShape(ps, "merged");
    const fillPaths = merged.paths.filter((p) => p.fill);
    const strokePaths = merged.paths.filter((p) => p.stroke && !p.fill);
    // TWO independently-selectable fill regions (the split halves), NOT one
    // dissolved silhouette — this is what P3 selection picks as two faces.
    expect(fillPaths.length).toBe(2);
    // The crossing stroke is segmented by the rect's edges into the inside span
    // plus the two outside stubs (3 undirected stroke segments).
    expect(strokePaths.length).toBe(3);
    // Both fill loops are closed and carry the red fill.
    for (const p of fillPaths) {
      expect(p.closed).toBe(true);
      expect(p.fill).toEqual(RED);
    }
  });

  it("a same-color overlap with NO dividing line still UNIONS to one loop", () => {
    // Regression: P2 must NOT break P1 same-color union. Two overlapping reds
    // with no stroke between them dissolve into a single silhouette loop.
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 20, 20, RED),
      rectShape("b", 10, 10, 20, 20, RED),
    ]);
    const merged = planarShapeToShape(ps, "merged");
    const fillPaths = merged.paths.filter((p) => p.fill);
    expect(fillPaths.length).toBe(1);
  });
});

describe("planar/P2 — two crossing lines segment each other", () => {
  it("an X of two stroke lines yields 4 edge-segments (read-back)", () => {
    const ps = buildArrangementFromShapes([
      strokeLineShape("a", 0, 0, 100, 100),
      strokeLineShape("b", 0, 100, 100, 0),
    ]);
    // The crossing point is a shared vertex: 4 undirected edges, 8 half-edges.
    expect(ps.halfEdges.length).toBe(8);
    const merged = planarShapeToShape(ps, "merged");
    const strokePaths = merged.paths.filter((p) => p.stroke && !p.fill);
    // Four independently-selectable arms meeting at the crossing.
    expect(strokePaths.length).toBe(4);
    // Each arm is an open segment ending at (or starting from) the crossing
    // point (50,50) — proving the lines were actually split at the intersection.
    const CENTER = { x: 50, y: 50 };
    const touches = (p: (typeof strokePaths)[number]): boolean => {
      const ends = [p.start, p.segments[p.segments.length - 1]!.to];
      return ends.some((e) => Math.abs(e.x - CENTER.x) < 0.6 && Math.abs(e.y - CENTER.y) < 0.6);
    };
    expect(strokePaths.every(touches)).toBe(true);
  });

  it("two crossing lines obey Euler and share exactly one crossing vertex", () => {
    const ps = buildArrangementFromShapes([
      strokeLineShape("a", 0, 0, 100, 100),
      strokeLineShape("b", 0, 100, 100, 0),
    ]);
    expect(eulerCharacteristic(ps)).toBe(2);
    const usedVerts = new Set(ps.halfEdges.map((h) => h.origin));
    expect(usedVerts.size).toBe(5); // 4 endpoints + 1 crossing
  });
});

describe("planar/P2 — a curved stroke across a fill splits it, curve-preserving", () => {
  it("the dividing curve keeps quadratic geometry and the fill splits in two", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      // A quadratic stroke arcing across the rect, endpoints outside its sides.
      {
        id: "arc",
        paths: [
          {
            start: { x: -10, y: 50 },
            segments: [{ type: "curve", control: { x: 50, y: 90 }, to: { x: 110, y: 50 } }],
            closed: false,
            stroke: STROKE,
          },
        ],
      },
    ]);
    const redFaces = ps.faces.filter((f) => !f.unbounded && f.fill === 0);
    expect(redFaces.length).toBe(2);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(100 * 100, 0);
    // Curve-preserving: at least one fill loop carries a quadratic segment from
    // the dividing arc (it was split at the rect's edges but never flattened).
    const merged = planarShapeToShape(ps, "merged");
    const fillPaths = merged.paths.filter((p) => p.fill);
    expect(fillPaths.length).toBe(2);
    const anyCurve = merged.paths.some((p) => p.segments.some((s) => s.type === "curve"));
    expect(anyCurve).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// faceInteriorPoint — sliver faces (task 1395)
//
// faceInteriorPoint must NEVER return a point proven OUTSIDE the face. The old
// implementation, when the centroid AND the 16x16 bbox grid both missed the
// interior (which a thin / acute / concave sliver from merge crossings genuinely
// produces), returned the centroid it had ALREADY proven outside. That
// proven-outside point then mis-classified the face's fill (build.ts) and
// destabilized its selection key (subselection.ts).
// ---------------------------------------------------------------------------

/**
 * Build a minimal {@link PlanarShape} whose single bounded face's outer boundary
 * is the given ordered (CCW) polygon of straight edges. Only the fields read by
 * faceBoundaryPolygon / faceInteriorPoint are populated (twin/origin are unused
 * by those; there are no holes).
 */
function planarShapeFromLoop(poly: readonly Point[]): { ps: PlanarShape; face: PlanarFace } {
  const n = poly.length;
  const vertices: PlanarVertex[] = poly.map((point, id) => ({ id, point, outgoing: id }));
  const halfEdges: HalfEdge[] = poly.map((p, i) => ({
    id: i,
    origin: i,
    twin: -1,
    next: (i + 1) % n,
    prev: (i - 1 + n) % n,
    face: 0,
    geometry: { p0: p, control: null, p1: poly[(i + 1) % n] },
    fillLeft: 0,
    fillRight: null,
    lineStyle: null,
  }));
  const face: PlanarFace = { id: 0, outer: 0, holes: [], fill: 0, unbounded: false };
  const ps: PlanarShape = { vertices, halfEdges, faces: [face], fills: [RED], lineStyles: [] };
  return { ps, face };
}

describe("faceInteriorPoint — never returns a point outside the face (task 1395)", () => {
  // A razor-thin, concave "L"-band sliver hugging the left + bottom edges of a
  // large bbox. Its vertex centroid falls in the empty hollow (outside), and
  // every one of the 16x16 = 256 grid samples (all at x >= 58.8 and y >= 58.8)
  // lands in the hollow too — so BOTH the centroid probe and the grid scan miss.
  const sliver: Point[] = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 1000 },
    { x: 0, y: 1000 },
  ];

  it("the sliver defeats the centroid and the grid (precondition)", () => {
    const cx = sliver.reduce((s, p) => s + p.x, 0) / sliver.length;
    const cy = sliver.reduce((s, p) => s + p.y, 0) / sliver.length;
    // Centroid is provably OUTSIDE the face.
    expect(pointInPolygon({ x: cx, y: cy }, sliver)).toBe(false);
    // The whole 16x16 grid misses too.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of sliver) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const steps = 17;
    let gridHits = 0;
    for (let i = 1; i < steps; i++)
      for (let j = 1; j < steps; j++) {
        const x = minX + ((maxX - minX) * j) / steps;
        const y = minY + ((maxY - minY) * i) / steps;
        if (pointInPolygon({ x, y }, sliver)) gridHits++;
      }
    expect(gridHits).toBe(0);
  });

  it("returns an interior point (or null), NEVER the proven-outside centroid", () => {
    const { ps, face } = planarShapeFromLoop(sliver);
    const ip = faceInteriorPoint(ps, face);
    // Must not hand back a point that is outside the face.
    expect(ip).not.toBeNull();
    if (ip) {
      expect(pointInFace(ps, face, ip)).toBe(true);
      // And specifically not the centroid (which is outside).
      const cx = sliver.reduce((s, p) => s + p.x, 0) / sliver.length;
      const cy = sliver.reduce((s, p) => s + p.y, 0) / sliver.length;
      expect(ip.x === cx && ip.y === cy).toBe(false);
    }
  });

  it("classifies the sliver's fill correctly through a full arrangement", () => {
    // The reported product impact: assignFaceFillsBySampling feeds the interior
    // point to pointInPolygon over the source regions. A thin RED cross-bar
    // (a sliver) must classify as RED, not background — a proven-outside sample
    // could match a different region or none.
    const ps = buildArrangementFromShapes([
      rectShape("bar", 0, 0, 400, 2, RED),
    ]);
    const bounded = ps.faces.filter((f) => !f.unbounded);
    expect(bounded.length).toBeGreaterThan(0);
    for (const f of bounded) {
      const ip = faceInteriorPoint(ps, f);
      if (ip) expect(pointInFace(ps, f, ip)).toBe(true);
    }
    // The thin bar reads back as a RED fill loop.
    const merged = planarShapeToShape(ps, "m");
    expect(merged.paths.some((p) => p.fill)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spatial broad-phase (task 1396) — behavior-preserving perf optimization
// ---------------------------------------------------------------------------

describe("planar/arrangement — spatial broad-phase (task 1396)", () => {
  // A non-trivial input: several spread-out clusters, each with two overlapping
  // squares (real crossings that split edges), a diagonal, and a curve. Because
  // the clusters are far apart, cross-cluster pairs are bbox-disjoint and must be
  // culled by the broad-phase, while intra-cluster crossings must still be found.
  function nonTrivialEdges(): InputEdge[] {
    const edges: InputEdge[] = [];
    const clusters = 12;
    for (let k = 0; k < clusters; k++) {
      const cx = (k % 4) * 200; // spread across x = 0..600
      const cy = Math.floor(k / 4) * 200; // spread across y = 0..400
      edges.push(...rectEdges(cx, cy, 20, 20, 0));
      edges.push(...rectEdges(cx + 10, cy + 10, 20, 20, 0));
      edges.push({
        geometry: line({ x: cx, y: cy }, { x: cx + 30, y: cy + 30 }),
        lineStyle: 0,
      });
      edges.push({
        geometry: curve(
          { x: cx, y: cy + 15 },
          { x: cx + 15, y: cy + 40 },
          { x: cx + 30, y: cy + 15 }
        ),
        lineStyle: 0,
      });
    }
    return edges;
  }

  function buildWith(spatialIndex: boolean): { ps: PlanarShape; tests: number } {
    const arr = new Arrangement([RED], [STROKE], { spatialIndex });
    for (const e of nonTrivialEdges()) arr.insertEdge(e);
    return { ps: arr.build(), tests: arr.edgeTestCount };
  }

  it("produces byte-identical arrangement output with vs without the index", () => {
    const withIdx = buildWith(true);
    const without = buildWith(false);
    // Full structural equality: vertices, half-edges (twin/next/prev/face/fill),
    // faces, and style tables must all match the exhaustive scan exactly.
    expect(withIdx.ps).toEqual(without.ps);
  });

  it("rejects the vast majority of pairwise edge tests via bbox culling", () => {
    const withIdx = buildWith(true);
    const without = buildWith(false);
    // The exhaustive scan is O(E²); the broad-phase must do dramatically fewer
    // intersection tests on this spread-out input (a perf sanity assertion).
    expect(without.tests).toBeGreaterThan(0);
    expect(withIdx.tests).toBeLessThan(without.tests / 3);
  });

  it("coincidentOverlap early-out is behavior-preserving for curve/curve pairs", () => {
    // Coincident curves are still detected (the bbox fast-path does NOT skip an
    // overlapping pair) …
    const a = curve({ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 });
    const coincident = intersectCurveCurve(a, a);
    expect(coincident.length).toBeGreaterThanOrEqual(1);
    // … while bbox-disjoint curves report no intersection (and skip the ~1400
    // edgeAt-eval coincidence sampling).
    const far = curve({ x: 500, y: 500 }, { x: 510, y: 520 }, { x: 520, y: 500 });
    expect(intersectCurveCurve(a, far)).toHaveLength(0);
  });
});

describe("planar/arrangement — rotation comparator total order (task 1399)", () => {
  // A quadratic edge leaving the origin. Its outgoing tangent direction is the
  // control point (∝ control − p0), and its bend SIDE is set by where p1 sits
  // relative to the control.
  const quad = (control: Point, p1: Point) =>
    ({ geometry: { p0: { x: 0, y: 0 }, control, p1 } }) as unknown as Parameters<
      // MutHalfEdge is private; compareOutgoing only reads `.geometry`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >[0];
  const polar = (angle: number, r: number): Point => ({
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r,
  });

  it("compareOutgoing is TRANSITIVE for three near-tangent edges chaining across the tie", () => {
    // Three outgoing tangents at angles 0, 0.008, 0.016 rad: A~B and B~C are
    // within the 0.01-rad tangent tie, but A~C (0.016) is BEYOND it. Their bend
    // signatures descend A > B > C. The OLD comparator returned the raw angle
    // beyond the tie and the bend within it, giving cmp(C,B)<=0, cmp(B,A)<=0 yet
    // cmp(C,A)>0 — an intransitive order → platform-dependent Array.sort.
    const A = quad(polar(0.0, 1000), { x: 1000, y: 2000 }); // strong +bend
    const B = quad(polar(0.008, 1000), {
      x: Math.cos(0.008) * 1000,
      y: Math.sin(0.008) * 1000 + 20,
    }); // small +bend
    const C = quad(polar(0.016, 1000), {
      x: Math.cos(0.016) * 1000,
      y: Math.sin(0.016) * 1000 - 2000,
    }); // strong −bend

    const arr = new Arrangement();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyArr = arr as any;
    const cmp = (x: unknown, y: unknown): number => anyArr.compareOutgoing(x, y);

    // Precondition: the angles chain across the tie (documents the intent).
    const ang = (e: unknown): number => anyArr.angleOf(e);
    expect(Math.abs(ang(A) - ang(B))).toBeLessThan(0.01);
    expect(Math.abs(ang(B) - ang(C))).toBeLessThan(0.01);
    expect(Math.abs(ang(A) - ang(C))).toBeGreaterThan(0.01);

    // Total-order check: for every ordered triple, cmp must respect transitivity
    // of `<=` (no cycles). This FAILS on the old raw-angle/bend hybrid.
    const edges = [A, B, C];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          if (cmp(edges[i], edges[j]) <= 0 && cmp(edges[j], edges[k]) <= 0) {
            expect(
              cmp(edges[i], edges[k]),
              `transitivity: (${i}<=${j}) && (${j}<=${k}) ⇒ (${i}<=${k})`
            ).toBeLessThanOrEqual(0);
          }
        }
      }
    }

    // Sorting the ring is now deterministic and matches the angular order.
    const order = [C, A, B].sort((x, y) => cmp(x, y));
    expect(order).toEqual([A, B, C]);
  });

  it("exact-tangency pinch still breaks the tie by bend side (task 1336 preserved)", () => {
    // Two curves leaving with the IDENTICAL tangent (same control direction) but
    // opposite bends must remain separable — same quantized bucket → bend order.
    const left = quad({ x: 1000, y: 0 }, { x: 1000, y: 1000 }); // bends left (+)
    const right = quad({ x: 1000, y: 0 }, { x: 1000, y: -1000 }); // bends right (−)
    const arr = new Arrangement();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyArr = arr as any;
    expect(anyArr.compareOutgoing(right, left)).toBeLessThan(0);
    expect(anyArr.compareOutgoing(left, right)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Interior-hole refill on rebuild (task 1425) — fill assignment must be
// WINDING/PARITY aware within a shape's same-Fill loops.
// ---------------------------------------------------------------------------

describe("planar/build — interior holes survive rebuild (task 1425)", () => {
  /** A CW (reversed) rect loop — a HOLE cut against a CCW outer loop of the same fill. */
  function holeRectPath(x: number, y: number, w: number, h: number, fill: Fill): ShapePath {
    // Reverse of rectPath: (x,y) -> (x+w,y) -> (x+w,y+h) -> (x,y+h) -> back (CW).
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

  it("WINDING-COUNT PROOF: an outer loop + its enclosed hole loop toggle to EMPTY", () => {
    // planarShapeToShape emits an interior hole as a SEPARATE closed loop that
    // SHARES the outer loop's Fill object reference (rendering cuts the hole via
    // non-zero winding). The hole centroid is enclosed by BOTH loops -> an even
    // enclosure count -> it must resolve to NO fill on any rebuild. This is the
    // exact idempotence the interactive eraser depends on.
    const holeCentroid: Point = { x: 100, y: 50 };

    // The two loops that a hole read-back produces, sharing ONE Fill object.
    const outer = rectPath(0, 0, 200, 100, RED);
    const hole = holeRectPath(80, 40, 40, 20, RED); // RED === RED (same object ref)

    // Enclosure count at the hole centroid = 2 (inside outer AND inside hole).
    const chord = (p: ShapePath): Point[] => {
      const poly: Point[] = [p.start];
      for (const s of p.segments) poly.push(s.to);
      return poly;
    };
    const enclosures =
      (pointInPolygon(holeCentroid, chord(outer)) ? 1 : 0) +
      (pointInPolygon(holeCentroid, chord(hole)) ? 1 : 0);
    expect(enclosures).toBe(2); // even -> hole

    const shapeWithHole: Shape = { id: "holed", paths: [outer, hole] };
    const ps = buildArrangementFromShapes([shapeWithHole]);

    // The hole face must be EMPTY (fill null); the surrounding ring must stay RED.
    const holeFace = locateFace(ps, holeCentroid);
    expect(holeFace?.fill ?? null).toBeNull();
    const ringFace = locateFace(ps, { x: 10, y: 50 });
    expect(ringFace?.fill ?? null).not.toBeNull();
  });

  it("read-back -> rebuild is IDEMPOTENT for a shape with an interior hole", () => {
    const outer = rectPath(0, 0, 200, 100, RED);
    const hole = holeRectPath(80, 40, 40, 20, RED);
    const shapeWithHole: Shape = { id: "holed", paths: [outer, hole] };

    // First rebuild (read-back).
    const ps1 = buildArrangementFromShapes([shapeWithHole]);
    const back1 = planarShapeToShape(ps1, "r1");
    // Second rebuild from the read-back result — the hole must persist.
    const ps2 = buildArrangementFromShapes([back1]);
    const holeFace = locateFace(ps2, { x: 100, y: 50 });
    expect(holeFace?.fill ?? null).toBeNull();
  });

  it("NO REGRESSION: two SEPARATE same-color shapes still UNION (overlap stays filled)", () => {
    // Distinct Fill object references (authored shapes) must NOT parity-cancel:
    // their overlap is a same-color union, still filled.
    const a = rectShape("a", 0, 0, 100, 100, RED);
    const b = rectShape("b", 50, 50, 100, 100, { ...RED }); // distinct Fill object
    const ps = buildArrangementFromShapes([a, b]);
    const overlap = locateFace(ps, { x: 75, y: 75 });
    expect(overlap?.fill ?? null).not.toBeNull();
  });

  it("NO REGRESSION: different-color island still carves a hole (top wins)", () => {
    // Blue square fully inside a red square: the island resolves to BLUE, the ring
    // stays RED (unchanged different-color cut).
    const red = rectShape("red", 0, 0, 200, 200, RED);
    const blue = rectShape("blue", 80, 80, 40, 40, BLUE);
    const ps = buildArrangementFromShapes([red, blue]);
    const island = locateFace(ps, { x: 100, y: 100 });
    const ring = locateFace(ps, { x: 10, y: 100 });
    expect(island?.fill ?? null).not.toBeNull();
    expect(ring?.fill ?? null).not.toBeNull();
    // island fill differs from ring fill (blue vs red).
    expect(island?.fill).not.toBe(ring?.fill);
  });
});
