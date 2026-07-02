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
export interface BuildArrangementOptions {
  /**
   * When true, a stroke half-edge whose midpoint is covered by a fill drawn
   * strictly AFTER it (a later draw-order shape) has its stroke CONSUMED (its
   * `lineStyle` cleared) so the covering fill replaces the line beneath it —
   * authentic Flash 8 Paint Normal / fill-commit semantics (task 1430). Only the
   * covered span is consumed; the arrangement has already split the stroke at the
   * fill's boundary, so uncovered spans keep their stroke. Default false, so every
   * direct/generic caller (live re-derive, sub-selection, brush masks, eraser,
   * tests) is byte-identical to the previous behavior; the merge FOLD opts in.
   */
  readonly consumeStrokesUnderFills?: boolean;
}

export function buildArrangementFromShapes(
  shapes: readonly Shape[],
  options?: BuildArrangementOptions
): ReturnType<Arrangement["build"]> {
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
  //
  // WINDING/PARITY (task 1425): a shape read back from the planar map emits an
  // interior HOLE as a SEPARATE closed loop that CARRIES the outer loop's fill and
  // SHARES its Fill OBJECT reference (the renderer cuts the hole via the non-zero
  // winding rule; see planarShapeToShape / renderShape). Treating every loop as an
  // independent last-covering-wins region re-fills the hole on any rebuild (the
  // outer silhouette covers the hole centroid), so an erased interior hole
  // silently self-reverts. We therefore GROUP a shape's loops that share ONE Fill
  // object into a single region and test membership by EVEN-ODD parity across the
  // group: a point enclosed by an outer loop AND its hole loop toggles OUT (even
  // enclosure count) = no fill. Authored shapes carry a DISTINCT Fill object per
  // path, so each becomes its own single-loop group (parity == plain containment)
  // — same-color union / different-color cut (top group wins) are unchanged.
  const fillRegions: { poly: Point[]; fill: number; group: number; order: number }[] = [];
  // Stable id per (source shape, Fill object identity). Keyed by object ref so
  // two shapes never share a group even if they use an equal-valued Fill.
  const groupOf = new Map<string, number>();
  const fillObjId = new Map<Fill, number>();
  const objIdFor = (f: Fill): number => {
    let id = fillObjId.get(f);
    if (id === undefined) {
      id = fillObjId.size;
      fillObjId.set(f, id);
    }
    return id;
  };

  let shapeIdx = 0;
  for (const shape of shapes) {
    for (const path of shape.paths) {
      // drawOrder = the source shape's draw index (0 = oldest), threaded onto
      // stroke edges so stroke-under-fill consumption knows which fills post-date
      // the stroke (task 1430).
      for (const e of pathToInputEdges(path, internFill, internLine, shapeIdx)) {
        arr.insertEdge(e);
      }
      if (path.fill && path.closed) {
        const key = `${shapeIdx}:${objIdFor(path.fill)}`;
        let group = groupOf.get(key);
        if (group === undefined) {
          group = groupOf.size;
          groupOf.set(key, group);
        }
        fillRegions.push({
          poly: chordPolygon(shapePathToEdgeGeometries(path)),
          fill: internFill(path.fill),
          group,
          order: shapeIdx,
        });
      }
    }
    shapeIdx++;
  }

  const ps = arr.build();
  assignFaceFillsBySampling(ps, fillRegions);
  if (options?.consumeStrokesUnderFills) consumeStrokesUnderFills(ps, fillRegions);
  return ps;
}

/**
 * Merge-fold stroke-under-fill consumption (task 1430). In authentic Flash 8
 * merge drawing, artwork drawn ON TOP replaces what is beneath it — INCLUDING
 * strokes: brushing a fill (Paint Normal), or drawing any plain fill, over a
 * pencil line ERASES the covered run of that line (this is exactly why Paint
 * Fills / Behind / Inside exist — they are the modes that leave lines alone).
 *
 * The arrangement has already split every stroke at the boundaries of the fills
 * it crosses, so each stroke half-edge is wholly inside or wholly outside any
 * given fill region. For each stroked half-edge we clear its `lineStyle` (and its
 * twin's) when its midpoint is covered by a fill region drawn STRICTLY LATER than
 * the stroke (`region.order > he.drawOrder`). Strict draw-order is what keeps the
 * P2 "line splits fill" case intact: a line drawn OVER an existing fill has the
 * higher order, so that earlier fill never consumes it (the line still splits the
 * fill); only a fill drawn after the line replaces it. A stroke and a fill from
 * the SAME shape share an order, so a stroked-and-filled shape never eats its own
 * boundary stroke.
 *
 * Clearing `lineStyle` (rather than filtering at emit) also makes the now-covered
 * seam dissolvable in `planarShapeToShape`, so the covering fill reads back as one
 * clean region instead of being split by a phantom line.
 */
function consumeStrokesUnderFills(
  ps: PlanarShape,
  regions: readonly { poly: Point[]; fill: number; group: number; order: number }[]
): void {
  if (regions.length === 0) return;
  for (const he of ps.halfEdges) {
    if (he.lineStyle === null || he.lineStyle === undefined) continue;
    // Only the forward half-edge of each undirected edge needs testing; clear
    // both. Skip the twin once handled (its lineStyle is already null).
    const order = he.drawOrder ?? -1;
    const mid = edgeAt(he.geometry, 0.5);
    let covered = false;
    for (const r of regions) {
      if (r.order <= order) continue; // only fills drawn strictly AFTER consume
      if (pointInPolygon(mid, r.poly)) {
        covered = true;
        break;
      }
    }
    if (covered) {
      he.lineStyle = null;
      const twin = ps.halfEdges[he.twin];
      if (twin) twin.lineStyle = null;
    }
  }
}

/**
 * Resolve every bounded face's fill by sampling an interior point against the
 * source fill regions, GROUPED by (source shape, Fill object identity) in draw
 * order.  A group "covers" the point when an ODD number of its loops enclose it
 * (even-odd parity) — so an outer loop plus its enclosed hole loop toggle OUT
 * (task 1425).  The LAST covering group (topmost in draw order) wins; faces
 * covered by no group are background (null).  This realizes merge semantics
 * (same-color union, different-color cut) AND keeps interior holes empty across
 * rebuilds.
 */
function assignFaceFillsBySampling(
  ps: PlanarShape,
  regions: readonly { poly: Point[]; fill: number; group: number }[]
): void {
  // Bucket regions by group, preserving first-appearance order = draw order.
  const groupOrder: number[] = [];
  const byGroup = new Map<number, { poly: Point[]; fill: number }[]>();
  for (const r of regions) {
    let bucket = byGroup.get(r.group);
    if (!bucket) {
      bucket = [];
      byGroup.set(r.group, bucket);
      groupOrder.push(r.group);
    }
    bucket.push(r);
  }

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
    for (const g of groupOrder) {
      const bucket = byGroup.get(g)!;
      // Even-odd across the group's loops: an outer + hole enclosure cancels.
      let enclosures = 0;
      for (const r of bucket) if (pointInPolygon(pt, r.poly)) enclosures++;
      // All loops of a group share one Fill object -> one interned index.
      if (enclosures % 2 === 1) resolved = bucket[0].fill;
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
  internLine: (s: Stroke) => number,
  drawOrder = -1
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
    drawOrder,
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
