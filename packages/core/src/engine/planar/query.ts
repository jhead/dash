/**
 * Queries over a built {@link PlanarShape}: point-in-face, face area (shoelace),
 * Euler invariant, and conversions between the per-path {@link Shape} model and
 * the arrangement.
 */

import type {
  EdgeGeometry,
  HalfEdge,
  PlanarFace,
  PlanarShape,
  Point,
  Shape,
  ShapePath,
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
  const inside = (pt: Point): boolean => {
    if (!pointInPolygon(pt, poly)) return false;
    for (const h of face.holes) if (pointInPolygon(pt, traceCycle(ps, h))) return false;
    return true;
  };
  if (inside({ x: cx, y: cy })) return { x: cx, y: cy };
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
      if (inside({ x, y })) return { x, y };
    }
  }
  return { x: cx, y: cy };
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
