/**
 * Path simplification and smoothing utilities for the pencil tool.
 *
 * - simplifyPath: Ramer-Douglas-Peucker algorithm to reduce point count
 * - smoothPath: Convert simplified points to smooth quadratic Bézier curves
 *   using the midpoint Catmull-Rom approximation
 * - createSimplifiedPencilShape: Full pipeline for pencil strokes
 */

import type {
  Fill,
  Shape,
  ShapeDisplayObject,
  ShapePath,
  SolidStroke,
} from "./types.js";

let _shapeCounter = 0;
function nextId(): string {
  return "shape-simplify-" + ++_shapeCounter;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Perpendicular distance from `pt` to the line segment (lineStart, lineEnd).
 */
function perpendicularDistance(
  pt: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return dist(pt, lineStart);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((pt.x - lineStart.x) * dx + (pt.y - lineStart.y) * dy) /
        (dx * dx + dy * dy)
    )
  );

  const closest = {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
  };

  return dist(pt, closest);
}

// ---------------------------------------------------------------------------
// Ramer-Douglas-Peucker
// ---------------------------------------------------------------------------

function rdp(
  pts: Array<{ x: number; y: number }>,
  start: number,
  end: number,
  epsilon: number,
  result: Array<{ x: number; y: number }>
): void {
  if (start >= end - 1) return;

  let maxDist = 0;
  let maxIdx = start;

  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistance(pts[i], pts[start], pts[end]);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    rdp(pts, start, maxIdx, epsilon, result);
    result.push(pts[maxIdx]);
    rdp(pts, maxIdx, end, epsilon, result);
  }
}

/**
 * Simplify a polyline using the Ramer-Douglas-Peucker algorithm.
 *
 * @param points  Input point array (at least 2 points recommended)
 * @param epsilon Maximum distance threshold; 2.0 works well for pencil strokes
 * @returns       Reduced point array preserving geometric shape
 */
export function simplifyPath(
  points: Array<{ x: number; y: number }>,
  epsilon: number
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  const result: Array<{ x: number; y: number }> = [points[0]];
  rdp(points, 0, points.length - 1, epsilon, result);
  result.push(points[points.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Catmull-Rom midpoint smoothing → quadratic Bézier ShapePath
// ---------------------------------------------------------------------------

/**
 * Convert a sequence of simplified points into a smooth ShapePath using the
 * midpoint Catmull-Rom approximation (each segment is a quadratic Bézier
 * starting and ending at midpoints, with the original point as control).
 *
 * @param points Input points (at least 2)
 * @param closed Whether to close the path back to the start
 * @returns      ShapePath with quadratic curve segments
 */
export function smoothPath(
  points: Array<{ x: number; y: number }>,
  closed: boolean
): ShapePath {
  if (points.length < 2) {
    // Degenerate: single point, return empty path
    const p = points[0] ?? { x: 0, y: 0 };
    return { start: p, segments: [], closed: false };
  }

  if (points.length === 2) {
    // Only two points — single line segment
    return {
      start: points[0],
      segments: [{ type: "line", to: points[1] }],
      closed,
    };
  }

  // Compute midpoints between consecutive points
  const midpoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    midpoints.push({
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    });
  }

  // Build segments:
  //   start = midpoints[0]
  //   segment[i] = curve from current to midpoints[i+1] with control = points[i+1]
  //   final segment: curve/line to points[last] (open) or curve back to start (closed)
  const start = midpoints[0];
  const segments: ShapePath["segments"][number][] = [];

  for (let i = 0; i < midpoints.length - 1; i++) {
    segments.push({
      type: "curve",
      control: points[i + 1],
      to: midpoints[i + 1],
    });
  }

  if (closed) {
    // Close with a curve from the last midpoint back to midpoints[0],
    // using the last point as control
    segments.push({
      type: "curve",
      control: points[points.length - 1],
      to: midpoints[0],
    });
  } else {
    // End with a line to the final point so the stroke reaches the actual endpoint
    segments.push({
      type: "line",
      to: points[points.length - 1],
    });
  }

  return {
    start,
    segments,
    closed,
  };
}

// ---------------------------------------------------------------------------
// Full pencil pipeline
// ---------------------------------------------------------------------------

/**
 * Build a ShapeDisplayObject from raw pencil input points by:
 *  1. Simplifying with Ramer-Douglas-Peucker (epsilon = 2.0)
 *  2. Smoothing with the midpoint Catmull-Rom → quadratic Bézier conversion
 *
 * @param points  Raw pointer positions captured during drawing
 * @param fill    Optional fill style
 * @param stroke  Optional stroke style
 * @param closed  Whether to close the path (default: false)
 */
export function createSimplifiedPencilShape(
  points: Array<{ x: number; y: number }>,
  fill: Fill | null,
  stroke: SolidStroke | null,
  closed = false
): ShapeDisplayObject {
  const simplified = simplifyPath(points, 2.0);
  const path = smoothPath(simplified, closed);

  const shapePath: ShapePath = {
    ...path,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };

  const shape: Shape = {
    id: nextId(),
    paths: [shapePath],
  };

  return {
    type: "shape",
    id: nextId(),
    shape,
    x: 0,
    y: 0,
  };
}
