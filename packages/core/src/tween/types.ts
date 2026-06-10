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
  motionRotate?: "none" | "auto" | "cw" | "ccw";  // rotation mode
  motionRotateCount?: number;                       // extra full rotations to add
}
