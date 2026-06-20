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
import { edgeAt, edgeBBox, quadAt, snapPoint, SNAP_EPS } from "./geometry.js";

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
  const out: Intersection[] = [];
  recurse(curveA, curveB, 0, 1, 0, 1, 0, out);
  // Dedupe near-equal results (subdivision can report a crossing twice).
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
