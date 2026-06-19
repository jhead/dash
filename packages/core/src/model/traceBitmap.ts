/**
 * Trace Bitmap — raster-to-vector conversion (Modify > Bitmap > Trace Bitmap).
 *
 * This module is the stable public façade for the authoring UI. The actual
 * vectorization lives in `engine/bitmapTrace.ts`, which extracts each color
 * region's true outline via **marching squares** + **Douglas-Peucker**
 * simplification (with optional quadratic-curve fitting and corner detection).
 * The earlier bounding-box MVP that lived here has been superseded by that
 * contour tracer; this file keeps the historical `traceBitmap` /
 * `tracePathsToShape` API so existing callers (the Trace Bitmap dialog handler)
 * are unchanged.
 */

import type { ShapePath } from "../engine/types.js";
import {
  traceBitmapToPaths,
  tracedPathsToShape,
  type BitmapTraceOptions,
  type BitmapTraceImageData,
  type TraceCurveFit,
  type TraceCornerThreshold,
} from "../engine/bitmapTrace.js";

// ---------------------------------------------------------------------------
// Public types (kept stable for the authoring UI / dialog)
// ---------------------------------------------------------------------------

export type CurveFit = TraceCurveFit;
export type CornerThreshold = TraceCornerThreshold;

export type TraceBitmapOptions = BitmapTraceOptions;
export type ImageDataLike = BitmapTraceImageData;

export const DEFAULT_TRACE_OPTIONS: TraceBitmapOptions = {
  colorThreshold: 100,
  minimumArea: 8,
  curveFit: "normal",
  cornerThreshold: "normal",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Trace a bitmap image into a list of filled, contour-traced `ShapePath`s
 * (one per connected color region). Delegates to the marching-squares +
 * Douglas-Peucker tracer in `engine/bitmapTrace.ts`.
 *
 * @param imageData - Pixel data (width × height × 4 bytes RGBA).
 * @param options   - Trace parameters (color threshold, min area, curve fit,
 *                    corner threshold).
 * @returns Array of closed, solid-filled ShapePaths.
 */
export function traceBitmap(
  imageData: ImageDataLike,
  options: Partial<TraceBitmapOptions> = {},
): ShapePath[] {
  return traceBitmapToPaths(imageData, options);
}

/**
 * Convenience: wrap an array of ShapePaths into a Shape structure (with a
 * generated id) suitable for a ShapeDisplayObject.
 */
export function tracePathsToShape(paths: ShapePath[]): {
  id: string;
  paths: readonly ShapePath[];
} {
  return tracedPathsToShape(paths);
}
