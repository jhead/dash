/**
 * Render-faithful RASTER oracle for the planar merge fold (task 1330).
 *
 * The previous merge-correctness oracle measured per-color *face area* by
 * re-running `buildArrangementFromShapes` on the merged path-soup and summing
 * `faceArea` over `locateFace`-resolved faces. That abstract oracle is NOT
 * render-faithful: re-arranging the read-back path-soup and resolving a point
 * into an abstract face can land in a different face than the actual renderer
 * paints (it both misses real regressions and reports false divergences — the
 * Δ144 "leak" in task 1330 was exactly such an artifact, with diff=0 confirmed
 * at the real CanvasRenderer).
 *
 * This oracle instead RASTERIZES ShapePaths to pixels using the SAME rules the
 * product renderer (`engine/renderer.ts renderShape`) uses for solid fills:
 *   - fills painted in path order (Pass 1), later paths over earlier;
 *   - consecutive paths sharing the SAME `Fill` object reference are batched
 *     into one path and filled together so inner "hole" loops cut their outer
 *     loop under the NON-ZERO WINDING rule (renderer.ts:253-269);
 *   - quadratic segments are flattened (matching the canvas `quadraticCurveTo`
 *     the renderer emits) for the scanline fill.
 *
 * Comparing PIXELS (per-color counts) of (A) the merged/folded result against
 * (B) the ground-truth top-wins layered render of the same input shapes is the
 * sound, render-faithful correctness check.
 */

import type { Fill, Point, Shape, ShapePath } from "../types.js";

/** A raster buffer: a flat array of color keys (or null = transparent). */
export interface Raster {
  readonly w: number;
  readonly h: number;
  /** w*h color keys ("r,g,b,a") or null for transparent. */
  readonly px: (string | null)[];
}

/** Subpixel oversampling for crisper edge coverage (axis-aligned rects are exact). */
const SS = 4;

function solidKey(fill: Fill | null | undefined): string | null {
  if (!fill || fill.type !== "solid") return null;
  const c = fill.color;
  return `${c.r},${c.g},${c.b},${c.a}`;
}

/** Flatten a closed ShapePath to a polygon point list (quadratics → chords). */
function pathToPolygon(path: ShapePath): Point[] {
  const pts: Point[] = [{ x: path.start.x, y: path.start.y }];
  let prev = path.start;
  for (const seg of path.segments) {
    if (seg.type === "curve") {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
          y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
        });
      }
    } else {
      pts.push({ x: seg.to.x, y: seg.to.y });
    }
    prev = seg.to;
  }
  return pts;
}

function cross(a: Point, b: Point, px: number, py: number): number {
  return (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
}

/**
 * Non-zero winding number of point (px,py) against a set of polygon loops
 * (one batched fill = all its same-reference loops, so holes cut their outer
 * loop exactly as canvas `fill("nonzero")` does).
 */
function windingNonZero(loops: Point[][], px: number, py: number): number {
  let wn = 0;
  for (const poly of loops) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % n]!;
      if (a.y <= py) {
        if (b.y > py && cross(a, b, px, py) > 0) wn++;
      } else {
        if (b.y <= py && cross(a, b, px, py) < 0) wn--;
      }
    }
  }
  return wn;
}

/**
 * Rasterize an ordered list of solid-fill paths to a {@link Raster}, exactly
 * mirroring the renderer's Pass-1 solid-fill loop: consecutive same-`Fill`-
 * reference paths are batched into one non-zero-winding fill; later paths/batches
 * paint over earlier ones. Non-solid (gradient/bitmap) and fill-less (stroke-only)
 * paths are skipped (they contribute no solid color to compare).
 */
export function rasterizePaths(paths: readonly ShapePath[], w: number, h: number): Raster {
  const px: (string | null)[] = new Array(w * h).fill(null);

  let pi = 0;
  while (pi < paths.length) {
    const path = paths[pi]!;
    if (!path.fill || path.fill.type !== "solid") {
      pi++;
      continue;
    }
    const key = solidKey(path.fill);
    // Batch consecutive same-Fill-reference paths (renderer.ts:263).
    const loops: Point[][] = [pathToPolygon(path)];
    while (pi + 1 < paths.length && paths[pi + 1]!.fill === path.fill) {
      pi++;
      loops.push(pathToPolygon(paths[pi]!));
    }
    pi++;

    // Bounding box of this batch to limit the scan.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of loops) {
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(h - 1, Math.ceil(maxY));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // Subpixel coverage: pixel is colored if any subsample is inside.
        // (Axis-aligned rects on integer grids are exact at the subsample centers.)
        let covered = false;
        for (let sy = 0; sy < SS && !covered; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const sampleX = x + (sx + 0.5) / SS;
            const sampleY = y + (sy + 0.5) / SS;
            if (windingNonZero(loops, sampleX, sampleY) !== 0) {
              covered = true;
              break;
            }
          }
        }
        if (covered) px[y * w + x] = key;
      }
    }
  }

  return { w, h, px };
}

/** Bake a display object's (x,y) offset into stage-space ShapePaths. */
function toStagePaths(shape: Shape, ox: number, oy: number): ShapePath[] {
  const t = (p: Point): Point => ({ x: p.x + ox, y: p.y + oy });
  return shape.paths.map((p) => ({
    ...p,
    start: t(p.start),
    segments: p.segments.map((s) =>
      s.type === "line"
        ? { type: "line" as const, to: t(s.to) }
        : { type: "curve" as const, control: t(s.control), to: t(s.to) }
    ),
  }));
}

/**
 * GROUND TRUTH: rasterize a stack of display objects in DRAW ORDER
 * (bottom → top). Each object's solid fills paint over what is below, so
 * top-wins overlaps resolve exactly as the renderer composites them — this is
 * the layered "what the screen shows" reference the merge fold must reproduce.
 */
export function rasterizeLayer(
  objs: readonly { shape: Shape; x: number; y: number }[],
  w: number,
  h: number
): Raster {
  // Flatten every object's paths, in draw order, into one ordered path list.
  // Object boundaries do NOT break the same-reference batching (distinct objects
  // never share a Fill reference here), so this composites identically to drawing
  // each shape with renderShape in z-order.
  const all: ShapePath[] = [];
  for (const o of objs) all.push(...toStagePaths(o.shape, o.x, o.y));
  return rasterizePaths(all, w, h);
}

/** Per-color pixel histogram of a raster. */
export function colorCounts(r: Raster): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of r.px) {
    if (k === null) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** pixelmatch-style: number of pixels whose color key differs between two rasters. */
export function pixelDiff(a: Raster, b: Raster): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error("raster size mismatch");
  let diff = 0;
  for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) diff++;
  return diff;
}
