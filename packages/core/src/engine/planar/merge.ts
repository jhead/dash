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
import { planarShapeToShape } from "./query.js";

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

  const { merged } = foldShapeIntoLayer(mergeable, incoming, incoming.shape.id);
  if (!merged || merged.paths.length === 0) return null;

  const mergedObj = makeMergedObject(merged);
  // Pass-through (non-shape / gradient / bitmap) objects keep their original
  // relative order; the merged planar artwork goes on top.
  return [...passthrough, mergedObj];
}
