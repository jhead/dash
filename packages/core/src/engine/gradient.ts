/**
 * Gradient fill creation utilities for the Flash 8 engine.
 *
 * Helpers for building LinearGradientFill and RadialGradientFill objects
 * that match the types defined in types.ts. Colors are passed as CSS color
 * strings and converted to the internal Color representation.
 */

import type { Color, GradientColorStop, LinearGradientFill, RadialGradientFill } from "./types.js";
import { cssToColor } from "./color-utils.js";

// ---------------------------------------------------------------------------
// Ratio utilities
// ---------------------------------------------------------------------------

/**
 * Produce evenly-spaced SWF ratio values (0–255) for a given number of stops.
 * Single-stop gradients return [128] (Flash midpoint convention).
 */
export function normalizeGradientRatios(count: number): number[] {
  if (count <= 1) return [128];
  return Array.from({ length: count }, (_, i) => Math.round((i / (count - 1)) * 255));
}

// ---------------------------------------------------------------------------
// Gradient fill factories
// ---------------------------------------------------------------------------

/**
 * Build a LinearGradientFill from parallel arrays of CSS color strings and
 * SWF ratio values (0–255). If `ratios` is omitted, ratios are distributed
 * evenly via normalizeGradientRatios.
 *
 * @param colors  CSS color strings (e.g. "#ff0000", "rgba(…)")
 * @param ratios  SWF ratio values 0–255, one per color
 * @param angleDeg  Gradient angle in degrees (0 = left-to-right)
 */
export function createLinearGradient(
  colors: string[],
  ratios: number[],
  angleDeg: number = 0
): LinearGradientFill {
  const stops: GradientColorStop[] = colors.map((css, i) => ({
    ratio: ratios[i] ?? 0,
    color: cssToColor(css),
  }));
  return { type: "linear-gradient", stops, angle: angleDeg };
}

/**
 * Build a RadialGradientFill from parallel arrays of CSS color strings and
 * SWF ratio values (0–255). If `ratios` is omitted, ratios are distributed
 * evenly. The `focalPoint` is clamped to [-1, 1].
 *
 * @param colors      CSS color strings
 * @param ratios      SWF ratio values 0–255, one per color
 * @param focalPoint  Focal-point offset along the x-axis: -1 to 1
 */
export function createRadialGradient(
  colors: string[],
  ratios: number[],
  focalPoint: number = 0
): RadialGradientFill {
  const stops: GradientColorStop[] = colors.map((css, i) => ({
    ratio: ratios[i] ?? 0,
    color: cssToColor(css),
  }));
  return {
    type: "radial-gradient",
    stops,
    focalPoint: Math.max(-1, Math.min(1, focalPoint)),
  };
}
