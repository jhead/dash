/**
 * Lasso tool selection helpers — Magic Wand flood-fill + polygon close logic.
 *
 * These are the pure (DOM-free) algorithms behind the authoring-ui Lasso tool:
 *
 *   - Magic Wand: seed-point contiguous flood fill over a rasterized bitmap
 *     region by RGB color distance, with a Threshold control and a Smoothing
 *     enum (pixels / rough / normal / smooth) that shapes the resulting
 *     selection polygon (AABB vs Moore-neighborhood contour trace + optional
 *     Douglas-Peucker simplification + Chaikin corner-cutting).
 *
 *   - Polygon Lasso: the decision of when a click should *close* an in-progress
 *     polygon selection (double-click within a short interval, or a click near
 *     the start vertex).
 *
 * The actual pixel reading (drawing a bitmap to a canvas, `getImageData`) stays
 * in the UI layer; everything here operates on already-extracted RGBA data and
 * plain geometry, so it is unit-testable without a DOM.
 */

import type { Point } from "./types.js";

/** Smoothing levels for Magic Wand selection (Flash 8 "Magic Wand Properties"). */
export type MagicWandSmoothing = "pixels" | "rough" | "normal" | "smooth";

/** Axis-aligned region of a bitmap display object on the stage. */
export interface BitmapRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Default Magic Wand color-distance threshold (Flash 8 default). */
export const DEFAULT_MAGIC_WAND_THRESHOLD = 20;

/**
 * Euclidean RGB distance between two pixels (alpha ignored).
 */
export function rgbDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 4-connected flood fill on RGBA pixel data.
 *
 * Starting from `(startX, startY)`, selects every contiguous pixel whose RGB
 * distance from the seed pixel is `<= threshold`.
 *
 * @returns a Set of pixel indices (`y * width + x`) belonging to the region.
 */
export function floodFillPixels(
  data: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  threshold: number,
): Set<number> {
  const selected = new Set<number>();
  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return selected;

  const startIdx = (sy * width + sx) * 4;
  const seedR = data[startIdx];
  const seedG = data[startIdx + 1];
  const seedB = data[startIdx + 2];

  const queue: number[] = [sy * width + sx];
  selected.add(sy * width + sx);

  while (queue.length > 0) {
    const pixelIdx = queue.pop()!;
    const px = pixelIdx % width;
    const py = Math.floor(pixelIdx / width);

    const neighbors: [number, number][] = [
      [px - 1, py],
      [px + 1, py],
      [px, py - 1],
      [px, py + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (selected.has(ni)) continue;
      const nDataIdx = ni * 4;
      const dist = rgbDistance(
        data[nDataIdx],
        data[nDataIdx + 1],
        data[nDataIdx + 2],
        seedR,
        seedG,
        seedB,
      );
      if (dist <= threshold) {
        selected.add(ni);
        queue.push(ni);
      }
    }
  }
  return selected;
}

/**
 * Build a boolean mask (Uint8Array, 1=selected, 0=not) from a Set of pixel
 * indices. The mask uses the same row-major index as the pixel set.
 */
export function buildMask(pixels: Set<number>, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const idx of pixels) {
    if (idx >= 0 && idx < width * height) mask[idx] = 1;
  }
  return mask;
}

/**
 * Moore-neighborhood boundary tracing (Jacob's stopping criterion).
 *
 * Traces the outer boundary of a binary mask as a sequence of pixel-edge
 * points (half-pixel offset so corners align to the pixel grid). For a
 * single-pixel mask returns the 4 corners of that pixel cell.
 *
 * 8-directional order (clockwise from "up"):
 *   7 0 1
 *   6 * 2
 *   5 4 3
 */
export function traceBoundary(
  mask: Uint8Array,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const dirs: [number, number][] = [
    [0, -1], // 0: up
    [1, -1], // 1: up-right
    [1, 0], // 2: right
    [1, 1], // 3: down-right
    [0, 1], // 4: down
    [-1, 1], // 5: down-left
    [-1, 0], // 6: left
    [-1, -1], // 7: up-left
  ];

  // Find the starting pixel: topmost then leftmost selected pixel.
  let startIdx = -1;
  outer: for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (mask[py * width + px] === 1) {
        startIdx = py * width + px;
        break outer;
      }
    }
  }
  if (startIdx < 0) return [];

  const startX = startIdx % width;
  const startY = Math.floor(startIdx / width);

  // Single-pixel selection → square polygon around the pixel.
  if (mask.reduce((s, v) => s + v, 0) === 1) {
    return [
      { x: startX, y: startY },
      { x: startX + 1, y: startY },
      { x: startX + 1, y: startY + 1 },
      { x: startX, y: startY + 1 },
    ];
  }

  const boundary: Array<{ x: number; y: number }> = [];
  const startEntryDir = 6; // entered the start pixel from the left
  let cx = startX;
  let cy = startY;
  let entryDir = startEntryDir;
  let iterations = 0;
  const maxIter = width * height * 2 + 8;

  do {
    boundary.push({ x: cx, y: cy });
    const backDir = (entryDir + 4) % 8;
    let found = false;
    for (let r = 1; r <= 8; r++) {
      const d = (backDir + r) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
        entryDir = (d + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel (should have been caught above)
    iterations++;
  } while (iterations < maxIter && !(cx === startX && cy === startY && entryDir === startEntryDir));

  // Offset to pixel-edge coordinates so the polygon encloses the cells.
  return boundary.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
}

/**
 * Douglas-Peucker polyline simplification.
 */
export function douglasPeucker(
  points: Array<{ x: number; y: number }>,
  epsilon: number,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  function perpendicularDist(
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const nearX = a.x + t * dx;
    const nearY = a.y + t * dy;
    return Math.hypot(p.x - nearX, p.y - nearY);
  }

  function rdp(
    pts: Array<{ x: number; y: number }>,
    start: number,
    end: number,
    eps: number,
    keep: Set<number>,
  ): void {
    if (end <= start + 1) return;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(pts[i], pts[start], pts[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > eps) {
      keep.add(maxIdx);
      rdp(pts, start, maxIdx, eps, keep);
      rdp(pts, maxIdx, end, eps, keep);
    }
  }

  const keep = new Set<number>([0, points.length - 1]);
  rdp(points, 0, points.length - 1, epsilon, keep);
  return points.filter((_, i) => keep.has(i));
}

/**
 * Chaikin corner-cutting smoothing. Each iteration replaces each edge of the
 * closed polygon with two new points at 1/4 and 3/4 along the edge.
 */
export function chaikin(
  points: Array<{ x: number; y: number }>,
  iterations = 2,
): Array<{ x: number; y: number }> {
  let pts = points;
  for (let i = 0; i < iterations; i++) {
    const next: Array<{ x: number; y: number }> = [];
    for (let j = 0; j < pts.length; j++) {
      const p0 = pts[j];
      const p1 = pts[(j + 1) % pts.length];
      next.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      next.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    pts = next;
  }
  return pts;
}

/**
 * Compute the AABB polygon (4 stage-space points) from a set of pixel indices.
 */
export function aabbPolygon(
  pixels: Set<number>,
  imgWidth: number,
  bitmapObj: BitmapRegion,
  scaleX: number,
  scaleY: number,
): Point[] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const idx of pixels) {
    const px = idx % imgWidth;
    const py = Math.floor(idx / imgWidth);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return [
    { x: bitmapObj.x + minX * scaleX, y: bitmapObj.y + minY * scaleY },
    { x: bitmapObj.x + (maxX + 1) * scaleX, y: bitmapObj.y + minY * scaleY },
    { x: bitmapObj.x + (maxX + 1) * scaleX, y: bitmapObj.y + (maxY + 1) * scaleY },
    { x: bitmapObj.x + minX * scaleX, y: bitmapObj.y + (maxY + 1) * scaleY },
  ];
}

/**
 * Convert a set of selected pixel indices to a selection polygon in stage
 * coordinates, applying the requested smoothing.
 *
 *   "pixels" / "normal" — exact AABB bounding box (no contour tracing)
 *   "rough"             — Moore-neighborhood boundary trace → Douglas-Peucker
 *   "smooth"            — rough contour + Chaikin corner-cutting (2 iterations)
 */
export function selectedPixelsToBoundingPolygon(
  pixels: Set<number>,
  imgWidth: number,
  imgHeight: number,
  bitmapObj: BitmapRegion,
  smoothing: MagicWandSmoothing,
): Point[] {
  if (pixels.size === 0) return [];

  const sx = bitmapObj.width / imgWidth;
  const sy = bitmapObj.height / imgHeight;

  if (smoothing === "pixels" || smoothing === "normal") {
    return aabbPolygon(pixels, imgWidth, bitmapObj, sx, sy);
  }

  // "rough" and "smooth": trace the pixel boundary contour.
  const mask = buildMask(pixels, imgWidth, imgHeight);
  let contour = traceBoundary(mask, imgWidth, imgHeight);

  // Fallback to AABB if tracing produced too few points.
  if (contour.length < 3) {
    return aabbPolygon(pixels, imgWidth, bitmapObj, sx, sy);
  }

  // Simplify with Douglas-Peucker when there are many points.
  if (contour.length > 100) {
    contour = douglasPeucker(contour, 0.5);
  }

  if (smoothing === "smooth") {
    contour = chaikin(contour, 2);
  }

  return contour.map((p) => ({
    x: bitmapObj.x + p.x * sx,
    y: bitmapObj.y + p.y * sy,
  }));
}

/**
 * Run the Magic Wand selection over already-extracted RGBA pixel data.
 *
 * The caller is responsible for rasterizing the bitmap (e.g. drawing it to a
 * canvas and reading `getImageData`) and supplying the resulting `data` plus
 * the image dimensions; this keeps the helper DOM-free and testable.
 *
 * @param data       RGBA pixel data (row-major, 4 bytes per pixel).
 * @param imgWidth   bitmap pixel width matching `data`.
 * @param imgHeight  bitmap pixel height matching `data`.
 * @param bitmapObj  the bitmap's stage region (for pixel→stage mapping).
 * @param stageX     click position in stage coordinates.
 * @param stageY     click position in stage coordinates.
 * @param threshold  RGB distance threshold.
 * @param smoothing  selection-polygon smoothing mode.
 * @returns the selection polygon in stage coordinates (may be empty).
 */
export function magicWandSelectPixels(
  data: Uint8ClampedArray | Uint8Array | number[],
  imgWidth: number,
  imgHeight: number,
  bitmapObj: BitmapRegion,
  stageX: number,
  stageY: number,
  threshold: number,
  smoothing: MagicWandSmoothing,
): Point[] {
  // Map the stage click into bitmap-local pixel coordinates.
  const localX = ((stageX - bitmapObj.x) / bitmapObj.width) * imgWidth;
  const localY = ((stageY - bitmapObj.y) / bitmapObj.height) * imgHeight;

  const selected = floodFillPixels(data, imgWidth, imgHeight, localX, localY, threshold);
  return selectedPixelsToBoundingPolygon(selected, imgWidth, imgHeight, bitmapObj, smoothing);
}

// ---------------------------------------------------------------------------
// Polygon Lasso close logic
// ---------------------------------------------------------------------------

/** The previous click used to detect a double-click polygon close. */
export interface PolygonLastClick {
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

/** Maximum interval (ms) between two clicks to count as a double-click. */
export const POLYGON_DOUBLE_CLICK_MS = 400;
/** Distance (stage units) within which a click is "on" the start/last vertex. */
export const POLYGON_CLOSE_DISTANCE = 10;

/**
 * Decide whether a polygon-lasso click should *close* the in-progress polygon.
 *
 * A polygon closes when either:
 *   - the click is a double-click (within `doubleClickMs` of, and within
 *     `closeDistance` of, the previous click), OR
 *   - there are already >= 3 vertices and the click lands within
 *     `closeDistance` of the *first* vertex.
 *
 * `closeDistance` is supplied by the caller already adjusted for zoom (the UI
 * passes `POLYGON_CLOSE_DISTANCE / zoom`), so this stays a pure function.
 *
 * Returns `false` when there are fewer than 3 vertices (a polygon needs at
 * least 3 points to enclose an area).
 */
export function shouldClosePolygon(
  vertices: readonly Point[],
  clickX: number,
  clickY: number,
  lastClick: PolygonLastClick | null,
  now: number,
  closeDistance: number = POLYGON_CLOSE_DISTANCE,
  doubleClickMs: number = POLYGON_DOUBLE_CLICK_MS,
): boolean {
  if (vertices.length < 3) return false;

  // Double-click near the previous click position.
  if (
    lastClick &&
    now - lastClick.time < doubleClickMs &&
    Math.hypot(clickX - lastClick.x, clickY - lastClick.y) < closeDistance
  ) {
    return true;
  }

  // Click near the first vertex.
  const first = vertices[0];
  if (Math.hypot(clickX - first.x, clickY - first.y) <= closeDistance) {
    return true;
  }

  return false;
}

/**
 * Point-in-polygon test using the ray-casting algorithm.
 */
export function pointInPolygon(px: number, py: number, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
