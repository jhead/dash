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
      if (inside(mid)) return mid;
      if (--budget <= 0) return null;
    }
  }
  // No interior point found. Return null rather than the centroid, which was
  // already PROVEN OUTSIDE the face via inside(...) above. Returning a
  // proven-outside point is strictly worse than null: it mis-classifies the
  // face's fill (assignFaceFillsBySampling in build.ts samples it against the
  // draw-order regions and can match a DIFFERENT region) and yields an unstable
  // faceKey / pickInRect selection (subselection.ts). Every caller already
  // handles a null return safely.
  return null;
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
