/**
 * Unit tests for motion tween rotation interpolation.
 * Tests the interpolateRotation logic via interpolateTween.
 */

import { describe, it, expect } from "vitest";
import { interpolateTween } from "../../tween/interpolate.js";
import type { TweenTarget } from "../../tween/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTweenTarget(rotation: number): TweenTarget {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation, alpha: 100 };
}

/**
 * Interpolate rotation from startAngle to endAngle at t=0.5 with the given mode.
 */
function rotationAt(
  startAngle: number,
  endAngle: number,
  t: number,
  mode: "auto" | "cw" | "ccw" | "none",
  count = 0
): number {
  // Build a 3-frame span: startFrame=0, endFrame=2, so span=2 frames.
  // At frame=1, linearT = 1/2 = 0.5.
  const from = makeTweenTarget(startAngle);
  const to = makeTweenTarget(endAngle);
  // We pick frame/startFrame/endFrame so that t = (frame - startFrame) / (endFrame - startFrame) = desired t.
  // Use startFrame=0, endFrame=100 so frame = t * 100.
  const frame = Math.round(t * 100);
  const result = interpolateTween(from, to, frame, 0, 100, {
    ease: 0,
    motionRotate: mode,
    motionRotateCount: count,
  });
  return result.rotation;
}

// ---------------------------------------------------------------------------
// auto mode: shortest path rotation
// ---------------------------------------------------------------------------

describe("rotation interpolation — auto mode (shortest path)", () => {
  it("0→90 at t=0.5 → 45 degrees", () => {
    // Shortest path: delta = 90, so 0 + 90 * 0.5 = 45
    expect(rotationAt(0, 90, 0.5, "auto")).toBeCloseTo(45);
  });

  it("0→270 at t=0.5 → -45 degrees (takes the short -90 path)", () => {
    // Normalized: from=0, to=270.
    // delta = 270 - 0 = 270 > 180 → wrapped to 270 - 360 = -90
    // result = 0 + (-90) * 0.5 = -45
    expect(rotationAt(0, 270, 0.5, "auto")).toBeCloseTo(-45);
  });

  it("0→180 at t=0.5 → 90 degrees (delta=180 stays at 180)", () => {
    // delta = 180, no wrapping needed
    expect(rotationAt(0, 180, 0.5, "auto")).toBeCloseTo(90);
  });

  it("0→-90 at t=0.5 → -45 degrees (CCW short path)", () => {
    // Normalized: from=0, to=270 (same as above)
    // This tests using a negative endAngle directly
    // normalizeAngle(-90) = 270, delta = 270 → -90 after wrap
    expect(rotationAt(0, -90, 0.5, "auto")).toBeCloseTo(-45);
  });
});

// ---------------------------------------------------------------------------
// cw mode: always clockwise
// ---------------------------------------------------------------------------

describe("rotation interpolation — cw mode (always clockwise)", () => {
  it("0→90 at t=0.5 → 45 degrees (small CW angle)", () => {
    // CW: delta = 90 - 0 = 90 (already positive), result = 0 + 90 * 0.5 = 45
    expect(rotationAt(0, 90, 0.5, "cw")).toBeCloseTo(45);
  });

  it("0→270 at t=0.5 → 135 degrees (goes the long way CW: 270 degrees traveled)", () => {
    // CW: from=0, to=270. delta = 270 - 0 = 270 (positive, already CW).
    // result = 0 + 270 * 0.5 = 135
    expect(rotationAt(0, 270, 0.5, "cw")).toBeCloseTo(135);
  });

  it("0→0 at t=0.5 → 0 degrees (no rotation, same start/end)", () => {
    // CW: delta = 0 (same angle), no extra rotation
    expect(rotationAt(0, 0, 0.5, "cw")).toBeCloseTo(0);
  });

  it("90→0 at t=0.5 → 225 degrees (CW wrap: delta = -90+360 = 270)", () => {
    // CW: from=90, to=0. delta = 0 - 90 = -90 < 0 → delta += 360 = 270
    // result = 90 + 270 * 0.5 = 90 + 135 = 225
    expect(rotationAt(90, 0, 0.5, "cw")).toBeCloseTo(225);
  });
});

// ---------------------------------------------------------------------------
// ccw mode: always counter-clockwise
// ---------------------------------------------------------------------------

describe("rotation interpolation — ccw mode (always counter-clockwise)", () => {
  it("0→270 at t=0.5 → -45 degrees (goes CCW: 90 degrees traveled)", () => {
    // CCW: from=0, to=270. delta = 270 - 0 = 270 > 0 → delta -= 360 = -90
    // result = 0 + (-90) * 0.5 = -45
    expect(rotationAt(0, 270, 0.5, "ccw")).toBeCloseTo(-45);
  });

  it("0→90 at t=0.5 → -135 degrees (goes the long way CCW: 270 degrees traveled)", () => {
    // CCW: from=0, to=90. delta = 90 - 0 = 90 > 0 → delta -= 360 = -270
    // result = 0 + (-270) * 0.5 = -135
    expect(rotationAt(0, 90, 0.5, "ccw")).toBeCloseTo(-135);
  });

  it("0→0 at t=0.5 → 0 degrees (no rotation, same start/end)", () => {
    // CCW: delta = 0 (same angle), no extra rotation
    expect(rotationAt(0, 0, 0.5, "ccw")).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// motionRotateCount: extra full rotations
// ---------------------------------------------------------------------------

describe("rotation interpolation — motionRotateCount", () => {
  it("cw with count=1 adds an extra full 360 degree spin", () => {
    // CW: from=0, to=90. delta = 90 + 1*360 = 450
    // At t=0.5: result = 0 + 450 * 0.5 = 225
    expect(rotationAt(0, 90, 0.5, "cw", 1)).toBeCloseTo(225);
  });

  it("cw with count=2 adds two extra full 360 degree spins", () => {
    // CW: from=0, to=90. delta = 90 + 2*360 = 810
    // At t=0.5: result = 0 + 810 * 0.5 = 405
    expect(rotationAt(0, 90, 0.5, "cw", 2)).toBeCloseTo(405);
  });

  it("ccw with count=1 adds an extra full 360 degree spin in CCW direction", () => {
    // CCW: from=0, to=270. delta = (270-0)=270>0 → -90 - 1*360 = -450
    // At t=0.5: result = 0 + (-450) * 0.5 = -225
    expect(rotationAt(0, 270, 0.5, "ccw", 1)).toBeCloseTo(-225);
  });
});

// ---------------------------------------------------------------------------
// none mode: no rotation
// ---------------------------------------------------------------------------

describe("rotation interpolation — none mode (no rotation)", () => {
  it("0→90 at t=0.5 → 0 degrees (stays at startAngle)", () => {
    expect(rotationAt(0, 90, 0.5, "none")).toBeCloseTo(0);
  });

  it("45→270 at t=0.5 → 45 degrees (stays at startAngle)", () => {
    expect(rotationAt(45, 270, 0.5, "none")).toBeCloseTo(45);
  });

  it("rotation stays at startAngle at t=0", () => {
    expect(rotationAt(30, 180, 0, "none")).toBeCloseTo(30);
  });

  it("rotation stays at startAngle at t=1", () => {
    expect(rotationAt(30, 180, 1, "none")).toBeCloseTo(30);
  });
});
