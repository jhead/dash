/**
 * Vector eraser — Flash 8 "erase" geometry.
 *
 * Flash 8's Eraser tool (in its default Normal / Erase-Fills / Erase-Lines
 * modes) does NOT delete the whole shape it touches.  It boolean-SUBTRACTS the
 * area painted over by the eraser from the shape's fill (and, for strokes, cuts
 * the stroke where the eraser crosses it), splitting or reshaping the vector and
 * leaving the rest of the shape intact.  Only the Faucet mode deletes a whole
 * fill/line on a single click.
 *
 * This module implements the pure, testable geometry of that subtraction:
 *
 *   - `buildEraserPolygon` — turns an eraser drag (a path of points + a radius)
 *     into a set of closed polygons: one disk per sample plus a bridging capsule
 *     rectangle between consecutive samples (NOT pre-unioned — `eraseShape`
 *     subtracts them cumulatively).  The polygons are in the same coordinate
 *     space as the points handed in.
 *   - `subtractPolygon` — a real polygon boolean SUBTRACT (Greiner–Hormann with
 *     degeneracy perturbation) of a clip polygon from a subject polygon,
 *     returning zero or more result loops (a difference can split one loop into
 *     several, or punch a hole — represented as multiple loops the renderer's
 *     non-zero winding rule cuts against each other).
 *   - `eraseShape` — applies the subtraction to a whole `Shape`, operating per
 *     `ShapePath`: fill paths are subtracted, stroke-only paths are cut.  Returns
 *     a new `Shape` with the surviving geometry, or `null` when nothing remains
 *     (the caller should then delete the display object — the genuine
 *     "fully-covered" case, equivalent to Flash's whole-shape erase).
 *
 * BEZIER NOTE: closed-loop fills are flattened to polylines for the boolean op
 * (quadratic Béziers sampled to chords).  The result is emitted as straight-line
 * `ShapePath` segments.  This matches Flash, which likewise produces a polygonal
 * cut edge along the eraser path; the un-erased portions of a curve are
 * preserved as a fine polyline so the visible silhouette is unchanged.
 */

import type { Point, Shape, ShapePath, PathSegment } from "./types.js";

// ---------------------------------------------------------------------------
// Eraser polygon construction
// ---------------------------------------------------------------------------

/** Number of segments used to approximate each disk in the eraser sweep. */
const DISK_SEGMENTS = 24;

/**
 * Build the eraser "stamp" polygon for a single disk of `radius` at `center`.
 */
function diskPolygon(center: Point, radius: number, segments = DISK_SEGMENTS): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

/**
 * Build the eraser polygons for a drag: one disk of `radius` per sample point
 * plus a bridging capsule rectangle between consecutive samples, so a fast drag
 * (sparse samples) still erases a continuous band.  Returned as an array of
 * closed loops; `eraseShape` subtracts each from the running survivors in turn,
 * so they compose without a numerically-fragile polygon-union pre-pass.  A
 * single click (one point) yields one disk.
 */
export function buildEraserPolygon(points: readonly Point[], radius: number): Point[][] {
  if (points.length === 0 || radius <= 0) return [];

  // Emit one disk per sample plus a bridging capsule rectangle between
  // consecutive samples.  We deliberately DO NOT union these into a single hull:
  // `eraseShape` subtracts each eraser loop from the running survivors in turn,
  // so overlapping loops compose into a continuous erased band without needing a
  // (numerically fragile) polygon-union pre-pass.  A single click → one disk.
  const loops: Point[][] = [diskPolygon(points[0], radius)];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const bridge = capsuleRect(a, b, radius);
    if (bridge) loops.push(bridge);
    loops.push(diskPolygon(b, radius));
  }
  return loops;
}

/**
 * The rectangle (oriented) connecting two disk centers, width 2*radius — the
 * straight body of the capsule between consecutive eraser samples.  Returns null
 * for a zero-length segment.
 */
function capsuleRect(a: Point, b: Point, radius: number): Point[] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = (-dy / len) * radius;
  const ny = (dx / len) * radius;
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

// ---------------------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------------------

function signedArea(poly: readonly Point[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function centroid(poly: readonly Point[]): Point {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

function pointInPolygon(pt: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function bbox(poly: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function bboxOverlap(
  a: ReturnType<typeof bbox>,
  b: ReturnType<typeof bbox>
): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// ---------------------------------------------------------------------------
// Greiner–Hormann polygon boolean
// ---------------------------------------------------------------------------
//
// A compact Greiner–Hormann implementation specialised to the DIFFERENCE
// (subject − clip) the eraser needs.  Subject and clip polygons are represented
// as doubly-linked vertex rings; intersection vertices are inserted, classified
// entry/exit, and the result is traced.
//
// Degenerate configurations (a vertex of one polygon lying exactly on an edge of
// the other, or no proper crossings) are avoided by perturbing the clip polygon
// by a tiny deterministic epsilon when the naive trace finds no intersections —
// and by falling back to containment logic when the two polygons do not cross at
// all.

interface GHVertex {
  x: number;
  y: number;
  next: GHVertex;
  prev: GHVertex;
  // Counterpart on the other polygon (for intersection vertices).
  neighbour?: GHVertex;
  intersect: boolean;
  entry: boolean;
  visited: boolean;
  alpha: number; // position along the edge for sorting inserted intersections
}

function buildRing(poly: readonly Point[]): GHVertex {
  const verts: GHVertex[] = poly.map((p) => ({
    x: p.x,
    y: p.y,
    next: null as unknown as GHVertex,
    prev: null as unknown as GHVertex,
    intersect: false,
    entry: false,
    visited: false,
    alpha: 0,
  }));
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    verts[i].next = verts[(i + 1) % n];
    verts[i].prev = verts[(i - 1 + n) % n];
  }
  return verts[0];
}

function* ringVerts(start: GHVertex): Generator<GHVertex> {
  let v = start;
  do {
    yield v;
    v = v.next;
  } while (v !== start);
}

/** Segment-segment intersection returning alpha/beta params, or null. */
function segIntersect(
  p1: GHVertex, p2: GHVertex,
  q1: GHVertex, q2: GHVertex
): { x: number; y: number; alpha: number; beta: number } | null {
  const r_x = p2.x - p1.x, r_y = p2.y - p1.y;
  const s_x = q2.x - q1.x, s_y = q2.y - q1.y;
  const denom = r_x * s_y - r_y * s_x;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const qpx = q1.x - p1.x, qpy = q1.y - p1.y;
  const t = (qpx * s_y - qpy * s_x) / denom;
  const u = (qpx * r_y - qpy * r_x) / denom;
  // Use a half-open-ish interval to dodge endpoint degeneracies (perturbation
  // handles the rest).
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: p1.x + t * r_x, y: p1.y + t * r_y, alpha: t, beta: u };
}

function insertIntersection(after: GHVertex, before: GHVertex, iv: GHVertex, alpha: number): void {
  // Insert iv into the ring between `after` and `before`, ordered by alpha among
  // existing intersection vertices already inserted on this edge.
  let cur = after.next;
  while (cur !== before && cur.intersect && cur.alpha < alpha) {
    cur = cur.next;
  }
  iv.prev = cur.prev;
  iv.next = cur;
  cur.prev.next = iv;
  cur.prev = iv;
}

/**
 * Core Greiner–Hormann DIFFERENCE trace for subject − clip.  Returns result
 * loops, or null if no proper intersections were found (caller falls back to
 * containment logic).  Both inputs must be wound CCW.
 */
function greinerHormann(
  subjectPoly: readonly Point[],
  clipPoly: readonly Point[]
): Point[][] | null {
  const subject = buildRing(subjectPoly);
  const clip = buildRing(clipPoly);

  // --- Phase 1: find & insert intersections ---
  let anyIntersection = false;
  const subjVerts = [...ringVerts(subject)].filter((v) => !v.intersect);
  const clipVerts = [...ringVerts(clip)].filter((v) => !v.intersect);

  // Capture each original edge's endpoint pair BEFORE any insertion: inserting an
  // intersection mutates `.next`, so re-reading `c.next` inside the loop would
  // shorten an edge that still has further crossings to find (it would drop the
  // 2nd, 3rd … crossing on the same edge — e.g. a band cutting clean through a
  // rect: 4 true crossings but only 3 detected).
  const subjNext = new Map<GHVertex, GHVertex>(subjVerts.map((v) => [v, v.next]));
  const clipNext = new Map<GHVertex, GHVertex>(clipVerts.map((v) => [v, v.next]));

  for (const s of subjVerts) {
    const s2 = subjNext.get(s)!;
    for (const c of clipVerts) {
      const c2 = clipNext.get(c)!;
      const hit = segIntersect(s, s2, c, c2);
      if (!hit) continue;
      anyIntersection = true;
      const sv: GHVertex = {
        x: hit.x, y: hit.y, next: null as unknown as GHVertex, prev: null as unknown as GHVertex,
        intersect: true, entry: false, visited: false, alpha: hit.alpha,
      };
      const cv: GHVertex = {
        x: hit.x, y: hit.y, next: null as unknown as GHVertex, prev: null as unknown as GHVertex,
        intersect: true, entry: false, visited: false, alpha: hit.beta,
      };
      sv.neighbour = cv;
      cv.neighbour = sv;
      insertIntersection(s, s2, sv, hit.alpha);
      insertIntersection(c, c2, cv, hit.beta);
    }
  }

  if (!anyIntersection) return null;

  // --- Phase 2: mark entry/exit ---
  // For DIFFERENCE (subject − clip): on the subject we enter the result when we
  // cross from inside-clip to outside-clip; on the clip we traverse it reversed.
  markEntryExit(subject, clipPoly, "subject");
  markEntryExit(clip, subjectPoly, "clip");

  // --- Phase 3: trace result loops ---
  // Canonical Greiner–Hormann trace.  Begin at each unvisited intersection on
  // the SUBJECT ring; walk forward (entry) or backward (exit) to the next
  // intersection, emit the vertices, then jump to the neighbour on the other
  // ring and continue until we return to the start of this loop.
  const result: Point[][] = [];
  let guard = 0;
  const maxSteps = 1_000_000;
  for (const startCandidate of ringVerts(subject)) {
    if (!startCandidate.intersect || startCandidate.visited) continue;
    const loop: Point[] = [];
    let cur: GHVertex = startCandidate;
    loop.push({ x: cur.x, y: cur.y });
    do {
      // Mark BOTH copies of this intersection visited (they are the same point
      // on the two rings) so neither restarts a new loop.
      cur.visited = true;
      if (cur.neighbour) cur.neighbour.visited = true;

      if (cur.entry) {
        do {
          cur = cur.next;
          loop.push({ x: cur.x, y: cur.y });
          if (++guard > maxSteps) return result;
        } while (!cur.intersect);
      } else {
        do {
          cur = cur.prev;
          loop.push({ x: cur.x, y: cur.y });
          if (++guard > maxSteps) return result;
        } while (!cur.intersect);
      }
      // Reached an intersection on the current ring; jump to its neighbour to
      // continue on the other ring.
      cur.visited = true;
      cur = cur.neighbour!;
      if (++guard > maxSteps) return result;
    } while (cur.neighbour !== startCandidate && cur !== startCandidate);
    // Drop the duplicated closing vertex if present.
    if (loop.length >= 2) {
      const f = loop[0], l = loop[loop.length - 1];
      if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) loop.pop();
    }
    if (loop.length >= 3) result.push(loop);
  }

  return result;
}

function markEntryExit(
  ringStart: GHVertex,
  otherPoly: readonly Point[],
  which: "subject" | "clip"
): void {
  // status = whether the current position is inside the other polygon.
  // Start status from the first non-intersection vertex.
  let firstReal: GHVertex | null = null;
  for (const v of ringVerts(ringStart)) {
    if (!v.intersect) { firstReal = v; break; }
  }
  if (!firstReal) return;

  let inside = pointInPolygon(firstReal, otherPoly);

  // Greiner–Hormann entry/exit convention for DIFFERENCE (A − B), both rings
  // CCW, standard trace (entry⇒walk forward, exit⇒walk backward): keep the parts
  // of the subject OUTSIDE the clip and the parts of the clip INSIDE the subject
  // (so the clip arcs carve the boundary).  Empirically the subject ring uses
  // `inside`, the clip ring uses `!inside`.
  const useInside = which === "subject";

  for (const v of ringVerts(firstReal)) {
    if (v.intersect) {
      // `inside` is the state on the edge ARRIVING at this crossing; after the
      // crossing we flip. The entry flag marks "this crossing enters the kept
      // region for this ring".
      v.entry = useInside ? inside : !inside;
      inside = !inside;
    }
  }
}

// ---------------------------------------------------------------------------
// Public boolean wrappers with degeneracy / containment fallbacks
// ---------------------------------------------------------------------------

/** Perturb a polygon by a tiny deterministic offset to break degeneracies. */
function perturb(poly: readonly Point[], eps: number): Point[] {
  return poly.map((p, i) => ({
    x: p.x + Math.cos(i * 2.399963) * eps,
    y: p.y + Math.sin(i * 2.399963) * eps,
  }));
}

/**
 * subject − clip.  Returns the surviving loops (CCW/CW preserved as emitted).
 * Handles the three no-crossing cases:
 *   - clip fully outside subject → subject unchanged
 *   - clip fully contains subject → empty (everything erased)
 *   - clip strictly inside subject (a hole) → subject + reversed clip (hole)
 */
export function subtractPolygon(subjectIn: readonly Point[], clipIn: readonly Point[]): Point[][] {
  if (subjectIn.length < 3) return [];
  if (clipIn.length < 3) return [subjectIn.slice()];

  const sBox = bbox(subjectIn);
  const cBox = bbox(clipIn);
  if (!bboxOverlap(sBox, cBox)) return [subjectIn.slice()];

  // The Greiner–Hormann entry/exit formulas assume BOTH polygons are wound CCW.
  // Normalize, run, then restore the output to the subject's original winding so
  // the renderer's fill direction is unchanged.
  const subjectWasCCW = signedArea(subjectIn) > 0;
  const subject = orient(subjectIn, true);
  const clip = orient(clipIn, true);

  const finish = (loopsIn: Point[][]): Point[][] => {
    const loops = loopsIn.filter(
      (loop) => loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-6
    );
    // Classify each loop as outer (kept region) or hole by containment: a loop
    // whose centroid lies inside an ODD number of OTHER loops is a hole.  Outer
    // loops take the subject's original winding; holes take the opposite so the
    // renderer's non-zero winding rule cuts them out.
    return loops.map((loop) => {
      const c = centroid(loop);
      let enclosing = 0;
      for (const other of loops) {
        if (other === loop) continue;
        if (pointInPolygon(c, other)) enclosing++;
      }
      const isHole = enclosing % 2 === 1;
      return orient(loop, isHole ? !subjectWasCCW : subjectWasCCW);
    });
  };

  // A valid difference trace must yield an even number of crossings on each
  // ring; a degenerate (vertex-on-edge / collinear) configuration can drop a
  // crossing and produce a null or empty/garbage trace.  Detect that and retry
  // on a tiny perturbed clip until the result is sane.
  const expectedArea = Math.abs(signedArea(subject)); // upper bound on survivor
  const looksSane = (loops: Point[][] | null): boolean => {
    if (loops === null) return false;
    if (loops.length === 0) return false; // overlapping clip should leave/remove something detectably
    const total = loops.reduce((a, l) => a + Math.abs(signedArea(l)), 0);
    return total <= expectedArea * 1.05 + 1e-6;
  };

  let res = greinerHormann(subject, clip);
  if (!looksSane(res)) {
    for (const eps of [1e-4, 7e-4, 3e-3, 1.3e-2, 5.1e-2]) {
      const attempt = greinerHormann(subject, perturb(clip, eps));
      if (looksSane(attempt)) { res = attempt; break; }
      if (res === null && attempt !== null) res = attempt;
    }
  }

  if (res === null || res.length === 0) {
    // Genuinely no crossing → containment logic.
    const clipInSubject = pointInPolygon(clip[0], subject);
    const subjectInClip = pointInPolygon(subject[0], clip);
    if (subjectInClip && !clipInSubject) {
      // Subject entirely inside clip → erased completely.
      return [];
    }
    if (clipInSubject) {
      // Clip is a hole inside subject: emit subject (original winding) + clip
      // wound OPPOSITE so the non-zero winding rule cuts the hole out.
      const hole = orient(clip, !subjectWasCCW);
      return [subjectIn.slice(), hole];
    }
    // Disjoint.
    return [subjectIn.slice()];
  }

  // GH difference returns the kept (outer) loops CCW and hole loops CW; restore
  // the outer loops to the subject's original winding and keep holes opposite.
  return finish(res);
}

/** Orient a polygon CCW (ccw=true) or CW (ccw=false). */
function orient(poly: readonly Point[], ccw: boolean): Point[] {
  const isCCW = signedArea(poly) > 0;
  return isCCW === ccw ? poly.slice() : poly.slice().reverse();
}

// ---------------------------------------------------------------------------
// ShapePath <-> polygon
// ---------------------------------------------------------------------------

/** Samples per quadratic-Bézier segment when flattening a path to a polygon. */
const CURVE_SAMPLES = 12;

/** Flatten a ShapePath to a closed polygon of points. */
export function pathToPolygon(path: ShapePath, samplesPerCurve = CURVE_SAMPLES): Point[] {
  const pts: Point[] = [{ x: path.start.x, y: path.start.y }];
  let prev = path.start;
  for (const seg of path.segments) {
    if (seg.type === "line") {
      pts.push({ x: seg.to.x, y: seg.to.y });
    } else {
      const cp = seg.control;
      for (let s = 1; s <= samplesPerCurve; s++) {
        const t = s / samplesPerCurve;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * prev.x + 2 * mt * t * cp.x + t * t * seg.to.x,
          y: mt * mt * prev.y + 2 * mt * t * cp.y + t * t * seg.to.y,
        });
      }
    }
    prev = seg.to;
  }
  // Drop a duplicate trailing point equal to start.
  if (pts.length > 1) {
    const last = pts[pts.length - 1];
    if (Math.abs(last.x - pts[0].x) < 1e-9 && Math.abs(last.y - pts[0].y) < 1e-9) {
      pts.pop();
    }
  }
  return pts;
}

/** Build a ShapePath (line segments) from a closed polygon, copying styling. */
function polygonToPath(poly: readonly Point[], template: ShapePath): ShapePath {
  const segments: PathSegment[] = [];
  for (let i = 1; i < poly.length; i++) {
    segments.push({ type: "line", to: { x: poly[i].x, y: poly[i].y } });
  }
  // Close back to start.
  segments.push({ type: "line", to: { x: poly[0].x, y: poly[0].y } });
  return {
    start: { x: poly[0].x, y: poly[0].y },
    segments,
    fill: template.fill,
    stroke: template.stroke,
    closed: true,
  };
}

// ---------------------------------------------------------------------------
// eraseShape — the StageArea-facing entry point
// ---------------------------------------------------------------------------

export interface EraseOptions {
  /** Erase fill geometry (default true). */
  readonly fills?: boolean;
  /** Erase stroke geometry (default true). */
  readonly strokes?: boolean;
}

/**
 * Subtract the eraser region (one or more closed polygons, in the SHAPE's local
 * coordinate space) from `shape`, returning a new Shape with the surviving
 * geometry — or `null` when nothing of the shape survives (caller deletes the
 * display object).
 *
 * Per-path behaviour:
 *   - Fill paths: boolean-subtract the eraser polygons from the closed fill
 *     loop; the result may be 0 loops (fully erased), 1 loop (reshaped), or
 *     several loops (split / holed).
 *   - Stroke-only paths: subtract as a thin region too (cut where the eraser
 *     crosses), preserving surviving sub-loops.  If an eraser fully covers the
 *     stroke path's bbox it is removed.
 */
export function eraseShape(
  shape: Shape,
  eraserLoops: readonly (readonly Point[])[],
  opts: EraseOptions = {}
): Shape | null {
  const eraseFills = opts.fills ?? true;
  const eraseStrokes = opts.strokes ?? true;
  if (eraserLoops.length === 0) return shape;

  const out: ShapePath[] = [];

  for (const path of shape.paths) {
    const isFill = path.fill !== undefined;
    const isStroke = !isFill && path.stroke !== undefined;

    if (isFill && !eraseFills) {
      out.push(path);
      continue;
    }
    if (isStroke && !eraseStrokes) {
      out.push(path);
      continue;
    }

    const poly = pathToPolygon(path);
    if (poly.length < 3) {
      out.push(path);
      continue;
    }

    // Subtract every eraser loop in turn; the survivors feed the next eraser
    // loop so multi-disk gestures cut cumulatively.
    let survivors: Point[][] = [poly];
    for (const eraser of eraserLoops) {
      if (eraser.length < 3) continue;
      const next: Point[][] = [];
      for (const s of survivors) {
        next.push(...subtractPolygon(s, eraser));
      }
      survivors = next;
      if (survivors.length === 0) break;
    }

    for (const loop of survivors) {
      out.push(polygonToPath(loop, path));
    }
  }

  if (out.length === 0) return null;
  return { ...shape, paths: out };
}
