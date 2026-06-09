/**
 * Types for Flash 8-style motion tween interpolation.
 */

export interface TweenTarget {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;   // degrees
  alpha: number;      // 0–100
}

export interface TweenConfig {
  ease: number;        // −100 to 100 (Flash ease value)
  // Flash 8 convention: positive = ease-out (fast start), negative = ease-in (slow start)
  motionRotate?: "none" | "auto" | "cw" | "ccw";  // rotation mode
  motionRotateCount?: number;                       // extra full rotations to add
}
