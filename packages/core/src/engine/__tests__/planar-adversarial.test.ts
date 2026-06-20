/**
 * Degenerate / adversarial REGRESSION GUARDS for the curve-aware planar merge
 * kernel (docs/36-vector-merge-model.md, P0/P1/P2).
 *
 * These are NOT happy-path cases. The kernel is FOUNDATIONAL — every later phase
 * (P3 selection, P4/P5) compounds on it — so the degenerate behavior that two
 * independent QA passes PROVED correct is encoded here permanently. The highest
 * priority is the 1325 coincident-edge / collinear-line corruption class: an
 * earlier kernel mis-handled coincident edges and yielded euler = -3 (corrupt
 * DCEL) for two identical squares instead of a clean union. Every expectation
 * below is a VERIFIED-CORRECT topology, confirmed at HEAD b543382.
 *
 * Style note: helpers mirror planar.test.ts / planar-merge.test.ts so the
 * adversarial cases are built the same way as the happy-path ones.
 */

import { describe, it, expect } from "vitest";
import type { EdgeGeometry, Fill, Point, Shape, ShapePath, Stroke } from "../types.js";
import {
  buildArrangement,
  buildArrangementFromShapes,
  eulerCharacteristic,
  faceArea,
  intersectSegSeg,
  locateFace,
  planarShapeToShape,
  type InputEdge,
} from "../planar/index.js";

// ---------------------------------------------------------------------------
// fixtures (mirrors planar.test.ts)
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

function line(p0: Point, p1: Point): EdgeGeometry {
  return { p0, control: null, p1 };
}

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

/** A stroke-only (no fill) open line shape. */
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

/** A stroke-only line as an InputEdge for the low-level buildArrangement path. */
function lineEdge(p0: Point, p1: Point): InputEdge {
  return { geometry: line(p0, p1), lineStyle: 0 };
}

/** A single black stroke style for the lineStyles array of buildArrangement. */
const LINE_STYLES: Stroke[] = [STROKE];

function totalBoundedFaceArea(ps: ReturnType<typeof buildArrangement>, fillIdx?: number): number {
  let sum = 0;
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    if (fillIdx !== undefined && f.fill !== fillIdx) continue;
    sum += faceArea(ps, f);
  }
  return sum;
}
function boundedFaces(ps: ReturnType<typeof buildArrangement>) {
  return ps.faces.filter((f) => !f.unbounded);
}
function undirectedEdgeCount(ps: ReturnType<typeof buildArrangement>): number {
  return ps.halfEdges.length / 2;
}
function vertexCount(ps: ReturnType<typeof buildArrangement>): number {
  return new Set(ps.halfEdges.map((h) => h.origin)).size;
}
function strokePathCount(merged: Shape): number {
  return merged.paths.filter((p) => p.stroke && !p.fill).length;
}

// ===========================================================================
// COINCIDENT / COLLINEAR — the 1325 class (HIGHEST PRIORITY).
// A corrupt DCEL would surface here as euler != 2 (e.g. -3), a dropped/dup
// edge, or a wrong area. These all proved clean.
// ===========================================================================

describe("planar/adversarial — COINCIDENT/COLLINEAR (1325 class)", () => {
  it("two IDENTICAL same-color squares -> ONE bounded face, area 100, euler 2 (not -3)", () => {
    // The canonical 1325 corruption: stacking the exact same square twice must
    // NOT double the boundary into a tangled DCEL. It must collapse to a single
    // clean face. euler = -3 was the corrupt symptom.
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 10, 10, RED),
      rectShape("b", 0, 0, 10, 10, RED),
    ]);
    expect(eulerCharacteristic(ps)).toBe(2);
    expect(boundedFaces(ps).length).toBe(1);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(100, 0);
    // The redundant copy's edges were coalesced, not duplicated: a lone square.
    expect(undirectedEdgeCount(ps)).toBe(4);
  });

  it("two same-color squares SHARING AN EDGE -> union, euler 2, area 200", () => {
    // Abutting squares share their common edge exactly. The shared edge must be
    // a single coincident boundary between the two faces, not two stacked edges.
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 10, 10, RED),
      rectShape("b", 10, 0, 10, 10, RED),
    ]);
    expect(eulerCharacteristic(ps)).toBe(2);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(200, 0);
    // Both halves are the same color: every bounded face is red.
    expect(boundedFaces(ps).every((f) => f.fill === 0)).toBe(true);
  });

  it("a different-color island flush to the outer boundary (collinear edges) locates correctly", () => {
    // The island's LEFT edge is collinear with the outer square's LEFT edge
    // (x = 0). Collinear-but-distinct boundaries must not fuse the island into
    // the outside; the outer area and the island fill stay correct & locatable.
    const ps = buildArrangementFromShapes([
      rectShape("outer", 0, 0, 30, 30, RED),
      rectShape("island", 0, 10, 10, 10, BLUE),
    ]);
    expect(eulerCharacteristic(ps)).toBe(2);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(800, 0); // 900 - 100 island
    expect(totalBoundedFaceArea(ps, 1)).toBeCloseTo(100, 0);
    // Probe the island center: it is the BLUE face, not the surrounding red.
    const f = locateFace(ps, { x: 5, y: 15 });
    expect(f).not.toBeNull();
    expect(f!.fill).toBe(1);
  });

  it("partial-overlap collinear lines [0,75]+[25,100] -> 3 segments, euler 2, no dup/drop", () => {
    // Two overlapping collinear stroke lines must segment into exactly the three
    // intervals 0-25, 25-75, 75-100 (the shared [25,75] becomes ONE edge — not
    // duplicated, not dropped).
    const ps = buildArrangement(
      [lineEdge({ x: 0, y: 0 }, { x: 75, y: 0 }), lineEdge({ x: 25, y: 0 }, { x: 100, y: 0 })],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(3);
    expect(vertexCount(ps)).toBe(4); // 0, 25, 75, 100
    expect(eulerCharacteristic(ps)).toBe(2);
    // Read-back exposes the three independently-selectable segments.
    const merged = planarShapeToShape(ps, "merged");
    expect(strokePathCount(merged)).toBe(3);
  });

  it("the seg/seg primitive reports BOTH collinear overlap endpoints (25 and 75)", () => {
    // Underlying intersector for the case above: the overlap interval endpoints.
    const hits = intersectSegSeg(line({ x: 0, y: 0 }, { x: 75, y: 0 }), line({ x: 25, y: 0 }, { x: 100, y: 0 }));
    const xs = hits.map((h) => h.point.x).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(25, 5);
    expect(xs[xs.length - 1]).toBeCloseTo(75, 5);
  });

  it("exact-duplicate lines merge to ONE edge", () => {
    const ps = buildArrangement(
      [lineEdge({ x: 0, y: 0 }, { x: 50, y: 0 }), lineEdge({ x: 0, y: 0 }, { x: 50, y: 0 })],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(1);
    expect(vertexCount(ps)).toBe(2);
  });

  it("near-epsilon coincident lines (sub-twip jitter) SNAP to ONE edge", () => {
    // A second line whose endpoints differ from the first by far less than a
    // twip must snap onto the first — NOT produce a hair-thin spurious sliver.
    const ps = buildArrangement(
      [lineEdge({ x: 0, y: 0 }, { x: 50, y: 0 }), lineEdge({ x: 0.01, y: 0.01 }, { x: 50, y: 0 })],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(1);
    expect(vertexCount(ps)).toBe(2);
  });
});

// ===========================================================================
// LINE / FILL split — a stroke crossing a fill region.
// ===========================================================================

describe("planar/adversarial — LINE/FILL split", () => {
  it("an in-out zigzag chord splits the fill in two and conserves area", () => {
    // The dividing stroke dips into the fill and back out (two boundary crossings
    // on each side). It still partitions the fill cleanly; area is conserved.
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      {
        id: "zig",
        paths: [
          {
            start: { x: -10, y: 25 },
            segments: [
              { type: "line", to: { x: 50, y: 75 } },
              { type: "line", to: { x: 110, y: 25 } },
            ],
            closed: false,
            stroke: STROKE,
          },
        ],
      },
    ]);
    expect(boundedFaces(ps).filter((f) => f.fill === 0).length).toBe(2);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(10000, 0);
  });

  it("a line merely touching a fill CORNER does NOT split it (tangent)", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      strokeLineShape("touch", -10, -10, 0, 0), // ends exactly at corner (0,0)
    ]);
    expect(boundedFaces(ps).filter((f) => f.fill === 0).length).toBe(1);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(10000, 0);
  });

  it("a line COINCIDENT with a fill edge yields NO spurious region (1325 class)", () => {
    // A stroke laid exactly on the rect's left edge must not carve a zero-area
    // sliver or split the fill — it coincides with an existing boundary.
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      strokeLineShape("edge", 0, 0, 0, 100),
    ]);
    expect(boundedFaces(ps).filter((f) => f.fill === 0).length).toBe(1);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(10000, 0);
  });

  it("a dangling INTERIOR line (both ends inside the fill) does NOT split it", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      strokeLineShape("dangle", 20, 20, 60, 60),
    ]);
    expect(boundedFaces(ps).filter((f) => f.fill === 0).length).toBe(1);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(10000, 0);
  });

  it("a line dangling FROM the boundary into the interior does NOT split it", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 100, RED),
      strokeLineShape("dangle", 50, 50, 50, 100), // interior end -> boundary end
    ]);
    expect(boundedFaces(ps).filter((f) => f.fill === 0).length).toBe(1);
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(10000, 0);
  });

  it("a CLOSED stroke loop inside a fill makes a ring + inner region (hole-aware: 8400 + 1600)", () => {
    // A closed stroke square (30..70) drawn inside a 100x100 red fill divides it
    // into the surrounding ring (10000 - 1600 = 8400) and the inner region
    // (40x40 = 1600). Both are red faces; the kernel is hole-aware.
    const innerLoop: Shape = {
      id: "loop",
      paths: [
        {
          start: { x: 30, y: 30 },
          segments: [
            { type: "line", to: { x: 30, y: 70 } },
            { type: "line", to: { x: 70, y: 70 } },
            { type: "line", to: { x: 70, y: 30 } },
            { type: "line", to: { x: 30, y: 30 } },
          ],
          closed: true,
          stroke: STROKE,
        },
      ],
    };
    const ps = buildArrangementFromShapes([rectShape("rect", 0, 0, 100, 100, RED), innerLoop]);
    const redFaces = boundedFaces(ps).filter((f) => f.fill === 0);
    expect(redFaces.length).toBe(2);
    const areas = redFaces.map((f) => faceArea(ps, f)).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(1600, 0); // inner region
    expect(areas[1]).toBeCloseTo(8400, 0); // ring
    expect(totalBoundedFaceArea(ps, 0)).toBeCloseTo(10000, 0);
  });
});

// ===========================================================================
// LINE / LINE — junctions & crossings segment correctly.
// ===========================================================================

describe("planar/adversarial — LINE/LINE junctions", () => {
  it("an X crossing -> 4 segments, euler 2, with the crossing vertex present", () => {
    const ps = buildArrangement(
      [lineEdge({ x: 0, y: 0 }, { x: 100, y: 100 }), lineEdge({ x: 0, y: 100 }, { x: 100, y: 0 })],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(4);
    expect(eulerCharacteristic(ps)).toBe(2);
    expect(vertexCount(ps)).toBe(5); // 4 endpoints + crossing
    // The crossing vertex (50,50) actually exists in the DCEL.
    const hasCrossing = ps.vertices.some(
      (v) => Math.abs(v.point.x - 50) < 0.6 && Math.abs(v.point.y - 50) < 0.6
    );
    expect(hasCrossing).toBe(true);
  });

  it("a T-junction -> 3 segments (the through-line is split at the tee)", () => {
    const ps = buildArrangement(
      [lineEdge({ x: 0, y: 0 }, { x: 100, y: 0 }), lineEdge({ x: 50, y: 0 }, { x: 50, y: 50 })],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(3);
    expect(vertexCount(ps)).toBe(4);
    expect(eulerCharacteristic(ps)).toBe(2);
  });

  it("a Y-junction (three lines from one point) -> 3 segments sharing the hub", () => {
    const ps = buildArrangement(
      [
        lineEdge({ x: 50, y: 50 }, { x: 0, y: 0 }),
        lineEdge({ x: 50, y: 50 }, { x: 100, y: 0 }),
        lineEdge({ x: 50, y: 50 }, { x: 50, y: 100 }),
      ],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(3);
    expect(vertexCount(ps)).toBe(4); // hub + 3 tips
    expect(eulerCharacteristic(ps)).toBe(2);
  });

  it("a line passing through an EXISTING crossing vertex -> 6 segments", () => {
    // Two lines already cross at (50,0); a third horizontal line passes through
    // that exact crossing. The third line splits at the shared vertex too.
    const ps = buildArrangement(
      [
        lineEdge({ x: 0, y: 0 }, { x: 100, y: 0 }),
        lineEdge({ x: 50, y: -50 }, { x: 50, y: 50 }),
        lineEdge({ x: 0, y: 50 }, { x: 100, y: 50 }),
      ],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(6);
    expect(vertexCount(ps)).toBe(7);
    expect(eulerCharacteristic(ps)).toBe(2);
  });

  it("a crossing very NEAR (but not at) an endpoint still segments into 4", () => {
    // The vertical line crosses the horizontal line at x=99 — one twip-ish from
    // its endpoint. The near-endpoint crossing must still split cleanly (no
    // dropped sliver, no merge with the endpoint).
    const ps = buildArrangement(
      [lineEdge({ x: 0, y: 0 }, { x: 100, y: 0 }), lineEdge({ x: 99, y: -50 }, { x: 99, y: 50 })],
      [],
      LINE_STYLES
    );
    expect(undirectedEdgeCount(ps)).toBe(4);
    expect(vertexCount(ps)).toBe(5);
    expect(eulerCharacteristic(ps)).toBe(2);
  });

  // -------------------------------------------------------------------------
  // task 1326 (fixed by 1322): the single-pass builder used to MERGE two
  // NON-ADJACENT same-color bands into one face when a same-color fill is
  // crossed by MULTIPLE PARALLEL full-crossing stroke dividers — a stray bridge
  // edge gave euler=-1 and faces [6000,3000] instead of [3000,3000,3000]. Root
  // cause: insertEdge intersected the new edge against RETIRED half-edges
  // (origin=-1) left in the array, producing spurious split params. Fixed by
  // skipping retired edges in the intersection scan (arrangement.ts).
  // -------------------------------------------------------------------------
  describe("task 1326 — same-color fill + N parallel full-crossing dividers", () => {
    it("two dividers split a same-color rect into THREE equal faces (euler 2)", () => {
      const ps = buildArrangementFromShapes([
        rectShape("r", 0, 0, 90, 90, RED),
        strokeLineShape("d1", -10, 30, 100, 30),
        strokeLineShape("d2", -10, 60, 100, 60),
      ]);
      const filled = ps.faces.filter((f) => !f.unbounded && f.fill !== null);
      expect(filled.length, "three same-color bands").toBe(3);
      expect(eulerCharacteristic(ps), "planar (no stray bridge edge)").toBe(2);
      // Bands are equal-area thirds (allow for the divider stroke width seam).
      const areas = filled.map((f) => faceArea(ps, f)).sort((a, b) => a - b);
      for (const a of areas) {
        expect(a, "each band ~ a third of the rect").toBeGreaterThan(2500);
        expect(a, "no band fused to ~two-thirds").toBeLessThan(3100);
      }
      // Total conserved (no area lost/duplicated).
      const total = areas.reduce((s, a) => s + a, 0);
      expect(total).toBeGreaterThan(8000);
      expect(total).toBeLessThan(8200);
    });

    it("three dividers split a same-color rect into FOUR faces (euler 2)", () => {
      const ps = buildArrangementFromShapes([
        rectShape("r", 0, 0, 100, 120, BLUE),
        strokeLineShape("d1", -10, 30, 110, 30),
        strokeLineShape("d2", -10, 60, 110, 60),
        strokeLineShape("d3", -10, 90, 110, 90),
      ]);
      const filled = ps.faces.filter((f) => !f.unbounded && f.fill !== null);
      expect(filled.length, "four same-color bands").toBe(4);
      expect(eulerCharacteristic(ps)).toBe(2);
    });
  });
});
