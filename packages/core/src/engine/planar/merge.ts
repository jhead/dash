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
export function toStageSpaceShape(obj: { shape: Shape; x: number; y: number }): Shape {
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
// Spatial culling (task 1327, corrected by task 1329) — bounded per-stroke fold
// on dense art, geometrically IDENTICAL to the full whole-layer rebuild.
//
// The planar kernel's per-edge `insertEdge` scans every existing half-edge, so
// folding N shapes with E total edges is ~O(E^2), plus the per-face fill resolve
// is O(F * R). On a dense layer (a traced bitmap with 1000+ solid fills) a single
// new stroke therefore "rebuilds the world" and hitches ~250-400 ms.
//
// CORRECT CULL INVARIANT (task 1329). The merge is TOP-WINS / draw-order
// dependent: when two shapes overlap, the LATER-drawn one wins the overlap. The
// full rebuild folds EVERY mergeable shape into ONE kernel arrangement in draw
// order, so every pairwise overlap — existing<->existing AND existing<->incoming —
// resolves in-kernel with correct top-wins. A culled fold may therefore only
// leave a shape UNTOUCHED if leaving it out cannot change ANY face of the merged
// result. That holds iff the untouched shape is bbox-disjoint from the incoming
// stroke AND from EVERY shape that gets folded — i.e. the folded set must be the
// TRANSITIVE OVERLAP CLOSURE of the incoming stroke, not merely the shapes that
// overlap the stroke directly.
//
// Why the closure (not just direct-overlap) is required (task 1329 regression):
// if existing shape A is folded (it overlaps the stroke) and existing shape B
// overlaps A but NOT the stroke, then A and B genuinely interact (top-wins between
// them). Folding only A and re-emitting B separately re-orders B relative to A in
// draw order, which can flip the color of the A<->B overlap — B was drawn on top
// of A, but re-emitting B BELOW the merged object lets A win their overlap. Pulling
// B (and anything B transitively overlaps) into the fold puts the whole interacting
// cluster through ONE kernel arrangement in original draw order, so every overlap
// resolves exactly as the full rebuild would.
//
// Why it stays correct for the UNTOUCHED shapes: by construction an untouched shape
// is bbox-disjoint from every folded shape (and from the stroke), so it shares no
// edges with the merged object — no union/cut/split is possible across that
// boundary. Its own faces are byte-identical whether or not it passes through the
// kernel, and its z-order relative to the merged object is geometrically irrelevant
// (disjoint shapes never contend for a face). Untouched shapes keep their original
// RELATIVE draw order among themselves, so any untouched<->untouched overlap also
// resolves exactly as before. The result is therefore identical to the full rebuild
// for ALL inputs — the cull only skips provably non-interacting work, turning
// O(all fills) into O(the interacting cluster). The bbox test uses a tight,
// curve-aware box (quadratic extrema) plus a 1px tolerance, so it is conservative:
// any genuinely interacting shape is always pulled in.
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
 * Spatially-culled fold (task 1327, corrected by task 1329). Partitions `existing`
 * into the TRANSITIVE OVERLAP CLOSURE of the incoming stroke (folded through the
 * kernel) and the bbox-disjoint rest (returned untouched).
 *
 * The folded set starts from the incoming stroke and grows to a fixpoint: a shape
 * joins the folded set if its stage-space bbox overlaps (or touches, within
 * {@link BBOX_OVERLAP_TOLERANCE}) the stroke OR any already-folded shape. This is
 * essential for correctness because the merge is top-wins / draw-order dependent:
 * an existing shape that overlaps another existing shape (even if it misses the
 * stroke) must be folded into the SAME kernel arrangement, in original draw order,
 * or their mutual overlap can resolve to the wrong color (the task-1329 regression).
 *
 * The folded subset is passed to {@link foldShapeIntoLayer} in its ORIGINAL draw
 * order (oldest first), with the incoming stroke last (topmost), so every overlap
 * inside the cluster resolves exactly as the full whole-layer rebuild would.
 *
 * Correctness for the UNTOUCHED shapes: by construction each is bbox-disjoint from
 * every folded shape AND from the stroke, so it shares no edges with the merged
 * object — no union/cut/split crosses that boundary, and its z-order relative to
 * the merged object is geometrically irrelevant. Untouched shapes keep their
 * original relative order among themselves. The merged artwork is therefore
 * identical to the full rebuild for ALL inputs — just bounded to the cluster that
 * actually interacts.
 */
export function foldShapeIntoLayerCulled<T extends { shape: Shape; x: number; y: number }>(
  existing: readonly T[],
  incoming: T,
  mergedId: string
): CulledFoldResult<T> {
  const incBBox = shapeStageBBox(incoming);

  // Precompute each existing shape's bbox once (null = no edges -> never overlaps).
  const bboxes: (Bound | null)[] = existing.map((e) => shapeStageBBox(e));

  // `folded[i] === true` means existing[i] is in the transitive overlap closure of
  // the incoming stroke and must be passed through the kernel. We grow the closure
  // to a fixpoint: seed it with everything overlapping the stroke, then repeatedly
  // pull in any not-yet-folded shape that overlaps a shape already in the closure.
  // The accumulating `clusterBounds` is the list of bboxes currently in the closure
  // (the stroke's bbox first); a candidate folds if it overlaps ANY of them.
  const folded: boolean[] = new Array(existing.length).fill(false);

  if (incBBox !== null) {
    // The cluster's member bboxes, seeded with the incoming stroke. Testing against
    // each member's tight bbox (rather than a coarse union) keeps the closure as
    // small as the geometry allows, preserving the perf win, while remaining exact:
    // any shape that interacts with a folded shape overlaps that member's bbox.
    const clusterBounds: Bound[] = [incBBox];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < existing.length; i++) {
        if (folded[i]) continue;
        const eb = bboxes[i];
        if (eb === null) continue;
        for (const cb of clusterBounds) {
          if (boundsOverlap(cb, eb, BBOX_OVERLAP_TOLERANCE)) {
            folded[i] = true;
            clusterBounds.push(eb);
            changed = true; // a new member can pull in further shapes -> re-scan.
            break;
          }
        }
      }
    }
  }
  // If incBBox is null (degenerate incoming with no edges) nothing overlaps it, so
  // the closure is empty and every existing shape is untouched — the stroke folds
  // alone (a no-op fold, matching the full rebuild which would also add no edges).

  const overlapping: T[] = [];
  const untouched: T[] = [];
  for (let i = 0; i < existing.length; i++) {
    if (folded[i]) overlapping.push(existing[i]);
    else untouched.push(existing[i]);
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

  // Spatial cull (task 1327, corrected by task 1329): fold the TRANSITIVE OVERLAP
  // CLOSURE of the incoming stroke through the kernel; shapes bbox-disjoint from the
  // whole interacting cluster are kept untouched. This bounds the per-stroke cost to
  // the cluster the stroke actually touches (O(cluster) instead of O(all fills))
  // while producing a result geometrically IDENTICAL to the full whole-layer rebuild
  // — untouched shapes are disjoint from every folded shape, so they cannot interact
  // with the merged artwork in any way (including z-order).
  const { merged, untouched } = foldShapeIntoLayerCulled(mergeable, incoming, incoming.shape.id);
  if (!merged || merged.paths.length === 0) return null;

  const mergedObj = makeMergedObject(merged);
  // Layer order, bottom -> top: non-mergeable pass-throughs (gradient/bitmap), then
  // the untouched disjoint mergeable shapes (in their original relative order), then
  // the freshly merged planar artwork. Placing the merged object on top is safe: by
  // the transitive-closure invariant every untouched shape is bbox-disjoint from all
  // folded geometry, so it never contends with the merged object for any face and its
  // z-position relative to it is geometrically irrelevant.
  return [...passthrough, ...untouched, mergedObj];
}
