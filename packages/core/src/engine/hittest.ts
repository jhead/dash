import type { DisplayObject, ShapePath } from './types.js';
import { getTransformedBounds } from './bounds.js';

/**
 * Returns a point on a quadratic Bézier curve at parameter t.
 * P0 = start, P1 = control, P2 = end.
 */
function quadBezier(
  x0: number, y0: number,
  cx: number, cy: number,
  x2: number, y2: number,
  t: number,
): [number, number] {
  const mt = 1 - t;
  const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x2;
  const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y2;
  return [x, y];
}

/**
 * Ray-casting helper: returns true if the horizontal ray from (px, py)
 * going rightward crosses the line segment from (x1,y1) to (x2,y2).
 */
function rayCrossesSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): boolean {
  if ((y1 > py) === (y2 > py)) return false; // both above or both below
  const intersectX = x1 + (py - y1) / (y2 - y1) * (x2 - x1);
  return px < intersectX;
}

/**
 * Point-in-polygon test against an explicit array of vertices using ray casting.
 * Returns true if the point (px, py) is inside the polygon defined by vertices.
 */
export function pointInPolygon(px: number, py: number, vertices: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Point-in-polygon test against a list of ShapePaths using ray casting.
 * Only filled paths are considered.
 */
function pointInPaths(paths: readonly ShapePath[], px: number, py: number): boolean {
  let inside = false;

  for (const path of paths) {
    if (!path.fill) continue; // only filled paths matter for hit

    const startX = path.start.x;
    const startY = path.start.y;
    let lastX = startX;
    let lastY = startY;

    for (const seg of path.segments) {
      if (seg.type === 'line') {
        const { x: toX, y: toY } = seg.to;
        if (rayCrossesSegment(px, py, lastX, lastY, toX, toY)) inside = !inside;
        lastX = toX;
        lastY = toY;
      } else if (seg.type === 'curve') {
        const { control, to } = seg;
        // Approximate quadratic Bézier with 8 line segments
        for (let i = 0; i < 8; i++) {
          const t0 = i / 8;
          const t1 = (i + 1) / 8;
          const [ax, ay] = quadBezier(lastX, lastY, control.x, control.y, to.x, to.y, t0);
          const [bx, by] = quadBezier(lastX, lastY, control.x, control.y, to.x, to.y, t1);
          if (rayCrossesSegment(px, py, ax, ay, bx, by)) inside = !inside;
        }
        lastX = to.x;
        lastY = to.y;
      }
    }

    // Close the path: segment from last point back to start
    if (path.closed) {
      if (rayCrossesSegment(px, py, lastX, lastY, startX, startY)) inside = !inside;
    }
  }

  return inside;
}

/**
 * Apply the inverse transform (position, rotation, scale) of a display object
 * to a world-space point, returning the point in local/object space.
 */
function inverseTransformPoint(
  obj: { x: number; y: number; rotation?: number; scaleX?: number; scaleY?: number },
  x: number,
  y: number,
): [number, number] {
  // Translate by object position
  const dx = x - obj.x;
  const dy = y - obj.y;

  // Inverse rotation
  const angleDeg = obj.rotation ?? 0;
  const rad = -angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  // Inverse scale
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;

  return [rx / sx, ry / sy];
}

/**
 * Hit-test a point (in world/stage coordinates) against a display object.
 *
 * - ShapeDisplayObject: uses ray-casting against filled shape paths,
 *   with the point transformed into local object space first.
 * - DrawingObject: same ray-casting approach.
 * - SymbolInstance, TextDisplayObject, BitmapDisplayObject, GroupObject:
 *   axis-aligned bounding box test via getTransformedBounds.
 */
export function hitTestPoint(obj: DisplayObject, x: number, y: number): boolean {
  if (obj.type === 'shape') {
    const [lx, ly] = inverseTransformPoint(obj, x, y);
    return pointInPaths(obj.shape.paths, lx, ly);
  }

  if (obj.type === 'drawing-object') {
    const [lx, ly] = inverseTransformPoint(obj, x, y);
    return pointInPaths(obj.shape.paths, lx, ly);
  }

  // SymbolInstance, TextDisplayObject, BitmapDisplayObject, GroupObject
  const bounds = getTransformedBounds(obj);
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}
