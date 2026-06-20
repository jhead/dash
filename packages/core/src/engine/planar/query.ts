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
 */
export function planarShapeToShape(ps: PlanarShape, id: string): Shape {
  const paths: ShapePath[] = [];

  // Fill-index of the face on a half-edge's LEFT (its incident face).
  const faceFillOf = (faceId: number): number | null => {
    const f = ps.faces[faceId];
    return f && !f.unbounded ? f.fill ?? null : null;
  };

  // --- Fills: trace the BOUNDARY of each same-fill region, dissolving interior
  //     seams (a half-edge whose left face and right face carry the SAME fill is
  //     an interior seam between same-color faces — it disappears, realizing
  //     same-color union as a single boundary loop). We walk boundary half-edges
  //     (left fill = F, right fill != F) following `next`, which already skips
  //     dissolved seams because `next` stays within the same incident face... but
  //     to cross face-to-face within a same-fill region we instead follow the
  //     boundary using a region-aware walk below.
  //
  // Group faces by fill, then per fill collect the set of boundary half-edges
  // (left = this fill, twin's face fill != this fill) and chain them into loops.
  const fillFaces = new Map<number, Set<number>>();
  for (const f of ps.faces) {
    if (f.unbounded || f.fill === null || f.fill === undefined) continue;
    let s = fillFaces.get(f.fill);
    if (!s) { s = new Set(); fillFaces.set(f.fill, s); }
    s.add(f.id);
  }

  const fillIndices = [...fillFaces.keys()].sort((a, b) => a - b);
  for (const fi of fillIndices) {
    const fill = ps.fills[fi];
    if (!fill) continue;
    const facesOfFill = fillFaces.get(fi)!;

    // Boundary half-edges of this fill region: the incident (left) face has fill
    // fi, and the half-edge across the twin does NOT belong to the same fill.
    const isBoundary = (he: HalfEdge): boolean => {
      if (!facesOfFill.has(he.face)) return false;
      const twin = ps.halfEdges[he.twin];
      const twinFill = faceFillOf(twin.face);
      return twinFill !== fi;
    };

    const remaining = new Set<number>();
    for (const he of ps.halfEdges) if (isBoundary(he)) remaining.add(he.id);

    // Chain boundary half-edges into closed loops. From a boundary half-edge,
    // the next boundary half-edge is found by rotating around the shared vertex:
    // follow `next` until we land on another boundary half-edge of this fill
    // (this hops across interior seams to stay on the region's true silhouette).
    while (remaining.size > 0) {
      const startId = remaining.values().next().value as number;
      const loop: EdgeGeometry[] = [];
      let cur = startId;
      let guard = 0;
      do {
        remaining.delete(cur);
        loop.push(ps.halfEdges[cur].geometry);
        // Advance to the next boundary half-edge: walk `next` (which stays in the
        // incident face) — if that is a boundary edge, take it; otherwise keep
        // rotating via successive `next` (crossing same-fill interior seams).
        let step = ps.halfEdges[cur].next;
        let inner = 0;
        while (step >= 0 && !isBoundary(ps.halfEdges[step])) {
          // Cross the interior seam: jump to the twin's `next` to continue along
          // the outer silhouette of the same-fill region.
          step = ps.halfEdges[ps.halfEdges[step].twin].next;
          if (++inner > ps.halfEdges.length + 5) break;
        }
        cur = step;
        if (++guard > ps.halfEdges.length + 5) break;
      } while (cur !== startId && cur >= 0 && remaining.has(cur));
      // Close: if we returned to start (or ran into an already-consumed edge),
      // emit the loop.
      const path = edgeGeometriesToShapePath(loop, fill);
      if (path) paths.push(path);
    }
  }

  // --- Strokes: one open path per undirected line-styled edge ---
  const seenStroke = new Set<number>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    if (seenStroke.has(he.id) || seenStroke.has(he.twin)) continue;
    seenStroke.add(he.id);
    const stroke = ps.lineStyles[he.lineStyle];
    if (!stroke) continue;
    const g = he.geometry;
    paths.push({
      start: g.p0,
      segments: [g.control === null ? { type: "line", to: g.p1 } : { type: "curve", control: g.control, to: g.p1 }],
      closed: false,
      stroke,
    });
  }

  return { id, paths };
}
