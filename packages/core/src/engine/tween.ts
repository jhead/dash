/**
 * Standalone tween easing utilities for Flash 8 motion tweens.
 *
 * Re-exports applyEase from the tween module and provides standalone
 * lerp and tweenValue helpers for interpolating numeric properties.
 */

export { applyEase } from "../tween/interpolate.js";

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

import { applyEase } from "../tween/interpolate.js";

/**
 * Interpolate a numeric property for a motion tween.
 *
 * @param from  Start value
 * @param to    End value
 * @param t     Linear time parameter in [0, 1]
 * @param ease  Flash 8 ease value (-100..100); 0 = linear, >0 = ease-out, <0 = ease-in
 * @returns     The interpolated value at time t with easing applied
 */
export function tweenValue(from: number, to: number, t: number, ease: number): number {
  const te = applyEase(t, ease);
  return lerp(from, to, te);
}
