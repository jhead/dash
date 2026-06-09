/**
 * Motion guide path sampling utilities.
 *
 * Used by the motion tween engine to position guided objects along a guide
 * layer's path at a given normalized parameter t ∈ [0, 1].
 */

import type { ShapePath } from './types.js';
import type { Layer } from '../model/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PathPoint {
  x: number;
  y: number;
  /** Tangent angle in radians (0 = rightward, -π/2 = upward, etc.) */
  angle: number;
}

// ---------------------------------------------------------------------------
// samplePath
// ---------------------------------------------------------------------------

/**
 * Sample a ShapePath at parameter t ∈ [0, 1].
 *
 * Builds a polyline approximation of the path (quadratic Bézier curves are
 * sampled with 10 sub-steps) then parameterizes by arc length to find the
 * (x, y) position and tangent angle at the requested parameter.
 *
 * @param path  The shape path to sample along.
 * @param t     Normalized position: 0 = path start, 1 = path end.
 * @returns     Position and tangent angle at parameter t.
 */
export function samplePath(path: ShapePath, t: number): PathPoint {
  // -----------------------------------------------------------------------
  // 1. Build polyline points from path segments
  // -----------------------------------------------------------------------
  const points: { x: number; y: number }[] = [];

  // Start point
  let cx = path.start.x;
  let cy = path.start.y;
  points.push({ x: cx, y: cy });

  for (const seg of path.segments) {
    if (seg.type === 'line') {
      cx = seg.to.x;
      cy = seg.to.y;
      points.push({ x: cx, y: cy });
    } else {
      // Quadratic Bézier: approximate with 10 line segments
      const bx0 = cx;
      const by0 = cy;
      const bcx = seg.control.x;
      const bcy = seg.control.y;
      const bx1 = seg.to.x;
      const by1 = seg.to.y;

      for (let i = 1; i <= 10; i++) {
        const bt = i / 10;
        const mt = 1 - bt;
        const x = mt * mt * bx0 + 2 * mt * bt * bcx + bt * bt * bx1;
        const y = mt * mt * by0 + 2 * mt * bt * bcy + bt * bt * by1;
        points.push({ x, y });
      }

      cx = seg.to.x;
      cy = seg.to.y;
    }
  }

  // -----------------------------------------------------------------------
  // 2. Degenerate cases
  // -----------------------------------------------------------------------
  if (points.length === 0) {
    return { x: 0, y: 0, angle: 0 };
  }
  if (points.length === 1) {
    return { x: points[0]!.x, y: points[0]!.y, angle: 0 };
  }

  // -----------------------------------------------------------------------
  // 3. Compute cumulative arc lengths
  // -----------------------------------------------------------------------
  const arcLengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    arcLengths.push(arcLengths[i - 1]! + Math.sqrt(dx * dx + dy * dy));
  }

  const totalLength = arcLengths[arcLengths.length - 1]!;

  // -----------------------------------------------------------------------
  // 4. Handle zero-length path
  // -----------------------------------------------------------------------
  if (totalLength === 0) {
    return { x: points[0]!.x, y: points[0]!.y, angle: 0 };
  }

  // -----------------------------------------------------------------------
  // 5. Find the segment at arc length position t * totalLength
  // -----------------------------------------------------------------------
  const targetLength = Math.max(0, Math.min(1, t)) * totalLength;

  // Binary search for the segment index
  let lo = 0;
  let hi = arcLengths.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (arcLengths[mid]! <= targetLength) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const segStart = arcLengths[lo]!;
  const segEnd = arcLengths[hi]!;
  const segLen = segEnd - segStart;

  const p0 = points[lo]!;
  const p1 = points[hi]!;

  // -----------------------------------------------------------------------
  // 6. Interpolate within the segment
  // -----------------------------------------------------------------------
  const localT = segLen > 0 ? (targetLength - segStart) / segLen : 0;

  const x = p0.x + (p1.x - p0.x) * localT;
  const y = p0.y + (p1.y - p0.y) * localT;
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);

  return { x, y, angle };
}

// ---------------------------------------------------------------------------
// getGuideLayerPath
// ---------------------------------------------------------------------------

/**
 * Extract the first ShapePath from the governing keyframe (frame 0) of a
 * guide layer.  Returns `null` if the layer has no frames, no display objects,
 * or none of the display objects are shapes.
 *
 * @param layer  The guide layer (type === 'guide') to inspect.
 * @returns      The first ShapePath found, or null.
 */
export function getGuideLayerPath(layer: Layer): ShapePath | null {
  // Find the first keyframe (frame index 0) or the first frame
  const frame = layer.frames.find((f) => f.index === 0) ?? layer.frames[0];
  if (!frame) return null;

  for (const obj of frame.displayObjects) {
    if (obj.type === 'shape' && obj.shape.paths.length > 0) {
      return obj.shape.paths[0]!;
    }
    if (obj.type === 'drawing-object' && obj.shape.paths.length > 0) {
      return obj.shape.paths[0]!;
    }
  }

  return null;
}
