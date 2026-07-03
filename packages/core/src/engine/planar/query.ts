/**
 * Queries over a built {@link PlanarShape}: point-in-face, face area (shoelace),
 * Euler invariant, and conversions between the per-path {@link Shape} model and
 * the arrangement.
 */

import type {
  EdgeGeometry,
  Fill,
  HalfEdge,
  PathSegment,
  PlanarFace,
  PlanarShape,
  Point,
  Shape,
  ShapePath,
  Stroke,
} from "../types.js";
import { edgeAt } from "./geometry.js";

/** Sample count per curved half-edge when flattening a face boundary for area / containment. */
const FACE_SAMPLES = 16;

/**
 * Trace a face's outer boundary as a polygon (curves sampled to chords).  Walks
 * the `next` cycle from `face.outer`.
 */
export function faceBoundaryPolygon(ps: PlanarShape, face: PlanarFace): Point[] {
  if (face.outer < 0) return [];
  const pts: Point[] = [];
  let cur = face.outer;
  let guard = 0;
  do {
    const he = ps.halfEdges[cur];
    appendHalfEdgePoints(he, pts);
    cur = he.next;
    if (++guard > ps.halfEdges.length + 5) break;
  } while (cur !== face.outer && cur >= 0);
  return pts;
}

function appendHalfEdgePoints(he: HalfEdge, out: Point[]): void {
  const g = he.geometry;
  if (g.control === null) {
    if (out.length === 0) out.push(g.p0);
    out.push(g.p1);
  } else {
    if (out.length === 0) out.push(g.p0);
    for (let i = 1; i <= FACE_SAMPLES; i++) out.push(edgeAt(g, i / FACE_SAMPLES));
  }
}

/** True when two points are within a twip (1/20 px) — a degenerate sub-twip span. */
function isSubTwip(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

/**
 * Minimum interior-candidate clearance from the face boundary, in px (task
 * 1436). One twip: comfortably above BOTH the ≤0.02px disagreement band
 * between a split-vertex-SNAPPED arrangement edge and the straight source
 * region chord the fill sampler tests against, AND the ≤~0.01px sagitta of the
 * FACE_SAMPLES flattening the clearance is measured on. A candidate at least
 * this far from the boundary is on the same side of every sub-twip-perturbed
 * variant of that boundary, so classifying the face by it can never be flipped
 * by snap noise.
 */
const INTERIOR_CLEARANCE = 0.05;

/** Distance from `pt` to the nearest segment of a closed polygon. */
function distToPolygonBoundary(pt: Point, poly: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t =
      l2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2));
    const ex = a.x + t * dx - pt.x;
    const ey = a.y + t * dy - pt.y;
    const d2 = ex * ex + ey * ey;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Shoelace signed area of a polygon. Positive = CCW. */
export function polygonSignedArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * A representative interior point of a bounded face (inside the outer boundary
 * and outside every hole).  Used to classify which fill covers the region.
 * Returns `null` for the unbounded face or a degenerate boundary.
 */
export function faceInteriorPoint(ps: PlanarShape, face: PlanarFace): Point | null {
  if (face.unbounded) return null;
  const poly = faceBoundaryPolygon(ps, face);
  if (poly.length < 3) return null;
  // Try the centroid first.
  let cx = 0,
    cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  // Membership is tested against the TRUE curved boundary (exact ray/quadratic
  // even-odd, task 1435), not the flattened `poly` — a candidate accepted here
  // is provably interior to the actual face, so classification can never be
  // flipped by the sagitta band between an arc and its inscribed chords. The
  // flattened poly is still used for CANDIDATE GENERATION (centroid/bbox/
  // diagonals), which keeps straight-edge faces byte-identical: for pure line
  // boundaries the exact test IS the polygon test (same arithmetic).
  const outerLoop = traceCycleGeometries(ps, face.outer);
  const holeLoops = face.holes.map((h) => traceCycleGeometries(ps, h));
  const inside = (pt: Point): boolean => {
    if (!pointInEdgeLoop(pt, outerLoop)) return false;
    for (const h of holeLoops) if (pointInEdgeLoop(pt, h)) return false;
    return true;
  };
  // CANDIDATE SELECTION WITH BOUNDARY CLEARANCE (task 1436). `inside` proves a
  // candidate interior to the face's own (snapped, split) boundary — but a
  // candidate a HAIR inside that boundary can still sit on the WRONG side of
  // the source-region chord the fill sampler compares against, because a
  // split-vertex-snapped arrangement edge and the region's straight chord
  // disagree by a sub-twip band (≤0.02px). A grid/diagonal candidate landing in
  // that band flipped a whole sliver face's fill to null (random-walk seed=2
  // h=9: a probe point EXACTLY on a dart face's boundary line passed the
  // even-odd fp coin toss). So each interior candidate must ALSO clear the
  // (flattened) boundary by {@link INTERIOR_CLEARANCE}; the first candidate
  // meeting both tests wins (preserving the centroid→grid→diagonal preference
  // order). A face too thin for ANY candidate to clear falls back to the
  // max-clearance interior candidate seen — never worse than the old
  // first-interior-hit, and still provably inside the face.
  const holePolys = face.holes.map((h) => traceCycle(ps, h));
  const clearanceOf = (pt: Point): number => {
    let d = distToPolygonBoundary(pt, poly);
    for (const hp of holePolys) d = Math.min(d, distToPolygonBoundary(pt, hp));
    return d;
  };
  let bestFallback: Point | null = null;
  let bestClearance = -1;
  const consider = (pt: Point): Point | null => {
    if (!inside(pt)) return null;
    const c = clearanceOf(pt);
    if (c >= INTERIOR_CLEARANCE) return pt;
    if (c > bestClearance) {
      bestClearance = c;
      bestFallback = pt;
    }
    return null;
  };
  const fromCentroid = consider({ x: cx, y: cy });
  if (fromCentroid) return fromCentroid;
  // Centroid can fall outside a non-convex face: scan along horizontal rays at
  // sampled y values, returning the midpoint of the first interior span.
  let minY = Infinity,
    maxY = -Infinity,
    minX = Infinity,
    maxX = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const steps = 17;
  for (let i = 1; i < steps; i++) {
    const y = minY + ((maxY - minY) * i) / steps;
    for (let j = 1; j < steps; j++) {
      const x = minX + ((maxX - minX) * j) / steps;
      const hit = consider({ x, y });
      if (hit) return hit;
    }
  }
  // Denser adaptive fallback for thin / acute slivers (which merge crossings
  // genuinely produce): a razor-thin or concave face can defeat BOTH the
  // centroid and the axis-aligned grid, yet the midpoint of an interior DIAGONAL
  // — a chord between two NON-ADJACENT boundary points — still lands strictly
  // inside. Probe those diagonals (skipping polygon edges, whose midpoint would
  // sit on the boundary). Bounded by a sample budget so a large boundary stays
  // cheap; the first interior hit returns immediately for a real sliver.
  const n = poly.length;
  let budget = 20000;
  for (let i = 0; i < n; i++) {
    for (let k = 2; k <= n - 2; k++) {
      const j = (i + k) % n;
      const mid = { x: (poly[i].x + poly[j].x) / 2, y: (poly[i].y + poly[j].y) / 2 };
      const hit = consider(mid);
      if (hit) return hit;
      if (--budget <= 0) return bestFallback;
    }
  }
  // No candidate cleared the boundary band: return the max-clearance interior
  // candidate (a face thinner than 2·INTERIOR_CLEARANCE everywhere has no
  // fully-cleared point — the best interior point found is still the right
  // representative). When nothing was interior at all, this is null: returning
  // the centroid — already PROVEN OUTSIDE the face via inside(...) above —
  // would be strictly worse (it mis-classifies the face's fill in
  // assignFaceFillsBySampling and yields an unstable faceKey / pickInRect
  // selection). Every caller already handles a null return safely.
  return bestFallback;
}

/** Absolute area of a face (its outer boundary minus its holes). */
export function faceArea(ps: PlanarShape, face: PlanarFace): number {
  if (face.unbounded) return Infinity;
  let area = Math.abs(polygonSignedArea(faceBoundaryPolygon(ps, face)));
  for (const h of face.holes) {
    const hole = traceCycle(ps, h);
    area -= Math.abs(polygonSignedArea(hole));
  }
  return Math.max(0, area);
}

/** Trace any half-edge cycle as a sampled polygon. */
export function traceCycle(ps: PlanarShape, startHe: number): Point[] {
  const pts: Point[] = [];
  let cur = startHe;
  let guard = 0;
  do {
    const he = ps.halfEdges[cur];
    appendHalfEdgePoints(he, pts);
    cur = he.next;
    if (++guard > ps.halfEdges.length + 5) break;
  } while (cur !== startHe && cur >= 0);
  return pts;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(pt: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Exact curve-aware even-odd membership (task 1435)
// ---------------------------------------------------------------------------

/**
 * Crossing test for one LINE segment (p0→p1) against the horizontal ray from
 * `pt` toward +x. BYTE-IDENTICAL arithmetic to the {@link pointInPolygon}
 * segment predicate (with (xi,yi) = p1, (xj,yj) = p0), so a loop of pure line
 * segments classifies exactly as its chord polygon did — the straight-edge
 * invariance the planar oracles depend on.
 */
function lineRayCrosses(pt: Point, p0: Point, p1: Point): boolean {
  const xi = p1.x,
    yi = p1.y;
  const xj = p0.x,
    yj = p0.y;
  return yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
}

/**
 * Number of crossings (0/1/2) of the horizontal +x ray from `pt` with the TRUE
 * quadratic `g` — closed-form, no flattening. The curve is split at its
 * y-extremum into y-MONOTONE pieces; each piece crosses the ray at most once,
 * decided with the same strict half-open convention (`y > pt.y` at both ends)
 * as {@link pointInPolygon}, so shared endpoints between consecutive edges are
 * never double-counted.
 */
function quadRayCrossings(pt: Point, g: EdgeGeometry): number {
  const y0 = g.p0.y;
  const cy = (g.control as Point).y;
  const y1 = g.p1.y;
  // y(t) = A t² + B t + C with:
  const A = y0 - 2 * cy + y1;
  const B = 2 * (cy - y0);
  // y-extremum at t = -B / (2A) — split there when strictly inside (0,1).
  let tSplit = -1;
  if (A !== 0) {
    const te = (y0 - cy) / A;
    if (te > 0 && te < 1) tSplit = te;
  }
  const yAt = (t: number): number =>
    t === 0 ? y0 : t === 1 ? y1 : (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;

  const pieces: readonly (readonly [number, number])[] =
    tSplit > 0
      ? [
          [0, tSplit],
          [tSplit, 1],
        ]
      : [[0, 1]];

  let crossings = 0;
  for (const [ta, tb] of pieces) {
    const ya = yAt(ta);
    const yb = yAt(tb);
    if (ya > pt.y === yb > pt.y) continue; // no strict crossing on this piece
    // Solve y(t) = pt.y on [ta, tb] (exactly one root — the piece is monotone).
    const C = y0 - pt.y;
    let t: number;
    if (A === 0) {
      t = -C / B; // degenerate quadratic: linear in t (B ≠ 0 when signs differ)
    } else {
      const disc = Math.max(0, B * B - 4 * A * C); // clamp fp noise near tangency
      const sq = Math.sqrt(disc);
      // Numerically stable pair of roots.
      const q = -0.5 * (B + (B >= 0 ? sq : -sq));
      const r1 = q / A;
      const r2 = q !== 0 ? C / q : r1;
      // Pick the root inside this monotone span (clamped against fp drift).
      const mid = (ta + tb) / 2;
      const in1 = r1 >= ta - 1e-9 && r1 <= tb + 1e-9;
      const in2 = r2 >= ta - 1e-9 && r2 <= tb + 1e-9;
      t = in1 && in2 ? (Math.abs(r1 - mid) <= Math.abs(r2 - mid) ? r1 : r2) : in1 ? r1 : r2;
      t = Math.min(tb, Math.max(ta, t));
    }
    const x = edgeAt(g, t).x;
    if (pt.x < x) crossings++;
  }
  return crossings;
}

/**
 * EXACT even-odd membership of `pt` in the region bounded by a closed loop of
 * edge geometries — the TRUE curves, not inscribed chords (task 1435).
 *
 * Rationale: `pointInPolygon` over a 6-chord flattening leaves a sagitta BAND
 * (up to ~0.12px for a nib-size quarter-arc) between the true arc and its
 * inscribed chords that mis-reads as outside. Fill-region classification
 * samples ONE representative point per face, so a point landing in that band
 * flipped the fill of the ENTIRE face (the round-dab crescent / dense-loop
 * crack defect). Solving the ray/quadratic intersection in closed form kills
 * the band entirely: when the arrangement is valid every face lies wholly
 * inside or wholly outside each source region, so the exact test is correct
 * for ANY interior point. Line segments use byte-identical arithmetic to
 * {@link pointInPolygon}, so straight-edge inputs classify unchanged.
 *
 * The loop is assumed to chain head-to-tail; if the last point does not return
 * to the first, an implicit straight closing segment is tested (matching the
 * implicit wraparound of {@link pointInPolygon}).
 */
export function pointInEdgeLoop(pt: Point, loop: readonly EdgeGeometry[]): boolean {
  if (loop.length === 0) return false;
  let inside = false;
  for (const g of loop) {
    if (g.control === null) {
      if (lineRayCrosses(pt, g.p0, g.p1)) inside = !inside;
    } else if (quadRayCrossings(pt, g) % 2 === 1) {
      inside = !inside;
    }
  }
  const first = loop[0].p0;
  const last = loop[loop.length - 1].p1;
  if ((first.x !== last.x || first.y !== last.y) && lineRayCrosses(pt, last, first)) {
    inside = !inside;
  }
  return inside;
}

/**
 * Locate the bounded face containing a point, or `null` if the point is in the
 * unbounded region.  When faces nest (a hole-island), the SMALLEST containing
 * bounded face wins.
 */
export function locateFace(ps: PlanarShape, pt: Point): PlanarFace | null {
  let best: PlanarFace | null = null;
  let bestArea = Infinity;
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    const poly = faceBoundaryPolygon(ps, f);
    if (poly.length < 3) continue;
    if (!pointInPolygon(pt, poly)) continue;
    const a = Math.abs(polygonSignedArea(poly));
    if (a < bestArea) {
      bestArea = a;
      best = f;
    }
  }
  return best;
}

/** True when `pt` lies inside the given face (respecting its holes). */
export function pointInFace(ps: PlanarShape, face: PlanarFace, pt: Point): boolean {
  if (face.unbounded) return false;
  const outer = faceBoundaryPolygon(ps, face);
  if (!pointInPolygon(pt, outer)) return false;
  for (const h of face.holes) {
    if (pointInPolygon(pt, traceCycle(ps, h))) return false;
  }
  return true;
}

/**
 * The Euler characteristic V - E + F of the planar subdivision.  For a
 * connected planar graph this equals 2 (counting the unbounded face); each extra
 * connected component adds 1.  `E` counts UNDIRECTED edges (half the half-edge
 * count); isolated vertices are excluded.
 */
export function eulerCharacteristic(ps: PlanarShape): number {
  const usedVerts = new Set<number>();
  for (const he of ps.halfEdges) {
    usedVerts.add(he.origin);
  }
  const V = usedVerts.size;
  const E = ps.halfEdges.length / 2;
  const F = ps.faces.length;
  return V - E + F;
}

// ---------------------------------------------------------------------------
// Shape <-> arrangement conversion
// ---------------------------------------------------------------------------

/** Turn a ShapePath into a list of directed edge geometries (one per segment). */
export function shapePathToEdgeGeometries(path: ShapePath): EdgeGeometry[] {
  const out: EdgeGeometry[] = [];
  let prev: Point = path.start;
  for (const seg of path.segments) {
    if (seg.type === "line") {
      out.push({ p0: prev, control: null, p1: seg.to });
    } else {
      out.push({ p0: prev, control: seg.control, p1: seg.to });
    }
    prev = seg.to;
  }
  return out;
}

/** Collect all edge geometries of a Shape (every path's segments). */
export function shapeToEdgeGeometries(shape: Shape): EdgeGeometry[] {
  const out: EdgeGeometry[] = [];
  for (const p of shape.paths) out.push(...shapePathToEdgeGeometries(p));
  return out;
}

// ---------------------------------------------------------------------------
// Curve-preserving face tracing + arrangement -> Shape conversion (P1)
// ---------------------------------------------------------------------------

/**
 * Trace a half-edge cycle (starting at `startHe`, following `next`) as a list of
 * directed {@link EdgeGeometry} — CURVE-PRESERVING (quadratic control points are
 * kept, never flattened to chords). This is the loop used to rebuild a
 * per-path closed {@link ShapePath} from a planar face after a merge.
 */
export function traceCycleGeometries(ps: PlanarShape, startHe: number): EdgeGeometry[] {
  const out: EdgeGeometry[] = [];
  let cur = startHe;
  let guard = 0;
  do {
    const he = ps.halfEdges[cur];
    if (!he) break;
    out.push(he.geometry);
    cur = he.next;
    if (++guard > ps.halfEdges.length + 5) break;
  } while (cur !== startHe && cur >= 0);
  return out;
}

/**
 * Convert a closed loop of directed edge geometries into a closed {@link ShapePath}
 * carrying the given fill/stroke. The loop's `p0`/`p1` are assumed to chain
 * head-to-tail (face cycles always do); quadratic controls are preserved.
 */
export function edgeGeometriesToShapePath(
  geoms: readonly EdgeGeometry[],
  fill?: Fill,
  stroke?: Stroke
): ShapePath | null {
  if (geoms.length === 0) return null;
  const start = geoms[0].p0;
  const segments: PathSegment[] = geoms.map((g) =>
    g.control === null
      ? { type: "line", to: g.p1 }
      : { type: "curve", control: g.control, to: g.p1 }
  );
  const path: ShapePath = {
    start,
    segments,
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };
  return path;
}

/**
 * Optional emit filters for {@link planarShapeToShape} (P3 partial selection /
 * split-on-move). When supplied, only faces accepted by `faceFilter` participate
 * in fill emission and only undirected edges accepted by `edgeFilter` emit as
 * strokes. Both default to "accept everything", so the no-arg call is exactly the
 * full read-back (byte-identical to the P1/P2 behavior). The filtered form is how
 * split-on-move emits the EXTRACTED sub-set and (with complement predicates) the
 * REMAINDER that keeps a hole where the extracted faces were.
 */
export interface PlanarEmitFilter {
  /** Accept a bounded, filled face by its face id (default: accept all). */
  faceFilter?: (faceId: number) => boolean;
  /** Accept an undirected edge by either of its half-edge ids (default: accept all). */
  edgeFilter?: (heId: number) => boolean;
}

/**
 * Convert a built {@link PlanarShape} (merge-mode half-edge form) back to the
 * per-path {@link Shape} interchange form — the inverse of
 * {@link import("./build.js").buildArrangementFromShapes}.
 *
 * FILLS: every bounded face whose `fill` index is non-null contributes its outer
 * boundary loop plus one loop per hole, ALL sharing the SAME {@link Fill} object
 * reference for that fill index. This is what makes the renderer (and SWF
 * encoder) treat a fill's faces as one region under the non-zero winding rule —
 * holes cut against their outer loop, and same-color union faces render seamlessly
 * (see `renderShape` in engine/renderer.ts, which batches consecutive
 * same-Fill-reference paths into one `fill("nonzero")`). Faces are grouped by
 * fill index and emitted contiguously so that batching kicks in.
 *
 * STROKES: every half-edge with a `lineStyle` contributes one open stroke path
 * (deduped against its twin so each undirected edge emits once).
 *
 * The result is curve-preserving (quadratic controls survive).
 *
 * P3: pass a {@link PlanarEmitFilter} to emit only a sub-set of faces/edges (the
 * basis for partial-selection extraction + the hole-leaving complement). With no
 * filter the output is identical to the P1/P2 full read-back.
 */
export function planarShapeToShape(
  ps: PlanarShape,
  id: string,
  filter?: PlanarEmitFilter
): Shape {
  const paths: ShapePath[] = [];
  const faceFilter = filter?.faceFilter ?? (() => true);
  const edgeFilter = filter?.edgeFilter ?? (() => true);

  // Whether a face participates in fill emission: bounded, filled, AND accepted.
  const faceAccepted = (faceId: number): boolean => {
    const f = ps.faces[faceId];
    if (!f || f.unbounded || f.fill === null || f.fill === undefined) return false;
    return faceFilter(faceId);
  };

  // Fill-index of the face on a half-edge's LEFT (its incident face). A face
  // rejected by the filter reads as "background" (null), so a boundary forms
  // between kept and dropped faces — this is what leaves a hole in the remainder.
  const faceFillOf = (faceId: number): number | null => {
    if (!faceAccepted(faceId)) return null;
    const f = ps.faces[faceId];
    return f && !f.unbounded ? f.fill ?? null : null;
  };

  // --- Fills: dissolve same-color UNION seams but KEEP line-split boundaries.
  //
  // Two adjacent faces carrying the SAME fill normally union into one region by
  // dissolving the shared interior edge (same-color UNION; P1). BUT in authentic
  // Flash 8 a STROKE drawn across a fill SPLITS it into independently-selectable
  // sub-faces (docs/36-vector-merge-model.md §1.1, P2): the line inserts edges
  // that subdivide the region and each sub-region is its own traceable loop. So
  // an interior same-fill seam is only DISSOLVABLE when it carries NO stroke; a
  // half-edge with a `lineStyle` is always a real boundary between its two faces.
  //
  // We therefore (1) partition same-fill faces into CONNECTED COMPONENTS where a
  // component edge crosses only NON-STROKED same-fill seams, then (2) trace each
  // component's boundary (the union silhouette of that component) as before. A
  // component with no stroked seams is a single region (same-color union); a fill
  // split by a line becomes two components → two loops → two selectable faces.

  // A seam between two same-fill faces is dissolvable iff it carries no stroke.
  const seamDissolvable = (he: HalfEdge): boolean => {
    if (he.lineStyle !== null && he.lineStyle !== undefined) return false;
    const twin = ps.halfEdges[he.twin];
    return faceFillOf(he.face) === faceFillOf(twin.face);
  };

  // Union-find over bounded, filled faces; merge across dissolvable seams only.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const f of ps.faces) {
    if (!faceAccepted(f.id)) continue;
    parent.set(f.id, f.id);
  }
  for (const he of ps.halfEdges) {
    if (!faceAccepted(he.face)) continue;
    const twin = ps.halfEdges[he.twin];
    if (!faceAccepted(twin.face)) continue;
    if (parent.has(he.face) && parent.has(twin.face) && seamDissolvable(he)) {
      union(he.face, twin.face);
    }
  }

  // Group faces by their component root, preserving the fill of the component.
  // Emit components ordered by fill index (so the renderer's same-Fill batching
  // groups loops of one colour contiguously), then by root id for determinism.
  const components = new Map<number, { fill: number; faces: Set<number> }>();
  for (const f of ps.faces) {
    if (!faceAccepted(f.id)) continue;
    const root = find(f.id);
    let comp = components.get(root);
    if (!comp) {
      comp = { fill: f.fill as number, faces: new Set() };
      components.set(root, comp);
    }
    comp.faces.add(f.id);
  }
  const compList = [...components.values()].sort(
    (a, b) => a.fill - b.fill
  );

  // Stroked edges consumed by a coincident fill loop (see below): they were
  // emitted as part of a COMBINED fill+stroke path, so the separate per-edge
  // stroke pass must not re-emit them.
  const strokeConsumedByFill = new Set<number>();

  for (const comp of compList) {
    const fill = ps.fills[comp.fill];
    if (!fill) continue;
    const facesOfComp = comp.faces;

    // Boundary half-edges of this component: the incident (left) face is in the
    // component, and the half-edge across the twin is NOT (a different fill, the
    // background, OR a stroked same-fill seam that splits the region).
    const isBoundary = (he: HalfEdge): boolean => {
      if (!facesOfComp.has(he.face)) return false;
      const twin = ps.halfEdges[he.twin];
      return !facesOfComp.has(twin.face);
    };

    const remaining = new Set<number>();
    for (const he of ps.halfEdges) if (isBoundary(he)) remaining.add(he.id);

    // Chain boundary half-edges into closed loops. From a boundary half-edge,
    // the next boundary half-edge is found by rotating around the shared vertex:
    // follow `next` until we land on another boundary half-edge of this
    // component (this hops across dissolved interior seams to stay on the
    // component's true silhouette).
    while (remaining.size > 0) {
      const startId = remaining.values().next().value as number;
      const loop: EdgeGeometry[] = [];
      const loopHes: number[] = [];
      let cur = startId;
      let guard = 0;
      do {
        remaining.delete(cur);
        loop.push(ps.halfEdges[cur].geometry);
        loopHes.push(cur);
        // Advance to the next boundary half-edge: walk `next` (which stays in the
        // incident face) — if that is a boundary edge, take it; otherwise keep
        // rotating via successive `next` (crossing dissolved interior seams).
        let step = ps.halfEdges[cur].next;
        let inner = 0;
        while (step >= 0 && !isBoundary(ps.halfEdges[step])) {
          // Cross the dissolved seam: jump to the twin's `next` to continue along
          // the outer silhouette of the same-fill component.
          step = ps.halfEdges[ps.halfEdges[step].twin].next;
          if (++inner > ps.halfEdges.length + 5) break;
        }
        cur = step;
        if (++guard > ps.halfEdges.length + 5) break;
      } while (cur !== startId && cur >= 0 && remaining.has(cur));

      // COMBINE a uniformly-stroked fill loop into ONE fill+stroke path. When
      // EVERY edge of this fill loop carries the SAME line style, the stroke
      // traces exactly the fill boundary (a stroked oval / rect / any stroked
      // filled shape). Emitting them as ONE path — instead of one fill loop PLUS
      // a dozen separate single-segment stroke fragments — is load-bearing: a
      // re-built (livePlanarShape) merge map then sees the stroke segmented
      // IDENTICALLY to the fill boundary, so the coincident-edge merge folds them
      // into shared edges and face tracing stays clean. Splitting them apart was
      // the stroked-ellipse centre-pick bug (task 1334): the fill loop (11 curve
      // segments) and the stroke fragments (per-edge) re-built with mismatched
      // split points → coincident curves the arrangement could not merge → the
      // interior never resolved to a fill face and pickAt at the centre returned
      // null. The combined form also matches the SWF encoder's
      // coalesceFillStrokePairs expectation and how an authored shape is shaped.
      let uniformStroke: Stroke | undefined;
      let allStroked = loopHes.length > 0;
      for (const heId of loopHes) {
        const he = ps.halfEdges[heId];
        const ls = he.lineStyle;
        const tls = ps.halfEdges[he.twin].lineStyle;
        const styleIdx = ls ?? tls;
        if (styleIdx === null || styleIdx === undefined) {
          allStroked = false;
          break;
        }
        const s = ps.lineStyles[styleIdx];
        if (!s) {
          allStroked = false;
          break;
        }
        if (uniformStroke === undefined) uniformStroke = s;
        else if (s !== uniformStroke) {
          allStroked = false;
          break;
        }
        // The edge must also pass the P3 edge filter to be consumed here.
        if (!edgeFilter(he.id) && !edgeFilter(he.twin)) {
          allStroked = false;
          break;
        }
      }

      const path = edgeGeometriesToShapePath(
        loop,
        fill,
        allStroked ? uniformStroke : undefined
      );
      if (path) {
        paths.push(path);
        if (allStroked) for (const heId of loopHes) strokeConsumedByFill.add(heId);
      }
    }
  }

  // --- Strokes: one open path per undirected line-styled edge (except those
  // already emitted as part of a coincident fill+stroke loop above). ---
  const seenStroke = new Set<number>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    if (seenStroke.has(he.id) || seenStroke.has(he.twin)) continue;
    if (strokeConsumedByFill.has(he.id) || strokeConsumedByFill.has(he.twin)) {
      seenStroke.add(he.id);
      continue;
    }
    // P3 edge filter: an undirected edge emits only if EITHER half-edge passes.
    if (!edgeFilter(he.id) && !edgeFilter(he.twin)) continue;
    seenStroke.add(he.id);
    const stroke = ps.lineStyles[he.lineStyle];
    if (!stroke) continue;
    const g = he.geometry;
    // Skip a sub-twip stub. A stroked edge that spans less than a twip after
    // snapping is a topology artifact (the residual stub left at a curve seam when
    // a fill loop's coincident stroke was emitted as one combined path) — it is
    // invisible AND, re-built, it produces a coincident micro-curve the
    // arrangement cannot merge, re-fragmenting the interior so the centre stops
    // resolving to a fill face (task 1334). A real stroke segment always spans
    // more than a twip.
    if (isSubTwip(g.p0, g.p1)) continue;
    paths.push({
      start: g.p0,
      segments: [g.control === null ? { type: "line", to: g.p1 } : { type: "curve", control: g.control, to: g.p1 }],
      closed: false,
      stroke,
    });
  }

  return { id, paths };
}
