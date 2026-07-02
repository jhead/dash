import type { TweenConfig, TweenTarget } from "./types.js";
import type {
  Color,
  ColorEffect,
  CurveSegment,
  DisplayObject,
  Fill,
  LineSegment,
  PathSegment,
  Point,
  Shape,
  ShapeDisplayObject,
  ShapePath,
  SolidFill,
  Stroke,
} from "../engine/types.js";
import type { ShapeHint } from "../model/types.js";
import type {
  AdjustColorFilter,
  BevelFilter,
  BlurFilter,
  DropShadowFilter,
  FlashFilter,
  GlowFilter,
  GradientBevelFilter,
  GradientGlowFilter,
} from "../engine/filters.js";

/**
 * Solve a CSS cubic-bezier at input x=t, returning the output y value.
 *
 * CSS cubic-bezier convention:
 *   P0 = (0, 0) — implicit start
 *   P1 = (x1, y1) — first control point
 *   P2 = (x2, y2) — second control point
 *   P3 = (1, 1)   — implicit end
 *
 * The x component of the parametric curve gives time; we solve for the
 * parameter s such that Bx(s) ≈ t using Newton-Raphson, then return By(s).
 *
 * @param t   Linear progress [0, 1]
 * @param x1  First control point x  (typically 0..1)
 * @param y1  First control point y  (unconstrained — allows overshoot)
 * @param x2  Second control point x (typically 0..1)
 * @param y2  Second control point y (unconstrained)
 */
function solveCubicBezier(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  // Clamp t to [0, 1] — boundary values map directly
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Cubic Bézier coefficients for x (with P0x=0, P3x=1)
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;

  // Cubic Bézier coefficients for y (with P0y=0, P3y=1)
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;

  /** Evaluate Bx(s) */
  const bxAt = (s: number) => ((ax * s + bx) * s + cx) * s;
  /** Derivative dBx/ds */
  const bxPrime = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  /** Evaluate By(s) */
  const byAt = (s: number) => ((ay * s + by) * s + cy) * s;

  // Newton-Raphson iteration: find s such that Bx(s) = t
  // Use t as the initial guess (good for near-linear curves)
  let s = t;
  for (let i = 0; i < 8; i++) {
    const xError = bxAt(s) - t;
    if (Math.abs(xError) < 1e-7) break;
    const d = bxPrime(s);
    if (Math.abs(d) < 1e-12) break; // avoid division by zero near inflection
    s -= xError / d;
    // Keep s in [0, 1] to avoid divergence
    if (s < 0) s = 0;
    if (s > 1) s = 1;
  }

  return byAt(s);
}

/**
 * Apply Flash 8 ease to a linear t (0..1) → eased t.
 *
 * When `easeCurve` is provided, uses a CSS cubic-bezier solver instead of
 * the integer ease formula.
 *
 * Flash 8 exponential ease formula (when easeCurve is null/undefined):
 *   ease > 0 (ease-out): eased_t = 1 - (1 - t)^(1 + (ease/100) * 3)
 *   ease < 0 (ease-in):  eased_t = t^(1 + (-ease/100) * 3)
 *   ease = 0:            eased_t = t  (linear)
 *
 * - ease = 0:    linear (t unchanged)
 * - ease > 0:    ease-out (fast start, slow end): t=0.5 maps to > 0.5
 * - ease < 0:    ease-in (slow start, fast end):  t=0.5 maps to < 0.5
 *
 * Note: Flash 8's Property Inspector slider goes from −100 (In) to +100 (Out).
 * Positive values produce more progress at the midpoint (ease-out).
 *
 * Examples:
 *   ease=100, t=0.5  → ~0.9375  (very strong ease-out)
 *   ease=-100, t=0.5 → ~0.0625  (very strong ease-in)
 */
export function applyEase(
  t: number,
  ease: number,
  easeCurve?: { x1: number; y1: number; x2: number; y2: number } | null
): number {
  if (easeCurve) {
    return solveCubicBezier(t, easeCurve.x1, easeCurve.y1, easeCurve.x2, easeCurve.y2);
  }
  if (ease === 0) return t;
  // Clamp t to [0, 1]
  const clamped = Math.max(0, Math.min(1, t));
  if (ease > 0) {
    // Ease out: starts fast, slows at end
    return 1 - Math.pow(1 - clamped, 1 + (ease / 100) * 3);
  } else {
    // Ease in: starts slow, speeds up at end
    return Math.pow(clamped, 1 + (-ease / 100) * 3);
  }
}

/**
 * Normalize an angle to the range [0, 360).
 */
function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Interpolate rotation with support for Flash 8 rotate modes.
 *
 * @param fromDeg  Start angle in degrees
 * @param toDeg    End angle in degrees
 * @param t        Normalized time (0..1)
 * @param mode     "auto" = shortest path (default), "cw" = always clockwise,
 *                 "ccw" = always counter-clockwise, "none" = no rotation
 * @param count    Number of extra full rotations to add (for cw/ccw)
 */
function interpolateRotation(
  fromDeg: number,
  toDeg: number,
  t: number,
  mode?: "none" | "auto" | "cw" | "ccw",
  count?: number
): number {
  if (mode === "none") {
    // No rotation — hold start angle throughout
    return fromDeg;
  }

  const rotateCount = count ?? 0;
  const from = normalizeAngle(fromDeg);
  const to = normalizeAngle(toDeg);

  if (mode === "cw") {
    // Always rotate clockwise (positive direction in Flash)
    let delta = to - from;
    if (delta < 0) delta += 360; // ensure clockwise
    delta += rotateCount * 360;
    return from + delta * t;
  } else if (mode === "ccw") {
    // Always rotate counter-clockwise (negative direction)
    let delta = to - from;
    if (delta > 0) delta -= 360; // ensure counter-clockwise
    delta -= rotateCount * 360;
    return from + delta * t;
  } else {
    // "auto" (default): shortest path
    let delta = to - from;
    // Wrap delta to [-180, 180] for shortest path
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return from + delta * t;
  }
}

/**
 * Linear interpolation for scalars.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Parse a CSS hex color string ("#rrggbb" or "#rrggbbaa") into {r, g, b} channels.
 * Returns {r:0, g:0, b:0} for invalid/missing values.
 */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = (hex ?? "#000000").replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

/**
 * Format {r, g, b} back into a CSS hex color string "#rrggbb".
 */
function toHexColor(r: number, g: number, b: number): string {
  return "#" + [r, g, b]
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Interpolate between two ColorEffect values at normalized time t (0..1).
 *
 * Rules:
 * - If both effects have the same type, interpolate the numeric fields.
 * - If the types differ, or one side is null/undefined/"none":
 *   - The "none" side is treated as the identity color effect for that type
 *     (e.g., tintAmount=0, alpha=100, brightness=0, advanced at 100%/0).
 *   - We interpolate toward/from the identity value.
 * - Mismatched non-none types: snap to the "from" effect (no interpolation).
 *
 * Returns null (no effect) when the result is the identity transform.
 */
export function interpolateColorEffect(
  from: ColorEffect | null | undefined,
  to: ColorEffect | null | undefined,
  t: number
): ColorEffect | null {
  // Normalize null/undefined/"none" to a sentinel
  const fromType = (!from || from.type === "none") ? "none" : from.type;
  const toType = (!to || to.type === "none") ? "none" : to.type;

  // Both none → no color effect
  if (fromType === "none" && toType === "none") return null;

  // Determine the active effect type (at least one side is non-none)
  const effectType = fromType !== "none" ? fromType : toType;

  // If the types differ (and neither is none), snap to from — can't interpolate
  if (fromType !== "none" && toType !== "none" && fromType !== toType) {
    return from ?? null;
  }

  switch (effectType) {
    case "brightness": {
      const fromB = fromType === "brightness" ? (from!.brightness ?? 0) : 0;
      const toB = toType === "brightness" ? (to!.brightness ?? 0) : 0;
      const b = lerp(fromB, toB, t);
      if (b === 0) return null;
      return { type: "brightness", brightness: b };
    }

    case "tint": {
      const fromP = fromType === "tint" ? (from!.tintAmount ?? 0) : 0;
      const toP = toType === "tint" ? (to!.tintAmount ?? 0) : 0;
      // Interpolate tintAmount
      const p = lerp(fromP, toP, t);

      // Interpolate tint color channels
      const fromColor = fromType === "tint" ? parseHexColor(from!.tintColor ?? "#000000") : { r: 0, g: 0, b: 0 };
      const toColor = toType === "tint" ? parseHexColor(to!.tintColor ?? "#000000") : { r: 0, g: 0, b: 0 };
      const r = lerp(fromColor.r, toColor.r, t);
      const g = lerp(fromColor.g, toColor.g, t);
      const b = lerp(fromColor.b, toColor.b, t);

      if (p === 0) return null;
      return {
        type: "tint",
        tintAmount: p,
        tintColor: toHexColor(r, g, b),
      };
    }

    case "alpha": {
      const fromA = fromType === "alpha" ? (from!.alpha ?? 100) : 100;
      const toA = toType === "alpha" ? (to!.alpha ?? 100) : 100;
      const a = lerp(fromA, toA, t);
      // alpha=100 is identity, no transform needed
      if (a >= 100) return null;
      return { type: "alpha", alpha: a };
    }

    case "advanced": {
      const fromRM = fromType === "advanced" ? (from!.redMult ?? 100) : 100;
      const fromGM = fromType === "advanced" ? (from!.greenMult ?? 100) : 100;
      const fromBM = fromType === "advanced" ? (from!.blueMult ?? 100) : 100;
      const fromRO = fromType === "advanced" ? (from!.redOffset ?? 0) : 0;
      const fromGO = fromType === "advanced" ? (from!.greenOffset ?? 0) : 0;
      const fromBO = fromType === "advanced" ? (from!.blueOffset ?? 0) : 0;

      const toRM = toType === "advanced" ? (to!.redMult ?? 100) : 100;
      const toGM = toType === "advanced" ? (to!.greenMult ?? 100) : 100;
      const toBM = toType === "advanced" ? (to!.blueMult ?? 100) : 100;
      const toRO = toType === "advanced" ? (to!.redOffset ?? 0) : 0;
      const toGO = toType === "advanced" ? (to!.greenOffset ?? 0) : 0;
      const toBO = toType === "advanced" ? (to!.blueOffset ?? 0) : 0;

      const rMult = lerp(fromRM, toRM, t);
      const gMult = lerp(fromGM, toGM, t);
      const bMult = lerp(fromBM, toBM, t);
      const rOff = lerp(fromRO, toRO, t);
      const gOff = lerp(fromGO, toGO, t);
      const bOff = lerp(fromBO, toBO, t);

      // Identity: mult=100, offset=0
      if (rMult === 100 && gMult === 100 && bMult === 100 &&
          rOff === 0 && gOff === 0 && bOff === 0) return null;
      return {
        type: "advanced",
        redMult: rMult,
        greenMult: gMult,
        blueMult: bMult,
        redOffset: rOff,
        greenOffset: gOff,
        blueOffset: bOff,
      };
    }

    default:
      return from ?? null;
  }
}

/**
 * Lerp a Color between two Color values (r, g, b, a channels).
 */
function lerpColorRGBA(a: Color, b: Color, t: number): Color {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
    a: Math.round(lerp(a.a, b.a, t)),
  };
}

/**
 * Interpolate a single pair of matching FlashFilters (same type) at t.
 * Returns the from filter unchanged if types differ.
 */
function interpolateSingleFilter(
  a: FlashFilter,
  b: FlashFilter,
  t: number
): FlashFilter {
  if (a.type !== b.type) return a;

  switch (a.type) {
    case "blur": {
      const fb = b as BlurFilter;
      const fa = a as BlurFilter;
      return {
        ...fa,
        blurX: lerp(fa.blurX, fb.blurX, t),
        blurY: lerp(fa.blurY, fb.blurY, t),
      };
    }
    case "drop-shadow": {
      const fa = a as DropShadowFilter;
      const fb = b as DropShadowFilter;
      return {
        ...fa,
        blurX: lerp(fa.blurX, fb.blurX, t),
        blurY: lerp(fa.blurY, fb.blurY, t),
        strength: lerp(fa.strength, fb.strength, t),
        angle: lerp(fa.angle, fb.angle, t),
        distance: lerp(fa.distance, fb.distance, t),
        alpha: lerp(fa.alpha, fb.alpha, t),
        color: lerpColorRGBA(fa.color, fb.color, t),
      };
    }
    case "glow": {
      const fa = a as GlowFilter;
      const fb = b as GlowFilter;
      return {
        ...fa,
        blurX: lerp(fa.blurX, fb.blurX, t),
        blurY: lerp(fa.blurY, fb.blurY, t),
        strength: lerp(fa.strength, fb.strength, t),
        alpha: lerp(fa.alpha, fb.alpha, t),
        color: lerpColorRGBA(fa.color, fb.color, t),
      };
    }
    case "bevel": {
      const fa = a as BevelFilter;
      const fb = b as BevelFilter;
      return {
        ...fa,
        blurX: lerp(fa.blurX, fb.blurX, t),
        blurY: lerp(fa.blurY, fb.blurY, t),
        strength: lerp(fa.strength, fb.strength, t),
        angle: lerp(fa.angle, fb.angle, t),
        distance: lerp(fa.distance, fb.distance, t),
        highlightAlpha: lerp(fa.highlightAlpha, fb.highlightAlpha, t),
        shadowAlpha: lerp(fa.shadowAlpha, fb.shadowAlpha, t),
        highlightColor: lerpColorRGBA(fa.highlightColor, fb.highlightColor, t),
        shadowColor: lerpColorRGBA(fa.shadowColor, fb.shadowColor, t),
      };
    }
    case "gradientGlow": {
      const fa = a as GradientGlowFilter;
      const fb = b as GradientGlowFilter;
      // Lerp gradient stops positionally; snap if lengths differ
      const gradient =
        fa.gradient.length === fb.gradient.length
          ? fa.gradient.map((stop, i) => {
              const stopB = fb.gradient[i];
              const lerpedColor = lerpColorRGBA(
                parseHexColorToRGBA(stop.color),
                parseHexColorToRGBA(stopB.color),
                t
              );
              return {
                color: toHexColor(lerpedColor.r, lerpedColor.g, lerpedColor.b),
                alpha: lerp(stop.alpha, stopB.alpha, t),
                ratio: lerp(stop.ratio, stopB.ratio, t),
              };
            })
          : fa.gradient;
      return {
        ...fa,
        blurX: lerp(fa.blurX, fb.blurX, t),
        blurY: lerp(fa.blurY, fb.blurY, t),
        strength: lerp(fa.strength, fb.strength, t),
        angle: lerp(fa.angle, fb.angle, t),
        distance: lerp(fa.distance, fb.distance, t),
        gradient,
      };
    }
    case "gradientBevel": {
      const fa = a as GradientBevelFilter;
      const fb = b as GradientBevelFilter;
      // Lerp gradient stops positionally; snap if lengths differ
      const gradient =
        fa.gradient.length === fb.gradient.length
          ? fa.gradient.map((stop, i) => {
              const stopB = fb.gradient[i];
              const lerpedColor = lerpColorRGBA(
                parseHexColorToRGBA(stop.color),
                parseHexColorToRGBA(stopB.color),
                t
              );
              return {
                color: toHexColor(lerpedColor.r, lerpedColor.g, lerpedColor.b),
                alpha: lerp(stop.alpha, stopB.alpha, t),
                ratio: lerp(stop.ratio, stopB.ratio, t),
              };
            })
          : fa.gradient;
      return {
        ...fa,
        blurX: lerp(fa.blurX, fb.blurX, t),
        blurY: lerp(fa.blurY, fb.blurY, t),
        strength: lerp(fa.strength, fb.strength, t),
        angle: lerp(fa.angle, fb.angle, t),
        distance: lerp(fa.distance, fb.distance, t),
        gradient,
      };
    }
    case "adjustColor": {
      const fa = a as AdjustColorFilter;
      const fb = b as AdjustColorFilter;
      return {
        ...fa,
        brightness: lerp(fa.brightness, fb.brightness, t),
        contrast: lerp(fa.contrast, fb.contrast, t),
        saturation: lerp(fa.saturation, fb.saturation, t),
        hue: lerp(fa.hue, fb.hue, t),
      };
    }
    default:
      return a;
  }
}

/**
 * Parse a hex color string "#rrggbb" or "#rrggbbaa" into a Color {r,g,b,a}.
 * Alpha defaults to 255 if not present in the string.
 */
function parseHexColorToRGBA(hex: string): Color {
  const clean = (hex ?? "#000000").replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
    a: clean.length >= 8 ? (parseInt(clean.slice(6, 8), 16) || 0) : 255,
  };
}

/**
 * Build a type-matched "disabled" (zero-strength / identity) copy of a filter.
 *
 * Flash's missing-filter matching rule (docs/08 — Animating filters): when a
 * filter exists on one keyframe but not the other, Flash synthesizes a matching
 * filter on the other keyframe so the tween is well-defined. The synthesized
 * filter shares the present filter's type and non-animatable fields (color,
 * quality, angle/distance, knockout/inner flags, gradient stops) but has its
 * magnitude parameters zeroed — blur 0, strength 0, alpha 0 — so interpolating
 * against it fades the effect in (appearing) or out (disappearing) rather than
 * snapping it on/off at the tween's end.
 */
function disabledFilterFor(f: FlashFilter): FlashFilter {
  switch (f.type) {
    case "blur":
      return { ...f, blurX: 0, blurY: 0 };
    case "drop-shadow":
      return { ...f, blurX: 0, blurY: 0, strength: 0, alpha: 0 };
    case "glow":
      return { ...f, blurX: 0, blurY: 0, strength: 0, alpha: 0 };
    case "bevel":
      return { ...f, blurX: 0, blurY: 0, strength: 0, highlightAlpha: 0, shadowAlpha: 0 };
    case "gradientGlow":
    case "gradientBevel":
      return {
        ...f,
        blurX: 0,
        blurY: 0,
        strength: 0,
        gradient: f.gradient.map((stop) => ({ ...stop, alpha: 0 })),
      };
    case "adjustColor":
      return { ...f, brightness: 0, contrast: 0, saturation: 0, hue: 0 };
    default:
      // Convolution / displacement-map carry no scalar magnitude the tween
      // engine interpolates, so there is nothing to fade — return as-is.
      return f;
  }
}

/**
 * Interpolate two filter arrays at normalized time t (0..1).
 *
 * Rules:
 * - Filters are matched by position (filter[0] ↔ filter[0], etc.).
 * - Missing-filter matching (docs/08 — Animating filters): when a filter is
 *   present at a position on one keyframe but absent on the other, Flash adds a
 *   matching disabled (zero-strength) filter on the other side so the parameter
 *   fades in (appearing) or out (disappearing) across the tween instead of
 *   popping on/off at the end. Reproduced here via `disabledFilterFor`.
 * - If the types at a matched position differ, snap to `from` (no interpolation
 *   for that filter).
 * - If both arrays are null/undefined/empty, returns null.
 *
 * @param from  Filter array from start keyframe (may be null/undefined)
 * @param to    Filter array from end keyframe (may be null/undefined)
 * @param t     Normalized time (0..1, post-ease)
 * @returns     Interpolated filter array, or null if both are empty/null
 */
export function interpolateFilters(
  from: readonly FlashFilter[] | null | undefined,
  to: readonly FlashFilter[] | null | undefined,
  t: number
): readonly FlashFilter[] | null {
  const fromFilters = from ?? [];
  const toFilters = to ?? [];

  if (fromFilters.length === 0 && toFilters.length === 0) return null;

  const length = Math.max(fromFilters.length, toFilters.length);
  const result: FlashFilter[] = [];
  for (let i = 0; i < length; i++) {
    const f = fromFilters[i];
    const g = toFilters[i];
    if (f && g) {
      result.push(interpolateSingleFilter(f, g, t));
    } else if (f) {
      // Disappearing filter: fade toward a matched disabled filter.
      result.push(interpolateSingleFilter(f, disabledFilterFor(f), t));
    } else if (g) {
      // Appearing filter: fade in from a matched disabled filter.
      result.push(interpolateSingleFilter(disabledFilterFor(g), g, t));
    }
  }
  return result;
}

/**
 * Interpolate between two keyframe states using Flash 8 easing.
 *
 * @param from         - Start keyframe TweenTarget
 * @param to           - End keyframe TweenTarget
 * @param frame        - Current frame index (absolute)
 * @param startFrame   - Tween start keyframe index (absolute)
 * @param endFrame     - Tween end keyframe index (absolute)
 * @param config       - Tween configuration (ease, etc.)
 * @returns Interpolated TweenTarget at the given frame
 */
export function interpolateTween(
  from: TweenTarget,
  to: TweenTarget,
  frame: number,
  startFrame: number,
  endFrame: number,
  config: TweenConfig
): TweenTarget {
  const span = endFrame - startFrame;
  if (span <= 0) return { ...from };

  // Linear t in [0, 1]
  const linearT = Math.max(0, Math.min(1, (frame - startFrame) / span));

  /**
   * Resolve the eased t for a specific property group.
   *
   * Priority (highest to lowest):
   *   1. per-property curve (e.g. easeForRotation) — if set
   *   2. single/position ease curve (config.easeCurve) — if set
   *   3. integer ease value (config.ease)
   */
  function easedT(perPropertyCurve: typeof config.easeCurve): number {
    return applyEase(linearT, config.ease, perPropertyCurve ?? config.easeCurve);
  }

  const tPosition = easedT(config.easeForPosition);
  const tRotation = easedT(config.easeForRotation);
  const tScale    = easedT(config.easeForScale);
  const tColor    = easedT(config.easeForColor);
  const tFilters  = easedT(config.easeForFilters);

  const colorEffect = interpolateColorEffect(from.colorEffect, to.colorEffect, tColor);
  const filters = interpolateFilters(from.filters, to.filters, tFilters);

  return {
    x: lerp(from.x, to.x, tPosition),
    y: lerp(from.y, to.y, tPosition),
    scaleX: config.motionScale === false ? (from.scaleX ?? 1) : lerp(from.scaleX, to.scaleX, tScale),
    scaleY: config.motionScale === false ? (from.scaleY ?? 1) : lerp(from.scaleY, to.scaleY, tScale),
    rotation: interpolateRotation(
      from.rotation,
      to.rotation,
      tRotation,
      config.motionRotate,
      config.motionRotateCount
    ),
    skewX: lerp(from.skewX ?? 0, to.skewX ?? 0, tRotation),
    skewY: lerp(from.skewY ?? 0, to.skewY ?? 0, tRotation),
    alpha: lerp(from.alpha, to.alpha, tColor),
    colorEffect,
    filters,
  };
}

// ---------------------------------------------------------------------------
// Shape tween interpolation
// ---------------------------------------------------------------------------

/**
 * Interpolate a Point linearly between two points.
 */
function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/**
 * Interpolate a Color linearly between two colors (RGBA channels).
 */
function lerpColor(a: Color, b: Color, t: number): Color {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
    a: Math.round(lerp(a.a, b.a, t)),
  };
}

/**
 * Interpolate a Fill between two fills. Only interpolates solid fills;
 * for mismatched or gradient fills, falls back to the start fill.
 */
function lerpFill(a: Fill, b: Fill, t: number): Fill {
  if (a.type === "solid" && b.type === "solid") {
    const solidA = a as SolidFill;
    const solidB = b as SolidFill;
    return { type: "solid", color: lerpColor(solidA.color, solidB.color, t) };
  }
  // Fall back: return start fill unchanged
  return a;
}

/**
 * Interpolate a Stroke between two strokes. Interpolates color and width for
 * solid strokes; falls back to the start stroke for other types.
 */
function lerpStroke(a: Stroke, b: Stroke, t: number): Stroke {
  // Both are SolidStroke (the only Stroke type currently)
  return {
    ...a,
    color: lerpColor(a.color, b.color, t),
    width: lerp(a.width, b.width, t),
  };
}

/**
 * Interpolate two path segment arrays pointwise.
 * If lengths differ, returns the start segments unmodified beyond the shorter length.
 *
 * @param aSegs      Segments from the start path
 * @param bSegs      Segments from the end path
 * @param t          Normalized time (0..1)
 * @param aPathStart Start point of path A (used as the implied "previous point" for
 *                   the first segment when promoting a line to a degenerate curve)
 * @param bPathStart Start point of path B (same purpose for path B)
 */
function lerpSegments(
  aSegs: readonly PathSegment[],
  bSegs: readonly PathSegment[],
  t: number,
  aPathStart: Point,
  bPathStart: Point
): PathSegment[] {
  const len = Math.min(aSegs.length, bSegs.length);
  const result: PathSegment[] = [];
  for (let i = 0; i < len; i++) {
    const sa = aSegs[i];
    const sb = bSegs[i];
    if (sa.type === "line" && sb.type === "line") {
      const lineA = sa as LineSegment;
      const lineB = sb as LineSegment;
      result.push({ type: "line", to: lerpPoint(lineA.to, lineB.to, t) });
    } else if (sa.type === "curve" && sb.type === "curve") {
      const curveA = sa as CurveSegment;
      const curveB = sb as CurveSegment;
      result.push({
        type: "curve",
        control: lerpPoint(curveA.control, curveB.control, t),
        to: lerpPoint(curveA.to, curveB.to, t),
      });
    } else if (sa.type === "line" && sb.type === "curve") {
      // Promote line to degenerate curve (control = midpoint of line segment).
      // The "previous point" for segment 0 is path.start (not origin).
      const lineA = sa as LineSegment;
      const curveB = sb as CurveSegment;
      const prevA: Point = i === 0
        ? aPathStart
        : (aSegs[i - 1] as LineSegment | CurveSegment).to;
      const degControl: Point = {
        x: lerp((lineA.to.x + prevA.x) / 2, curveB.control.x, t),
        y: lerp((lineA.to.y + prevA.y) / 2, curveB.control.y, t),
      };
      result.push({
        type: "curve",
        control: degControl,
        to: lerpPoint(lineA.to, curveB.to, t),
      });
    } else if (sa.type === "curve" && sb.type === "line") {
      // Promote end line to degenerate curve (control = midpoint of line segment).
      const curveA = sa as CurveSegment;
      const lineB = sb as LineSegment;
      const prevB: Point = i === 0
        ? bPathStart
        : (bSegs[i - 1] as LineSegment | CurveSegment).to;
      const degControl: Point = {
        x: lerp(curveA.control.x, (lineB.to.x + prevB.x) / 2, t),
        y: lerp(curveA.control.y, (lineB.to.y + prevB.y) / 2, t),
      };
      result.push({
        type: "curve",
        control: degControl,
        to: lerpPoint(curveA.to, lineB.to, t),
      });
    } else {
      // Mismatched or unhandled — keep start segment
      result.push(sa);
    }
  }
  // Append extra segments from the longer array (uninterpolated)
  for (let i = len; i < aSegs.length; i++) {
    result.push(aSegs[i]);
  }
  return result;
}

/**
 * Interpolate a single ShapePath between start and end paths.
 */
function lerpShapePath(a: ShapePath, b: ShapePath, t: number): ShapePath {
  return {
    start: lerpPoint(a.start, b.start, t),
    segments: lerpSegments(a.segments, b.segments, t, a.start, b.start),
    fill:
      a.fill !== undefined && b.fill !== undefined
        ? lerpFill(a.fill, b.fill, t)
        : a.fill,
    stroke:
      a.stroke !== undefined && b.stroke !== undefined
        ? lerpStroke(a.stroke, b.stroke, t)
        : a.stroke,
    closed: a.closed,
  };
}

/**
 * Interpolate a Shape between two shapes.
 * Paths are matched by index; unmatched paths are kept from the start shape.
 */
function lerpShape(a: Shape, b: Shape, t: number): Shape {
  const len = Math.min(a.paths.length, b.paths.length);
  const paths: ShapePath[] = [];
  for (let i = 0; i < len; i++) {
    paths.push(lerpShapePath(a.paths[i], b.paths[i], t));
  }
  // Extra paths from start shape — keep unmodified
  for (let i = len; i < a.paths.length; i++) {
    paths.push(a.paths[i]);
  }
  return { ...a, paths };
}

// ---------------------------------------------------------------------------
// Shape hint vertex correspondence
// ---------------------------------------------------------------------------

/**
 * Euclidean distance squared between two points.
 */
function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Find the index of the vertex in `verts` closest to `hint` position.
 * `verts` is the flat list of all vertices from the path (start point + segment endpoints).
 */
function closestVertexIndex(
  hint: { x: number; y: number },
  verts: Point[]
): number {
  let best = 0;
  let bestDist = distSq(hint, verts[0]!);
  for (let i = 1; i < verts.length; i++) {
    const d = distSq(hint, verts[i]!);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Flatten a ShapePath into an ordered vertex array (start + segment endpoints).
 * Only endpoints are returned (no control points).
 */
function pathVertices(path: ShapePath): Point[] {
  const pts: Point[] = [{ ...path.start }];
  for (const seg of path.segments) {
    pts.push({ ...seg.to });
  }
  return pts;
}

/**
 * Rotate an array so that element at `pivotIdx` becomes index 0.
 * Works for both closed paths (rotation makes sense) and open paths (clamp pivot to 0).
 */
function rotateArray<T>(arr: T[], pivotIdx: number): T[] {
  if (pivotIdx === 0 || arr.length === 0) return arr;
  return [...arr.slice(pivotIdx), ...arr.slice(0, pivotIdx)];
}

/**
 * Reorder a ShapePath's vertices so that the vertex closest to `anchorPt` comes first.
 * Only meaningful for closed paths; for open paths returns the path unchanged.
 *
 * The path is reconstructed from the reordered vertex list as straight-line segments
 * (control points from curve segments are not preserved — morphshape uses line segments
 * anyway for SWF encoding).
 */
function reorderPathByAnchor(path: ShapePath, anchorPt: Point): ShapePath {
  if (!path.closed) return path;

  const verts = pathVertices(path);
  if (verts.length <= 1) return path;

  const pivotIdx = closestVertexIndex(anchorPt, verts);
  if (pivotIdx === 0) return path;

  const reordered = rotateArray(verts, pivotIdx);

  // Reconstruct segments as line segments from the reordered vertices
  const newStart = reordered[0]!;
  const newSegments = reordered.slice(1).map((pt) => ({
    type: "line" as const,
    to: pt,
  }));

  return {
    ...path,
    start: newStart,
    segments: newSegments,
  };
}

/**
 * Build matched hint pairs from start and end hint arrays.
 * Only pairs with matching ids are returned.
 */
function matchHints(
  startHints: readonly ShapeHint[],
  endHints: readonly ShapeHint[]
): Array<{ start: ShapeHint; end: ShapeHint }> {
  const pairs: Array<{ start: ShapeHint; end: ShapeHint }> = [];
  for (const sh of startHints) {
    const eh = endHints.find((h) => h.id === sh.id);
    if (eh) {
      pairs.push({ start: sh, end: eh });
    }
  }
  return pairs;
}

/**
 * Apply shape hints to a single ShapePath pair, reordering vertices so that
 * the hint-anchored vertex comes first.  For multiple hints we use the first
 * matched pair as the primary anchor for reordering (closest vertex approach).
 *
 * This ensures that the vertex at index 0 of the start path corresponds to the
 * vertex at index 0 of the end path — the key requirement for smooth morphing.
 */
function applyHintsToPath(
  startPath: ShapePath,
  endPath: ShapePath,
  pairs: Array<{ start: ShapeHint; end: ShapeHint }>
): [ShapePath, ShapePath] {
  if (pairs.length === 0) return [startPath, endPath];

  // Use the first hint pair as the primary anchor to align vertex 0
  const primary = pairs[0]!;
  const reorderedStart = reorderPathByAnchor(startPath, primary.start);
  const reorderedEnd = reorderPathByAnchor(endPath, primary.end);

  return [reorderedStart, reorderedEnd];
}

// ---------------------------------------------------------------------------
// Angular blend mode helpers
// ---------------------------------------------------------------------------

/**
 * Compute the centroid of a ShapePath (average of all vertices: start + segment endpoints).
 */
function pathCentroid(path: ShapePath): Point {
  const pts: Point[] = [{ ...path.start }];
  for (const seg of path.segments) {
    pts.push({ ...seg.to });
  }
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

/**
 * Rotate a point around the origin by `angleRad` radians.
 */
function rotatePoint(p: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

/**
 * Interpolate a ShapePath using angular morphing.
 *
 * Angular mode adds a rotational component on top of the linear vertex lerp:
 *   vertex_t = centroid_t + rotate(v_start - c_start, angle * t) * (1 - t)
 *                         + (v_end - c_end) * t
 *
 * The rotation `angle` is the angular difference between each shape's
 * characteristic orientation vector (centroid → first vertex), ensuring a
 * smooth rotational arc rather than a straight-line translation.
 *
 * At t=0 this reduces to the start shape; at t=1 it reduces to the end shape.
 */
function lerpShapePathAngular(a: ShapePath, b: ShapePath, t: number): ShapePath {
  const ca = pathCentroid(a);
  const cb = pathCentroid(b);

  // Lerp centroid linearly
  const ct: Point = { x: lerp(ca.x, cb.x, t), y: lerp(ca.y, cb.y, t) };

  // Compute characteristic orientation angle for each shape:
  // use the vector from centroid to the start vertex.
  const angleA = Math.atan2(a.start.y - ca.y, a.start.x - ca.x);
  const angleB = Math.atan2(b.start.y - cb.y, b.start.x - cb.x);

  // Shortest-path angular delta (wrap to [-π, π])
  let angleDelta = angleB - angleA;
  if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
  if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

  /**
   * Angular-blend position for a single vertex pair:
   *   vertex_t = ct + rotate(v_a - c_a, angleDelta * t) * (1 - t)
   *                 + (v_b - c_b) * t
   */
  function angularLerpPoint(va: Point, vb: Point): Point {
    const relA: Point = { x: va.x - ca.x, y: va.y - ca.y };
    const relB: Point = { x: vb.x - cb.x, y: vb.y - cb.y };
    const rotated = rotatePoint(relA, angleDelta * t);
    return {
      x: ct.x + rotated.x * (1 - t) + relB.x * t,
      y: ct.y + rotated.y * (1 - t) + relB.y * t,
    };
  }

  const newStart = angularLerpPoint(a.start, b.start);

  const len = Math.min(a.segments.length, b.segments.length);
  const segments: PathSegment[] = [];

  for (let i = 0; i < len; i++) {
    const sa = a.segments[i]!;
    const sb = b.segments[i]!;
    // For angular morphing we work with endpoints; for curves we lerp the
    // control point linearly (angular rotation applies to endpoints only).
    if (sa.type === "line" && sb.type === "line") {
      segments.push({ type: "line", to: angularLerpPoint(sa.to, sb.to) });
    } else if (sa.type === "curve" && sb.type === "curve") {
      segments.push({
        type: "curve",
        control: lerpPoint(sa.control, sb.control, t),
        to: angularLerpPoint(sa.to, sb.to),
      });
    } else if (sa.type === "line" && sb.type === "curve") {
      const prevA: Point = i === 0 ? a.start : a.segments[i - 1]!.to;
      const degControl: Point = {
        x: lerp((sa.to.x + prevA.x) / 2, sb.control.x, t),
        y: lerp((sa.to.y + prevA.y) / 2, sb.control.y, t),
      };
      segments.push({ type: "curve", control: degControl, to: angularLerpPoint(sa.to, sb.to) });
    } else if (sa.type === "curve" && sb.type === "line") {
      const prevB: Point = i === 0 ? b.start : b.segments[i - 1]!.to;
      const degControl: Point = {
        x: lerp(sa.control.x, (sb.to.x + prevB.x) / 2, t),
        y: lerp(sa.control.y, (sb.to.y + prevB.y) / 2, t),
      };
      segments.push({ type: "curve", control: degControl, to: angularLerpPoint(sa.to, sb.to) });
    } else {
      segments.push(sa);
    }
  }

  // Extra segments from the longer array — keep from start
  for (let i = len; i < a.segments.length; i++) {
    segments.push(a.segments[i]!);
  }

  return {
    start: newStart,
    segments,
    fill:
      a.fill !== undefined && b.fill !== undefined
        ? lerpFill(a.fill, b.fill, t)
        : a.fill,
    stroke:
      a.stroke !== undefined && b.stroke !== undefined
        ? lerpStroke(a.stroke, b.stroke, t)
        : a.stroke,
    closed: a.closed,
  };
}

/**
 * Interpolate a Shape using angular blend mode.
 * Paths are matched by index; unmatched paths are kept from the start shape.
 */
function lerpShapeAngular(a: Shape, b: Shape, t: number): Shape {
  const len = Math.min(a.paths.length, b.paths.length);
  const paths: ShapePath[] = [];
  for (let i = 0; i < len; i++) {
    paths.push(lerpShapePathAngular(a.paths[i]!, b.paths[i]!, t));
  }
  for (let i = len; i < a.paths.length; i++) {
    paths.push(a.paths[i]!);
  }
  return { ...a, paths };
}

/**
 * Interpolate shape display objects for a shape tween.
 *
 * @param startObjects  - Display objects on the start keyframe
 * @param endObjects    - Display objects on the end keyframe
 * @param t             - Normalized position between keyframes (0..1, pre-ease)
 * @param ease          - Flash ease value (−100..100)
 * @param blend         - Blend mode: 'distributive' | 'angular'
 * @param easeCurve     - Optional custom cubic Bézier ease curve; overrides `ease` when set
 * @param startHints    - Shape hints from the start keyframe (optional)
 * @param endHints      - Shape hints from the end keyframe (optional)
 * @returns             New array of interpolated ShapeDisplayObject values
 */
export function interpolateShapeTween(
  startObjects: readonly DisplayObject[],
  endObjects: readonly DisplayObject[],
  t: number,
  ease: number,
  blend: "distributive" | "angular",
  easeCurve?: { x1: number; y1: number; x2: number; y2: number } | null,
  startHints?: readonly ShapeHint[] | null,
  endHints?: readonly ShapeHint[] | null
): DisplayObject[] {

  const easedT = applyEase(Math.max(0, Math.min(1, t)), ease, easeCurve);

  // Only interpolate ShapeDisplayObjects; other types are passed through from start
  const result: DisplayObject[] = [];
  const len = Math.max(startObjects.length, endObjects.length);

  for (let i = 0; i < len; i++) {
    const startObj = startObjects[i];
    const endObj = endObjects[i];

    if (startObj === undefined) {
      // Extra end objects: fade in (increase alpha toward end)
      if (endObj?.type === "shape") {
        result.push(endObj);
      }
      continue;
    }

    if (endObj === undefined) {
      // Extra start objects: keep static
      result.push(startObj);
      continue;
    }

    if (startObj.type !== "shape" || endObj.type !== "shape") {
      // Non-shape objects are not morphed; pass through start
      result.push(startObj);
      continue;
    }

    const s = startObj as ShapeDisplayObject;
    const e = endObj as ShapeDisplayObject;

    // Apply shape hints to improve vertex correspondence if both keyframes have hints
    let startShape = s.shape;
    let endShape = e.shape;

    if (startHints && startHints.length > 0 && endHints && endHints.length > 0) {
      const hintPairs = matchHints(startHints, endHints);
      if (hintPairs.length > 0) {
        // Apply hint-based reordering to each path pair
        const newStartPaths: ShapePath[] = [];
        const newEndPaths: ShapePath[] = [];
        const pathCount = Math.min(startShape.paths.length, endShape.paths.length);
        for (let pi = 0; pi < pathCount; pi++) {
          const [rsp, rep] = applyHintsToPath(
            startShape.paths[pi]!,
            endShape.paths[pi]!,
            hintPairs
          );
          newStartPaths.push(rsp);
          newEndPaths.push(rep);
        }
        // Preserve any extra paths from the longer shape
        for (let pi = pathCount; pi < startShape.paths.length; pi++) {
          newStartPaths.push(startShape.paths[pi]!);
        }
        for (let pi = pathCount; pi < endShape.paths.length; pi++) {
          newEndPaths.push(endShape.paths[pi]!);
        }
        startShape = { ...startShape, paths: newStartPaths };
        endShape = { ...endShape, paths: newEndPaths };
      }
    }

    const interpolated: ShapeDisplayObject = {
      type: "shape",
      id: s.id,
      shape:
        blend === "angular"
          ? lerpShapeAngular(startShape, endShape, easedT)
          : lerpShape(startShape, endShape, easedT),
      x: lerp(s.x, e.x, easedT),
      y: lerp(s.y, e.y, easedT),
      scaleX: lerp(s.scaleX ?? 1, e.scaleX ?? 1, easedT),
      scaleY: lerp(s.scaleY ?? 1, e.scaleY ?? 1, easedT),
      rotation: interpolateRotation(s.rotation ?? 0, e.rotation ?? 0, easedT),
    };
    result.push(interpolated);
  }

  return result;
}
