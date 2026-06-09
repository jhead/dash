/**
 * Tests for the pen tool path-building state machine.
 */

import { describe, it, expect } from "vitest";
import {
  createPenState,
  addAnchorPoint,
  addSmoothPoint,
  closePenPath,
  penStateToShapePath,
  updateLastPoint,
} from "../pentool.js";
import type { Fill } from "../types.js";

const defaultFill: Fill = { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 } };

// ---------------------------------------------------------------------------
// createPenState
// ---------------------------------------------------------------------------

describe("createPenState", () => {
  it("returns an empty points array", () => {
    const state = createPenState();
    expect(state.points).toEqual([]);
    expect(state.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addAnchorPoint
// ---------------------------------------------------------------------------

describe("addAnchorPoint", () => {
  it("adds a point with the given coordinates", () => {
    const state = addAnchorPoint(createPenState(), 10, 20);
    expect(state.points).toHaveLength(1);
    expect(state.points[0]).toEqual({ x: 10, y: 20 });
  });

  it("does not mutate the original state", () => {
    const original = createPenState();
    addAnchorPoint(original, 5, 5);
    expect(original.points).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// penStateToShapePath — lineTo for anchor-only points
// ---------------------------------------------------------------------------

describe("penStateToShapePath — two anchor points produce a line segment", () => {
  it("two anchor points → single line segment", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    state = addAnchorPoint(state, 100, 0);
    const path = penStateToShapePath(state, defaultFill, null);
    expect(path.start).toEqual({ x: 0, y: 0 });
    expect(path.segments).toHaveLength(1);
    expect(path.segments[0]).toEqual({ type: "line", to: { x: 100, y: 0 } });
  });
});

// ---------------------------------------------------------------------------
// addSmoothPoint → curveTo
// ---------------------------------------------------------------------------

describe("addSmoothPoint", () => {
  it("smooth point followed by anchor → curveTo segment", () => {
    let state = createPenState();
    // Smooth point at (0,0) with cpOut pointing right
    state = addSmoothPoint(state, 0, 0, 50, 0);
    state = addAnchorPoint(state, 100, 0);
    const path = penStateToShapePath(state, defaultFill, null);
    expect(path.segments).toHaveLength(1);
    const seg = path.segments[0];
    expect(seg.type).toBe("curve");
    if (seg.type === "curve") {
      expect(seg.to).toEqual({ x: 100, y: 0 });
      // Control point: midpoint of cpOut(50,0) and curr.cpIn(100,0) = (75, 0)
      expect(seg.control).toEqual({ x: 75, y: 0 });
    }
  });

  it("anchor followed by smooth point → curveTo using prev.cpOut", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    // Smooth point at (100,0) with cpIn derived from cpOut reflection
    state = addSmoothPoint(state, 100, 0, 150, 0);
    const path = penStateToShapePath(state, defaultFill, null);
    expect(path.segments).toHaveLength(1);
    const seg = path.segments[0];
    expect(seg.type).toBe("curve");
    if (seg.type === "curve") {
      // prev has no cpOut (anchor), curr has cpIn = 2*100-150 = 50, so cpIn = (50,0)
      // midpoint of prev.x(0) and curr.cpIn.x(50) = 25
      expect(seg.control.x).toBe(25);
      expect(seg.control.y).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// closePenPath
// ---------------------------------------------------------------------------

describe("closePenPath", () => {
  it("marks state as closed", () => {
    const state = closePenPath(createPenState());
    expect(state.closed).toBe(true);
  });

  it("does not mutate the original state", () => {
    const original = createPenState();
    closePenPath(original);
    expect(original.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Closed path ends with close command
// ---------------------------------------------------------------------------

describe("penStateToShapePath — closed path", () => {
  it("closed path sets closed: true on the ShapePath", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    state = addAnchorPoint(state, 100, 0);
    state = addAnchorPoint(state, 50, 100);
    state = closePenPath(state);
    const path = penStateToShapePath(state, defaultFill, null);
    expect(path.closed).toBe(true);
  });

  it("closed path with anchor-only points does not add closing curve segment", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    state = addAnchorPoint(state, 100, 0);
    state = addAnchorPoint(state, 50, 100);
    state = closePenPath(state);
    const path = penStateToShapePath(state, defaultFill, null);
    // 2 line segments between the 3 anchors; no extra closing curve
    expect(path.segments).toHaveLength(2);
  });

  it("closed path with smooth last point adds closing curve segment", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    // Smooth final point with cpOut
    state = addSmoothPoint(state, 100, 0, 150, 0);
    state = closePenPath(state);
    const path = penStateToShapePath(state, defaultFill, null);
    // 1 line/curve from p0→p1, plus 1 closing curve from p1 back to p0
    expect(path.segments).toHaveLength(2);
    const closing = path.segments[path.segments.length - 1];
    expect(closing.type).toBe("curve");
  });
});

// ---------------------------------------------------------------------------
// updateLastPoint
// ---------------------------------------------------------------------------

describe("updateLastPoint", () => {
  it("moves the last anchor point", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    state = updateLastPoint(state, 50, 75);
    expect(state.points[0]).toMatchObject({ x: 50, y: 75 });
  });

  it("sets cpOut and cpIn when handle coords provided", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 0, 0);
    state = updateLastPoint(state, 0, 0, 30, 0);
    expect(state.points[0].cpOut).toEqual({ x: 30, y: 0 });
    // cpIn is mirror of cpOut around (0,0)
    expect(state.points[0].cpIn).toEqual({ x: -30, y: 0 });
  });

  it("returns same state when there are no points", () => {
    const state = createPenState();
    const next = updateLastPoint(state, 10, 10);
    expect(next).toBe(state);
  });

  it("does not mutate earlier points", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 10, 20);
    state = addAnchorPoint(state, 30, 40);
    state = updateLastPoint(state, 99, 99);
    expect(state.points[0]).toEqual({ x: 10, y: 20 });
  });
});

// ---------------------------------------------------------------------------
// penStateToShapePath — edge cases
// ---------------------------------------------------------------------------

describe("penStateToShapePath — edge cases", () => {
  it("0 points → empty segments and origin start", () => {
    const state = createPenState();
    const path = penStateToShapePath(state, defaultFill, null);
    expect(path.segments).toHaveLength(0);
    expect(path.start).toEqual({ x: 0, y: 0 });
  });

  it("1 point → only start set, no segments", () => {
    let state = createPenState();
    state = addAnchorPoint(state, 42, 17);
    const path = penStateToShapePath(state, defaultFill, null);
    expect(path.start).toEqual({ x: 42, y: 17 });
    expect(path.segments).toHaveLength(0);
  });

  it("passes fill through to ShapePath", () => {
    const fill: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
    const path = penStateToShapePath(createPenState(), fill, null);
    expect(path.fill).toEqual(fill);
  });

  it("passes stroke through to ShapePath when provided", () => {
    const stroke = {
      type: "solid" as const,
      color: { r: 0, g: 0, b: 255, a: 255 },
      width: 2,
      caps: "round" as const,
      joints: "miter" as const,
      miterLimit: 3,
    };
    const path = penStateToShapePath(createPenState(), defaultFill, stroke);
    expect(path.stroke).toEqual(stroke);
  });

  it("omits stroke when null passed", () => {
    const path = penStateToShapePath(createPenState(), defaultFill, null);
    expect(path.stroke).toBeUndefined();
  });
});
