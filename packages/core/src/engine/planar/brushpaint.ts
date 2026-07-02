/**
 * Brush paint-mode compositing (Flash 8 brush "Paint" modes) on the planar
 * arrangement / face model. See docs/04-toolbox.md (Brush) and
 * docs/36-vector-merge-model.md.
 *
 * The brush tool draws a filled ribbon shape (see StageArea `brushPointsToShape`
 * / engine `addBrushStroke`). By default (Paint Normal) that ribbon merges into
 * the layer top-wins like any other shape. The non-Normal paint modes CLIP the
 * ribbon to a region derived from the existing artwork BEFORE it merges:
 *
 *   - **Normal**    — no clip; paint over everything (default merge).
 *   - **Fills**     — paint only where an existing solid FILL already is; empty
 *                     areas and (kept) lines are left untouched.
 *   - **Behind**    — paint only where the layer is EMPTY (behind existing art).
 *   - **Selection** — paint only within the currently-selected fill region(s).
 *   - **Inside**    — start-region-locked: the stroke paints only inside the
 *                     region (fill face, or the empty background) that the stroke
 *                     STARTED in; crossing a boundary is clipped away.
 *
 * The clip is a boolean intersection of the incoming ribbon with a mask region,
 * realized on the kernel: we build one arrangement from the ribbon PLUS the
 * region-boundary edges (so the ribbon is subdivided along every mask boundary),
 * then keep only the sub-faces whose interior lies inside the ribbon AND passes
 * the mode predicate. The kept faces are read back (curve-preserving) as the
 * clipped ribbon shape. The caller then merges that clipped shape normally.
 *
 * Pure data — no canvas, no React.
 */

import type { Point, Shape, ShapePath } from "../types.js";
import { buildArrangementFromShapes } from "./build.js";
import {
  faceInteriorPoint,
  locateFace,
  planarShapeToShape,
  pointInFace,
  pointInPolygon,
  shapePathToEdgeGeometries,
} from "./query.js";
import { edgeAt } from "./geometry.js";
import { isMergeableShape, toStageSpaceShape } from "./merge.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BrushPaintMode =
  | "normal"
  | "fills"
  | "behind"
  | "selection"
  | "inside";

/** A mergeable shape with a stage offset (the layer's display objects). */
export interface PlacedShape {
  readonly shape: Shape;
  readonly x: number;
  readonly y: number;
}

export interface BrushPaintContext {
  /** All existing mergeable shapes on the target layer (stage space, draw order). */
  readonly existing: readonly PlacedShape[];
  /**
   * The subset of `existing` that is currently selected — used by the
   * "selection" mode to build the mask. Optional; empty ⇒ nothing to paint.
   */
  readonly selection?: readonly PlacedShape[];
  /**
   * Stroke start point (stage space) — used by the "inside" mode to lock the
   * paint to the region the stroke began in.
   */
  readonly startPoint?: Point | null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Strip fill+stroke from a shape's paths so it contributes only CUTTING edges. */
function toBoundaryShape(shape: Shape): Shape {
  return {
    id: shape.id + "-cut",
    paths: shape.paths.map((p) => {
      const { fill: _f, stroke: _s, ...rest } = p;
      return { ...rest } as ShapePath;
    }),
  };
}

/** Flatten a shape's paths to chord polygons (one per closed path) for point tests. */
function shapeChordPolys(shape: Shape): Point[][] {
  const polys: Point[][] = [];
  for (const path of shape.paths) {
    const poly: Point[] = [];
    for (const g of shapePathToEdgeGeometries(path)) {
      if (poly.length === 0) poly.push(g.p0);
      if (g.control === null) {
        poly.push(g.p1);
      } else {
        for (let i = 1; i <= 8; i++) poly.push(edgeAt(g, i / 8));
      }
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

/** True when `pt` lies inside the filled area of `shape` (any of its fill polys). */
function pointInShapeFill(polys: readonly Point[][], pt: Point): boolean {
  // Even-odd across all polygons approximates the filled interior well enough for
  // a ribbon (a simple, mostly-convex outline). Nested hole loops toggle out.
  let inside = false;
  for (const poly of polys) {
    if (pointInPolygon(pt, poly)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clip an incoming brush ribbon to the region allowed by `mode`. Returns the
 * clipped ribbon as a stage-space {@link Shape} (place at x=0,y=0), or `null`
 * when the mode leaves nothing to paint (the caller should then commit nothing).
 *
 * For "normal" the ribbon is returned unchanged (baked to stage space).
 *
 * @param incoming  The brush ribbon display object (solid-fill shape + offset).
 * @param mode      The Flash 8 brush paint mode.
 * @param ctx       Existing layer art / selection / stroke start.
 */
export function clipBrushStroke(
  incoming: PlacedShape,
  mode: BrushPaintMode,
  ctx: BrushPaintContext
): Shape | null {
  const ribbon = toStageSpaceShape(incoming);
  if (mode === "normal") return ribbon;
  if (ribbon.paths.length === 0) return null;

  // The mask region is derived from the existing mergeable art (stage space).
  const existingStage = ctx.existing
    .filter((e) => isMergeableShape(e.shape))
    .map(toStageSpaceShape);

  // Build a predicate `keep(interiorPoint)` deciding whether a sub-face of the
  // ribbon should be painted, plus the set of boundary shapes whose edges must
  // subdivide the ribbon so the predicate is representative per sub-face.
  let keep: (pt: Point) => boolean;
  let boundaries: Shape[];

  switch (mode) {
    case "fills": {
      // Paint only over existing fills. Region = existing filled faces.
      if (existingStage.length === 0) return null;
      const regionPS = buildArrangementFromShapes(existingStage);
      keep = (pt) => {
        const f = locateFace(regionPS, pt);
        return f !== null && f.fill !== null;
      };
      boundaries = existingStage.map(toBoundaryShape);
      break;
    }
    case "behind": {
      // Paint only where empty. Region = complement of existing filled faces.
      if (existingStage.length === 0) return ribbon; // all empty ⇒ paint anywhere
      const regionPS = buildArrangementFromShapes(existingStage);
      keep = (pt) => {
        const f = locateFace(regionPS, pt);
        return f === null || f.fill === null;
      };
      boundaries = existingStage.map(toBoundaryShape);
      break;
    }
    case "selection": {
      // Paint only within the current selection's filled region(s).
      const selStage = (ctx.selection ?? [])
        .filter((e) => isMergeableShape(e.shape))
        .map(toStageSpaceShape);
      if (selStage.length === 0) return null;
      const regionPS = buildArrangementFromShapes(selStage);
      keep = (pt) => {
        const f = locateFace(regionPS, pt);
        return f !== null && f.fill !== null;
      };
      boundaries = selStage.map(toBoundaryShape);
      break;
    }
    case "inside": {
      // Start-region-locked. If the stroke started inside an existing fill, lock
      // to THAT face; if it started on empty, lock to the empty background.
      const start = ctx.startPoint ?? null;
      boundaries = existingStage.map(toBoundaryShape);
      if (existingStage.length === 0) {
        // Nothing to bound: whole layer is one empty region → paint anywhere.
        return ribbon;
      }
      const regionPS = buildArrangementFromShapes(existingStage);
      const startFace = start ? locateFace(regionPS, start) : null;
      if (startFace && startFace.fill !== null) {
        keep = (pt) => pointInFace(regionPS, startFace, pt);
      } else {
        // Started on empty (or unknown) → lock to the empty background.
        keep = (pt) => {
          const f = locateFace(regionPS, pt);
          return f === null || f.fill === null;
        };
      }
      break;
    }
    default:
      return ribbon;
  }

  return clipRibbonToPredicate(ribbon, boundaries, keep);
}

/**
 * Intersect the ribbon with a mask predicate on the kernel: subdivide the ribbon
 * along the boundary edges, then keep sub-faces whose interior is inside the
 * ribbon fill AND accepted by `keep`. Returns the clipped ribbon, or null.
 */
function clipRibbonToPredicate(
  ribbon: Shape,
  boundaries: readonly Shape[],
  keep: (pt: Point) => boolean
): Shape | null {
  const ribbonPolys = shapeChordPolys(ribbon);
  // Build one arrangement: boundary edges (no fill) subdivide, ribbon carries the
  // only fill so a face is "inside the ribbon" iff it picked up a non-null fill.
  const ps = buildArrangementFromShapes([...boundaries, ribbon]);

  const keptFaceIds = new Set<number>();
  for (const f of ps.faces) {
    if (f.unbounded || f.fill === null) continue; // must be inside the ribbon
    const ip = faceInteriorPoint(ps, f);
    if (!ip) continue;
    // Guard against boundary-only faces that the kernel may have colored via
    // sampling: require the interior to actually be in the ribbon outline too.
    if (!pointInShapeFill(ribbonPolys, ip)) continue;
    if (keep(ip)) keptFaceIds.add(f.id);
  }
  if (keptFaceIds.size === 0) return null;

  const clipped = planarShapeToShape(ps, ribbon.id, {
    faceFilter: (fid) => keptFaceIds.has(fid),
    edgeFilter: () => false, // brush ribbon emits fills only, never strokes
  });
  return clipped.paths.length > 0 ? clipped : null;
}
