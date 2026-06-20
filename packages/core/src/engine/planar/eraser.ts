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

/** Even-odd point-in-(multi-polygon): inside an ODD number of the loops. */
function pointInEraser(pt: Point, eraserLoops: readonly (readonly Point[])[]): boolean {
  let inside = false;
  for (const loop of eraserLoops) {
    if (loop.length >= 3 && pointInPolygon(pt, loop)) inside = !inside;
  }
  return inside;
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
  // For "inside" mode: the fill index the gesture started in.
  let insideFillIdx: number | null = null;
  if (mode === "inside" && opts.insideAt) {
    const startFace = locateFace(ps, opts.insideAt);
    insideFillIdx = startFace ? startFace.fill : null;
  }

  for (const f of ps.faces) {
    if (f.unbounded) continue;
    const interior = faceInteriorPoint(ps, f);
    if (!interior) continue;
    if (!pointInEraser(interior, usableLoops)) continue;
    // The face is under the eraser. Decide per mode whether to erase its fill.
    if (mode === "lines") continue; // lines-only: never erase fills.
    if (mode === "selected") {
      if (!opts.selectedFaceFilter || !opts.selectedFaceFilter(interior)) continue;
    }
    if (mode === "inside") {
      // Only erase the fill that the gesture started in.
      if (insideFillIdx === null || f.fill !== insideFillIdx) continue;
    }
    erasedFace.add(f.id);
  }

  // Which stroke half-edges are inside the erased region (midpoint test).
  const eraseStrokes = mode === "normal" || mode === "lines";
  const erasedEdgeMid = (heId: number): boolean => {
    if (!eraseStrokes) return false;
    const he = ps.halfEdges[heId];
    if (he.lineStyle === null || he.lineStyle === undefined) return false;
    return pointInEraser(halfEdgeMidpoint(he.geometry), usableLoops);
  };

  const result = planarShapeToShape(ps, resultId, {
    // A face is kept (participates in fill emission) unless it was erased.
    faceFilter: (fid) => !erasedFace.has(fid),
    // A stroke edge is kept unless its midpoint is inside the erased region.
    edgeFilter: (heId) => !erasedEdgeMid(heId),
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
  resultId = shape.id
): PlanarEraseResult {
  const ps = livePlanarShape(shape);

  // 1) Try a stroke under the point first (within a small tolerance against each
  //    stroked edge's curve).
  const strokeHit = pickStrokeNear(ps, pt);
  if (strokeHit >= 0) {
    // Delete the whole connected line: all stroked edges reachable across shared
    // vertices through stroked-only connectivity.
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

/** BFS the connected run of stroked edges reachable from `startHe` via shared vertices. */
function connectedStrokeRun(ps: PlanarShape, startHe: number): Set<number> {
  const out = new Set<number>();
  const stack = [canonicalEdge(ps, startHe)];
  out.add(stack[0]);
  // Build vertex -> outgoing stroked half-edges adjacency.
  const byVertex = new Map<number, number[]>();
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    const arr = byVertex.get(he.origin) ?? [];
    arr.push(he.id);
    byVertex.set(he.origin, arr);
  }
  while (stack.length > 0) {
    const u = stack.pop()!;
    const he = ps.halfEdges[u];
    const tw = ps.halfEdges[he.twin];
    for (const vtx of [he.origin, tw.origin]) {
      for (const out2 of byVertex.get(vtx) ?? []) {
        const c = canonicalEdge(ps, out2);
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
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
