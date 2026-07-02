/**
 * P3 — partial selection on the planar mesh: STABLE, serializable references to a
 * fill region (FACE) or a line segment (undirected half-edge run), plus the pure
 * picking functions (click / double-click-connected / marquee) and the inverse
 * resolution back to live face/half-edge ids.
 *
 * WHY GEOMETRY-BASED KEYS. Half-edge and face ids are array indices into a freshly
 * built {@link PlanarShape}; they are NOT stable across a rebuild. But every
 * coordinate is twip-snapped, so a geometry-derived key (an interior point for a
 * face; the two endpoints + midpoint for an edge, via {@link pointKey}) reproduces
 * EXACTLY for the same geometry — making the key serializable and rebuild-stable.
 *
 * All functions here are PURE (operate on a `PlanarShape` + a point/rect) and are
 * unit-testable without React. See docs/36-vector-merge-model.md §3 (P3).
 */

import type { HalfEdge, PlanarFace, PlanarShape, Point, Rect } from "../types.js";
import { edgeAt, pointKey, snapPoint } from "./geometry.js";
import {
  faceBoundaryPolygon,
  faceInteriorPoint,
  locateFace,
  pointInPolygon,
  traceCycle,
} from "./query.js";

/** Samples per half-edge when measuring edge proximity / marquee intersection. */
const EDGE_SAMPLES = 16;

// ---------------------------------------------------------------------------
// Stable key model
// ---------------------------------------------------------------------------

/** A stable, serializable reference to ONE fill region (face) of a merged shape. */
export interface FaceKey {
  readonly kind: "face";
  /** pointKey() of a deterministic interior point of the face. */
  readonly interior: string;
}

/** A stable, serializable reference to ONE undirected edge (line segment). */
export interface SegmentKey {
  readonly kind: "segment";
  /** pointKey() of the two snapped endpoints, sorted (undirected). */
  readonly a: string;
  readonly b: string;
  /** pointKey() of the geometric midpoint — disambiguates curves sharing endpoints. */
  readonly mid: string;
}

export type SubKey = FaceKey | SegmentKey;

/** A partial selection scoped to one merged display object. */
export interface SubSelection {
  /** The merged ShapeDisplayObject id this selection refers to. */
  readonly shapeId: string;
  readonly keys: readonly SubKey[];
}

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

/** Stable key for a face, or `null` for a degenerate/unbounded face. */
export function faceKey(ps: PlanarShape, face: PlanarFace): FaceKey | null {
  const ip = faceInteriorPoint(ps, face);
  if (!ip) return null;
  return { kind: "face", interior: pointKey(snapPoint(ip)) };
}

/** Stable key for an undirected edge (pass either of its twin half-edges). */
export function segmentKey(_ps: PlanarShape, he: HalfEdge): SegmentKey {
  const g = he.geometry;
  const ka = pointKey(snapPoint(g.p0));
  const kb = pointKey(snapPoint(g.p1));
  const [a, b] = ka <= kb ? [ka, kb] : [kb, ka];
  const mid = pointKey(snapPoint(edgeAt(g, 0.5)));
  return { kind: "segment", a, b, mid };
}

// ---------------------------------------------------------------------------
// Key resolution (key -> live id)
// ---------------------------------------------------------------------------

/** Parse a `pointKey` ("x,y" in twips) back to a Point in px. */
function unkey(k: string): Point {
  const [x, y] = k.split(",").map((s) => Number(s) / 20);
  return { x, y };
}

/**
 * Resolve a {@link FaceKey} to a live face id, or -1. First matches the stored
 * interior point exactly; if no face has that exact interior point (a different
 * edit shifted the centroid) falls back to point-in-face containment.
 */
export function resolveFace(ps: PlanarShape, key: FaceKey): number {
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    const fk = faceKey(ps, f);
    if (fk && fk.interior === key.interior) return f.id;
  }
  // Containment fallback.
  const pt = unkey(key.interior);
  const f = locateFace(ps, pt);
  return f ? f.id : -1;
}

/**
 * Resolve a {@link SegmentKey} to a live half-edge id (the lower-id half of the
 * twin pair), or -1.
 */
export function resolveSegment(ps: PlanarShape, key: SegmentKey): number {
  let best = -1;
  for (const he of ps.halfEdges) {
    const sk = segmentKey(ps, he);
    if (sk.a === key.a && sk.b === key.b && sk.mid === key.mid) {
      const id = Math.min(he.id, he.twin);
      if (best < 0 || id < best) best = id;
    }
  }
  if (best >= 0) return best;
  // Endpoint-only fallback (ignore mid) for near-degenerate snaps.
  for (const he of ps.halfEdges) {
    const sk = segmentKey(ps, he);
    if (sk.a === key.a && sk.b === key.b) return Math.min(he.id, he.twin);
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Squared distance from a point to a single half-edge (sampled). */
function distToEdge2(he: HalfEdge, pt: Point): number {
  const g = he.geometry;
  let best = Infinity;
  let prev = g.p0;
  for (let i = 1; i <= EDGE_SAMPLES; i++) {
    const cur = g.control === null && i === EDGE_SAMPLES ? g.p1 : edgeAt(g, i / EDGE_SAMPLES);
    const d = distToSegment2(pt, prev, cur);
    if (d < best) best = d;
    prev = cur;
  }
  return best;
}

/** Squared distance from `p` to the segment a-b. */
function distToSegment2(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * vx;
  const cy = a.y + t * vy;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

/** Whether a half-edge intersects (or lies inside) an axis-aligned rect. */
function edgeIntersectsRect(he: HalfEdge, rect: Rect): boolean {
  const g = he.geometry;
  let prev = g.p0;
  if (pointInRect(prev, rect)) return true;
  for (let i = 1; i <= EDGE_SAMPLES; i++) {
    const cur = g.control === null && i === EDGE_SAMPLES ? g.p1 : edgeAt(g, i / EDGE_SAMPLES);
    if (pointInRect(cur, rect)) return true;
    if (segIntersectsRect(prev, cur, rect)) return true;
    prev = cur;
  }
  return false;
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** Cheap segment-vs-rect overlap test (endpoints + the four rect edges). */
function segIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  const x0 = r.x,
    y0 = r.y,
    x1 = r.x + r.width,
    y1 = r.y + r.height;
  const corners: [Point, Point][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  for (const [c, d] of corners) if (segSegCross(a, b, c, d)) return true;
  return false;
}

function segSegCross(p: Point, p2: Point, q: Point, q2: Point): boolean {
  const d = (p2.x - p.x) * (q2.y - q.y) - (p2.y - p.y) * (q2.x - q.x);
  if (d === 0) return false;
  const t = ((q.x - p.x) * (q2.y - q.y) - (q.y - p.y) * (q2.x - q.x)) / d;
  const u = ((q.x - p.x) * (p2.y - p.y) - (q.y - p.y) * (p2.x - p.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/**
 * Click pick: in authentic Flash 8 a click ON a line selects the line even when
 * it lies over a fill (the stroke renders on top), but a click in the fill body
 * selects the fill region. So we (1) find the nearest stroked half-edge and its
 * distance; if the click is within the stroke's on-ink tolerance (half its width,
 * floored at `tolPx`) we prefer the SEGMENT; (2) otherwise the FACE under the
 * point; (3) otherwise the nearest stroke within `tolPx`; (4) otherwise null.
 */
export function pickAt(ps: PlanarShape, pt: Point, tolPx = 4): SubKey | null {
  // Nearest stroked half-edge + its distance (deduped against the twin).
  let bestHe: HalfEdge | null = null;
  let bestD = Infinity;
  let bestHalfWidth = 0;
  const seen = new Set<number>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    if (seen.has(he.twin)) continue;
    seen.add(he.id);
    const d = distToEdge2(he, pt);
    if (d < bestD) {
      bestD = d;
      bestHe = he;
      const stroke = ps.lineStyles[he.lineStyle];
      bestHalfWidth = stroke ? (stroke.width ?? 1) / 2 : 0;
    }
  }
  const bestDist = Math.sqrt(bestD);

  // (1) On-ink: the click is on the visible stroke -> select the segment first.
  const onInkTol = Math.max(tolPx, bestHalfWidth + 1);
  if (bestHe && bestDist <= onInkTol) {
    return segmentKey(ps, bestHe);
  }

  // (2) Inside a fill region -> the face.
  const f = locateFace(ps, pt);
  if (f) {
    const k = faceKey(ps, f);
    if (k) return k;
  }

  // (3) Near a stroke (but not on a fill) within the general tolerance.
  if (bestHe && bestDist <= tolPx) {
    return segmentKey(ps, bestHe);
  }
  return null;
}

/**
 * Double-click pick: the CONNECTED set of fills + strokes reachable from the face
 * (or segment) under the point — the "fill flood" the user expects. Flood across
 * shared edges where both faces carry the SAME fill (the dissolvable-seam notion),
 * collecting every face in the component + every stroked edge bounding it.
 */
export function pickConnected(ps: PlanarShape, pt: Point): SubKey[] {
  const seed = pickAt(ps, pt);
  if (!seed) return [];

  // Determine the seed face: the picked face, or (for a segment) a bounded face
  // incident to that edge.
  let seedFace = -1;
  if (seed.kind === "face") {
    seedFace = resolveFace(ps, seed);
  } else {
    const heId = resolveSegment(ps, seed);
    if (heId >= 0) {
      const he = ps.halfEdges[heId];
      const fa = ps.faces[he.face];
      const tw = ps.halfEdges[he.twin];
      const fb = ps.faces[tw.face];
      if (fa && !fa.unbounded && fa.fill != null) seedFace = fa.id;
      else if (fb && !fb.unbounded && fb.fill != null) seedFace = fb.id;
      else {
        // Lone segment (no incident fill): select just it + its run of connected
        // collinear-or-touching stroked edges sharing a vertex.
        return strokeRunKeys(ps, heId);
      }
    }
  }
  if (seedFace < 0) return [];

  // BFS over faces across dissolvable same-fill seams.
  const seedFill = ps.faces[seedFace].fill;
  const compFaces = new Set<number>([seedFace]);
  const queue = [seedFace];
  while (queue.length > 0) {
    const fid = queue.pop()!;
    for (const he of ps.halfEdges) {
      if (he.face !== fid) continue;
      const tw = ps.halfEdges[he.twin];
      const tf = ps.faces[tw.face];
      if (!tf || tf.unbounded || tf.fill == null) continue;
      if (tf.fill !== seedFill) continue;
      // Dissolvable seam (no stroke) keeps the same-fill region connected.
      if (he.lineStyle !== null && he.lineStyle !== undefined) continue;
      if (!compFaces.has(tf.id)) {
        compFaces.add(tf.id);
        queue.push(tf.id);
      }
    }
  }

  const keys: SubKey[] = [];
  for (const fid of compFaces) {
    const k = faceKey(ps, ps.faces[fid]);
    if (k) keys.push(k);
  }
  // Plus every stroked edge bounding the component.
  const seen = new Set<number>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    if (seen.has(he.twin) || seen.has(he.id)) continue;
    const tw = ps.halfEdges[he.twin];
    if (compFaces.has(he.face) || compFaces.has(tw.face)) {
      seen.add(he.id);
      keys.push(segmentKey(ps, he));
    }
  }
  return keys;
}

/** A run of stroked edges connected through shared vertices, starting at `heId`. */
function strokeRunKeys(ps: PlanarShape, heId: number): SubKey[] {
  const keys: SubKey[] = [];
  const seen = new Set<number>();
  const stack = [heId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const u = Math.min(id, ps.halfEdges[id].twin);
    if (seen.has(u)) continue;
    seen.add(u);
    const he = ps.halfEdges[id];
    keys.push(segmentKey(ps, he));
    // Neighbours: any stroked half-edge sharing this edge's origin or twin origin.
    const verts = new Set<number>([he.origin, ps.halfEdges[he.twin].origin]);
    for (const other of ps.halfEdges) {
      if (other.lineStyle === null || other.lineStyle === undefined) continue;
      const ou = Math.min(other.id, other.twin);
      if (seen.has(ou)) continue;
      if (verts.has(other.origin) || verts.has(ps.halfEdges[other.twin].origin)) {
        stack.push(other.id);
      }
    }
  }
  return keys;
}

/**
 * Marquee pick: every FACE whose interior point lies in `rect`, plus every line
 * SEGMENT that intersects `rect`.
 */
export function pickInRect(ps: PlanarShape, rect: Rect): SubKey[] {
  const keys: SubKey[] = [];
  for (const f of ps.faces) {
    if (f.unbounded || f.fill == null) continue;
    const ip = faceInteriorPoint(ps, f);
    if (ip && pointInRect(ip, rect)) {
      const k = faceKey(ps, f);
      if (k) keys.push(k);
    }
  }
  const seen = new Set<number>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    if (seen.has(he.twin) || seen.has(he.id)) continue;
    if (edgeIntersectsRect(he, rect)) {
      seen.add(he.id);
      keys.push(segmentKey(ps, he));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Erase Selected Fills — the predicate planarEraseShape's "selected" mode needs
// ---------------------------------------------------------------------------

/**
 * Build the "Erase Selected Fills" face predicate (task 1428): given the LIVE
 * planar map of a merged shape and a partial selection's keys, return a predicate
 * over a stage/kernel-space interior point that is TRUE iff the point lies inside
 * one of the SELECTED fill FACES (outer boundary minus holes). Selected line
 * SEGMENTS never make a fill erasable, matching Flash 8 (Erase Selected Fills
 * leaves strokes untouched). Returns `null` when no fill face is selected, so the
 * caller can treat the whole object as un-erasable.
 *
 * This is the predicate {@link import("./eraser.js").planarEraseShape}'s
 * `"selected"` mode requires: without a caller supplying it, that mode skips EVERY
 * face and is a silent no-op (it erases nothing). The predicate is evaluated
 * against interior points of the eraser's OWN rebuilt arrangement, so it must test
 * geometric CONTAINMENT (not a face-id / interior-key match, which would not
 * survive the eraser's re-split of the selected face).
 */
export function buildSelectedFaceFilter(
  ps: PlanarShape,
  keys: readonly SubKey[]
): ((pt: Point) => boolean) | null {
  const faceKeys = keys.filter((k): k is FaceKey => k.kind === "face");
  if (faceKeys.length === 0) return null;
  const regions: { outer: Point[]; holes: Point[][] }[] = [];
  for (const key of faceKeys) {
    const fid = resolveFace(ps, key);
    if (fid < 0) continue;
    const f = ps.faces[fid];
    regions.push({
      outer: faceBoundaryPolygon(ps, f),
      holes: f.holes.map((h) => traceCycle(ps, h)),
    });
  }
  if (regions.length === 0) return null;
  return (pt: Point): boolean =>
    regions.some(
      (r) => pointInPolygon(pt, r.outer) && !r.holes.some((h) => pointInPolygon(pt, h))
    );
}

// ---------------------------------------------------------------------------
// Overlay geometry (for the selection halo in the UI)
// ---------------------------------------------------------------------------

/**
 * Resolve a sub-selection to drawable polylines (face boundaries + hole loops +
 * edge polylines), for rendering the selection halo. Pure; the UI just strokes
 * the returned point arrays.
 */
export function subSelectionPolylines(ps: PlanarShape, keys: readonly SubKey[]): Point[][] {
  const out: Point[][] = [];
  for (const key of keys) {
    if (key.kind === "face") {
      const fid = resolveFace(ps, key);
      if (fid < 0) continue;
      const f = ps.faces[fid];
      out.push(faceBoundaryPolygon(ps, f));
      for (const h of f.holes) out.push(traceCycle(ps, h));
    } else {
      const heId = resolveSegment(ps, key);
      if (heId < 0) continue;
      const g = ps.halfEdges[heId].geometry;
      const pts: Point[] = [g.p0];
      for (let i = 1; i <= EDGE_SAMPLES; i++) pts.push(edgeAt(g, i / EDGE_SAMPLES));
      out.push(pts);
    }
  }
  return out;
}
