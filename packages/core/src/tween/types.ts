/**
 * Types for Flash 8-style motion tween interpolation.
 */

import type { ColorEffect } from "../engine/types.js";
import type { FlashFilter } from "../engine/filters.js";

export interface TweenTarget {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;   // degrees
  skewX?: number;     // degrees
  skewY?: number;     // degrees
  alpha: number;      // 0–100
  /** Optional color effect to interpolate (tint/brightness/alpha/advanced). */
  colorEffect?: ColorEffect | null;
  /** Optional filter list to interpolate (matched by type+position). */
  filters?: readonly FlashFilter[] | null;
}

export type { ColorEffect, FlashFilter };

export interface TweenConfig {
  ease: number;        // −100 to 100 (Flash ease value)
  // Flash 8 convention: positive = ease-out (fast start), negative = ease-in (slow start)
  /** Custom cubic Bézier ease curve (CSS cubic-bezier convention). Overrides `ease` when set. */
  easeCurve?: { x1: number; y1: number; x2: number; y2: number } | null;
  /**
   * Per-property ease curves (Flash 8+).  When `useSingleEaseCurve` is false and a
   * per-property curve is set, that curve takes precedence over `easeCurve` / `ease`
   * for its property group.  null/undefined means fall back to `easeCurve` / `ease`.
   */
  easeForPosition?: { x1: number; y1: number; x2: number; y2: number } | null;
  easeForRotation?: { x1: number; y1: number; x2: number; y2: number } | null;
  easeForScale?:    { x1: number; y1: number; x2: number; y2: number } | null;
  easeForColor?:    { x1: number; y1: number; x2: number; y2: number } | null;
  easeForFilters?:  { x1: number; y1: number; x2: number; y2: number } | null;
  motionRotate?: "none" | "auto" | "cw" | "ccw";  // rotation mode
  motionRotateCount?: number;                       // extra full rotations to add
  motionScale?: boolean;                            // default true — when false, freeze scaleX/scaleY at start values
}
