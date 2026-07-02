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

import type { Fill, Point, PlanarShape, Shape, ShapePath } from "@flash/core";
import {
  buildArrangementFromShapes,
  planarShapeToShape,
  livePlanarShape,
  pickAt as planarPickAt,
  planar,
} from "@flash/core";

/** Paint Bucket Gap Size → gap-closing tolerance in px (0 = don't close gaps). */
export function gapSizeToPx(
  gap: "none" | "small" | "medium" | "large" | undefined,
): number {
  switch (gap) {
    case "small": return 4;
    case "medium": return 8;
    case "large": return 16;
    default: return 0;
  }
}

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

/** Endpoints of every OPEN (non-closed) path — the candidate gap ends. */
function openPathEndpoints(shape: Shape): Point[] {
  const pts: Point[] = [];
  for (const p of shape.paths) {
    if (p.closed) continue;
    pts.push(p.start);
    if (p.segments.length > 0) {
      pts.push(p.segments[p.segments.length - 1].to);
    }
  }
  return pts;
}

/**
 * Gap Size honoring: synthesize invisible bridge edges that close small breaks
 * in an outline so a leaky region becomes enclosed and fillable. Each open-path
 * endpoint is joined to its nearest OTHER open endpoint within `gapPx`. The
 * bridges carry NO fill and NO stroke, so they only add a topological boundary
 * (a straight fill edge across the gap) — they never render as a visible line,
 * matching Flash's "Close … Gaps" behavior.
 */
function gapBridges(shape: Shape, gapPx: number): ShapePath[] {
  if (gapPx <= 0) return [];
  const pts = openPathEndpoints(shape);
  const bridges: ShapePath[] = [];
  const used = new Set<number>();
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    let best = -1;
    let bestD = gapPx;
    for (let j = 0; j < pts.length; j++) {
      if (j === i || used.has(j)) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d > 0.0001 && d <= bestD) { bestD = d; best = j; }
    }
    if (best >= 0) {
      used.add(i);
      used.add(best);
      bridges.push({
        start: pts[i],
        segments: [{ type: "line", to: pts[best] }],
        closed: false,
      });
    }
  }
  return bridges;
}

/**
 * Paint-bucket a single enclosed region under `pt` (in the shape's own space).
 *
 * Returns a NEW {@link Shape} with only the region under the cursor recolored to
 * `fill` (or with its fill removed when `fill === null`), or `null` when there is
 * no enclosed region under the point — the caller then leaves the shape untouched
 * and (if desired) tries the next shape. This fixes clicking in an empty part of
 * a shape's bbox and clicking a different region of the same object.
 *
 * `gapPx` (Paint Bucket Gap Size) closes small outline breaks before flooding:
 * when the raw click lands in no enclosed region and `gapPx > 0`, the outline's
 * open endpoints are bridged (see {@link gapBridges}) and the fill is retried.
 */
export function bucketFillRegion(
  shape: Shape,
  pt: Point,
  fill: Fill | null,
  resultId: string = shape.id,
  gapPx: number = 0,
): Shape | null {
  // Build a FRESH arrangement (not the memoized live map) — we mutate face fills.
  let ps = buildArrangementFromShapes([shape]);
  let face = planar.locateFace(ps, pt);
  if ((!face || face.unbounded) && gapPx > 0) {
    // Gap Size: retry over an arrangement with the outline's gaps bridged.
    const bridges = gapBridges(shape, gapPx);
    if (bridges.length > 0) {
      ps = buildArrangementFromShapes([{ ...shape, paths: [...shape.paths, ...bridges] }]);
      face = planar.locateFace(ps, pt);
    }
  }
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

/** An axis-aligned reference rectangle for a locked gradient anchor. */
export interface LockFillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Paint Bucket Lock Fill honoring for gradient fills.
 *
 * Without Lock Fill each filled region auto-fits the gradient to its own
 * bounding box (the renderer/encoder default when a gradient carries no
 * `matrix`), so adjacent fills restart the gradient. With Lock Fill ON the
 * gradient is stamped with an explicit `matrix` anchored to a FIXED reference
 * rectangle (the first region filled while locked), so every subsequent locked
 * fill shares one coordinate frame and the gradient reads as a single
 * continuous fill spanning the objects.
 *
 * The matrix uses the shared SWF gradient-space convention honored by both the
 * stage renderer (`engine/renderer.ts`) and the SWF encoder (`swf/shapes.ts`):
 * a/b/c/d are 16.16-scale floats (screen-twips per gradient-twip; gradient space
 * spans ±16384 twips) and tx/ty are in pixels. Solid/bitmap fills pass through
 * unchanged (Lock Fill is a no-op for solids; bitmap continuity is a follow-up).
 */
export function lockGradientToRect(fill: Fill, rect: LockFillRect): Fill {
  if (fill.type !== "linear-gradient" && fill.type !== "radial-gradient") {
    return fill;
  }
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const halfLen = Math.max(rect.width, rect.height, 1) / 2;
  // Scale that maps ±16384 gradient twips onto ±halfLen px:
  //   a * 16384 / 20 = halfLen  →  a = halfLen * 20 / 16384
  const s = (halfLen * 20) / 16384;
  if (fill.type === "linear-gradient") {
    const rad = ((fill.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      ...fill,
      matrix: {
        a: cos * s,
        b: sin * s,
        c: -sin * s,
        d: cos * s,
        tx: cx,
        ty: cy,
      },
    };
  }
  // radial: unit circle radius 16384 twips → centre (tx,ty) px, radius halfLen px.
  return {
    ...fill,
    matrix: { a: s, b: 0, c: 0, d: s, tx: cx, ty: cy },
  };
}
