/**
 * Paint Bucket / Eyedropper correctness helpers (task 1389).
 *
 * The StageArea handlers for the Paint Bucket ("fill") and Eyedropper tools used
 * to hit-test a shape by its axis-aligned bounding box and then act on the WHOLE
 * shape:
 *   - Paint Bucket recolored EVERY path of the hit shape, so a click anywhere in
 *     the bbox — even outside the actual geometry, or inside a different enclosed
 *     region of the same object — repainted the entire object instead of the one
 *     enclosed region under the cursor.
 *   - The Eyedropper reported only the shape id, so the caller auto-switched to
 *     Paint Bucket vs Ink Bottle by whether the shape HAD a fill, not by whether
 *     the click landed on a stroke or a fill (docs/04 wants the auto-switch keyed
 *     on the sampled attribute at the click location).
 *
 * These pure helpers use the planar merge map (the "shape soup" arrangement) to
 * pick the actual region/attribute under the cursor. They operate in the shape's
 * own coordinate space (for a merged shape committed at x=0,y=0 that is stage
 * space — see engine/planar/live.ts).
 */

import type { Fill, Point, PlanarShape, Shape } from "@flash/core";
import {
  buildArrangementFromShapes,
  planarShapeToShape,
  livePlanarShape,
  pickAt as planarPickAt,
  planar,
} from "@flash/core";

/**
 * The connected region under the cursor: faces reachable from `startFace` across
 * NON-stroked seams that carry the SAME fill value (including the `null` /
 * unfilled case, so a bucket click inside a line-enclosed but currently unfilled
 * area recolors just that area). A stroked seam is always a boundary — this is
 * what makes a line-split fill fillable region-by-region.
 */
function connectedRegion(ps: PlanarShape, startFace: number): Set<number> {
  const out = new Set<number>([startFace]);
  const fill = ps.faces[startFace].fill;
  const stack = [startFace];
  while (stack.length > 0) {
    const fid = stack.pop()!;
    for (const he of ps.halfEdges) {
      if (he.face !== fid) continue;
      // A stroked seam splits regions; never dissolve across it.
      if (he.lineStyle !== null && he.lineStyle !== undefined) continue;
      const nbId = ps.halfEdges[he.twin].face;
      const nb = ps.faces[nbId];
      if (!nb || nb.unbounded) continue;
      if (nb.fill === fill && !out.has(nbId)) {
        out.add(nbId);
        stack.push(nbId);
      }
    }
  }
  return out;
}

/**
 * Paint-bucket a single enclosed region under `pt` (in the shape's own space).
 *
 * Returns a NEW {@link Shape} with only the region under the cursor recolored to
 * `fill` (or with its fill removed when `fill === null`), or `null` when there is
 * no enclosed region under the point — the caller then leaves the shape untouched
 * and (if desired) tries the next shape. This fixes clicking in an empty part of
 * a shape's bbox and clicking a different region of the same object.
 */
export function bucketFillRegion(
  shape: Shape,
  pt: Point,
  fill: Fill | null,
  resultId: string = shape.id,
): Shape | null {
  // Build a FRESH arrangement (not the memoized live map) — we mutate face fills.
  const ps = buildArrangementFromShapes([shape]);
  const face = planar.locateFace(ps, pt);
  if (!face || face.unbounded) return null;

  const region = connectedRegion(ps, face.id);

  let fills = ps.fills;
  let targetIndex: number | null;
  if (fill === null) {
    targetIndex = null;
  } else {
    targetIndex = ps.fills.length;
    fills = [...ps.fills, fill];
  }
  for (const fid of region) {
    (ps.faces[fid] as { fill: number | null }).fill = targetIndex;
  }

  const psMod: PlanarShape = { ...ps, fills };
  return planarShapeToShape(psMod, resultId);
}

/**
 * Sample which attribute — the FILL body or a STROKE — lies under `pt` (in the
 * shape's own space), so the Eyedropper can auto-switch to Paint Bucket (fill) or
 * Ink Bottle (stroke) keyed on the click location. Returns `null` when the point
 * is over neither (outside the geometry).
 */
export function sampleAttributeAt(
  shape: Shape,
  pt: Point,
  tolPx = 4,
): "fill" | "stroke" | null {
  // Read-only pick on the memoized live map.
  const ps = livePlanarShape(shape);
  const key = planarPickAt(ps, pt, tolPx);
  if (!key) return null;
  return key.kind === "segment" ? "stroke" : "fill";
}
