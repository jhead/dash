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
  dist2,
  edgeAt,
  outgoingDirection,
  pointKey,
  reverseEdgeGeometry,
  snapPoint,
} from "./geometry.js";
import { intersectEdges } from "./intersect.js";

/**
 * Endpoint-incidence radius for the shared-vertex guard (task 1335), in px²
 * (squared distance). An interior split whose snapped crossing point lands within
 * this radius of an edge endpoint is treated as a SHARED-VERTEX incidence — it is
 * snapped to that endpoint vertex and NOT registered as a real interior split.
 * Two arcs that merely TOUCH at a shared vertex (consecutive segments of any
 * closed path — every oval / rounded shape) report such a near-endpoint hit whose
 * snapped point lands one-to-two twips off the true vertex; without this guard the
 * sub-twip stub it creates re-fragments and drifts the geometry on every
 * fold->read-back cycle. The radius is ~1.5 twips (a touch over the grid spacing),
 * large enough to absorb the curve-curve solver's near-tangent noise but far
 * smaller than any real feature, so genuine crossings (which land well inside an
 * edge, many twips from any vertex) are unaffected.
 */
const ENDPOINT_INCIDENCE_R2 = (1.5 / 20) * (1.5 / 20);

/** True when `pt` lies within {@link ENDPOINT_INCIDENCE_R2} of `endpoint`. */
function nearEndpoint(pt: Point, endpoint: Point): boolean {
  return dist2(pt, endpoint) <= ENDPOINT_INCIDENCE_R2;
}

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

/**
 * A pending edge subdivision at parameter `t` whose vertex is the shared snapped
 * crossing `point` (task 1332). Threading the authoritative point through the
 * chop keeps both edges through a crossing exactly vertex-coincident.
 */
interface Split {
  readonly t: number;
  readonly point: Point;
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
    //
    // CRITICAL (task 1332): a split is recorded as `{ t, point }` where `point`
    // is the SNAPPED intersection coordinate the intersector returned. Both the
    // NEW edge and the EXISTING edge are then split AT THAT SHARED POINT (see
    // `chopEdge`/`splitLocal`, which pin each interior split endpoint to the
    // supplied point) rather than each side independently re-evaluating its own
    // geometry at its own parameter. Independent re-evaluation snapped the SAME
    // crossing into two ADJACENT twip cells — e.g. an angled eraser-capsule edge
    // crossing a band's top edge produced (102.65,95) on the capsule side and
    // (102.70,95) on the band side, a 1-twip apart. Those two "should-be-shared"
    // vertices then did NOT merge, the half-edge rotation ring at the crossing
    // was wrong, and the far region failed to close into a bounded face (it
    // leaked into the unbounded face) → one whole side of an angled cut vanished.
    // Pinning both splits to the EXACT returned point makes the shared vertex
    // exactly shared, so an angled cut splits the shape into two bounded faces.
    const newSplits = new Map<string, Split>(); // splits on the NEW edge, keyed by point
    // existingEdgeId (forward) -> point-key -> split
    const existingSplits = new Map<number, Map<string, Split>>();

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
        const pt = snapPoint(h.point);
        const ptKey = pointKey(pt);
        // Only register interior splits; endpoints become shared vertices
        // automatically when we create the new edge's vertices.
        //
        // SHARED-VERTEX GUARD (task 1335): two arcs that share an endpoint vertex
        // (e.g. consecutive quadratic arcs of one oval, or any closed path's
        // adjacent segments) merely TOUCH there — they do not truly cross. But the
        // curve-curve solver reports a near-endpoint "hit" whose parameter is
        // interior (tA≈0.9993, tB≈0.0002) and whose SNAPPED point lands one-to-two
        // twips OFF the true shared vertex. Registering it (a) splits an arc a
        // sub-twip from its own endpoint, leaving a ~1-twip stub, and (b) moves the
        // chain through a vertex a twip away from the real one. On a single
        // un-crossed oval this drifts/fragments the read-back on every
        // fold->read-back cycle (the 45° vertices march ~1 twip per cycle; segments
        // multiply 8->13->19) until the topology degenerates and the fill is LOST
        // entirely (paths=0 after ~3 cycles) — the multi-cycle planar read-back
        // drift.
        //
        // The signature of a shared-vertex tangent touch is that the hit lands near
        // an endpoint of BOTH edges at once (the vertex they share). A GENUINE
        // crossing — even one near a vertex (e.g. an eraser-capsule edge cutting a
        // band edge close to where the capsule edge ends) — is near an endpoint of
        // AT MOST ONE of the two edges; the other edge passes through with the
        // crossing solidly in its interior. So reject the interior split ONLY when
        // the snapped point is within ENDPOINT_INCIDENCE_R2 of an endpoint of BOTH
        // edges. This kills the oval's tangent-touch stubs (idempotent fixed-point
        // read-back) without suppressing any real crossing — including the angled
        // eraser cuts (planar-eraser.test.ts), where the crossing is near only the
        // capsule edge's end, not the band edge's.
        const newNear = nearEndpoint(pt, geom.p0) || nearEndpoint(pt, geom.p1);
        const existingNear =
          nearEndpoint(pt, e.geometry.p0) || nearEndpoint(pt, e.geometry.p1);
        const sharedVertexTouch = newNear && existingNear;
        if (h.tA > 1e-7 && h.tA < 1 - 1e-7 && !sharedVertexTouch) {
          newSplits.set(ptKey, { t: h.tA, point: pt });
        }
        if (h.tB > 1e-7 && h.tB < 1 - 1e-7 && !sharedVertexTouch) {
          let set = existingSplits.get(eid);
          if (!set) {
            set = new Map<string, Split>();
            existingSplits.set(eid, set);
          }
          set.set(ptKey, { t: h.tB, point: pt });
        }
      }
    }

    // 2. Split existing edges first (so their geometry is subdivided before we
    //    weave in the new one).  Splitting changes the edge array but we operate
    //    on a captured snapshot of (eid, splits).
    for (const [eid, splits] of existingSplits) {
      this.splitExistingEdge(eid, [...splits.values()]);
    }

    // 3. Split the NEW edge at its own intersection points and insert each piece
    //    as a twin pair, sharing vertices at the split points.
    const sortedSplits = [...newSplits.values()].sort((a, b) => a.t - b.t);
    const pieceGeoms = chopEdge(geom, sortedSplits);
    for (const pg of pieceGeoms) {
      const aId = this.getOrCreateVertex(pg.p0);
      const bId = this.getOrCreateVertex(pg.p1);
      // A piece whose endpoints snap to the SAME vertex spans no real distance —
      // a zero-length line OR a zero-span quadratic stub (the kind produced when
      // a curve is split a sub-twip from its own endpoint, e.g. two adjacent
      // oval arcs crossing near their shared corner). It carries no area and no
      // visible stroke; inserting it adds a self-loop half-edge that pollutes the
      // rotation system and leaves orphan stroke fragments on read-back (the
      // stroked-ellipse centre-pick bug, task 1334). Skip lines AND curves.
      if (aId === bId) continue; // collapsed (was: only `&& control === null`)
      this.addTwinPair(aId, bId, pg, fillLeft, fillRight, lineStyle);
    }
  }

  /**
   * Split an existing undirected edge (given by its forward half-edge id) at a
   * set of parameters, replacing it with a chain of twin pairs that share new
   * vertices.  Preserves fill/line styles and curve geometry.
   */
  private splitExistingEdge(forwardId: number, splits: Split[]): void {
    const fwd = this.edges[forwardId];
    const rev = this.edges[fwd.twin];
    const fillLeft = fwd.fillLeft;
    const fillRight = fwd.fillRight;
    const lineStyle = fwd.lineStyle;
    const geom = fwd.geometry;

    // Dedupe by the shared crossing point (task 1332) and order by parameter.
    const byKey = new Map<string, Split>();
    for (const s of splits) byKey.set(pointKey(s.point), s);
    const sorted = [...byKey.values()].sort((a, b) => a.t - b.t);
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
      if (aId === bId) continue; // collapsed line OR zero-span curve (task 1334)
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
 * Chop an edge geometry at a sorted list of interior splits (curve-aware),
 * returning the chain of piece geometries.  De Casteljau preserves quadratics.
 *
 * Each {@link Split} carries the parameter `t` AND the authoritative snapped
 * crossing `point` (task 1332): the split vertex is FORCED to `point` rather than
 * re-evaluating the geometry at `t` and re-snapping. This guarantees that the
 * same crossing produces the EXACT same vertex coordinate on every edge that
 * passes through it (the new edge and the existing edge it crosses), so the
 * shared vertex merges by exact integer key instead of landing a twip apart.
 */
function chopEdge(geom: EdgeGeometry, sortedSplits: Split[]): EdgeGeometry[] {
  if (sortedSplits.length === 0) return [geom];
  const pieces: EdgeGeometry[] = [];
  let cur = geom;
  let prevT = 0;
  for (const s of sortedSplits) {
    const t = s.t;
    if (t <= prevT + 1e-9 || t >= 1 - 1e-9) continue;
    // Re-parameterize t into the remaining sub-curve's local parameter.
    const local = (t - prevT) / (1 - prevT);
    const { first, second } = splitLocal(cur, local, s.point);
    pieces.push(first);
    cur = second;
    prevT = t;
  }
  pieces.push(cur);
  return pieces;
}

/**
 * Split a sub-curve `g` at local parameter `t`. The split vertex is pinned to
 * `mid` — the authoritative snapped crossing point (task 1332) — so both edges
 * through a crossing share the exact same vertex coordinate. The control points
 * are still computed by de Casteljau (curve-preserving); only the endpoint that
 * becomes the shared vertex is forced.
 */
function splitLocal(
  g: EdgeGeometry,
  t: number,
  mid: Point
): { first: EdgeGeometry; second: EdgeGeometry } {
  if (g.control === null) {
    return {
      first: { p0: g.p0, control: null, p1: mid },
      second: { p0: mid, control: null, p1: g.p1 },
    };
  }
  // de Casteljau on the quadratic.
  const a = lerp(g.p0, g.control, t);
  const b = lerp(g.control, g.p1, t);
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
