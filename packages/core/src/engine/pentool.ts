/**
 * Pen tool path-building state machine.
 *
 * Pure data functions — no React, no canvas.
 * Converts anchor points with optional Bézier control handles into ShapePath
 * (quadratic Bézier, matching the Flash/SWF internal format).
 */

import type { Fill, Stroke, ShapePath } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PenAnchorPoint {
  x: number;
  y: number;
  /** Control point for the curve entering this point (from previous segment) */
  cpIn?: { x: number; y: number };
  /** Control point for the curve leaving this point (to next segment) */
  cpOut?: { x: number; y: number };
}

export interface PenToolState {
  points: PenAnchorPoint[];
  closed: boolean;
}

// ---------------------------------------------------------------------------
// State constructors / mutators (all return new immutable state)
// ---------------------------------------------------------------------------

/** Start a new empty path */
export function createPenState(): PenToolState {
  return { points: [], closed: false };
}

/** Add an anchor point (sharp corner — no curve handles) */
export function addAnchorPoint(
  state: PenToolState,
  x: number,
  y: number
): PenToolState {
  return {
    ...state,
    points: [...state.points, { x, y }],
  };
}

/**
 * Add a smooth curve point with symmetric control handles.
 * cpOut drives the curve leaving this point; cpIn is the mirror.
 */
export function addSmoothPoint(
  state: PenToolState,
  x: number,
  y: number,
  cpOutX: number,
  cpOutY: number
): PenToolState {
  // Symmetric: cpIn is the reflection of cpOut around (x, y)
  const cpIn = { x: 2 * x - cpOutX, y: 2 * y - cpOutY };
  const cpOut = { x: cpOutX, y: cpOutY };
  return {
    ...state,
    points: [...state.points, { x, y, cpIn, cpOut }],
  };
}

/** Close the path (connect last point back to first) */
export function closePenPath(state: PenToolState): PenToolState {
  return { ...state, closed: true };
}

/** Move the last anchor point (for drag updates during placement) */
export function updateLastPoint(
  state: PenToolState,
  x: number,
  y: number,
  cpOutX?: number,
  cpOutY?: number
): PenToolState {
  if (state.points.length === 0) return state;
  const last = state.points[state.points.length - 1];
  let updated: PenAnchorPoint = { ...last, x, y };
  if (cpOutX !== undefined && cpOutY !== undefined) {
    const cpOut = { x: cpOutX, y: cpOutY };
    const cpIn = { x: 2 * x - cpOutX, y: 2 * y - cpOutY };
    updated = { ...updated, cpOut, cpIn };
  }
  return {
    ...state,
    points: [...state.points.slice(0, -1), updated],
  };
}

// ---------------------------------------------------------------------------
// Conversion to ShapePath
// ---------------------------------------------------------------------------

/**
 * Convert PenToolState to a ShapePath (PathSegment array).
 *
 * For each segment with cpOut/cpIn, emit a quadratic curve using the average
 * of cpOut and cpIn as the control point.  For segments with no handles,
 * emit a line segment.
 */
export function penStateToShapePath(
  state: PenToolState,
  fill: Fill,
  stroke: Stroke | null
): ShapePath {
  const empty: ShapePath = {
    start: { x: 0, y: 0 },
    segments: [],
    closed: false,
    fill,
    ...(stroke !== null ? { stroke } : {}),
  };

  if (state.points.length === 0) return empty;

  const first = state.points[0];
  const start = { x: first.x, y: first.y };
  const segments: ShapePath["segments"][number][] = [];

  for (let i = 1; i < state.points.length; i++) {
    const prev = state.points[i - 1];
    const curr = state.points[i];

    if (prev.cpOut || curr.cpIn) {
      // Cubic-to-quadratic approximation: midpoint of the two control points
      const cpx = ((prev.cpOut?.x ?? prev.x) + (curr.cpIn?.x ?? curr.x)) / 2;
      const cpy = ((prev.cpOut?.y ?? prev.y) + (curr.cpIn?.y ?? curr.y)) / 2;
      segments.push({ type: "curve", control: { x: cpx, y: cpy }, to: { x: curr.x, y: curr.y } });
    } else {
      segments.push({ type: "line", to: { x: curr.x, y: curr.y } });
    }
  }

  if (state.closed && state.points.length > 1) {
    const last = state.points[state.points.length - 1];
    const firstP = state.points[0];
    if (last.cpOut || firstP.cpIn) {
      const cpx = ((last.cpOut?.x ?? last.x) + (firstP.cpIn?.x ?? firstP.x)) / 2;
      const cpy = ((last.cpOut?.y ?? last.y) + (firstP.cpIn?.y ?? firstP.y)) / 2;
      segments.push({ type: "curve", control: { x: cpx, y: cpy }, to: { x: firstP.x, y: firstP.y } });
    }
    // closed is set at the ShapePath level; no separate "close" segment needed
  }

  return {
    start,
    segments,
    closed: state.closed,
    fill,
    ...(stroke !== null ? { stroke } : {}),
  };
}
