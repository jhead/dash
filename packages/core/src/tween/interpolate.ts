import type { TweenConfig, TweenTarget } from "./types.js";
import type {
  Color,
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
