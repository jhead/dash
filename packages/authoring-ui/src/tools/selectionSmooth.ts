/**
 * Selection-tool Smooth / Straighten geometry transforms (task 1388).
 *
 * The Flash 8 Selection (Arrow) tool exposes three Options-area modifiers:
 * the magnet (Snap to Objects, a document property), **Smooth**, and
 * **Straighten**. Smooth and Straighten reshape the currently-selected raw
 * shape:
 *   - **Straighten** removes redundant points (Ramer–Douglas–Peucker) and
 *     re-emits the contour as straight line segments — corners get crisper.
 *   - **Smooth** resamples the contour through the Catmull-Rom midpoint
 *     smoother (`smoothPath`) so the outline flows through gentle quadratic
 *     Béziers.
 *
 * Both are pure functions of a `Shape` (no React/store coupling) so they can be
 * unit-tested directly and reused by the tool handler. Fill/stroke/closed
 * attributes of each path are preserved; empty/degenerate paths pass through
 * untouched.
 */
import { simplifyPath, smoothPath, type Shape, type ShapePath, type Point } from "@flash/core";

/** Extract the on-path anchor points of a path (start + each segment endpoint). */
function pathAnchors(path: ShapePath): Point[] {
  const pts: Point[] = [{ x: path.start.x, y: path.start.y }];
  for (const seg of path.segments) {
    pts.push({ x: seg.to.x, y: seg.to.y });
  }
  // A closed path's final segment usually returns to the start; drop the
  // duplicate so smoothing/simplification treat the loop as N distinct points.
  if (
    path.closed &&
    pts.length > 1 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y
  ) {
    pts.pop();
  }
  return pts;
}

/** Straighten one path: RDP-simplify its anchors, re-emit as line segments. */
export function straightenPath(path: ShapePath, epsilon = 2): ShapePath {
  const anchors = pathAnchors(path);
  if (anchors.length < 3) return path;
  const simplified = simplifyPath(anchors, epsilon);
  if (simplified.length < 2) return path;
  const segments = simplified.slice(1).map((to) => ({ type: "line" as const, to }));
  if (path.closed) {
    segments.push({ type: "line" as const, to: simplified[0] });
  }
  return {
    start: simplified[0],
    segments,
    closed: path.closed,
    ...(path.fill ? { fill: path.fill } : {}),
    ...(path.stroke ? { stroke: path.stroke } : {}),
  };
}

/** Smooth one path: resample anchors through the Catmull-Rom midpoint smoother. */
export function smoothShapePath(path: ShapePath): ShapePath {
  const anchors = pathAnchors(path);
  if (anchors.length < 3) return path;
  const smoothed = smoothPath(anchors, path.closed);
  return {
    ...smoothed,
    ...(path.fill ? { fill: path.fill } : {}),
    ...(path.stroke ? { stroke: path.stroke } : {}),
  };
}

/** Straighten every path in a shape. */
export function straightenShape(shape: Shape): Shape {
  return { ...shape, paths: shape.paths.map((p) => straightenPath(p)) };
}

/** Smooth every path in a shape. */
export function smoothShape(shape: Shape): Shape {
  return { ...shape, paths: shape.paths.map((p) => smoothShapePath(p)) };
}
