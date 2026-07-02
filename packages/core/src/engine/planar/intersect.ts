/**
 * Curve-aware edge/edge intersection.
 *
 * Provides the three primitives the arrangement builder needs:
 *   - segment/segment  (analytic)
 *   - segment/curve    (quadratic root solve)
 *   - curve/curve      (recursive subdivision / fat-line clipping)
 *
 * Every intersection is returned as a parameter pair `{ tA, tB }` (the parameter
 * on edge A and edge B) plus the snapped point.  Reporting parameters — not just
 * points — is what lets the arrangement split each edge at the correct place
 * while preserving the curve (de Casteljau at tA / tB).
 *
 * Endpoints are reported too (closed [0,1] interval): the arrangement relies on
 * shared endpoints becoming shared vertices.  Callers dedupe by snapped point.
 */

import type { EdgeGeometry, Point } from "../types.js";
import { edgeAt, edgeBBox, edgeTangent, quadAt, snapPoint, SNAP_EPS } from "./geometry.js";

export interface Intersection {
  /** Parameter on edge A, in [0,1]. */
  readonly tA: number;
  /** Parameter on edge B, in [0,1]. */
  readonly tB: number;
  /** The intersection point (twip-snapped). */
  readonly point: Point;
}

const PARAM_EPS = 1e-6;

// ---------------------------------------------------------------------------
// segment / segment
// ---------------------------------------------------------------------------

/**
 * Intersect two straight segments.  Returns 0 or 1 proper crossing/touch (the
 * closed interval includes endpoints).  Collinear-overlap is handled by
 * reporting the overlap endpoints (up to two intersections) so the arrangement
 * splits both edges at the shared sub-segment.
 */
export function intersectSegSeg(a: EdgeGeometry, b: EdgeGeometry): Intersection[] {
  const p = a.p0,
    p2 = a.p1,
    q = b.p0,
    q2 = b.p1;
  const rx = p2.x - p.x,
    ry = p2.y - p.y;
  const sx = q2.x - q.x,
    sy = q2.y - q.y;
  const denom = rx * sy - ry * sx;
  const qpx = q.x - p.x,
    qpy = q.y - p.y;

  if (Math.abs(denom) < 1e-12) {
    // Parallel. Check collinearity; if collinear, report overlap endpoints.
    const cross = qpx * ry - qpy * rx;
    if (Math.abs(cross) > 1e-9) return []; // parallel, not collinear
    return collinearOverlap(a, b);
  }

  const tA = (qpx * sy - qpy * sx) / denom;
  const tB = (qpx * ry - qpy * rx) / denom;
  if (tA < -PARAM_EPS || tA > 1 + PARAM_EPS || tB < -PARAM_EPS || tB > 1 + PARAM_EPS) {
    return [];
  }
  const ca = clamp01(tA);
  const cb = clamp01(tB);
  return [{ tA: ca, tB: cb, point: snapPoint(edgeAt(a, ca)) }];
}

function collinearOverlap(a: EdgeGeometry, b: EdgeGeometry): Intersection[] {
  // Project b's endpoints onto a's parameterization; clamp the overlap to [0,1]
  // and report the two overlap-interval endpoints as intersections (deduped by
  // the caller). This makes a stroke lying ON another stroke split correctly.
  const rx = a.p1.x - a.p0.x,
    ry = a.p1.y - a.p0.y;
  const len2 = rx * rx + ry * ry;
  if (len2 < 1e-12) return [];
  const paramOnA = (pt: Point): number => ((pt.x - a.p0.x) * rx + (pt.y - a.p0.y) * ry) / len2;
  const paramOnB = (pt: Point): number => {
    const bx = b.p1.x - b.p0.x,
      by = b.p1.y - b.p0.y;
    const bl2 = bx * bx + by * by;
    if (bl2 < 1e-12) return 0;
    return ((pt.x - b.p0.x) * bx + (pt.y - b.p0.y) * by) / bl2;
  };

  const tb0 = paramOnA(b.p0);
  const tb1 = paramOnA(b.p1);
  const lo = Math.max(0, Math.min(tb0, tb1));
  const hi = Math.min(1, Math.max(tb0, tb1));
  if (hi < lo - PARAM_EPS) return [];

  const out: Intersection[] = [];
  for (const tA of [lo, hi]) {
    const pt = snapPoint(edgeAt(a, tA));
    const tB = clamp01(paramOnB(pt));
    out.push({ tA: clamp01(tA), tB, point: pt });
  }
  return out;
}

// ---------------------------------------------------------------------------
// segment / curve
// ---------------------------------------------------------------------------

/**
 * Intersect a straight segment (seg) with a quadratic curve.  Solves the
 * quadratic for the curve parameters where the curve crosses the segment's
 * supporting line, then keeps those that land within the segment's extent.
 * `flip` controls which input is A vs B in the returned parameter pair.
 */
export function intersectSegCurve(seg: EdgeGeometry, curve: EdgeGeometry): Intersection[] {
  const p0 = curve.p0,
    c = curve.control!,
    p1 = curve.p1;
  // Line through seg as ax + by + cc = 0 (normalized normal).
  const dx = seg.p1.x - seg.p0.x;
  const dy = seg.p1.y - seg.p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return [];
  const nx = -dy / len;
  const ny = dx / len;
  const cc = -(nx * seg.p0.x + ny * seg.p0.y);

  // Signed distance of the quadratic control points to the line.
  const d0 = nx * p0.x + ny * p0.y + cc;
  const d1 = nx * c.x + ny * c.y + cc;
  const d2 = nx * p1.x + ny * p1.y + cc;

  // f(t) = (1-t)^2 d0 + 2(1-t)t d1 + t^2 d2 = A t^2 + B t + C
  const A = d0 - 2 * d1 + d2;
  const B = -2 * d0 + 2 * d1;
  const C = d0;

  const roots = solveQuadratic(A, B, C);
  const out: Intersection[] = [];
  const segLen2 = dx * dx + dy * dy;
  for (const tC of roots) {
    if (tC < -PARAM_EPS || tC > 1 + PARAM_EPS) continue;
    const tc = clamp01(tC);
    const pt = quadAt(p0, c, p1, tc);
    // Parameter along the segment.
    const tS = ((pt.x - seg.p0.x) * dx + (pt.y - seg.p0.y) * dy) / segLen2;
    if (tS < -PARAM_EPS || tS > 1 + PARAM_EPS) continue;
    out.push({ tA: clamp01(tS), tB: tc, point: snapPoint(pt) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// curve / curve
// ---------------------------------------------------------------------------

/**
 * Intersect two quadratic curves by recursive subdivision of their bounding
 * boxes.  When both sub-curves are small enough, report the midpoint as an
 * intersection.  Returns parameter pairs (tA on curveA, tB on curveB).
 */
export function intersectCurveCurve(
  curveA: EdgeGeometry,
  curveB: EdgeGeometry
): Intersection[] {
  // COINCIDENCE FAST-PATH. Two quadratics that trace (a span of) the SAME path —
  // e.g. an oval's fill boundary and its coincident stroke loop, or a curve laid
  // exactly over another — have overlapping bounding boxes at every subdivision
  // level, so the transversal `recurse` below would emit a FLOOD of spurious
  // "crossings" all along the shared arc (deduped only at SNAP_EPS → dozens of
  // bogus split points → the arrangement shatters into thousands of micro-edges
  // and face tracing collapses). This is the curve analogue of the seg/seg
  // collinear-overlap case: report ONLY the overlap-interval endpoints so both
  // curves split at the SAME shared vertices and the coincident-edge merge in
  // the arrangement folds them into one edge.
  const overlap = coincidentOverlap(curveA, curveB);
  if (overlap) return overlap;

  const out: Intersection[] = [];
  recurse(curveA, curveB, 0, 1, 0, 1, 0, out);
  // TANGENT-CLUSTER COLLAPSE (task 1336). At an EXACT or near tangency — two
  // distinct curved fills touching at a single apex (dx == 2r for two equal
  // circles) — the two grazing arcs' sub-boxes overlap over a contiguous band
  // and never separate, so `recurse` emits a FLOOD of near-duplicate crossings
  // spread over a short arc (~2–3 px). `dedupe` only merges within SNAP_EPS
  // (0.025 px), so dozens survive as distinct vertices; the arrangement then
  // shatters (he 16 -> ~98) and BOTH filled regions leak to the unbounded face.
  // This is the curve analogue of the 1332 seg/seg crossing-pin: a single
  // tangent CONTACT must become ONE pinned shared vertex (the closest-approach
  // point), not a cloud. Collapse only a genuinely GRAZING cluster (near-parallel
  // curve tangents) so two real transversal crossings — which are spatially far
  // apart and cross at non-parallel angles — are never wrongly merged.
  const collapsed = collapseTangentClusters(curveA, curveB, out);
  // Dedupe near-equal results (subdivision can report a crossing twice).
  return dedupe(collapsed);
}

/**
 * Detect whether two quadratic curves are COINCIDENT over a span (one traces the
 * same path as the other for a contiguous parameter range) and, if so, return the
 * overlap-interval endpoints as the only intersections. Returns `null` when the
 * curves merely cross transversally (the normal subdivision case).
 *
 * Method: sample B; project each sample to its nearest parameter on A. The pair
 * is coincident iff a contiguous run of B's samples ALL lie on A (within a
 * slightly-relaxed snap tolerance) AND their A-parameters advance monotonically
 * (same trace, not a transversal touch). We then report the endpoints of that
 * shared span on A (which, snapped, become shared vertices on both curves). One or
 * two grazing samples on A are NOT coincidence — they fall through to the
 * transversal solver so a real curve/curve crossing is unaffected.
 */
function coincidentOverlap(a: EdgeGeometry, b: EdgeGeometry): Intersection[] | null {
  // Relax the on-curve tolerance a touch above SNAP_EPS: coincident authored
  // geometry can differ by sub-twip rounding after a readback round-trip.
  const ON_TOL = Math.max(SNAP_EPS * 4, 0.05);
  const SAMPLES = 24;

  // SPATIAL REJECTION (task 1396). This routine samples B at SAMPLES+1 points and
  // runs a 32-step coarse scan + 24-iter ternary refine (~1400 `edgeAt` evals) for
  // EVERY curve/curve pair — before any bbox test — which dominated dense-edit fold
  // cost. Short-circuit when the two curves' exact bounding boxes are disjoint by
  // more than the on-curve tolerance: no B sample can then lie within ON_TOL of A,
  // so `onA` would stay empty and this would return null regardless. It is strictly
  // behavior-preserving — the only pairs skipped are ones that provably have no
  // coincident overlap (and the transversal `recurse` in intersectCurveCurve also
  // bails immediately on the same disjoint boxes).
  const ba = edgeBBox(a);
  const bb = edgeBBox(b);
  if (
    ba.maxX < bb.minX - ON_TOL ||
    bb.maxX < ba.minX - ON_TOL ||
    ba.maxY < bb.minY - ON_TOL ||
    bb.maxY < ba.minY - ON_TOL
  ) {
    return null;
  }

  // Nearest parameter on `a` to a point: coarse scan + ternary-search refine.
  const nearestParamOnA = (pt: Point): { t: number; d: number } => {
    let bestT = 0;
    let bestD = Infinity;
    const COARSE = 32;
    for (let i = 0; i <= COARSE; i++) {
      const t = i / COARSE;
      const q = edgeAt(a, t);
      const d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2;
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
    let lo = Math.max(0, bestT - 1 / COARSE);
    let hi = Math.min(1, bestT + 1 / COARSE);
    for (let iter = 0; iter < 24; iter++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const q1 = edgeAt(a, m1);
      const q2 = edgeAt(a, m2);
      const d1 = (q1.x - pt.x) ** 2 + (q1.y - pt.y) ** 2;
      const d2 = (q2.x - pt.x) ** 2 + (q2.y - pt.y) ** 2;
      if (d1 < d2) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const q = edgeAt(a, t);
    return { t, d: Math.hypot(q.x - pt.x, q.y - pt.y) };
  };

  // Project each B sample onto A; collect the ones whose point lies on A.
  const onA: { tA: number; tB: number }[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const tB = i / SAMPLES;
    const pt = edgeAt(b, tB);
    const { t, d } = nearestParamOnA(pt);
    if (d <= ON_TOL) onA.push({ tA: t, tB });
  }
  // Need a real shared span — and the bulk of B must lie on A — so a true
  // transversal crossing (one/two on-curve samples) still goes to the solver.
  if (onA.length < 3 || onA.length < (SAMPLES + 1) * 0.5) return null;

  // Reject a CORNER GRAZE. Two adjacent (non-coincident) quadratic arcs that
  // share an endpoint also share a near-equal tangent there, so a handful of B's
  // samples near the join project onto a tiny slice of A — looking like a
  // micro-overlap. A genuine coincident overlap covers a substantial parameter
  // span of A; require the matched A-range to be a real fraction of the curve.
  const tASpan = Math.abs(onA[onA.length - 1].tA - onA[0].tA);
  const tBSpan = Math.abs(onA[onA.length - 1].tB - onA[0].tB);
  if (tASpan < 0.1 || tBSpan < 0.1) return null;

  // The shared A-parameters must advance monotonically (same direction, same
  // trace), not bounce — a transversal contact would not.
  const incr = onA[onA.length - 1].tA >= onA[0].tA;
  for (let i = 1; i < onA.length; i++) {
    const dt = onA[i].tA - onA[i - 1].tA;
    if (incr ? dt < -ON_TOL : dt > ON_TOL) return null;
  }

  // Report the overlap-interval endpoints on A (snapped → shared vertices).
  // CRUCIAL: the two endpoints must be DISTINCT after snapping. Two adjacent
  // (but not coincident) curves that merely share a corner vertex can produce a
  // near-degenerate "overlap" clustered at that corner — emitting it would split
  // a curve at a point coincident with its own endpoint and create a zero-span
  // stub edge that corrupts face tracing. A genuine coincident overlap spans a
  // real arc, so its endpoints snap to different vertices.
  const tA0 = clamp01(onA[0].tA);
  const tA1 = clamp01(onA[onA.length - 1].tA);
  const p0 = snapPoint(edgeAt(a, tA0));
  const p1 = snapPoint(edgeAt(a, tA1));
  if (p0.x === p1.x && p0.y === p1.y) return null; // span collapses to one vertex

  const out: Intersection[] = [
    { tA: tA0, tB: clamp01(onA[0].tB), point: p0 },
    { tA: tA1, tB: clamp01(onA[onA.length - 1].tB), point: p1 },
  ];
  return dedupe(out);
}

function recurse(
  a: EdgeGeometry,
  b: EdgeGeometry,
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  depth: number,
  out: Intersection[]
): void {
  const ba = subBBox(a, a0, a1);
  const bb = subBBox(b, b0, b1);
  if (!boxesOverlap(ba, bb)) return;

  const aSpan = Math.max(ba.maxX - ba.minX, ba.maxY - ba.minY);
  const bSpan = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
  // Converged: both sub-boxes below tolerance, or recursion limit reached.
  if ((aSpan <= SNAP_EPS && bSpan <= SNAP_EPS) || depth >= 40) {
    const tA = (a0 + a1) / 2;
    const tB = (b0 + b1) / 2;
    const pt = snapPoint(edgeAt(a, tA));
    out.push({ tA: clamp01(tA), tB: clamp01(tB), point: pt });
    return;
  }

  const am = (a0 + a1) / 2;
  const bm = (b0 + b1) / 2;
  // Subdivide the larger-span curve to keep recursion balanced.
  if (aSpan >= bSpan) {
    recurse(a, b, a0, am, b0, b1, depth + 1, out);
    recurse(a, b, am, a1, b0, b1, depth + 1, out);
  } else {
    recurse(a, b, a0, a1, b0, bm, depth + 1, out);
    recurse(a, b, a0, a1, bm, b1, depth + 1, out);
  }
}

/**
 * Spatial radius (px) within which two raw `recurse` crossings are linked into
 * one cluster. The near-tangent flood spreads its points over a short arc — at
 * dx==2r for r=30 the band is ~2.5 px tall — so the radius must comfortably
 * exceed that, yet stay well below the smallest gap between two GENUINE
 * transversal crossings of two distinct curved fills (which, for overlapping
 * circles, are tens of px apart, on opposite sides of the lens). 4 px threads
 * that needle.
 */
const CLUSTER_RADIUS = 4;
const CLUSTER_RADIUS2 = CLUSTER_RADIUS * CLUSTER_RADIUS;

/**
 * Tangents are treated as PARALLEL (a grazing contact, not a transversal cross)
 * when |sin θ| between the two curve tangents at the cluster representative is
 * below this. A true transversal crossing meets at a clear angle; a tangency has
 * (near-)parallel tangents. 0.35 ≈ 20°: generous enough to catch the slightly-
 * off-parallel tangents the snapped flood produces, tight enough that a real
 * crossing (typically near-perpendicular for two circle boundaries) is never
 * mistaken for a tangency.
 */
const TANGENT_PARALLEL_SIN = 0.35;

/**
 * Collapse each GRAZING (near-tangent) spatial cluster of raw crossings to a
 * single pinned representative — the point of closest approach between the two
 * curves within the cluster's parameter span (task 1336). Transversal crossings
 * (well-separated clusters, or a cluster whose curve tangents clearly cross) are
 * returned unchanged, so genuine curve/curve crossings keep their split points.
 */
function collapseTangentClusters(
  a: EdgeGeometry,
  b: EdgeGeometry,
  raw: Intersection[]
): Intersection[] {
  if (raw.length <= 1) return raw;

  // Single-linkage spatial clustering: union points within CLUSTER_RADIUS.
  const n = raw.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (x: number, y: number): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = raw[i].point.x - raw[j].point.x;
      const dy = raw[i].point.y - raw[j].point.y;
      if (dx * dx + dy * dy <= CLUSTER_RADIUS2) union(i, j);
    }
  }

  const clusters = new Map<number, Intersection[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let list = clusters.get(r);
    if (!list) {
      list = [];
      clusters.set(r, list);
    }
    list.push(raw[i]);
  }

  const out: Intersection[] = [];
  for (const members of clusters.values()) {
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    // Span of the cluster on each curve.
    let tAmin = Infinity,
      tAmax = -Infinity,
      tBmin = Infinity,
      tBmax = -Infinity;
    for (const m of members) {
      if (m.tA < tAmin) tAmin = m.tA;
      if (m.tA > tAmax) tAmax = m.tA;
      if (m.tB < tBmin) tBmin = m.tB;
      if (m.tB > tBmax) tBmax = m.tB;
    }

    const rep = closestApproach(a, b, tAmin, tAmax, tBmin, tBmax);

    // Grazing test: parallel curve tangents at the contact AND a real spatial
    // spread (multiple distinct snapped points). A single tight transversal
    // crossing that merely got reported a few times stays as its members
    // (dedupe folds it); only a genuine near-tangent BAND collapses.
    const dA = edgeTangent(a, rep.tA);
    const dB = edgeTangent(b, rep.tB);
    const lenA = Math.hypot(dA.x, dA.y);
    const lenB = Math.hypot(dB.x, dB.y);
    let parallel = false;
    if (lenA > 1e-9 && lenB > 1e-9) {
      const sin = Math.abs(dA.x * dB.y - dA.y * dB.x) / (lenA * lenB);
      parallel = sin <= TANGENT_PARALLEL_SIN;
    }
    const spread = Math.max(
      maxPointSpread(members),
      0
    );

    if (parallel && spread > SNAP_EPS) {
      // A genuine tangent contact: ONE pinned shared vertex.
      out.push({ tA: clamp01(rep.tA), tB: clamp01(rep.tB), point: snapPoint(rep.point) });
    } else {
      // Not a tangency (transversal crossing reported multiply, or two close but
      // angle-crossing hits): keep the members; dedupe folds the true duplicates.
      for (const m of members) out.push(m);
    }
  }
  return out;
}

/** Largest pairwise spatial spread (px) among a cluster's points. */
function maxPointSpread(members: Intersection[]): number {
  let max = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const dx = members[i].point.x - members[j].point.x;
      const dy = members[i].point.y - members[j].point.y;
      const d = Math.hypot(dx, dy);
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * Point of closest approach between curve A over [a0,a1] and curve B over
 * [b0,b1]. A coarse grid scan seeds a short coordinate-descent refine. Returns
 * the midpoint of the two closest curve points (the geometric contact) plus the
 * parameters on each curve so the arrangement splits both at that exact place.
 */
function closestApproach(
  a: EdgeGeometry,
  b: EdgeGeometry,
  a0: number,
  a1: number,
  b0: number,
  b1: number
): { tA: number; tB: number; point: Point } {
  // Pad the spans slightly so the true contact (which may sit a hair outside the
  // reported flood's extent) is reachable.
  const pad = 0.02;
  let loA = Math.max(0, a0 - pad),
    hiA = Math.min(1, a1 + pad),
    loB = Math.max(0, b0 - pad),
    hiB = Math.min(1, b1 + pad);

  const gap2 = (tA: number, tB: number): number => {
    const pa = edgeAt(a, tA);
    const pb = edgeAt(b, tB);
    const dx = pa.x - pb.x;
    const dy = pa.y - pb.y;
    return dx * dx + dy * dy;
  };

  // Coarse seed.
  let bestA = (loA + hiA) / 2,
    bestB = (loB + hiB) / 2,
    bestD = Infinity;
  const G = 12;
  for (let i = 0; i <= G; i++) {
    const tA = loA + ((hiA - loA) * i) / G;
    for (let j = 0; j <= G; j++) {
      const tB = loB + ((hiB - loB) * j) / G;
      const d = gap2(tA, tB);
      if (d < bestD) {
        bestD = d;
        bestA = tA;
        bestB = tB;
      }
    }
  }

  // Coordinate-descent refine, shrinking the window each pass.
  let win = Math.max(hiA - loA, hiB - loB) / G;
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (const dtA of [-win, win, 0]) {
      for (const dtB of [-win, win, 0]) {
        const tA = clamp01(bestA + dtA);
        const tB = clamp01(bestB + dtB);
        const d = gap2(tA, tB);
        if (d < bestD - 1e-15) {
          bestD = d;
          bestA = tA;
          bestB = tB;
          improved = true;
        }
      }
    }
    if (!improved) win /= 2;
    if (win < 1e-7) break;
  }

  const pa = edgeAt(a, bestA);
  const pb = edgeAt(b, bestB);
  return {
    tA: bestA,
    tB: bestB,
    point: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
  };
}

function subBBox(g: EdgeGeometry, t0: number, t1: number): ReturnType<typeof edgeBBox> {
  // Bounding box of the sub-curve [t0,t1]. Sample a few points (cheap, since the
  // recursion shrinks the interval quickly); include endpoints + midpoint.
  const samples = [t0, (t0 + t1) / 2, t1];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const t of samples) {
    const p = edgeAt(g, t);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Intersect any two edge geometries, dispatching on line vs curve.  Returns
 * parameter pairs (tA on A, tB on B) + snapped points, with endpoint touches
 * included and near-duplicates removed.
 */
export function intersectEdges(a: EdgeGeometry, b: EdgeGeometry): Intersection[] {
  const aCurve = a.control !== null;
  const bCurve = b.control !== null;
  let res: Intersection[];
  if (!aCurve && !bCurve) {
    res = intersectSegSeg(a, b);
  } else if (!aCurve && bCurve) {
    res = intersectSegCurve(a, b);
  } else if (aCurve && !bCurve) {
    res = intersectSegCurve(b, a).map((i) => ({ tA: i.tB, tB: i.tA, point: i.point }));
  } else {
    res = intersectCurveCurve(a, b);
  }
  return dedupe(res);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function boxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return (
    a.minX <= b.maxX + SNAP_EPS &&
    a.maxX >= b.minX - SNAP_EPS &&
    a.minY <= b.maxY + SNAP_EPS &&
    a.maxY >= b.minY - SNAP_EPS
  );
}

function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    // Near-tangent: if essentially zero, report the double root.
    if (disc > -1e-9) return [-b / (2 * a)];
    return [];
  }
  const sq = Math.sqrt(disc);
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
}

function dedupe(list: Intersection[]): Intersection[] {
  const out: Intersection[] = [];
  for (const i of list) {
    let dup = false;
    for (const o of out) {
      if (
        Math.abs(o.point.x - i.point.x) <= SNAP_EPS &&
        Math.abs(o.point.y - i.point.y) <= SNAP_EPS
      ) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(i);
  }
  return out;
}
