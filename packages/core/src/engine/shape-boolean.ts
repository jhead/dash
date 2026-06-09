/**
 * Simplified shape path union/subtract — operates on SVG path strings.
 *
 * Note: Full polygon clipping (Sutherland-Hodgman, Martinez, etc.) is complex.
 * This implementation provides the interface for Flash 8 parity; full
 * implementation is separate.
 */

export interface PathShape {
  path: string; // SVG path data
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Returns the bounding-box union of two shapes.
 * Full path union requires a polygon clipping algorithm; this returns a
 * concatenated path with merged bounding box.
 */
export function shapeBoundsUnion(a: PathShape, b: PathShape): PathShape {
  const x = Math.min(a.bounds.x, b.bounds.x);
  const y = Math.min(a.bounds.y, b.bounds.y);
  const x2 = Math.max(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width);
  const y2 = Math.max(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height);
  const path = [a.path, b.path].filter(Boolean).join(" ");
  return {
    path,
    bounds: { x, y, width: x2 - x, height: y2 - y },
  };
}

/**
 * Returns shape A with shape B's bounding area excluded (intersection removed).
 * Full implementation requires polygon clipping; this returns A unchanged.
 */
export function shapeBoundsSubtract(a: PathShape, b: PathShape): PathShape {
  // Simplified: return A unchanged (full clip requires polygon boolean ops)
  void b;
  return { ...a, bounds: { ...a.bounds } };
}
