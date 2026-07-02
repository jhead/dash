/**
 * P4 — curve-preserving eraser on the LAYER planar arrangement.
 *
 * The legacy per-object eraser (engine/eraser.ts) does a polygon
 * Greiner–Hormann difference on FLATTENED polylines, so every cut curve is
 * faceted to chords.  This module re-targets the eraser to the planar kernel
 * (docs/36-vector-merge-model.md §3 "P3-eraser"): the eraser stroke (disk +
 * bridging capsules) is inserted into the layer's arrangement as input edges,
 * which makes the kernel SPLIT the existing fill/stroke edges at the eraser
 * boundary CURVE-PRESERVINGLY (de Casteljau, never flattened).  Faces inside the
 * erased region lose their fill (the fill is subtracted; a band erased clean
 * through a fill SPLITS it into two faces; an erased island leaves a hole);
 * stroke half-edges inside the erased region lose their line style (the stroke is
 * TRIMMED at the eraser boundary, keeping its quadratic on both surviving sides).
 *
 * It reuses the same proven read-back ({@link planarShapeToShape}) as P1–P3, with
 * an emit filter that drops the erased faces/edges — so the result is one or more
 * per-path {@link Shape}s for storage / render / SWF, exactly like every other
 * merge op.
 *
 * Flash 8 eraser MODES (docs/03-drawing-vector-graphics.md):
 *   - **Normal**        — erase both fills and strokes.
 *   - **Erase Fills**   — erase only fills; leave strokes intact.
 *   - **Erase Lines**   — erase only strokes; leave fills intact.
 *   - **Erase Selected**— erase only the currently-selected fills (the caller
 *     restricts the set of faces by passing a `selectedFaceFilter`).
 *   - **Erase Inside**  — erase only the fill the gesture STARTED inside, and only
 *     within that fill's silhouette (does not spill onto other fills / background).
 *   - **Faucet**        — a single click deletes a WHOLE fill or line; see
 *     {@link faucetEraseShape}.
 */

import type { Point, Shape } from "../types.js";
import type { PlanarShape, PlanarFace } from "../types.js";
import { type InputEdge } from "./arrangement.js";
import { buildArrangementFromShapes } from "./build.js";
import {
  faceInteriorPoint,
  pointInPolygon,
  shapePathToEdgeGeometries,
  planarShapeToShape,
  locateFace,
} from "./query.js";
import { livePlanarShape } from "./live.js";
import { edgeAt } from "./geometry.js";

/** The Flash 8 eraser modes. */
export type EraserMode =
  | "normal"
  | "fills"
  | "lines"
  | "selected"
  | "inside";

export interface PlanarEraseOptions {
  /** Eraser mode (default "normal"). */
  readonly mode?: EraserMode;
  /**
   * For "selected" mode: a predicate over a face's representative INTERIOR POINT
   * (in kernel/stage space) selecting which fills are erasable. Faces whose
   * interior point fails this predicate are preserved even when erased over.
   */
  readonly selectedFaceFilter?: (interior: Point) => boolean;
  /**
   * For "inside" mode: the stage-space point where the eraser gesture STARTED.
   * Only the fill containing this point is erased (and only within its
   * silhouette). Ignored for other modes.
   */
  readonly insideAt?: Point;
}

// ---------------------------------------------------------------------------
// Eraser region helpers
// ---------------------------------------------------------------------------

/**
 * UNION point-in-(multi-polygon): inside if `pt` falls within ANY of the eraser
 * stamp loops.
 *
 * The eraser stamp is built from MULTIPLE overlapping simple loops — one disk per
 * drag sample plus a bridging capsule between consecutive samples (see
 * {@link buildEraserStamp}). The erased region is their UNION, not their symmetric
 * difference. The old even-odd parity test (`inside = !inside` per containing loop)
 * cancelled wherever an EVEN number of loops overlapped — exactly the disk⋂capsule
 * overlap that occurs on every ordinary drag — so those covered points read as
 * OUTSIDE and the fill/stroke there survived as an un-erased sliver (task 1327).
 *
 * Because each individual stamp loop is a simple (non-self-intersecting) convex
 * polygon, an OR over per-loop {@link pointInPolygon} is the exact union /
 * nonzero-coverage test: a point inside one-or-more loops is inside the swept area.
 */
function pointInEraser(pt: Point, eraserLoops: readonly (readonly Point[])[]): boolean {
  for (const loop of eraserLoops) {
    if (loop.length >= 3 && pointInPolygon(pt, loop)) return true;
  }
  return false;
}

/** Sample a half-edge's geometric MIDPOINT (curve-aware). */
function halfEdgeMidpoint(g: import("../types.js").EdgeGeometry): Point {
  return edgeAt(g, 0.5);
}

// ---------------------------------------------------------------------------
// The planar erase
// ---------------------------------------------------------------------------

export interface PlanarEraseResult {
  /** The surviving merged geometry as a single Shape, or null if nothing remains. */
  readonly shape: Shape | null;
}

/**
 * Subtract the eraser region (closed polygons in the SHAPE's coordinate space)
 * from a single merged `shape`, curve-preservingly, on the planar arrangement.
 *
 * The eraser loops are inserted as subdivision edges so the kernel splits the
 * fill/stroke edges at the eraser boundary keeping true quadratics; the faces /
 * strokes inside the erased region are then dropped at read-back per `mode`.
 */
export function planarEraseShape(
  shape: Shape,
  eraserLoops: readonly (readonly Point[])[],
  opts: PlanarEraseOptions = {},
  resultId = shape.id
): PlanarEraseResult {
  const mode = opts.mode ?? "normal";
  const usableLoops = eraserLoops.filter((l) => l.length >= 3);
  if (usableLoops.length === 0) return { shape };

  // Build the arrangement from the shape's own paths AND the eraser polygon
  // edges, so the kernel subdivides the geometry at the eraser boundary
  // (curve-preserving). We reuse buildArrangementFromShapes for the fill/style
  // bookkeeping by wrapping the eraser loops as an extra style-less "shape":
  // its edges carry no fill/line, so they only SPLIT existing edges and never
  // introduce visible geometry.
  const eraserShape: Shape = {
    id: `${shape.id}__eraser`,
    paths: usableLoops.map((loop) => ({
      start: { x: loop[0].x, y: loop[0].y },
      segments: loop
        .slice(1)
        .concat([loop[0]])
        .map((p) => ({ type: "line" as const, to: { x: p.x, y: p.y } })),
      closed: true,
      // No fill, no stroke: pure subdivision boundary.
    })),
  };

  // buildArrangementFromShapes resolves each face's fill by sampling the source
  // fill regions in draw order (topmost wins). The eraser shape contributes no
  // fill region, so the existing fills are resolved exactly as before; the only
  // effect of the eraser edges is the extra splits at the boundary.
  const ps = buildArrangementFromShapes([shape, eraserShape]);

  // Which faces are inside the erased region (interior point inside the eraser).
  const erasedFace = new Set<number>();
  // For "inside" mode: the CONNECTED same-fill component the gesture started in.
  //
  // Task 1399: keying on the fill INDEX alone (startFace.fill) is wrong.
  // buildArrangementFromShapes de-dupes fills by color, so two spatially-disjoint
  // same-color regions share one fill index; erasing every face with `f.fill ===
  // insideFillIdx` therefore ALSO bit a separate same-colored region the eraser
  // merely passed over. Authentic Flash confines Erase-Inside to the connected
  // fill you started in — so restrict to `connectedFillComponent(startFace)` (the
  // same silhouette walk the faucet uses), which cannot reach a disjoint region.
  let insideComponent: Set<number> | null = null;
  if (mode === "inside" && opts.insideAt) {
    const startFace = locateFace(ps, opts.insideAt);
    insideComponent =
      startFace && startFace.fill !== null
        ? connectedFillComponent(ps, startFace.id)
        : null;
  }

  for (const f of ps.faces) {
    if (f.unbounded) continue;
    const interior = faceInteriorPoint(ps, f);
    if (!interior) continue;
    if (!pointInEraser(interior, usableLoops)) continue;
    // A face with NO fill has nothing to erase — skip it (task 1431). Otherwise a
    // stamp that only covers empty regions (e.g. the eraser's own disk area, or a
    // gesture that never intersects the artwork) would mark a fillless face as
    // "erased" and defeat the no-op identity return below. Dropping a fillless
    // face never changes the read-back (it emits no fill loop either way).
    if (f.fill === null || f.fill === undefined) continue;
    // The face is under the eraser. Decide per mode whether to erase its fill.
    if (mode === "lines") continue; // lines-only: never erase fills.
    if (mode === "selected") {
      if (!opts.selectedFaceFilter || !opts.selectedFaceFilter(interior)) continue;
    }
    if (mode === "inside") {
      // Only erase faces in the connected fill the gesture started in.
      if (insideComponent === null || !insideComponent.has(f.id)) continue;
    }
    erasedFace.add(f.id);
  }

  // Which stroke half-edges are inside the erased region (midpoint test).
  const eraseStrokes = mode === "normal" || mode === "lines";
  const erasedStroke = new Set<number>();
  if (eraseStrokes) {
    for (const he of ps.halfEdges) {
      if (he.lineStyle === null || he.lineStyle === undefined) continue;
      if (pointInEraser(halfEdgeMidpoint(he.geometry), usableLoops)) {
        erasedStroke.add(he.id);
      }
    }
  }

  // No-op increment (task 1431): the eraser passed the bbox pre-filter but its
  // stamp did not actually remove any fill face OR trim any stroke. Rebuilding
  // via planarShapeToShape would still return a NEW Shape (the eraser boundary
  // edges split the geometry, so the read-back is a different object even though
  // it renders identically), which churns the document/history and re-runs the
  // read-back round-trip on every such move. Return the ORIGINAL reference so the
  // caller's `next === shape` guard makes a no-op increment truly free.
  if (erasedFace.size === 0 && erasedStroke.size === 0) return { shape };

  const result = planarShapeToShape(ps, resultId, {
    // A face is kept (participates in fill emission) unless it was erased.
    faceFilter: (fid) => !erasedFace.has(fid),
    // A stroke edge is kept unless its midpoint is inside the erased region.
    edgeFilter: (heId) => !erasedStroke.has(heId),
  });

  return { shape: result.paths.length > 0 ? result : null };
}

// ---------------------------------------------------------------------------
// Faucet — single click deletes a whole fill or a whole line
// ---------------------------------------------------------------------------

/**
 * Faucet eraser: a single click at `pt` (kernel/stage space) deletes a WHOLE
 * connected fill region or a WHOLE connected line. We pick what's under the
 * point on the LIVE planar map (a stroke-on-ink wins over a face), then re-emit
 * everything EXCEPT the picked piece.
 *
 * Returns the surviving shape, or null if nothing remains.
 */
export function faucetEraseShape(
  shape: Shape,
  pt: Point,
  resultId = shape.id,
  /**
   * Pick tolerance in STAGE pixels for hitting a stroke (default 3, matching
   * Flash's ~3px). The caller SHOULD pass a zoom-adjusted value (`3 / zoom`) so
   * the faucet feels equally precise at every zoom (task 1432): at 400% a fixed
   * 3px reads as 12 stage-px of slop, at 25% it is nearly impossible to hit.
   */
  tol = 3
): PlanarEraseResult {
  const ps = livePlanarShape(shape);

  // 1) Try a stroke under the point first (within a small tolerance against each
  //    stroked edge's curve).
  const strokeHit = pickStrokeNear(ps, pt, tol);
  if (strokeHit >= 0) {
    // Delete the clicked LINE — the connected same-style run that FOLLOWS the
    // clicked stroke through corners, but does NOT jump across a crossing into an
    // unrelated line (task 1432). See {@link connectedStrokeRun}.
    const erasedEdges = connectedStrokeRun(ps, strokeHit);
    const result = planarShapeToShape(ps, resultId, {
      edgeFilter: (heId) => {
        const u = Math.min(heId, ps.halfEdges[heId].twin);
        return !erasedEdges.has(u);
      },
    });
    return { shape: result.paths.length > 0 ? result : null };
  }

  // 2) Otherwise a fill face: delete its whole same-fill connected component
  //    (the silhouette the user sees as one fill), leaving the rest.
  const face = locateFace(ps, pt);
  if (!face || face.fill === null) return { shape };
  const erasedFaces = connectedFillComponent(ps, face.id);
  const result = planarShapeToShape(ps, resultId, {
    faceFilter: (fid) => !erasedFaces.has(fid),
  });
  return { shape: result.paths.length > 0 ? result : null };
}

/** The canonical (smaller) id of a half-edge's undirected edge. */
function canonicalEdge(ps: PlanarShape, heId: number): number {
  return Math.min(heId, ps.halfEdges[heId].twin);
}

/** Find a stroked half-edge whose curve passes near `pt` (returns its id, or -1). */
function pickStrokeNear(ps: PlanarShape, pt: Point, tol = 3): number {
  let best = -1;
  let bestD = tol;
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    const d = distPointToEdge(pt, he.geometry);
    if (d < bestD) {
      bestD = d;
      best = he.id;
    }
  }
  return best;
}

/** Distance from a point to an edge (sampled along the curve). */
function distPointToEdge(pt: Point, g: import("../types.js").EdgeGeometry): number {
  const samples = g.control === null ? 1 : 8;
  let prev = g.p0;
  let best = Infinity;
  for (let i = 1; i <= samples; i++) {
    const q = g.control === null ? g.p1 : edgeAt(g, i / samples);
    best = Math.min(best, distPointToSeg(pt, prev, q));
    prev = q;
  }
  return best;
}

function distPointToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Minimum straight-through-ness (dot of travel direction with the continuation's
 * outgoing direction) required to FOLLOW the clicked line across a crossing /
 * junction (degree > 2 vertex). cos(45°): a genuine line continuation deviates
 * < 45° from straight; a crossing/perpendicular-junction arm is ~90° off and is
 * left untouched. Corners (degree-2 vertices) are followed unconditionally, so
 * this threshold only gates multi-way vertices.
 */
const STRAIGHT_THROUGH_MIN_DOT = Math.SQRT1_2; // = cos(45°) ≈ 0.7071

/** Two stroked edges share a line style iff their lineStyle indices are equal. */
function sameLineStyle(ps: PlanarShape, a: number, b: number): boolean {
  return ps.halfEdges[a].lineStyle === ps.halfEdges[b].lineStyle;
}

/**
 * Unit direction of undirected edge `canon` LEAVING one of its endpoint vertices
 * `v` (the tangent at `v`, pointing away from `v` into the edge). Curve-aware:
 * uses the control point when present, falling back to the far endpoint for a
 * degenerate (zero-length first span) curve.
 */
function dirLeavingVertex(ps: PlanarShape, canon: number, v: number): Point {
  const he = ps.halfEdges[canon];
  // Use whichever half-edge is oriented away from v (origin === v), so p0 is at v.
  const g = he.origin === v ? he.geometry : ps.halfEdges[he.twin].geometry;
  const bx = g.control ? g.control.x : g.p1.x;
  const by = g.control ? g.control.y : g.p1.y;
  let dx = bx - g.p0.x;
  let dy = by - g.p0.y;
  if (dx === 0 && dy === 0) {
    dx = g.p1.x - g.p0.x;
    dy = g.p1.y - g.p0.y;
  }
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * The stroked LINE the faucet deletes when clicking `startHe`: the connected run
 * of same-style stroked edges that FOLLOWS the clicked stroke as one line — through
 * corners (walk continues), but NOT jumping across a crossing/junction into an
 * unrelated line (task 1432).
 *
 * The old implementation flood-filled ALL stroked edges sharing any vertex,
 * ignoring stroke style AND crossings, so clicking one of two crossing lines
 * deleted BOTH entire lines (repro in task 1432). Real Flash 8's faucet deletes
 * the stroke you clicked (its connected segment scope); an intersection SPLITS
 * strokes into segments and the faucet never wipes a different line that merely
 * crosses the clicked one.
 *
 * Scope rule (line-segment scope marked "needs-oracle-verification" in the task —
 * this is the most Flash-faithful reading we can justify without a live oracle):
 *   - At a **corner** (degree-2 vertex: exactly one OTHER same-style edge) the
 *     line simply continues — follow it. This deletes a rectangle outline / any
 *     bent polyline in one click (the documented rectangle-outline workflow).
 *   - At a **crossing / junction** (degree > 2) follow ONLY the geometric
 *     continuation — the single other same-style edge whose direction carries
 *     the line straight through (within {@link STRAIGHT_THROUGH_MIN_DOT}). The
 *     perpendicular arms of a crossing line are NOT followed, so the crossing
 *     line survives. If no arm continues straight (a T where the clicked line
 *     dead-ends at the junction) the walk stops there.
 *   - A **style boundary** (different lineStyle index, e.g. a black line touching
 *     a red line) is never crossed.
 */
function connectedStrokeRun(ps: PlanarShape, startHe: number): Set<number> {
  const out = new Set<number>();
  const start = canonicalEdge(ps, startHe);
  out.add(start);

  // vertex -> incident stroked edges (each incident edge contributes exactly one
  // outgoing half-edge at the vertex, i.e. the half-edge whose origin === vertex).
  const byVertex = new Map<number, number[]>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    const arr = byVertex.get(he.origin) ?? [];
    arr.push(he.id);
    byVertex.set(he.origin, arr);
  }

  /** Canonical same-style edges incident to `v`, excluding `exclude`. */
  const incidentEdges = (v: number, exclude: number): number[] => {
    const seen = new Set<number>();
    for (const heId of byVertex.get(v) ?? []) {
      const c = canonicalEdge(ps, heId);
      if (c !== exclude && sameLineStyle(ps, c, exclude)) seen.add(c);
    }
    return [...seen];
  };

  /**
   * The single edge that continues line `from` past vertex `v`, or -1 to stop.
   * Degree-2 (one candidate): the corner continuation, followed unconditionally.
   * Degree > 2: the straightest continuation, only if near-collinear.
   */
  const continuation = (from: number, v: number): number => {
    const cands = incidentEdges(v, from);
    if (cands.length === 0) return -1;
    if (cands.length === 1) return cands[0];
    // Travel direction INTO v along `from` = opposite of `from` leaving v. The
    // straight continuation leaves v in that same travel direction, i.e. opposite
    // to `from` leaving v → most-negative dot(fromDir, candDir).
    const fromDir = dirLeavingVertex(ps, from, v);
    let best = -1;
    let bestScore = -Infinity;
    for (const c of cands) {
      const d = dirLeavingVertex(ps, c, v);
      const score = -(fromDir.x * d.x + fromDir.y * d.y); // straightness
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return bestScore >= STRAIGHT_THROUGH_MIN_DOT ? best : -1;
  };

  const stack = [start];
  while (stack.length > 0) {
    const c = stack.pop()!;
    const he = ps.halfEdges[c];
    const v0 = he.origin;
    const v1 = ps.halfEdges[he.twin].origin;
    for (const v of [v0, v1]) {
      const nxt = continuation(c, v);
      if (nxt >= 0 && !out.has(nxt)) {
        out.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return out;
}

/** BFS the connected same-fill face component reachable from `startFace`. */
function connectedFillComponent(ps: PlanarShape, startFace: number): Set<number> {
  const out = new Set<number>();
  const fill = ps.faces[startFace].fill;
  if (fill === null) return out;
  const stack = [startFace];
  out.add(startFace);
  while (stack.length > 0) {
    const fid = stack.pop()!;
    for (const he of ps.halfEdges) {
      if (he.face !== fid) continue;
      // A no-stroke seam to a same-fill face dissolves them into one silhouette.
      if (he.lineStyle !== null && he.lineStyle !== undefined) continue;
      const nb = ps.halfEdges[he.twin].face;
      const nf = ps.faces[nb] as PlanarFace | undefined;
      if (!nf || nf.unbounded) continue;
      if (nf.fill === fill && !out.has(nb)) {
        out.add(nb);
        stack.push(nb);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Eraser-stamp polygon construction (curve-free disk + capsule)
// ---------------------------------------------------------------------------

const DISK_SEGMENTS = 24;

function diskPolygon(center: Point, radius: number, segments = DISK_SEGMENTS): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

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

/**
 * Build the eraser stamp polygons for a drag (one disk per sample + a bridging
 * capsule between consecutive samples). Same shape as the legacy
 * {@link import("../eraser.js").buildEraserPolygon} but kept local so the planar
 * path has no dependency on the legacy module. A single click → one disk.
 */
export function buildEraserStamp(points: readonly Point[], radius: number): Point[][] {
  if (points.length === 0 || radius <= 0) return [];
  const loops: Point[][] = [diskPolygon(points[0], radius)];
  for (let i = 1; i < points.length; i++) {
    const bridge = capsuleRect(points[i - 1], points[i], radius);
    if (bridge) loops.push(bridge);
    loops.push(diskPolygon(points[i], radius));
  }
  return loops;
}

// Unused-import guard: keep these referenced for downstream re-export needs.
export type { InputEdge };
export { shapePathToEdgeGeometries };
