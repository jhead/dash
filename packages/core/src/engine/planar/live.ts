/**
 * P3 — the LIVE planar map for selection.
 *
 * Partial face/segment selection + split-on-move need the in-memory
 * {@link PlanarShape} arrangement (faces, half-edges) for the merged artwork that
 * the merge-on-commit path stored back as a single per-path {@link Shape} (a
 * `ShapeDisplayObject` at `x=0,y=0` whose geometry is in stage space). We derive
 * it on demand by re-building the arrangement from that shape, memoized by the
 * shape's object IDENTITY: every immutable timeline mutation produces a NEW
 * `Shape` object, so identity is a correct cache key and an old entry is GC'd when
 * the shape is replaced (move / undo). No eviction logic, no leaks.
 *
 * This keeps the dissolve at READ-BACK but exposes the LIVE map for selection —
 * which is exactly the §3.0 gap the P3 work needed (docs/36-vector-merge-model.md).
 */

import type { PlanarShape, Shape } from "../types.js";
import { buildArrangementFromShapes } from "./build.js";

const cache = new WeakMap<Shape, PlanarShape>();

/**
 * Derive (rebuild-on-demand, memoized by `Shape` identity) the live
 * {@link PlanarShape} for one merged shape. The shape's paths are assumed to be
 * in the kernel's coordinate space (the merged display object is at `x=0,y=0`, so
 * stage space == local space == kernel space — see merge.ts foldShapeIntoLayer).
 */
export function livePlanarShape(shape: Shape): PlanarShape {
  const hit = cache.get(shape);
  if (hit) return hit;
  const ps = buildArrangementFromShapes([shape]);
  cache.set(shape, ps);
  return ps;
}
