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
  /** Quality (render passes). 1 = Low, 2 = Med, 3 = High. Default: 1. */
  readonly quality?: 1 | 2 | 3;
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
  /** Quality (render passes). 1 = Low, 2 = Med, 3 = High. Default: 1. */
  readonly quality?: 1 | 2 | 3;
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
  /** Bevel placement. 'full' sets the ON_TOP bit in the SWF encoder. Default: 'outer'. */
  readonly bevelType?: "inner" | "outer" | "full";
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
// Convolution
// ---------------------------------------------------------------------------

export interface ConvolutionFilter {
  readonly type: "convolution";
  /** Number of columns in the convolution matrix. Default: 3. */
  readonly matrixX: number;
  /** Number of rows in the convolution matrix. Default: 3. */
  readonly matrixY: number;
  /**
   * Convolution matrix values in row-major order (matrixX * matrixY floats).
   * Identity kernel: center element = 1, rest = 0.
   */
  readonly matrix: readonly number[];
  /** Divisor applied to the convolution sum. Default: 1. */
  readonly divisor: number;
  /** Bias added after dividing. Default: 0. */
  readonly bias: number;
  /** Color used for pixels outside the source image when clamp = false. */
  readonly defaultColor: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  /** When true, clamp out-of-bounds pixels to the nearest edge. Default: true. */
  readonly clamp: boolean;
  /** When true, the alpha channel is not affected by the filter. Default: false. */
  readonly preserveAlpha: boolean;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// Displacement Map
// ---------------------------------------------------------------------------

export interface DisplacementMapFilter {
  readonly type: "displacementMap";
  /** Character ID of the bitmap to use as the displacement map. Default: 0. */
  readonly mapBitmapId?: number;
  /** X,Y offset of the map relative to the filtered object. Default: {x:0, y:0}. */
  readonly mapPoint?: { readonly x: number; readonly y: number };
  /** Which color channel to use for X displacement (1=R, 2=G, 4=B, 8=A). Default: 1. */
  readonly componentX?: number;
  /** Which color channel to use for Y displacement (1=R, 2=G, 4=B, 8=A). Default: 2. */
  readonly componentY?: number;
  /** Scale factor for X displacement. Default: 0. */
  readonly scaleX?: number;
  /** Scale factor for Y displacement. Default: 0. */
  readonly scaleY?: number;
  /** Displacement mode. Default: "wrap". */
  readonly mode?: "wrap" | "clamp" | "ignore" | "color";
  /**
   * Color used for out-of-bounds pixels when mode is "color".
   * CSS hex string #RRGGBB or #RRGGBBAA. Default: "#00000000".
   */
  readonly color?: string;
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
  | AdjustColorFilter
  | ConvolutionFilter
  | DisplacementMapFilter;

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
    quality: 1,
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
    bevelType: "outer",
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

export function defaultConvolution(): ConvolutionFilter {
  // 3×3 identity kernel: center = 1, rest = 0.
  return {
    type: "convolution",
    matrixX: 3,
    matrixY: 3,
    matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    divisor: 1,
    bias: 0,
    defaultColor: { r: 0, g: 0, b: 0, a: 0 },
    clamp: true,
    preserveAlpha: false,
    enabled: true,
  };
}

export function defaultDisplacementMap(): DisplacementMapFilter {
  return {
    type: "displacementMap",
    mapBitmapId: 0,
    mapPoint: { x: 0, y: 0 },
    componentX: 1, // Red channel
    componentY: 2, // Green channel
    scaleX: 0,
    scaleY: 0,
    mode: "wrap",
    color: "#00000000",
    enabled: true,
  };
}
