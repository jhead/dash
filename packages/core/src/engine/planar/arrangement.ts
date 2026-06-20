/**
 * Half-edge planar subdivision (arrangement) builder.
 *
 * The arrangement is a doubly-connected edge list (DCEL).  You insert directed
 * edges (lines or quadratic curves); the builder splits each new edge — and any
 * existing edge it crosses — at every intersection point, snaps all coordinates
 * to the twip grid, merges coincident vertices exactly, builds the rotation
 * system around each vertex (the cyclic order of incident half-edges by outgoing
 * angle), links `next`/`prev` to form face boundaries, and extracts the faces.
 *
 * Curves are CURVE-PRESERVING throughout: an edge cut at parameter t is split
 * with de Casteljau (geometry.ts `splitEdgeGeometry`), so each resulting
 * half-edge carries a true quadratic, never a polyline.
 *
 * Coordinate stability follows the eraser's hard-won lesson (engine/eraser.ts):
 * snap everything to a fixed grid (here, twips) so "should-be-shared" points
 * become EXACTLY shared, turning the fragile epsilon vertex-merge into an exact
 * integer-key compare.  Genuine numeric ties in the angular sort are broken
 * deterministically.
 */

import type {
  EdgeGeometry,
  Fill,
  HalfEdge,
  PlanarFace,
  PlanarShape,
  PlanarVertex,
  Point,
  Stroke,
} from "../types.js";
import {
  edgeAt,
  outgoingDirection,
  pointKey,
  reverseEdgeGeometry,
  snapPoint,
} from "./geometry.js";
import { intersectEdges } from "./intersect.js";

/** A directed input edge handed to the arrangement. */
export interface InputEdge {
  readonly geometry: EdgeGeometry;
  /** Fill on the LEFT of travel (style index), or null. */
  readonly fillLeft?: number | null;
  /** Fill on the RIGHT of travel (style index), or null. */
  readonly fillRight?: number | null;
  /** Line-style index, or null for no stroke. */
  readonly lineStyle?: number | null;
}

interface MutVertex {
  id: number;
  point: Point;
  /** Outgoing half-edge ids, kept sorted by outgoing angle (CCW). */
  outgoing: number[];
}

interface MutHalfEdge {
  id: number;
  origin: number; // vertex id
  twin: number; // half-edge id
  next: number;
  prev: number;
  face: number;
  geometry: EdgeGeometry;
  fillLeft: number | null;
  fillRight: number | null;
  lineStyle: number | null;
}

export class Arrangement {
  private vertices: MutVertex[] = [];
  private edges: MutHalfEdge[] = [];
  /** Maps a snapped-point key to a vertex id. */
  private vertexByKey = new Map<string, number>();
  /** Style tables. */
  readonly fills: Fill[];
  readonly lineStyles: Stroke[];

  constructor(fills: Fill[] = [], lineStyles: Stroke[] = []) {
    this.fills = fills;
    this.lineStyles = lineStyles;
  }

  // -- vertex management ---------------------------------------------------

  private getOrCreateVertex(p: Point): number {
    const sp = snapPoint(p);
    const key = pointKey(sp);
    const existing = this.vertexByKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.vertices.length;
    this.vertices.push({ id, point: sp, outgoing: [] });
    this.vertexByKey.set(key, id);
    return id;
  }

  // -- raw edge creation (no splitting) ------------------------------------

  /**
   * Create a twin pair of half-edges for an undirected edge between snapped
   * endpoints `aId`→`bId` with geometry `geom` (oriented a→b).  Returns the
   * forward half-edge id.  Does NOT register intersections.
   */
  /**
   * Find an existing undirected edge that is geometrically COINCIDENT with the
   * directed edge `aId→bId` (`geom`): same two endpoints (in either order) and
   * matching curve control. Returns the forward half-edge whose direction is
   * `aId→bId` (i.e. the half-edge that travels the same way as `geom`), or null.
   *
   * This is what makes collinear/coincident overlapping segments — e.g. the
   * shared top/bottom edges of two axis-aligned overlapping rectangles — merge
   * into ONE edge instead of producing a duplicate that breaks face tracing.
   */
  private findCoincidentHalfEdge(aId: number, bId: number, geom: EdgeGeometry): MutHalfEdge | null {
    const ctrlKey = (g: EdgeGeometry): string => (g.control === null ? "L" : pointKey(g.control));
    const wantCtrl = ctrlKey(geom);
    for (const heId of this.vertices[aId].outgoing) {
      const he = this.edges[heId];
      if (he.origin !== aId) continue;
      const twin = this.edges[he.twin];
      if (twin.origin !== bId) continue;
      // Endpoints match in the a→b direction; verify the curve control matches
      // (a straight edge and a curve between the same endpoints are distinct).
      if (ctrlKey(he.geometry) === wantCtrl) return he;
    }
    return null;
  }

  private addTwinPair(
    aId: number,
    bId: number,
    geom: EdgeGeometry,
    fillLeft: number | null,
    fillRight: number | null,
    lineStyle: number | null
  ): number {
    // Coincident-edge merge: if an undirected edge already runs a→b with the
    // same geometry, fold the new labels into it rather than adding a duplicate.
    // Fill labels combine "last non-null wins" (the later/topmost contributor's
    // fill takes the side it covers); line styles prefer any non-null. The
    // final per-face fill is re-resolved by interior sampling in build.ts, so
    // this label-merge only needs to keep the topology single-edged.
    const existing = this.findCoincidentHalfEdge(aId, bId, geom);
    if (existing) {
      const twin = this.edges[existing.twin];
      if (fillLeft !== null) existing.fillLeft = fillLeft;
      if (fillRight !== null) existing.fillRight = fillRight;
      // Twin sees swapped sides.
      if (fillRight !== null) twin.fillLeft = fillRight;
      if (fillLeft !== null) twin.fillRight = fillLeft;
      if (lineStyle !== null) {
        existing.lineStyle = lineStyle;
        twin.lineStyle = lineStyle;
      }
      return existing.id;
    }

    const fwdId = this.edges.length;
    const revId = fwdId + 1;
    const fwd: MutHalfEdge = {
      id: fwdId,
      origin: aId,
      twin: revId,
      next: -1,
      prev: -1,
      face: -1,
      geometry: geom,
      fillLeft,
      fillRight,
      lineStyle,
    };
    const rev: MutHalfEdge = {
      id: revId,
      origin: bId,
      twin: fwdId,
      next: -1,
      prev: -1,
      face: -1,
      geometry: reverseEdgeGeometry(geom),
      // The reverse half-edge swaps left/right.
      fillLeft: fillRight,
      fillRight: fillLeft,
      lineStyle,
    };
    this.edges.push(fwd, rev);
    this.vertices[aId].outgoing.push(fwdId);
    this.vertices[bId].outgoing.push(revId);
    return fwdId;
  }

  // -- public: insert an edge with full splitting --------------------------

  /**
   * Insert a directed edge into the arrangement, splitting it and every existing
   * edge it crosses at all intersection points (curve-preserving).  This is the
   * incremental arrangement-construction primitive.
   */
  insertEdge(input: InputEdge): void {
    const fillLeft = input.fillLeft ?? null;
    const fillRight = input.fillRight ?? null;
    const lineStyle = input.lineStyle ?? null;

    // Snap the input endpoints/control up front.
    let geom: EdgeGeometry = {
      p0: snapPoint(input.geometry.p0),
      control: input.geometry.control ? snapPoint(input.geometry.control) : null,
      p1: snapPoint(input.geometry.p1),
    };
    // Degenerate zero-length edge: ignore.
    if (pointKey(geom.p0) === pointKey(geom.p1) && geom.control === null) return;

    // 1. Find all intersection parameters of this edge against existing edges,
    //    and the splits each existing edge needs.  We collect splits per
    //    existing FORWARD half-edge (process undirected edges once via even ids).
    const newSplitParams = new Set<number>(); // params on the NEW edge
    // existingEdgeId (forward) -> set of params to split it at
    const existingSplits = new Map<number, Set<number>>();

    const forwardIds: number[] = [];
    for (let i = 0; i < this.edges.length; i += 2) forwardIds.push(i);

    for (const eid of forwardIds) {
      const e = this.edges[eid];
      // Skip RETIRED half-edges: splitExistingEdge marks a split-away edge with
      // origin=-1 but leaves it in the array (to keep the even/odd twin pairing).
      // Its geometry is stale; intersecting the new edge against it produces
      // SPURIOUS split params that corrupt the topology when a later edge crosses
      // the same region (e.g. a second parallel chord / an eraser band's two
      // sides both crossing a fill's boundary edge). Skip them. (task 1322)
      if (e.origin < 0) continue;
      const hits = intersectEdges(geom, e.geometry);
      for (const h of hits) {
        // Only register interior splits; endpoints become shared vertices
        // automatically when we create the new edge's vertices.
        if (h.tA > 1e-7 && h.tA < 1 - 1e-7) newSplitParams.add(h.tA);
        if (h.tB > 1e-7 && h.tB < 1 - 1e-7) {
          let set = existingSplits.get(eid);
          if (!set) {
            set = new Set<number>();
            existingSplits.set(eid, set);
          }
          set.add(h.tB);
        }
      }
    }

    // 2. Split existing edges first (so their geometry is subdivided before we
    //    weave in the new one).  Splitting changes the edge array but we operate
    //    on a captured snapshot of (eid, params).
    for (const [eid, params] of existingSplits) {
      this.splitExistingEdge(eid, [...params]);
    }

    // 3. Split the NEW edge at its own intersection params and insert each piece
    //    as a twin pair, sharing vertices at the split points.
    const sortedParams = [...newSplitParams].sort((a, b) => a - b);
    let segStartT = 0;
    let pieceGeoms = chopEdge(geom, sortedParams);
    for (const pg of pieceGeoms) {
      const aId = this.getOrCreateVertex(pg.p0);
      const bId = this.getOrCreateVertex(pg.p1);
      if (aId === bId && pg.control === null) continue; // collapsed
      this.addTwinPair(aId, bId, pg, fillLeft, fillRight, lineStyle);
    }
    void segStartT;
  }

  /**
   * Split an existing undirected edge (given by its forward half-edge id) at a
   * set of parameters, replacing it with a chain of twin pairs that share new
   * vertices.  Preserves fill/line styles and curve geometry.
   */
  private splitExistingEdge(forwardId: number, params: number[]): void {
    const fwd = this.edges[forwardId];
    const rev = this.edges[fwd.twin];
    const fillLeft = fwd.fillLeft;
    const fillRight = fwd.fillRight;
    const lineStyle = fwd.lineStyle;
    const geom = fwd.geometry;

    const sorted = [...new Set(params)].sort((a, b) => a - b);
    const pieces = chopEdge(geom, sorted);
    if (pieces.length <= 1) return; // nothing to do

    // Remove the old twin pair from its vertices' outgoing lists, then "retire"
    // the two half-edges by collapsing them (they will be ignored: we rebuild
    // their vertices' adjacency from scratch in finalize()).
    this.detachHalfEdge(fwd);
    this.detachHalfEdge(rev);
    // Mark retired by giving them a zero-length self geometry that we filter out.
    fwd.origin = -1;
    rev.origin = -1;

    for (const pg of pieces) {
      const aId = this.getOrCreateVertex(pg.p0);
      const bId = this.getOrCreateVertex(pg.p1);
      if (aId === bId && pg.control === null) continue;
      this.addTwinPair(aId, bId, pg, fillLeft, fillRight, lineStyle);
    }
  }

  private detachHalfEdge(he: MutHalfEdge): void {
    if (he.origin < 0) return;
    const v = this.vertices[he.origin];
    const idx = v.outgoing.indexOf(he.id);
    if (idx >= 0) v.outgoing.splice(idx, 1);
  }

  // -- finalize: rotation system, faces ------------------------------------

  /**
   * Build the rotation system around every vertex, link next/prev, extract
   * faces, and return an immutable {@link PlanarShape}.  Retired (split-away)
   * half-edges are pruned and ids are compacted.
   */
  build(): PlanarShape {
    // Compact: drop retired half-edges (origin < 0) and reindex.
    const liveEdges: MutHalfEdge[] = [];
    const remap = new Map<number, number>();
    for (const e of this.edges) {
      if (e.origin < 0) continue;
      const newId = liveEdges.length;
      remap.set(e.id, newId);
      liveEdges.push(e);
    }
    // Fix twin references and ids.
    for (const e of liveEdges) {
      e.id = remap.get(e.id)!;
      e.twin = remap.get(e.twin)!;
    }
    // Rebuild each vertex's outgoing list against live edges (remapped).
    for (const v of this.vertices) {
      v.outgoing = v.outgoing
        .filter((id) => remap.has(id))
        .map((id) => remap.get(id)!);
    }

    // Rotation system: sort each vertex's outgoing half-edges by their outgoing
    // angle (CCW).  next(he) = twin(prevInRotation(... )); standard DCEL link.
    for (const v of this.vertices) {
      v.outgoing.sort((a, b) => this.angleOf(liveEdges[a]) - this.angleOf(liveEdges[b]));
    }

    // Link next/prev. For a half-edge `e` arriving at vertex w (e = twin of an
    // outgoing at w's... ), the next half-edge around the face on e's left is the
    // outgoing half-edge at e.dest that comes just CLOCKWISE-after e.twin in the
    // CCW rotation. Standard formula:
    //   next(e) = the outgoing edge at dest(e) immediately before twin(e)
    //             in CCW order, i.e. rotate twin(e) clockwise by one.
    for (const e of liveEdges) {
      const twin = liveEdges[e.twin];
      const dest = twin.origin; // = destination vertex of e
      const ring = this.vertices[dest].outgoing;
      const idx = ring.indexOf(twin.id);
      // The next outgoing CW from twin(e): previous element in the CCW-sorted ring.
      const cwIdx = (idx - 1 + ring.length) % ring.length;
      const nextId = ring[cwIdx];
      e.next = nextId;
      liveEdges[nextId].prev = e.id;
    }

    // Face extraction in two phases so disconnected components and nested holes
    // are handled correctly (a small island inside a larger fill with NO edge
    // crossings forms a separate boundary cycle that must become a HOLE of the
    // containing face, not its own free-floating face).
    //
    // Phase A: collect every boundary cycle, its signed area, and a chord
    // polygon.  CCW cycles (area > 0) bound a face on their interior; CW cycles
    // (area <= 0) are either the global outer boundary or an inner hole boundary.
    const visited = new Array<boolean>(liveEdges.length).fill(false);
    interface Cycle {
      edges: number[];
      area: number; // signed
      poly: Point[]; // chord polygon (CCW orientation for containment tests)
    }
    const cycles: Cycle[] = [];
    for (const e of liveEdges) {
      if (visited[e.id]) continue;
      const edges: number[] = [];
      let cur = e.id;
      let guard = 0;
      do {
        visited[cur] = true;
        edges.push(cur);
        cur = liveEdges[cur].next;
        if (++guard > liveEdges.length + 5) break;
      } while (cur !== e.id && cur !== -1 && !visited[cur]);
      const area = this.cycleSignedArea(liveEdges, edges);
      cycles.push({ edges, area, poly: this.cyclePolygon(liveEdges, edges) });
    }

    // Phase B: CCW cycles → bounded faces; CW cycles → holes (or the unbounded
    // face's content).  A CW cycle is assigned to the SMALLEST-area CCW face
    // whose interior contains it; if none contains it, it bounds the single
    // unbounded face.
    const faces: PlanarFace[] = [];
    const ccwCycles = cycles.filter((c) => c.area > 0);
    const cwCycles = cycles.filter((c) => c.area <= 0);

    // The unbounded face (always present).
    const unboundedId = 0;
    faces.push({ id: unboundedId, outer: -1, holes: [], fill: null, unbounded: true });

    // One bounded face per CCW cycle.
    const ccwFaceId = new Map<Cycle, number>();
    for (const c of ccwCycles) {
      const id = faces.length;
      faces.push({ id, outer: c.edges[0], holes: [], fill: null, unbounded: false });
      ccwFaceId.set(c, id);
      for (const cid of c.edges) liveEdges[cid].face = id;
    }

    // Assign each CW cycle (hole / outer boundary) to its containing CCW face.
    for (const hole of cwCycles) {
      // A representative point of the hole boundary (a cycle vertex).
      const probe = hole.poly[0];
      let container: Cycle | null = null;
      let containerArea = Infinity;
      for (const c of ccwCycles) {
        if (c === hole) continue;
        if (Math.abs(c.area) <= Math.abs(hole.area)) continue; // must be larger
        if (pointInPoly(probe, c.poly)) {
          if (Math.abs(c.area) < containerArea) {
            containerArea = Math.abs(c.area);
            container = c;
          }
        }
      }
      const faceId = container ? ccwFaceId.get(container)! : unboundedId;
      faces[faceId].holes.push(hole.edges[0]);
      for (const cid of hole.edges) liveEdges[cid].face = faceId;
    }

    // Provisional fill assignment from edge labels: a bounded face lies on the
    // LEFT of its boundary half-edges, so its fill is any non-null `fillLeft`
    // around the cycle.  This is exact when the input edges are consistently
    // labeled (e.g. a single shape, or edges fed to `Arrangement` directly).
    // For overlapping/coincident merge inputs the labels are ambiguous; the
    // high-level `buildArrangementFromShapes` re-resolves face fills by
    // interior-point sampling against the source regions (see build.ts).
    for (const f of faces) {
      if (f.unbounded) {
        f.fill = null;
        continue;
      }
      let fill: number | null = null;
      let cur = f.outer;
      let guard = 0;
      do {
        const e = liveEdges[cur];
        if (e.fillLeft !== null) {
          fill = e.fillLeft;
          break;
        }
        cur = e.next;
        if (++guard > liveEdges.length + 5) break;
      } while (cur !== f.outer && cur >= 0);
      f.fill = fill;
    }

    // Build immutable output.
    const outVerts: PlanarVertex[] = this.vertices.map((v) => ({
      id: v.id,
      point: v.point,
      outgoing: v.outgoing.length > 0 ? v.outgoing[0] : -1,
    }));
    const outEdges: HalfEdge[] = liveEdges.map((e) => ({
      id: e.id,
      origin: e.origin,
      twin: e.twin,
      next: e.next,
      prev: e.prev,
      face: e.face,
      geometry: e.geometry,
      fillLeft: e.fillLeft,
      fillRight: e.fillRight,
      lineStyle: e.lineStyle,
    }));

    return {
      vertices: outVerts,
      halfEdges: outEdges,
      faces,
      fills: this.fills,
      lineStyles: this.lineStyles,
    };
  }

  /** A chord polygon (sampled) for a cycle of half-edges, for containment tests. */
  private cyclePolygon(edges: MutHalfEdge[], cycle: number[]): Point[] {
    const poly: Point[] = [];
    for (const cid of cycle) {
      const g = edges[cid].geometry;
      if (g.control === null) {
        poly.push(g.p0);
      } else {
        // sample the curve, excluding the duplicated endpoint
        for (let i = 0; i < 8; i++) poly.push(edgeAt(g, i / 8));
      }
    }
    return poly;
  }

  /** Outgoing angle of a half-edge at its origin, in [0, 2π). */
  private angleOf(e: MutHalfEdge): number {
    const d = outgoingDirection(e.geometry);
    let a = Math.atan2(d.y, d.x);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  /**
   * Signed area of a face cycle, sampling curves into chords for the shoelace.
   * Positive = CCW (a bounded interior face); ≤0 = CW (the unbounded outer
   * boundary, traversed clockwise).
   */
  private cycleSignedArea(edges: MutHalfEdge[], cycle: number[]): number {
    let area = 0;
    for (const cid of cycle) {
      const g = edges[cid].geometry;
      const samples = g.control === null ? [g.p0, g.p1] : sampleCurve(g, 8);
      for (let i = 0; i + 1 < samples.length; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        area += a.x * b.y - b.x * a.y;
      }
    }
    return area / 2;
  }

  // -- introspection (for tests / callers) ---------------------------------

  get vertexCount(): number {
    return this.vertices.length;
  }
  get halfEdgeCount(): number {
    return this.edges.filter((e) => e.origin >= 0).length;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Chop an edge geometry at a sorted list of interior parameters (curve-aware),
 * returning the chain of piece geometries.  De Casteljau preserves quadratics.
 */
function chopEdge(geom: EdgeGeometry, sortedParams: number[]): EdgeGeometry[] {
  if (sortedParams.length === 0) return [geom];
  const pieces: EdgeGeometry[] = [];
  let cur = geom;
  let prevT = 0;
  for (const t of sortedParams) {
    if (t <= prevT + 1e-9 || t >= 1 - 1e-9) continue;
    // Re-parameterize t into the remaining sub-curve's local parameter.
    const local = (t - prevT) / (1 - prevT);
    const { first, second } = splitLocal(cur, local);
    pieces.push(first);
    cur = second;
    prevT = t;
  }
  pieces.push(cur);
  return pieces;
}

function splitLocal(
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
  // de Casteljau on the quadratic.
  const a = lerp(g.p0, g.control, t);
  const b = lerp(g.control, g.p1, t);
  const mid = snapPoint(lerp(a, b, t));
  return {
    first: { p0: g.p0, control: snapPoint(a), p1: mid },
    second: { p0: mid, control: snapPoint(b), p1: g.p1 },
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function sampleCurve(g: EdgeGeometry, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) out.push(edgeAt(g, i / n));
  return out;
}

/** Even-odd point-in-polygon (module-local; query.ts has the exported copy). */
function pointInPoly(pt: Point, poly: readonly Point[]): boolean {
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
