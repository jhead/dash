/**
 * Curve-aware planar geometry primitives.
 *
 * The planar kernel works in twip-snapped pixel coordinates.  Flash's native
 * unit is the TWIP (1/20 px); snapping intersection points and vertices to the
 * twip grid is what makes the arrangement numerically stable — two edges that
 * "should" meet at a shared point are guaranteed to share the EXACT same
 * coordinate after snapping, so vertex merging is an exact integer-key compare
 * rather than an epsilon dance.
 *
 * Curves are quadratic Béziers (Flash's only curve form).  Splitting is
 * CURVE-PRESERVING: de Casteljau subdivision yields two true quadratics, never
 * a polyline.
 */

import type { Point, EdgeGeometry } from "../types.js";

/** Twips per pixel (Flash's internal unit). */
export const TWIPS_PER_PX = 20;

/** Snap a single coordinate to the twip grid. */
export function snapCoord(v: number): number {
  return Math.round(v * TWIPS_PER_PX) / TWIPS_PER_PX;
}

/** Snap a point to the twip grid. */
export function snapPoint(p: Point): Point {
  return { x: snapCoord(p.x), y: snapCoord(p.y) };
}

/** A stable integer key for a twip-snapped point (used to merge coincident vertices). */
export function pointKey(p: Point): string {
  // Multiply by TWIPS_PER_PX and round → integer twip coordinates; `|0` after a
  // +/- offset keeps -0 and +0 identical.
  const tx = Math.round(p.x * TWIPS_PER_PX);
  const ty = Math.round(p.y * TWIPS_PER_PX);
  return `${tx},${ty}`;
}

/** Squared distance between two points. */
export function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** True when two points are equal after twip snapping. */
export function pointsEqual(a: Point, b: Point): boolean {
  return pointKey(a) === pointKey(b);
}

/** Half a twip, in px — the spatial tolerance below which points are "the same". */
export const SNAP_EPS = 0.5 / TWIPS_PER_PX; // 0.025 px

// ---------------------------------------------------------------------------
// Quadratic Bézier evaluation & subdivision
// ---------------------------------------------------------------------------

/** Evaluate a quadratic Bézier p0→c→p1 at parameter t∈[0,1]. */
export function quadAt(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

/** Evaluate an {@link EdgeGeometry} (line or curve) at parameter t∈[0,1]. */
export function edgeAt(g: EdgeGeometry, t: number): Point {
  if (g.control === null) {
    return { x: g.p0.x + (g.p1.x - g.p0.x) * t, y: g.p0.y + (g.p1.y - g.p0.y) * t };
  }
  return quadAt(g.p0, g.control, g.p1, t);
}

/**
 * Tangent direction (unnormalized) of an edge at parameter t.  Used for the
 * angular sort around a vertex (the rotation system of the half-edge graph).
 */
export function edgeTangent(g: EdgeGeometry, t: number): Point {
  if (g.control === null) {
    return { x: g.p1.x - g.p0.x, y: g.p1.y - g.p0.y };
  }
  const mt = 1 - t;
  // d/dt of quadratic = 2(1-t)(c-p0) + 2t(p1-c)
  return {
    x: 2 * mt * (g.control.x - g.p0.x) + 2 * t * (g.p1.x - g.control.x),
    y: 2 * mt * (g.control.y - g.p0.y) + 2 * t * (g.p1.y - g.control.y),
  };
}

/**
 * The outgoing tangent direction at the ORIGIN of a half-edge — the direction
 * the edge leaves its origin vertex.  Robust to a degenerate (zero-length)
 * first derivative at t=0 (a curve whose control coincides with p0): falls back
 * to a small forward sample.
 */
export function outgoingDirection(g: EdgeGeometry): Point {
  let d = edgeTangent(g, 0);
  if (Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12) {
    const s = edgeAt(g, 1e-3);
    d = { x: s.x - g.p0.x, y: s.y - g.p0.y };
  }
  if (Math.abs(d.x) < 1e-12 && Math.abs(d.y) < 1e-12) {
    d = { x: g.p1.x - g.p0.x, y: g.p1.y - g.p0.y };
  }
  return d;
}

/**
 * Split a quadratic Bézier p0→c→p1 at parameter t into two quadratics
 * (de Casteljau).  Returns the new control points and the split point.  This is
 * the curve-preserving primitive: each half is a true quadratic.
 */
export function splitQuad(
  p0: Point,
  c: Point,
  p1: Point,
  t: number
): { mid: Point; c0: Point; c1: Point } {
  const a = lerp(p0, c, t); // control of first half
  const b = lerp(c, p1, t); // control of second half
  const mid = lerp(a, b, t); // split point on the curve
  return { mid, c0: a, c1: b };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Split an {@link EdgeGeometry} at parameter t into two geometries that share
 * the split point.  Lines split into two lines; curves split into two true
 * quadratics (NO polyline flattening).  Coordinates are twip-snapped.
 */
export function splitEdgeGeometry(
  g: EdgeGeometry,
  t: number
): { first: EdgeGeometry; second: EdgeGeometry } {
  if (g.control === null) {
    const mid = snapPoint(edgeAt(g, t));
    return {
      first: { p0: g.p0, control: null, p1: mid },
      second: { p0: mid, control: null, p1: g.p1 },
    };
  }
  const { mid, c0, c1 } = splitQuad(g.p0, g.control, g.p1, t);
  const sMid = snapPoint(mid);
  return {
    first: { p0: g.p0, control: snapPoint(c0), p1: sMid },
    second: { p0: sMid, control: snapPoint(c1), p1: g.p1 },
  };
}

/** Reverse an edge geometry (swap endpoints; control stays). */
export function reverseEdgeGeometry(g: EdgeGeometry): EdgeGeometry {
  return { p0: g.p1, control: g.control, p1: g.p0 };
}

/**
 * Tight bounding box of an edge geometry (curve-aware: includes the bezier
 * extrema, not just the control hull).
 */
export function edgeBBox(g: EdgeGeometry): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Math.min(g.p0.x, g.p1.x);
  let maxX = Math.max(g.p0.x, g.p1.x);
  let minY = Math.min(g.p0.y, g.p1.y);
  let maxY = Math.max(g.p0.y, g.p1.y);
  if (g.control !== null) {
    // Extrema of a quadratic occur at t = (p0 - c) / (p0 - 2c + p1) per axis.
    for (const axis of ["x", "y"] as const) {
      const a = g.p0[axis];
      const c = g.control[axis];
      const b = g.p1[axis];
      const denom = a - 2 * c + b;
      if (Math.abs(denom) > 1e-12) {
        const t = (a - c) / denom;
        if (t > 0 && t < 1) {
          const v = edgeAt(g, t)[axis];
          if (axis === "x") {
            minX = Math.min(minX, v);
            maxX = Math.max(maxX, v);
          } else {
            minY = Math.min(minY, v);
            maxY = Math.max(maxY, v);
          }
        }
      }
    }
  }
  return { minX, minY, maxX, maxY };
}
