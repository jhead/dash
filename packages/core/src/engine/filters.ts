/**
 * Flash 8 filter types for display objects.
 *
 * Mirrors the ActionScript flash.filters.* classes and the SWF filter list
 * on PlaceObject. Applied per-object and stacked in order; each filter can be
 * individually enabled/disabled.
 */

import type { Color } from "./types.js";

// ---------------------------------------------------------------------------
// Drop Shadow
// ---------------------------------------------------------------------------

export interface DropShadowFilter {
  readonly type: "drop-shadow";
  /** Shadow offset in pixels. Default: 4. */
  readonly distance: number;
  /** Shadow angle in degrees. Default: 45. */
  readonly angle: number;
  /** Shadow color. Default: black. */
  readonly color: Color;
  /** Shadow alpha 0–1. Default: 0.65. */
  readonly alpha: number;
  /** Horizontal blur. Default: 4. */
  readonly blurX: number;
  /** Vertical blur. Default: 4. */
  readonly blurY: number;
  /** Strength (0–255). Default: 1. */
  readonly strength: number;
  /** Inner shadow mode. */
  readonly inner: boolean;
  /** Knockout mode — hides the source object. */
  readonly knockout: boolean;
  /** Hide the source object entirely (shadow only). */
  readonly hideObject: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Glow
// ---------------------------------------------------------------------------

export interface GlowFilter {
  readonly type: "glow";
  readonly color: Color;
  /** Alpha 0–1. Default: 1. */
  readonly alpha: number;
  /** Horizontal blur. Default: 6. */
  readonly blurX: number;
  /** Vertical blur. Default: 6. */
  readonly blurY: number;
  /** Strength (0–255). Default: 2. */
  readonly strength: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Blur
// ---------------------------------------------------------------------------

export interface BlurFilter {
  readonly type: "blur";
  /** Horizontal blur. Default: 4. */
  readonly blurX: number;
  /** Vertical blur. Default: 4. */
  readonly blurY: number;
  /** Quality (render passes). 1 = Low, 2 = Med, 3 = High. Default: 1. */
  readonly quality: 1 | 2 | 3;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Bevel
// ---------------------------------------------------------------------------

export interface BevelFilter {
  readonly type: "bevel";
  /** Distance of the bevel offset in pixels. Default: 4. */
  readonly distance: number;
  /** Bevel angle in degrees. Default: 45. */
  readonly angle: number;
  readonly highlightColor: Color;
  /** Highlight alpha 0–1. Default: 1. */
  readonly highlightAlpha: number;
  readonly shadowColor: Color;
  /** Shadow alpha 0–1. Default: 1. */
  readonly shadowAlpha: number;
  /** Horizontal blur. Default: 4. */
  readonly blurX: number;
  /** Vertical blur. Default: 4. */
  readonly blurY: number;
  /** Strength (0–255). Default: 1. */
  readonly strength: number;
  /** Quality (render passes). 1 = Low, 2 = Med, 3 = High. Default: 1. */
  readonly quality: 1 | 2 | 3;
  /** Bevel placement. "inner" = inside object, "outer" = outside, "full" = both sides. Default: "inner". */
  readonly bevelType: "inner" | "outer" | "full";
  readonly knockout: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Gradient Glow
// ---------------------------------------------------------------------------

export interface GradientGlowFilter {
  readonly type: "gradientGlow";
  readonly distance: number;
  readonly angle: number;
  readonly gradient: ReadonlyArray<{ color: string; alpha: number; ratio: number }>;
  readonly blurX: number;
  readonly blurY: number;
  readonly strength: number;
  readonly quality: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly compositeSource: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Gradient Bevel
// ---------------------------------------------------------------------------

export interface GradientBevelFilter {
  readonly type: "gradientBevel";
  readonly distance: number;
  readonly angle: number;
  readonly gradient: ReadonlyArray<{ color: string; alpha: number; ratio: number }>;
  readonly blurX: number;
  readonly blurY: number;
  readonly strength: number;
  readonly quality: number;
  readonly inner: boolean;
  readonly knockout: boolean;
  readonly compositeSource: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Adjust Color (ColorMatrix)
// ---------------------------------------------------------------------------

export interface AdjustColorFilter {
  readonly type: "adjustColor";
  /** -100..100 */
  readonly brightness: number;
  /** -100..100 */
  readonly contrast: number;
  /** -100..100 */
  readonly saturation: number;
  /** -180..180 */
  readonly hue: number;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type FlashFilter =
  | DropShadowFilter
  | GlowFilter
  | BlurFilter
  | BevelFilter
  | GradientGlowFilter
  | GradientBevelFilter
  | AdjustColorFilter;

// ---------------------------------------------------------------------------
// Default factories
// ---------------------------------------------------------------------------

export function defaultDropShadow(): DropShadowFilter {
  return {
    type: "drop-shadow",
    distance: 4,
    angle: 45,
    color: { r: 0, g: 0, b: 0, a: 255 },
    alpha: 0.65,
    blurX: 4,
    blurY: 4,
    strength: 1,
    inner: false,
    knockout: false,
    hideObject: false,
    enabled: true,
  };
}

export function defaultGlow(): GlowFilter {
  return {
    type: "glow",
    color: { r: 255, g: 0, b: 0, a: 255 },
    alpha: 1,
    blurX: 6,
    blurY: 6,
    strength: 2,
    inner: false,
    knockout: false,
    enabled: true,
  };
}

export function defaultBlur(): BlurFilter {
  return {
    type: "blur",
    blurX: 4,
    blurY: 4,
    quality: 1,
    enabled: true,
  };
}

export function defaultBevel(): BevelFilter {
  return {
    type: "bevel",
    distance: 4,
    angle: 45,
    highlightColor: { r: 255, g: 255, b: 255, a: 255 },
    highlightAlpha: 1,
    shadowColor: { r: 0, g: 0, b: 0, a: 255 },
    shadowAlpha: 1,
    blurX: 4,
    blurY: 4,
    strength: 1,
    quality: 1,
    bevelType: "inner",
    knockout: false,
    enabled: true,
  };
}

export function defaultGradientGlow(): GradientGlowFilter {
  return {
    type: "gradientGlow",
    distance: 4,
    angle: 45,
    gradient: [
      { color: "#000000", alpha: 0, ratio: 0 },
      { color: "#ff0000", alpha: 1, ratio: 128 },
      { color: "#ffffff", alpha: 1, ratio: 255 },
    ],
    blurX: 4,
    blurY: 4,
    strength: 1,
    quality: 1,
    inner: false,
    knockout: false,
    compositeSource: true,
    enabled: true,
  };
}

export function defaultGradientBevel(): GradientBevelFilter {
  return {
    type: "gradientBevel",
    distance: 4,
    angle: 45,
    gradient: [
      { color: "#000000", alpha: 1, ratio: 0 },
      { color: "#ffffff", alpha: 1, ratio: 128 },
      { color: "#808080", alpha: 1, ratio: 255 },
    ],
    blurX: 4,
    blurY: 4,
    strength: 1,
    quality: 1,
    inner: false,
    knockout: false,
    compositeSource: true,
    enabled: true,
  };
}

export function defaultAdjustColor(): AdjustColorFilter {
  return {
    type: "adjustColor",
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    enabled: true,
  };
}
