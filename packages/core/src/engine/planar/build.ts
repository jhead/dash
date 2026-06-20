/**
 * High-level arrangement builders that take per-path {@link Shape}s (the
 * interchange / Object-Drawing form) and produce a {@link PlanarShape} (the
 * merge-mode half-edge form).
 *
 * Fill assignment: a closed fill path is oriented so the fill lies on the LEFT
 * of each directed edge (CCW interior).  We compute the path's signed area; if
 * it is clockwise we reverse the edges so the fill ends up on the left.  Each
 * edge is then inserted with `fillLeft = <styleIndex>`, `fillRight = null`.  The
 * arrangement splits crossings; face extraction reconstructs the regions and
 * picks up each face's fill from its boundary half-edges' `fillLeft`.
 *
 * Stroke-only paths are inserted as edges with a `lineStyle` and no fill.
 */

import type { Fill, PlanarShape, Shape, ShapePath, Stroke, Point } from "../types.js";
import { Arrangement, type InputEdge } from "./arrangement.js";
import {
  faceInteriorPoint,
  pointInPolygon,
  polygonSignedArea,
  shapePathToEdgeGeometries,
} from "./query.js";
import { edgeAt } from "./geometry.js";

/**
 * Build a planar arrangement from one or more shapes whose paths are mergeable
 * (drawn on the same layer in merge mode).  Returns the immutable PlanarShape.
 *
 * The style tables are deduped: identical fills/strokes share an index, which is
 * what makes same-color regions unify when the planar map is traced (a face
 * bounded entirely by fill index k is a single region regardless of how many
 * source paths contributed its boundary).
 */
export function buildArrangementFromShapes(shapes: readonly Shape[]): ReturnType<Arrangement["build"]> {
  const fills: Fill[] = [];
  const lineStyles: Stroke[] = [];
  const fillIndex = new Map<string, number>();
  const lineIndex = new Map<string, number>();

  const internFill = (f: Fill): number => {
    const key = fillKey(f);
    const existing = fillIndex.get(key);
    if (existing !== undefined) return existing;
    const id = fills.length;
    fills.push(f);
    fillIndex.set(key, id);
    return id;
  };
  const internLine = (s: Stroke): number => {
    const key = lineKey(s);
    const existing = lineIndex.get(key);
    if (existing !== undefined) return existing;
    const id = lineStyles.length;
    lineStyles.push(s);
    lineIndex.set(key, id);
    return id;
  };

  const arr = new Arrangement(fills, lineStyles);

  // Collect the fill regions (chord polygons + fill index) in DRAW ORDER so we
  // can resolve each face's fill by interior-point sampling: in merge mode the
  // later-drawn fill wins where colors differ, and same-color fills union (any
  // covering loop colors the region).  This is what makes the planar faces carry
  // the correct merge result regardless of overlapping/coincident boundaries.
  const fillRegions: { poly: Point[]; fill: number }[] = [];

  for (const shape of shapes) {
    for (const path of shape.paths) {
      for (const e of pathToInputEdges(path, internFill, internLine)) {
        arr.insertEdge(e);
      }
      if (path.fill && path.closed) {
        fillRegions.push({
          poly: chordPolygon(shapePathToEdgeGeometries(path)),
          fill: internFill(path.fill),
        });
      }
    }
  }

  const ps = arr.build();
  assignFaceFillsBySampling(ps, fillRegions);
  return ps;
}

/**
 * Resolve every bounded face's fill by sampling an interior point against the
 * source fill regions in draw order: the LAST region (topmost) covering the
 * point wins.  Faces covered by no region are background (null).  This realizes
 * merge semantics (same-color union, different-color cut) on the planar map.
 */
function assignFaceFillsBySampling(
  ps: PlanarShape,
  regions: readonly { poly: Point[]; fill: number }[]
): void {
  for (const f of ps.faces) {
    if (f.unbounded) {
      f.fill = null;
      continue;
    }
    const pt = faceInteriorPoint(ps, f);
    if (!pt) {
      f.fill = null;
      continue;
    }
    let resolved: number | null = null;
    for (const r of regions) {
      if (pointInPolygon(pt, r.poly)) resolved = r.fill;
    }
    f.fill = resolved;
  }
}

/** Build an arrangement from raw input edges (lowest-level entry point). */
export function buildArrangement(
  edges: readonly InputEdge[],
  fills: Fill[] = [],
  lineStyles: Stroke[] = []
): ReturnType<Arrangement["build"]> {
  const arr = new Arrangement(fills, lineStyles);
  for (const e of edges) arr.insertEdge(e);
  return arr.build();
}

/**
 * Convert a single ShapePath to input edges with fill/line assignment.  A filled
 * closed path contributes fill-on-left edges (orientation-normalized); a
 * stroke-only path contributes line-style edges.
 */
export function pathToInputEdges(
  path: ShapePath,
  internFill: (f: Fill) => number,
  internLine: (s: Stroke) => number
): InputEdge[] {
  const geoms = shapePathToEdgeGeometries(path);
  if (geoms.length === 0) return [];

  const fillIdx = path.fill ? internFill(path.fill) : null;
  const lineIdx = path.stroke ? internLine(path.stroke) : null;

  // Orientation: if the path carries a fill, normalize so the interior is on the
  // LEFT.  Compute signed area from a chord polygon of the path.
  let edges = geoms;
  if (fillIdx !== null && path.closed) {
    const poly = chordPolygon(geoms);
    const ccw = polygonSignedArea(poly) > 0;
    if (!ccw) {
      // Reverse the edge list and each edge so the fill ends up on the left.
      edges = geoms
        .map((g) => ({ p0: g.p1, control: g.control, p1: g.p0 }))
        .reverse();
    }
  }

  return edges.map((g) => ({
    geometry: g,
    fillLeft: fillIdx,
    fillRight: null,
    lineStyle: lineIdx,
  }));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function chordPolygon(
  geoms: readonly import("../types.js").EdgeGeometry[]
): Point[] {
  const poly: Point[] = [];
  for (const g of geoms) {
    if (poly.length === 0) poly.push(g.p0);
    if (g.control === null) {
      poly.push(g.p1);
    } else {
      for (let i = 1; i <= 6; i++) poly.push(edgeAt(g, i / 6));
    }
  }
  return poly;
}

function fillKey(f: Fill): string {
  if (f.type === "solid") {
    const c = f.color;
    return `solid:${c.r},${c.g},${c.b},${c.a}`;
  }
  // Gradients / bitmaps: structural JSON key (sufficient for dedupe).
  return `${f.type}:${JSON.stringify(f)}`;
}

function lineKey(s: Stroke): string {
  const c = s.color;
  return `${s.width}:${c.r},${c.g},${c.b},${c.a}:${s.caps}:${s.joints}:${s.strokeType ?? "solid"}`;
}
