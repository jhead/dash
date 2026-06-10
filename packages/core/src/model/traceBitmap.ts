/**
 * Trace Bitmap — raster-to-vector conversion algorithm.
 *
 * Given raw pixel data (ImageData-like), quantizes colors, flood-fills
 * connected regions, and returns one ShapePath per region. Each path
 * is a filled axis-aligned rectangle covering the region's bounding box.
 *
 * The algorithm is intentionally kept simple (bounding-box MVP) to be fast
 * and dependency-free. A contour-tracing upgrade can be layered on later.
 */

import type { ShapePath, SolidFill } from "../engine/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CurveFit =
  | "pixels"
  | "very-tight"
  | "tight"
  | "normal"
  | "smooth"
  | "very-smooth";

export type CornerThreshold = "many" | "normal" | "few";

export interface TraceBitmapOptions {
  /**
   * Color similarity threshold (1–500).
   * Adjacent pixels whose color distance is <= threshold are treated as the
   * same color bucket when quantizing. Default 100.
   */
  colorThreshold: number;
  /**
   * Minimum region area in pixels. Regions smaller than this value are
   * discarded. Default 8.
   */
  minimumArea: number;
  /**
   * Curve fitting mode — controls Douglas-Peucker simplification epsilon.
   * Ignored in the bounding-box MVP (retained for API compatibility).
   */
  curveFit: CurveFit;
  /**
   * Corner threshold — controls corner detection aggressiveness.
   * Ignored in the bounding-box MVP (retained for API compatibility).
   */
  cornerThreshold: CornerThreshold;
}

export const DEFAULT_TRACE_OPTIONS: TraceBitmapOptions = {
  colorThreshold: 100,
  minimumArea: 8,
  curveFit: "normal",
  cornerThreshold: "normal",
};

// ---------------------------------------------------------------------------
// Minimal ImageData-like interface (avoids DOM dependency in unit tests)
// ---------------------------------------------------------------------------

export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  /**
   * Flat RGBA pixel buffer: 4 bytes per pixel in row-major order.
   * Pixel at (x, y) starts at index (y * width + x) * 4.
   */
  readonly data: Uint8ClampedArray | Uint8Array | number[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Quantize a single 8-bit channel to the nearest bucket of size `step`. */
function quantizeChannel(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Map a pixel's RGBA to a single quantized integer key.
 * Fully-transparent pixels always map to a sentinel value (-1) so they are
 * collected into one transparent bucket and typically filtered by minimumArea.
 */
function pixelKey(
  data: ImageDataLike["data"],
  offset: number,
  step: number
): number {
  const a = data[offset + 3];
  if (a < 16) return -1; // treat near-transparent as one bucket
  const r = quantizeChannel(data[offset], step);
  const g = quantizeChannel(data[offset + 1], step);
  const b = quantizeChannel(data[offset + 2], step);
  // Pack into a 32-bit integer — works for step >= 1
  return (r << 16) | (g << 8) | b;
}

/** Unpack a color key back to RGBA (alpha always 255). */
function keyToColor(key: number): { r: number; g: number; b: number; a: number } {
  return {
    r: (key >> 16) & 0xff,
    g: (key >> 8) & 0xff,
    b: key & 0xff,
    a: 255,
  };
}

// ---------------------------------------------------------------------------
// Counter for generating unique shape IDs without importing from engine/shapes.ts
// (avoids a potential circular dependency)
// ---------------------------------------------------------------------------

let _traceCounter = 0;
function nextTraceId(): string {
  return `trace-shape-${++_traceCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

/**
 * Trace a bitmap image into a list of filled ShapePaths.
 *
 * Steps:
 *  1. For each pixel, compute a quantized color key (color bucket).
 *  2. Flood-fill connected regions of the same color key using a simple
 *     iterative 4-connectivity flood fill.
 *  3. For each region, compute its axis-aligned bounding box.
 *  4. Filter regions smaller than `minimumArea` pixels.
 *  5. Return one closed, filled ShapePath per surviving region.
 *
 * @param imageData - Pixel data (width × height × 4 bytes RGBA).
 * @param options   - Trace parameters.
 * @returns Array of ShapePaths, one per color region.
 */
export function traceBitmap(
  imageData: ImageDataLike,
  options: Partial<TraceBitmapOptions> = {}
): ShapePath[] {
  const opts: TraceBitmapOptions = { ...DEFAULT_TRACE_OPTIONS, ...options };

  const { width, height, data } = imageData;
  const totalPixels = width * height;

  // ------------------------------------------------------------------
  // Step 1: Quantize each pixel to a color bucket key.
  // ------------------------------------------------------------------
  // threshold maps to a quantization step: lower threshold = finer
  // buckets = more colors preserved.
  // We map the [1, 500] threshold to a [1, 128] step:
  //   step = max(1, floor(threshold / 4))
  const step = Math.max(1, Math.floor(opts.colorThreshold / 4));

  const keys = new Int32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    keys[i] = pixelKey(data, i * 4, step);
  }

  // ------------------------------------------------------------------
  // Step 2: Flood-fill to label connected regions.
  // ------------------------------------------------------------------
  // -1 = unlabeled.  We use a simple iterative stack-based flood fill.
  const labels = new Int32Array(totalPixels).fill(-1);
  let regionCount = 0;

  // regionInfo[label] = { key, minX, minY, maxX, maxY, area }
  const regionInfo: Array<{
    key: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    area: number;
  }> = [];

  const stack: number[] = [];

  for (let startIdx = 0; startIdx < totalPixels; startIdx++) {
    if (labels[startIdx] !== -1) continue;

    const targetKey = keys[startIdx];
    const label = regionCount++;
    regionInfo.push({
      key: targetKey,
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      area: 0,
    });

    stack.push(startIdx);

    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (labels[idx] !== -1) continue;
      if (keys[idx] !== targetKey) continue;

      labels[idx] = label;
      const info = regionInfo[label];
      const px = idx % width;
      const py = Math.floor(idx / width);
      if (px < info.minX) info.minX = px;
      if (py < info.minY) info.minY = py;
      if (px > info.maxX) info.maxX = px;
      if (py > info.maxY) info.maxY = py;
      info.area++;

      // 4-connectivity neighbors
      if (px > 0) stack.push(idx - 1);
      if (px < width - 1) stack.push(idx + 1);
      if (py > 0) stack.push(idx - width);
      if (py < height - 1) stack.push(idx + width);
    }
  }

  // ------------------------------------------------------------------
  // Step 3 & 4: Build ShapePaths for regions that pass the area filter.
  // ------------------------------------------------------------------
  const paths: ShapePath[] = [];

  for (let label = 0; label < regionCount; label++) {
    const info = regionInfo[label];

    // Skip transparent bucket and small regions
    if (info.key === -1) continue;
    if (info.area < opts.minimumArea) continue;
    if (!isFinite(info.minX)) continue;

    const color = keyToColor(info.key);
    const fill: SolidFill = { type: "solid", color };

    // Bounding-box rectangle path
    const x1 = info.minX;
    const y1 = info.minY;
    const x2 = info.maxX + 1; // +1 to cover the pixel's right/bottom edge
    const y2 = info.maxY + 1;

    const path: ShapePath = {
      start: { x: x1, y: y1 },
      segments: [
        { type: "line", to: { x: x2, y: y1 } },
        { type: "line", to: { x: x2, y: y2 } },
        { type: "line", to: { x: x1, y: y2 } },
        { type: "line", to: { x: x1, y: y1 } },
      ],
      closed: true,
      fill,
    };

    paths.push(path);
  }

  return paths;
}

/**
 * Convenience: wrap an array of ShapePaths into a ShapeDisplayObject-compatible
 * Shape structure (with generated id).
 */
export function tracePathsToShape(paths: ShapePath[]): {
  id: string;
  paths: readonly ShapePath[];
} {
  return { id: nextTraceId(), paths };
}
