/**
 * Pure geometry helpers for Flash 8 snapping behavior.
 *
 * All functions are pure — no side effects, no mutations.
 * Tolerance is in stage pixels; callers should scale by zoom if needed.
 */

import type { Point } from "./types.js";
import type { Guide } from "../model/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapType = "none" | "grid" | "pixel" | "guide" | "object";

export interface SnapResult {
  readonly point: Point;
  readonly type: SnapType;
  readonly distance: number; // distance from original point to snapped point
}

export interface ObjectBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly id: string;
}

export interface SnapConfig {
  readonly snapToGrid: boolean;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly snapToPixels: boolean;
  readonly snapToGuides: boolean;
  readonly guides: readonly Guide[];
  readonly snapToObjects: boolean;
  readonly objectBounds: readonly ObjectBounds[]; // bounding boxes of objects on stage (excluding the one being dragged)
  readonly tolerance: number; // snap distance in stage pixels (default 8)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Euclidean distance between two points. */
export function snapDistance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Individual snap functions
// ---------------------------------------------------------------------------

/** Snap a point to the nearest grid intersection. */
export function snapToGrid(
  point: Point,
  gridWidth: number,
  gridHeight: number
): SnapResult {
  const snappedX = Math.round(point.x / gridWidth) * gridWidth;
  const snappedY = Math.round(point.y / gridHeight) * gridHeight;
  const snapped: Point = { x: snappedX, y: snappedY };
  return {
    point: snapped,
    type: "grid",
    distance: snapDistance(point, snapped),
  };
}

/** Snap a point to the nearest whole pixel. */
export function snapToPixels(point: Point): SnapResult {
  const snappedX = Math.round(point.x);
  const snappedY = Math.round(point.y);
  const snapped: Point = { x: snappedX, y: snappedY };
  return {
    point: snapped,
    type: "pixel",
    distance: snapDistance(point, snapped),
  };
}

/**
 * Snap a point to the nearest guide line (within tolerance).
 * Returns a 'none' snap if no guide is within tolerance.
 */
export function snapToGuides(
  point: Point,
  guides: readonly Guide[],
  tolerance: number
): SnapResult {
  let best: SnapResult = { point, type: "none", distance: 0 };
  let bestDist = Infinity;

  for (const guide of guides) {
    let candidate: Point;
    if (guide.orientation === "horizontal") {
      candidate = { x: point.x, y: guide.position };
    } else {
      candidate = { x: guide.position, y: point.y };
    }

    const dist = snapDistance(point, candidate);
    if (dist < tolerance && dist < bestDist) {
      bestDist = dist;
      best = { point: candidate, type: "guide", distance: dist };
    }
  }

  return best;
}

/**
 * Snap a point to the nearest edge/center of nearby objects (snap-to-objects).
 * Checks: 4 corners, 4 edge midpoints, and center of each ObjectBounds.
 * Returns a 'none' snap if no object snap point is within tolerance.
 */
export function snapToObjects(
  point: Point,
  objects: readonly ObjectBounds[],
  tolerance: number
): SnapResult {
  let best: SnapResult = { point, type: "none", distance: 0 };
  let bestDist = Infinity;

  for (const obj of objects) {
    const left = obj.x;
    const right = obj.x + obj.width;
    const top = obj.y;
    const bottom = obj.y + obj.height;
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;

    const candidates: Point[] = [
      // 4 corners
      { x: left, y: top },
      { x: right, y: top },
      { x: left, y: bottom },
      { x: right, y: bottom },
      // 4 edge midpoints
      { x: cx, y: top },
      { x: cx, y: bottom },
      { x: left, y: cy },
      { x: right, y: cy },
      // center
      { x: cx, y: cy },
    ];

    for (const candidate of candidates) {
      const dist = snapDistance(point, candidate);
      if (dist < tolerance && dist < bestDist) {
        bestDist = dist;
        best = { point: candidate, type: "object", distance: dist };
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Scalar (1-D) snap helpers
// ---------------------------------------------------------------------------

/** Snap a scalar value to the nearest multiple of gridSize.
 * Returns the value unchanged if gridSize <= 0. */
export function snapScalarToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/** Snap a scalar value to the nearest integer (whole pixel). */
export function snapScalarToPixel(value: number): number {
  return Math.round(value);
}

/** Snap a scalar value toward the nearest guide of the specified orientation.
 * Returns the value unchanged if no guide is within the threshold. */
export function snapScalarToGuide(
  value: number,
  guides: readonly Guide[],
  orientation: "horizontal" | "vertical",
  threshold: number
): number {
  let best = value;
  let bestDist = Infinity;
  for (const guide of guides) {
    if (guide.orientation !== orientation) continue;
    const dist = Math.abs(guide.position - value);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      best = guide.position;
    }
  }
  return best;
}

export interface ScalarSnapConfig {
  readonly snapToGrid: boolean;
  readonly snapToPixels: boolean;
  readonly snapToGuides: boolean;
  readonly grid?: { readonly gridWidth: number; readonly gridHeight: number };
  readonly guides: readonly Guide[];
  readonly snapThreshold?: number;
}

const DEFAULT_SNAP_THRESHOLD = 5;

/** Apply all enabled scalar snap modes to the X axis value. */
export function snapScalarX(x: number, config: ScalarSnapConfig): number {
  let v = x;
  if (config.snapToGrid && config.grid) {
    v = snapScalarToGrid(v, config.grid.gridWidth);
  }
  if (config.snapToPixels) {
    v = snapScalarToPixel(v);
  }
  if (config.snapToGuides) {
    const threshold = config.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    v = snapScalarToGuide(v, config.guides, "vertical", threshold);
  }
  return v;
}

/** Apply all enabled scalar snap modes to the Y axis value. */
export function snapScalarY(y: number, config: ScalarSnapConfig): number {
  let v = y;
  if (config.snapToGrid && config.grid) {
    v = snapScalarToGrid(v, config.grid.gridHeight);
  }
  if (config.snapToPixels) {
    v = snapScalarToPixel(v);
  }
  if (config.snapToGuides) {
    const threshold = config.snapThreshold ?? DEFAULT_SNAP_THRESHOLD;
    v = snapScalarToGuide(v, config.guides, "horizontal", threshold);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Apply all enabled snap modes and return the best snap result
 * (the one with the smallest distance). If no snap is closer than
 * config.tolerance, returns the original point with type='none'.
 */
export function snapPoint(point: Point, config: SnapConfig): SnapResult {
  const candidates: SnapResult[] = [];

  if (config.snapToGrid) {
    candidates.push(snapToGrid(point, config.gridWidth, config.gridHeight));
  }

  if (config.snapToPixels) {
    candidates.push(snapToPixels(point));
  }

  if (config.snapToGuides) {
    const result = snapToGuides(point, config.guides, config.tolerance);
    if (result.type !== "none") {
      candidates.push(result);
    }
  }

  if (config.snapToObjects) {
    const result = snapToObjects(point, config.objectBounds, config.tolerance);
    if (result.type !== "none") {
      candidates.push(result);
    }
  }

  // Filter to only snaps within tolerance
  const withinTolerance = candidates.filter(
    (r) => r.distance <= config.tolerance
  );

  if (withinTolerance.length === 0) {
    return { point, type: "none", distance: 0 };
  }

  // Return the snap with the smallest distance
  return withinTolerance.reduce((best, current) =>
    current.distance < best.distance ? current : best
  );
}
