/**
 * P1 merge-on-commit: fold a newly-drawn merge-mode shape into a layer's planar
 * arrangement and read the result back as per-path {@link Shape}s.
 *
 * This is the TRUE planar realization of Flash 8 merge drawing, replacing the
 * AABB approximation in engine/merge-drawing.ts:
 *
 *   - **Same-color union** — two overlapping fills of the same color become ONE
 *     region (the planar face carries a single fill; the shared interior edge
 *     disappears as a fill boundary).
 *   - **Different-color cut (top wins)** — the newly-drawn (topmost) fill carves
 *     the underlying overlapped area: the overlap face resolves to the new fill
 *     and the underlying fill loses that region.
 *   - **Island / hole** — a different-color fill fully inside another carves a
 *     hole into the outer fill (the island is a hole-face of the outer face).
 *
 * Curves are preserved (the kernel splits quadratics with de Casteljau and the
 * read-back keeps true quadratics).
 *
 * Coordinate convention: the kernel works in one shared coordinate space. A
 * {@link ShapeDisplayObject} carries an `(x, y)` offset and its `shape.paths`
 * are local. {@link foldShapeIntoLayer} bakes each contributor's offset into its
 * geometry (stage space), builds the arrangement, then returns ONE merged shape
 * whose geometry is in stage space — so the caller places it at `(0, 0)`.
 */

import type { Point, Shape, ShapePath } from "../types.js";
import { buildArrangementFromShapes } from "./build.js";
import { planarShapeToShape, shapePathToEdgeGeometries } from "./query.js";
import { edgeBBox } from "./geometry.js";

/** Translate a single ShapePath by (dx, dy) (curve-preserving). */
function translatePath(path: ShapePath, dx: number, dy: number): ShapePath {
  if (dx === 0 && dy === 0) return path;
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...path,
    start: t(path.start),
    segments: path.segments.map((seg) =>
      seg.type === "line"
        ? { type: "line", to: t(seg.to) }
        : { type: "curve", control: t(seg.control), to: t(seg.to) }
    ),
  };
}

/** Bake a display object's (x, y) offset into its shape geometry (stage space). */
function toStageSpaceShape(obj: { shape: Shape; x: number; y: number }): Shape {
  return {
    id: obj.shape.id,
    paths: obj.shape.paths.map((p) => translatePath(p, obj.x, obj.y)),
  };
}

/**
 * Whether a shape participates in the planar merge map. Only fills/strokes that
 * the kernel understands (solid fills + strokes) merge; gradient/bitmap fills are
 * passed through as-is (the kernel cannot subdivide their styling meaningfully).
 *
 * We keep this conservative: a shape with ANY non-solid fill is treated as
 * non-mergeable (left untouched and re-appended), so we never destroy gradient or
 * bitmap artwork. Pure solid-fill / stroke shapes go through the arrangement.
 */
export function isMergeableShape(shape: Shape): boolean {
  for (const p of shape.paths) {
    if (p.fill && p.fill.type !== "solid") return false;
  }
  return true;
}

export interface FoldResult {
  /**
   * The single merged shape (stage space; place at x=0, y=0). Null when there
   * was nothing mergeable to fold (caller should fall back to a plain append).
   */
  readonly merged: Shape | null;
}

// ---------------------------------------------------------------------------
// Spatial culling (task 1327) — bounded per-stroke fold on dense art.
//
// The planar kernel's per-edge `insertEdge` scans every existing half-edge, so
// folding N shapes with E total edges is ~O(E^2), plus the per-face fill resolve
// is O(F * R). On a dense layer (a traced bitmap with 1000+ solid fills) a single
// new stroke therefore "rebuilds the world" and hitches ~250-400 ms.
//
// But a shape whose bounding box does NOT overlap the new stroke's bounding box
// cannot interact with it geometrically — no edges cross, so no union, cut, or
// split is possible. Such disjoint shapes are kept UNTOUCHED and only the shapes
// whose bbox overlaps the incoming stroke (plus the stroke) are folded through
// the kernel. The merged result for the overlapping subset is identical to what
// the full rebuild would produce for those same faces (the disjoint shapes
// contribute no edges to the overlap region), and the disjoint faces are
// byte-identical whether or not they pass through the kernel — so correctness is
// preserved exactly. This turns the per-stroke cost from O(all fills) into
// O(only the fills the stroke actually touches).
// ---------------------------------------------------------------------------

interface Bound {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tolerance (in px) by which a candidate's bbox is grown before the overlap
 * test. Two shapes that merely TOUCH along a shared boundary edge (e.g. the
 * coincident top/bottom edges of two adjacent rects) genuinely interact in the
 * planar map — the coincident-edge merge must see both. Padding the test makes
 * touching/near-touching candidates fold; being conservative (folding a shape
 * that turns out not to interact) only costs a little time, never correctness.
 * 1 twip = 0.05px; 1px of padding is many twips of safety margin.
 */
const BBOX_OVERLAP_TOLERANCE = 1;

/** Stage-space bounding box of a shape (curve-aware). Null if it has no edges. */
function shapeStageBBox(obj: { shape: Shape; x: number; y: number }): Bound | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const path of obj.shape.paths) {
    for (const g of shapePathToEdgeGeometries(path)) {
      const b = edgeBBox(g);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
      any = true;
    }
  }
  if (!any) return null;
  return { minX: minX + obj.x, minY: minY + obj.y, maxX: maxX + obj.x, maxY: maxY + obj.y };
}

/** Whether two bounds overlap (or touch within tolerance). */
function boundsOverlap(a: Bound, b: Bound, tol: number): boolean {
  return (
    a.minX <= b.maxX + tol &&
    a.maxX >= b.minX - tol &&
    a.minY <= b.maxY + tol &&
    a.maxY >= b.minY - tol
  );
}

/**
 * Fold a newly-drawn merge-mode shape into the existing merge-mode shapes of a
 * layer, using the planar kernel. `existing` are the layer's current merge-mode
 * shape display objects (draw order, oldest first); `incoming` is the shape just
 * committed on top. Both carry stage offsets.
 *
 * Returns a single merged {@link Shape} in stage space (one display object should
 * replace all the folded ones). Non-solid (gradient/bitmap) contributors are NOT
 * folded — the caller is responsible for re-appending them untouched; see
 * {@link planarMergeCommit}.
 *
 * Folds ALL of `existing` (no spatial culling). Prefer
 * {@link foldShapeIntoLayerCulled} on dense layers; this remains for callers /
 * tests that want the explicit whole-layer fold.
 */
export function foldShapeIntoLayer(
  existing: readonly { shape: Shape; x: number; y: number }[],
  incoming: { shape: Shape; x: number; y: number },
  mergedId: string
): FoldResult {
  // Order matters: existing first (oldest -> newest), incoming last so it is the
  // topmost in draw order and wins different-color overlaps (last-drawn wins).
  const stageShapes: Shape[] = [];
  for (const e of existing) stageShapes.push(toStageSpaceShape(e));
  stageShapes.push(toStageSpaceShape(incoming));

  if (stageShapes.length === 0) return { merged: null };

  const ps = buildArrangementFromShapes(stageShapes);
  const merged = planarShapeToShape(ps, mergedId);
  return { merged };
}

export interface CulledFoldResult<T> {
  /**
   * The single merged shape (stage space; place at x=0, y=0) of the incoming
   * stroke folded with every existing shape whose bbox overlaps it. Null when
   * the fold produced nothing.
   */
  readonly merged: Shape | null;
  /**
   * The existing display objects whose bbox did NOT overlap the incoming stroke,
   * kept UNTOUCHED (in their original relative order). They are re-emitted as-is
   * — they cannot interact with the new stroke, so re-folding them would be
   * wasted work that produces an identical result.
   */
  readonly untouched: T[];
}

/**
 * Spatially-culled fold (task 1327). Partitions `existing` into the shapes whose
 * stage-space bbox overlaps (or touches, within {@link BBOX_OVERLAP_TOLERANCE})
 * the incoming stroke's bbox and the disjoint rest. Only the overlapping subset +
 * the incoming stroke are run through the planar kernel; the disjoint shapes are
 * returned untouched.
 *
 * Correctness: a disjoint shape contributes no edges that cross the incoming
 * stroke, so its presence in (or absence from) the arrangement cannot change any
 * face the stroke touches; and an untouched shape's own faces are byte-identical
 * whether or not they pass through the kernel. The merged artwork is therefore
 * identical to the full rebuild — just bounded to the shapes that actually
 * interact.
 */
export function foldShapeIntoLayerCulled<T extends { shape: Shape; x: number; y: number }>(
  existing: readonly T[],
  incoming: T,
  mergedId: string
): CulledFoldResult<T> {
  const incBBox = shapeStageBBox(incoming);

  const overlapping: T[] = [];
  const untouched: T[] = [];
  if (incBBox === null) {
    // Degenerate incoming (no edges): nothing can overlap it; fold alone.
    for (const e of existing) untouched.push(e);
  } else {
    for (const e of existing) {
      const eb = shapeStageBBox(e);
      if (eb !== null && boundsOverlap(incBBox, eb, BBOX_OVERLAP_TOLERANCE)) {
        overlapping.push(e);
      } else {
        untouched.push(e);
      }
    }
  }

  const { merged } = foldShapeIntoLayer(overlapping, incoming, mergedId);
  return { merged, untouched };
}

/**
 * High-level commit helper for {@link ShapeDisplayObject}s on one layer.
 *
 * Partitions the layer's existing display objects into mergeable shape objects
 * (solid fills/strokes) and everything else. The mergeable shapes + the incoming
 * shape are folded into ONE planar-merged shape display object; the non-mergeable
 * objects pass through untouched (in original order). The merged object is placed
 * after the pass-through objects (it absorbs the topmost artwork).
 *
 * @returns the new ordered list of objects on the layer, OR null if the planar
 *   fold produced nothing (caller should fall back to a plain append).
 */
export interface MergeableLike {
  readonly type: string;
  readonly id: string;
  readonly shape: Shape;
  readonly x: number;
  readonly y: number;
}

export function planarMergeCommit<T extends MergeableLike>(
  layerObjects: readonly T[],
  incoming: T,
  makeMergedObject: (shape: Shape) => T
): T[] | null {
  const mergeable: T[] = [];
  const passthrough: T[] = [];
  for (const obj of layerObjects) {
    if (obj.type === "shape" && isMergeableShape(obj.shape)) mergeable.push(obj);
    else passthrough.push(obj);
  }

  if (!isMergeableShape(incoming.shape)) {
    // Incoming itself isn't mergeable — nothing to fold; append as-is.
    return null;
  }

  // Spatial cull (task 1327): only the mergeable shapes whose bbox overlaps the
  // incoming stroke are folded through the kernel; disjoint shapes are kept
  // untouched. This bounds the per-stroke cost to the shapes the stroke actually
  // touches (O(overlap) instead of O(all fills)) while producing an identical
  // merged result — disjoint shapes cannot interact with the new stroke.
  const { merged, untouched } = foldShapeIntoLayerCulled(mergeable, incoming, incoming.shape.id);
  if (!merged || merged.paths.length === 0) return null;

  const mergedObj = makeMergedObject(merged);
  // Layer order, bottom -> top: non-mergeable pass-throughs (gradient/bitmap),
  // then the untouched disjoint mergeable shapes (unchanged), then the freshly
  // merged planar artwork (absorbs the topmost stroke + everything it touched).
  return [...passthrough, ...untouched, mergedObj];
}
