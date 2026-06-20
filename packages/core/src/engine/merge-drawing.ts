/**
 * Merge-drawing model for Flash 8 vector shapes.
 *
 * SUPERSEDED (task 1319, P1): the TRUE planar merge-on-commit lives in
 * `engine/planar/merge.ts` (`planarMergeCommit` / `foldShapeIntoLayer`) + the
 * `planarShapeToShape` read-back in `engine/planar/query.ts`, wired into
 * `Shell.tsx` behind the `planarMergeOnCommit` feature flag. The AABB
 * approximation below is no longer on the commit path. It is retained only
 * because its unit tests still exercise the color/fill helpers; do NOT add new
 * callers — use the planar kernel. See docs/36-vector-merge-model.md.
 *
 * Flash's signature behavior (classic / merge-drawing mode):
 *   - Overlapping fills of the **same color** on the same layer merge into one
 *     contiguous shape.
 *   - Overlapping fills of **different colors** — the top (incoming) shape
 *     cuts away the overlapping area from the shapes beneath.
 *   - Strokes and fills are treated as independent entities.
 *
 * Full computational geometry (polygon boolean ops) is a large undertaking.
 * This MVP implementation provides:
 *   1. A `colorKey` helper to compare fill colors.
 *   2. `mergeShapes` — applies merge-drawing rules to two shapes and returns
 *      the resulting merged shape.  This is the canonical low-level merge
 *      primitive; `mergeDraw` and `applyMergeDrawing` both delegate to it.
 *   3. `mergeDraw` — the canonical entry point that applies Flash merge-drawing
 *      rules to a flat list of Shape objects and returns an updated array.
 *   4. `applyMergeDrawing` — applies an incoming ShapeDisplayObject to a
 *      layer's DisplayObject list, applying transform-aware stage-space overlap
 *      detection and delegating per-shape merge logic to `mergeDraw`.
 *
 * SIMPLIFICATION NOTE: The overlap detection uses axis-aligned bounding boxes
 * (AABB) refined by polygon vertex and edge intersection tests.  This is accurate
 * for rectangles and ovals but may mis-classify highly concave or rotated shapes.
 * A production implementation would substitute exact polygon clipping (e.g.
 * Sutherland–Hodgman, martinez, or polybool) at the same call sites without
 * changing the public API.
 *
 * BEZIER PRESERVATION: The polygon approximation (pathToPolygon) is used ONLY
 * for overlap detection and point-in-polygon tests.  It is NEVER written back
 * into shape data — all ShapePath objects that appear in the output are either
 * the original input ShapePath objects (reference-equal) or new ShapePath objects
 * whose segments contain only the original Bezier/line data.
 */

import type { Color, DisplayObject, Fill, Shape, ShapeDisplayObject, ShapePath } from "./types.js";
import type { Point } from "./types.js";

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/**
 * Returns a stable string key for a fill so we can compare two fills for
 * "same colour" equality.
 */
function fillKey(fill: Fill): string {
  if (fill.type === "solid") {
    const { r, g, b, a } = fill.color;
    return `solid:${r},${g},${b},${a}`;
  }
  // Future fill types would add cases here.
  return JSON.stringify(fill);
}

/**
 * Returns true when two colors are identical (all channels equal).
 */
export function colorsEqual(a: Color, b: Color): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

// ---------------------------------------------------------------------------
// Bounding-box helpers (used as a spatial approximation for MVP)
// ---------------------------------------------------------------------------

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Compute an axis-aligned bounding box for a ShapePath. */
function pathBBox(path: ShapePath): BBox {
  let minX = path.start.x;
  let minY = path.start.y;
  let maxX = path.start.x;
  let maxY = path.start.y;

  for (const seg of path.segments) {
    minX = Math.min(minX, seg.to.x);
    minY = Math.min(minY, seg.to.y);
    maxX = Math.max(maxX, seg.to.x);
    maxY = Math.max(maxY, seg.to.y);

    if (seg.type === "curve") {
      minX = Math.min(minX, seg.control.x);
      minY = Math.min(minY, seg.control.y);
      maxX = Math.max(maxX, seg.control.x);
      maxY = Math.max(maxY, seg.control.y);
    }
  }

  return { minX, minY, maxX, maxY };
}

/** Compute bounding box for an entire shape (union of all path bboxes). */
function shapeBBox(shape: Shape): BBox {
  if (shape.paths.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let bbox = pathBBox(shape.paths[0]);
  for (let i = 1; i < shape.paths.length; i++) {
    const b = pathBBox(shape.paths[i]);
    bbox = {
      minX: Math.min(bbox.minX, b.minX),
      minY: Math.min(bbox.minY, b.minY),
      maxX: Math.max(bbox.maxX, b.maxX),
      maxY: Math.max(bbox.maxY, b.maxY),
    };
  }

  return bbox;
}

/** Returns true when two bounding boxes overlap. */
function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

// ---------------------------------------------------------------------------
// Core merge-drawing logic
// ---------------------------------------------------------------------------

/**
 * Result of applying merge-drawing between two shapes.
 */
export interface MergeResult {
  /** Paths that survive from the existing shape (minus any cut areas). */
  readonly survivingPaths: readonly ShapePath[];
  /** Paths from the incoming shape to add. */
  readonly incomingPaths: readonly ShapePath[];
}

/**
 * Apply merge-drawing semantics between an `existing` shape and an `incoming`
 * shape.  The incoming shape is drawn "on top of" the existing one.
 *
 * Rules (MVP approximation using bounding boxes):
 *   - Where fills have the **same key**: both shapes' paths in the overlapping
 *     area are merged (incoming paths are just appended — the renderer will
 *     naturally union same-fill areas via Canvas `nonzero` winding rule).
 *   - Where fills have **different keys**: the incoming shape's fill cuts the
 *     existing shape.  In the MVP this removes existing paths whose bounding
 *     boxes are fully contained within the incoming shape's bounding box.
 *     A production build would do exact polygon boolean subtraction here.
 *
 * @param existing  The shape already on the layer.
 * @param incoming  The newly drawn shape being applied.
 * @returns `MergeResult` describing which paths survive.
 */
export function mergeShapes(existing: Shape, incoming: Shape): MergeResult {
  const incomingBBox = shapeBBox(incoming);

  const survivingPaths: ShapePath[] = [];

  for (const existingPath of existing.paths) {
    if (!existingPath.fill) {
      // Stroke-only paths survive unconditionally (not affected by fill merging).
      survivingPaths.push(existingPath);
      continue;
    }

    const existingBBox = pathBBox(existingPath);

    if (!bboxOverlap(existingBBox, incomingBBox)) {
      // No spatial overlap — path survives unchanged.
      survivingPaths.push(existingPath);
      continue;
    }

    // There is spatial overlap.  Check whether any incoming fill matches.
    const existingFillKey = fillKey(existingPath.fill);
    const hasSameFill = incoming.paths.some(
      (ip) => ip.fill && fillKey(ip.fill) === existingFillKey
    );

    if (hasSameFill) {
      // Same color: keep existing path (renderer unites them via winding rule).
      survivingPaths.push(existingPath);
    } else {
      // Different color: incoming cuts existing.
      // MVP: drop existing paths fully contained within the incoming bbox.
      const fullyContained =
        existingBBox.minX >= incomingBBox.minX &&
        existingBBox.minY >= incomingBBox.minY &&
        existingBBox.maxX <= incomingBBox.maxX &&
        existingBBox.maxY <= incomingBBox.maxY;

      if (!fullyContained) {
        // Partial overlap — keep existing path (production would subtract).
        survivingPaths.push(existingPath);
      }
      // Fully-contained paths are dropped (cut away by the incoming shape).
    }
  }

  return {
    survivingPaths,
    incomingPaths: [...incoming.paths],
  };
}

/**
 * Apply an incoming `ShapeDisplayObject` to an existing list of display
 * objects on the same layer, following merge-drawing semantics.
 *
 * Non-shape display objects (instances, drawing-objects) are never affected.
 * ShapeDisplayObjects whose stage-space geometry overlaps the incoming shape
 * interact with it.  The full display-object transform (x, y, scaleX, scaleY,
 * rotation) is applied when computing stage-space bounds so that shapes at
 * different offsets, scales, or rotations are compared correctly.
 *
 * Returns a new display-object list reflecting the merge-drawing result.
 */
export function applyMergeDrawing(
  layerObjects: readonly DisplayObject[],
  incoming: ShapeDisplayObject
): readonly DisplayObject[] {
  const result: DisplayObject[] = [];

  // Build a stage-space (world) version of the incoming shape's paths for
  // overlap testing.  We translate by (x, y) and apply scale; rotation is
  // handled via pathToPolygon + transformPoint below.
  const incomingWorldPaths = incoming.shape.paths.map((p) =>
    transformPath(p, incoming.x, incoming.y, incoming.scaleX ?? 1, incoming.scaleY ?? 1, incoming.rotation ?? 0)
  );
  const incomingWorldShape: Shape = { id: incoming.shape.id, paths: incomingWorldPaths };

  for (const obj of layerObjects) {
    if (obj.type !== "shape") {
      // Non-shape display objects are never affected.
      result.push(obj);
      continue;
    }

    // Transform the existing shape's paths to stage space for overlap testing.
    const objWorldPaths = obj.shape.paths.map((p) =>
      transformPath(p, obj.x, obj.y, obj.scaleX ?? 1, obj.scaleY ?? 1, obj.rotation ?? 0)
    );
    const objWorldShape: Shape = { id: obj.shape.id, paths: objWorldPaths };

    // Check stage-space bounding box overlap as a quick rejection test.
    const objBBox = shapeBBox(objWorldShape);
    const incomingBBox = shapeBBox(incomingWorldShape);
    if (!bboxOverlap(objBBox, incomingBBox)) {
      // No overlap in stage space — unaffected.
      result.push(obj);
      continue;
    }

    // There is stage-space overlap; apply merge logic using world-space shapes.
    // The surviving paths from mergeShapes are world-space paths (for detection
    // purposes) — but we must track which ORIGINAL (local-space) paths survive,
    // because we must not write transformed geometry back into the document.
    //
    // Strategy: run mergeShapes on world-space shapes to get the set of
    // surviving world-space paths, then map those back to the corresponding
    // original local-space paths by index.
    const { survivingPaths: survivingWorldPaths } = mergeShapes(objWorldShape, incomingWorldShape);

    // Map world-space surviving paths back to original local-space paths by
    // matching on path identity (world path at index i corresponds to original
    // path at index i).
    const survivingOriginalPaths = obj.shape.paths.filter((_, i) => {
      const worldPath = objWorldPaths[i];
      return survivingWorldPaths.includes(worldPath);
    });

    if (survivingOriginalPaths.length === 0) {
      // All paths were cut away — drop this display object entirely.
      continue;
    }

    // Rebuild the shape with surviving paths (original, untransformed geometry).
    const updatedObj: ShapeDisplayObject = {
      ...obj,
      shape: { ...obj.shape, paths: survivingOriginalPaths },
    };
    result.push(updatedObj);
  }

  // Append the incoming shape as a new display object at the end.
  result.push(incoming);

  return result;
}

// ---------------------------------------------------------------------------
// Geometry utilities (used by mergeDraw)
// ---------------------------------------------------------------------------

/**
 * Apply a 2-D affine transform (translate + uniform scale + rotation) to a
 * single point.  Used to bring local-space paths into stage space for overlap
 * testing.
 *
 * The transform order matches Flash's display-object matrix:
 *   1. Scale (scaleX, scaleY) around the local origin.
 *   2. Rotate (clockwise, in degrees) around the local origin.
 *   3. Translate by (tx, ty).
 */
function transformPoint(p: Point, tx: number, ty: number, scaleX: number, scaleY: number, rotationDeg: number): Point {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Scale then rotate then translate.
  const sx = p.x * scaleX;
  const sy = p.y * scaleY;
  return {
    x: sx * cos - sy * sin + tx,
    y: sx * sin + sy * cos + ty,
  };
}

/**
 * Return a new ShapePath whose control points have been transformed by the
 * given display-object matrix.  The original segment types (line / curve) are
 * preserved; no Bezier data is discarded.
 */
function transformPath(
  path: ShapePath,
  tx: number,
  ty: number,
  scaleX: number,
  scaleY: number,
  rotationDeg: number
): ShapePath {
  const xf = (p: Point) => transformPoint(p, tx, ty, scaleX, scaleY, rotationDeg);

  return {
    ...path,
    start: xf(path.start),
    segments: path.segments.map((seg) => {
      if (seg.type === "line") {
        return { type: "line" as const, to: xf(seg.to) };
      } else {
        return { type: "curve" as const, control: xf(seg.control), to: xf(seg.to) };
      }
    }),
  };
}

/**
 * Point-in-polygon test using ray casting.
 * Returns true when `point` lies strictly inside `polygon`.
 * Points exactly on the boundary may return either true or false (acceptable
 * for the approximation-level guarantees of this module).
 */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

/**
 * Approximate a ShapePath as a flat polygon by sampling points along each
 * segment.  Line segments contribute their endpoint; quadratic Bézier curves
 * are sampled at `samplesPerCurve` equally-spaced parameter values plus the
 * endpoint.
 *
 * Default: 8 samples per curve — sufficient for typical Flash shapes (ovals,
 * rounded rectangles) at this approximation level.
 *
 * IMPORTANT: The returned polygon is used ONLY for overlap/containment tests.
 * It is NEVER written back into shape data.
 */
function pathToPolygon(path: ShapePath, samplesPerCurve = 8): Point[] {
  const pts: Point[] = [path.start];
  let prev: Point = path.start;

  for (const seg of path.segments) {
    if (seg.type === "line") {
      pts.push(seg.to);
    } else {
      // Quadratic Bézier: B(t) = (1-t)²·prev + 2(1-t)t·control + t²·to
      const cp = seg.control;
      for (let s = 1; s <= samplesPerCurve; s++) {
        const t = s / samplesPerCurve;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * prev.x + 2 * mt * t * cp.x + t * t * seg.to.x,
          y: mt * mt * prev.y + 2 * mt * t * cp.y + t * t * seg.to.y,
        });
      }
    }
    prev = seg.to;
  }

  return pts;
}

/**
 * Compute the intersection point of two finite line segments [p1,p2] and
 * [p3,p4]. Returns null if the segments are parallel or do not intersect
 * within their finite extents.
 */
function lineLineIntersect(
  p1: Point, p2: Point,
  p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null; // parallel / collinear

  const dx = p3.x - p1.x, dy = p3.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denom;
  const u = (dx * d1y - dy * d1x) / denom;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null; // outside segment extents

  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * Compute the axis-aligned bounding box of a set of points.
 */
function pointsBounds(
  points: Point[]
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = points[0].x, minY = points[0].y;
  let maxX = points[0].x, maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Check if two bounding boxes overlap (quick rejection test).
 */
function boundsOverlap(
  a: ReturnType<typeof pointsBounds>,
  b: ReturnType<typeof pointsBounds>
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * Check if two polygon arrays have any overlapping region using a combination
 * of point-in-polygon tests and bounds overlap.
 *
 * This is an approximation: it returns true if the bounding boxes overlap AND
 * at least one vertex of either polygon lies inside the other, OR if the
 * bounding boxes fully contain one another. For the MVP accuracy level this
 * is sufficient.
 */
function polygonsOverlap(a: Point[], b: Point[]): boolean {
  const ba = pointsBounds(a);
  const bb = pointsBounds(b);
  if (!boundsOverlap(ba, bb)) return false;

  // Check if any vertex of `a` is inside `b` or vice-versa.
  for (const p of a) {
    if (pointInPolygon(p, b)) return true;
  }
  for (const p of b) {
    if (pointInPolygon(p, a)) return true;
  }

  // Check edge intersections (handles cross-shaped overlaps where no vertex
  // is inside the other polygon).
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j], b2 = b[(j + 1) % b.length];
      if (lineLineIntersect(a1, a2, b1, b2) !== null) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Fill comparison
// ---------------------------------------------------------------------------

/**
 * Compare two fills for "same color" equality.
 * Two SolidFills are equal iff all four RGBA channels match.
 * Gradient fills are never considered equal for merge purposes (each gradient
 * is unique enough that merging them is undefined behavior in Flash).
 */
export function fillsEqual(a: Fill | undefined, b: Fill | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.type !== "solid" || b.type !== "solid") return false;
  return colorsEqual(a.color, b.color);
}

// ---------------------------------------------------------------------------
// mergeDraw — canonical entry point
// ---------------------------------------------------------------------------

/**
 * Apply Flash merge-drawing rules when a new shape is placed on a layer.
 *
 * For each fill path in `newShape`, the function inspects every existing shape
 * and applies the following rules:
 *
 *   1. **Same-color fills overlap** → the paths are kept as separate sub-paths
 *      within the merged shape.  The Canvas 2D renderer's nonzero winding rule
 *      produces the correct visual union without requiring a convex-hull or
 *      polygon boolean computation, and the original Bezier data is preserved
 *      exactly.
 *   2. **Different-color fills overlap** → the new shape cuts the existing fill.
 *      For the MVP this removes existing paths fully contained within the new
 *      shape's bounding box; partially-overlapping paths are preserved (a
 *      production build would subtract the exact intersection polygon).
 *   3. **Stroke drawn across fill** → the stroke is recorded in the output and
 *      the fill is split conceptually (MVP: both survive; full segmentation
 *      requires a planar subdivision which is outside this MVP scope).
 *   4. **Stroke + stroke overlap** → strokes replace each other (top wins, so
 *      existing strokes fully covered by the new stroke's path are removed).
 *   5. **Object Drawing mode** (`objectDrawing = true`) → no interaction; the
 *      new shape is simply appended.
 *
 * SIMPLIFICATION: Overlap detection uses axis-aligned bounding boxes with
 * polygon vertex and edge tests (see `polygonsOverlap`). This is accurate for
 * rectangles and ovals but may mis-classify highly concave or rotated shapes.
 *
 * All inputs are treated as immutable; no input object is mutated.
 *
 * @param existingShapes - Shapes currently on the layer (draw order, oldest first).
 * @param newShape       - The shape just drawn (on top of all existing shapes).
 * @param objectDrawing  - When true, skip merge-drawing (Object Drawing mode).
 * @returns New array of shapes after applying merge-drawing interactions.
 */
export function mergeDraw(
  existingShapes: Shape[],
  newShape: Shape,
  objectDrawing = false
): Shape[] {
  // Object Drawing mode: no interaction with existing shapes.
  if (objectDrawing) {
    return [...existingShapes, newShape];
  }

  // Build a mutable working copy: each existing shape as an array of surviving
  // paths.  We process new paths one by one against every existing shape.
  const survivingPathsPerShape: ShapePath[][] = existingShapes.map((s) =>
    [...s.paths]
  );

  // Paths that will become part of the final new shape (may grow via merges).
  // We accumulate the original incoming paths plus any same-color paths absorbed
  // from existing shapes; original Bezier data is always preserved.
  let mergedNewPaths: ShapePath[] = [...newShape.paths];

  for (let si = existingShapes.length - 1; si >= 0; si--) {
    const workingPaths = survivingPathsPerShape[si];

    // We'll rebuild workingPaths after processing.
    const nextPaths: ShapePath[] = [];

    for (const existingPath of workingPaths) {
      const existingPoly = pathToPolygon(existingPath);
      const existingBounds = pointsBounds(existingPoly);

      let pathSurvives = true; // whether existingPath goes into nextPaths

      for (let ni = 0; ni < mergedNewPaths.length; ni++) {
        const newPath = mergedNewPaths[ni];
        const newPoly = pathToPolygon(newPath);
        const newBounds = pointsBounds(newPoly);

        // Quick bounds rejection.
        if (!boundsOverlap(existingBounds, newBounds)) continue;

        // Deeper overlap check.
        if (!polygonsOverlap(existingPoly, newPoly)) continue;

        // ----------------------------------------------------------------
        // Determine the type of interaction.
        // ----------------------------------------------------------------

        const existingIsFill = existingPath.fill !== undefined;
        const newIsFill = newPath.fill !== undefined;
        const existingIsStroke = !existingIsFill && existingPath.stroke !== undefined;
        const newIsStroke = !newIsFill && newPath.stroke !== undefined;

        if (existingIsFill && newIsFill) {
          if (fillsEqual(existingPath.fill, newPath.fill)) {
            // --- UNION: same-color fills merge ---
            //
            // Instead of computing a convex hull (which would corrupt concave
            // shapes like L-shapes and discard Bezier data), we keep both paths
            // as separate sub-paths within the merged shape.  The Canvas 2D
            // renderer uses the nonzero winding rule by default, which produces
            // the correct visual union for overlapping same-color fills.
            //
            // The existing path is absorbed into mergedNewPaths so that it
            // travels with the new shape and is rendered together with it.
            mergedNewPaths = [...mergedNewPaths, existingPath];
            pathSurvives = false; // absorbed into the new shape
          } else {
            // --- SUBTRACT: different-color fill cuts existing ---
            // MVP: drop existing path if fully contained in new shape bbox.
            const fullyContained =
              existingBounds.minX >= newBounds.minX &&
              existingBounds.minY >= newBounds.minY &&
              existingBounds.maxX <= newBounds.maxX &&
              existingBounds.maxY <= newBounds.maxY;
            if (fullyContained) {
              pathSurvives = false;
            }
            // Partial overlap: keep existing (production would subtract polygon).
          }
        } else if (existingIsFill && newIsStroke) {
          // --- SEGMENT: stroke crosses fill ---
          // MVP: both paths survive; the fill is not geometrically split.
          // A full implementation would insert intersection points as vertices
          // and output two separate fill sub-paths.
          // pathSurvives remains true, newPath is also appended as-is.
        } else if (existingIsStroke && newIsStroke) {
          // --- STROKE REPLACEMENT: top stroke wins ---
          // Check if the new stroke completely covers the existing stroke's
          // bounding box (simple approximation).
          const existingFullyCovered =
            existingBounds.minX >= newBounds.minX &&
            existingBounds.minY >= newBounds.minY &&
            existingBounds.maxX <= newBounds.maxX &&
            existingBounds.maxY <= newBounds.maxY;
          if (existingFullyCovered) {
            pathSurvives = false;
          }
        }
        // existingIsStroke && newIsFill: fill does not erase strokes (same as
        // mergeShapes behavior — stroke-only paths survive unconditionally).

        // Once pathSurvives is false there's no need to check further new paths.
        if (!pathSurvives) break;
      }

      if (pathSurvives) {
        nextPaths.push(existingPath);
      }
    }

    survivingPathsPerShape[si] = nextPaths;
  }

  // Reconstruct the output shape list.
  const result: Shape[] = [];

  for (let si = 0; si < existingShapes.length; si++) {
    const remaining = survivingPathsPerShape[si];
    if (remaining.length === 0) continue; // shape fully consumed
    result.push({
      id: existingShapes[si].id,
      paths: remaining,
    });
  }

  // Append the (possibly augmented) new shape.
  if (mergedNewPaths.length > 0) {
    result.push({
      id: newShape.id,
      paths: mergedNewPaths,
    });
  }

  return result;
}
