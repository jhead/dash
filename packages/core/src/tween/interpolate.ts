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
 * Apply Flash 8 ease to a linear t (0..1) → eased t.
 *
 * Flash 8 exponential ease formula:
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
export function applyEase(t: number, ease: number): number {
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
 * Interpolate two filter arrays at normalized time t (0..1).
 *
 * Rules:
 * - Filters are matched by position (filter[0] ↔ filter[0], etc.).
 * - If the lengths differ or types at a position don't match, snap to `from`
 *   (no interpolation for that filter).
 * - If both arrays are null/undefined, returns null.
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

  // If lengths differ, snap to from
  if (fromFilters.length !== toFilters.length) {
    return fromFilters.length > 0 ? fromFilters : null;
  }

  return fromFilters.map((f, i) => interpolateSingleFilter(f, toFilters[i], t));
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
  const t = applyEase(linearT, config.ease);

  const colorEffect = interpolateColorEffect(from.colorEffect, to.colorEffect, t);
  const filters = interpolateFilters(from.filters, to.filters, t);

  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    scaleX: lerp(from.scaleX, to.scaleX, t),
    scaleY: lerp(from.scaleY, to.scaleY, t),
    rotation: interpolateRotation(
      from.rotation,
      to.rotation,
      t,
      config.motionRotate,
      config.motionRotateCount
    ),
    alpha: lerp(from.alpha, to.alpha, t),
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

/**
 * Interpolate shape display objects for a shape tween.
 *
 * @param startObjects  - Display objects on the start keyframe
 * @param endObjects    - Display objects on the end keyframe
 * @param t             - Normalized position between keyframes (0..1, pre-ease)
 * @param ease          - Flash ease value (−100..100)
 * @param blend         - Blend mode: 'distributive' | 'angular' (reserved for future use)
 * @returns             New array of interpolated ShapeDisplayObject values
 */
export function interpolateShapeTween(
  startObjects: readonly DisplayObject[],
  endObjects: readonly DisplayObject[],
  t: number,
  ease: number,
  blend: "distributive" | "angular"
): DisplayObject[] {
  // Suppress unused-variable lint for blend (reserved for future hint-based morphing)
  void blend;

  const easedT = applyEase(Math.max(0, Math.min(1, t)), ease);

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

    const interpolated: ShapeDisplayObject = {
      type: "shape",
      id: s.id,
      shape: lerpShape(s.shape, e.shape, easedT),
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
