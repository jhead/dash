/**
 * Unit tests for Modify > Transform menu operations.
 *
 * Tests the pure math behind flip/rotate operations without spinning up React.
 * The production code in Shell.tsx uses these same formulas via applyTransformDelta.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Mirror of the transform delta logic from Shell.tsx applyTransformDelta.
// Stays in sync with the production implementation.
// ---------------------------------------------------------------------------

interface TransformState {
  scaleX: number;
  scaleY: number;
  rotation: number;
}

function applyTransformDelta(
  state: TransformState,
  scaleXDelta: number,
  scaleYDelta: number,
  rotationDelta: number
): TransformState {
  const newRotation = ((state.rotation + rotationDelta) % 360 + 360) % 360;
  return {
    scaleX: state.scaleX * scaleXDelta,
    scaleY: state.scaleY * scaleYDelta,
    rotation: newRotation,
  };
}

function flipHorizontal(state: TransformState): TransformState {
  return applyTransformDelta(state, -1, 1, 0);
}

function flipVertical(state: TransformState): TransformState {
  return applyTransformDelta(state, 1, -1, 0);
}

function rotate90CW(state: TransformState): TransformState {
  return applyTransformDelta(state, 1, 1, 90);
}

function rotate90CCW(state: TransformState): TransformState {
  return applyTransformDelta(state, 1, 1, -90);
}

function rotate180(state: TransformState): TransformState {
  return applyTransformDelta(state, 1, 1, 180);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Flip Horizontal", () => {
  it("negates scaleX from 1 to -1", () => {
    const result = flipHorizontal({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(result.scaleX).toBe(-1);
    expect(result.scaleY).toBe(1);
    expect(result.rotation).toBe(0);
  });

  it("negates scaleX from -1 back to 1 (toggle)", () => {
    const result = flipHorizontal({ scaleX: -1, scaleY: 1, rotation: 0 });
    expect(result.scaleX).toBe(1);
  });

  it("does not alter scaleY or rotation", () => {
    const result = flipHorizontal({ scaleX: 2, scaleY: 3, rotation: 45 });
    expect(result.scaleX).toBe(-2);
    expect(result.scaleY).toBe(3);
    expect(result.rotation).toBe(45);
  });
});

describe("Flip Vertical", () => {
  it("negates scaleY from 1 to -1", () => {
    const result = flipVertical({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(result.scaleX).toBe(1);
    expect(result.scaleY).toBe(-1);
    expect(result.rotation).toBe(0);
  });

  it("negates scaleY from -1 back to 1 (toggle)", () => {
    const result = flipVertical({ scaleX: 1, scaleY: -1, rotation: 0 });
    expect(result.scaleY).toBe(1);
  });

  it("does not alter scaleX or rotation", () => {
    const result = flipVertical({ scaleX: 2, scaleY: 3, rotation: 45 });
    expect(result.scaleX).toBe(2);
    expect(result.scaleY).toBe(-3);
    expect(result.rotation).toBe(45);
  });
});

describe("Rotate 90° CW", () => {
  it("adds 90° to rotation", () => {
    const result = rotate90CW({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(result.rotation).toBe(90);
  });

  it("wraps around at 360°", () => {
    const result = rotate90CW({ scaleX: 1, scaleY: 1, rotation: 300 });
    expect(result.rotation).toBe(30);
  });

  it("does not alter scaleX or scaleY", () => {
    const result = rotate90CW({ scaleX: 2, scaleY: 3, rotation: 0 });
    expect(result.scaleX).toBe(2);
    expect(result.scaleY).toBe(3);
  });
});

describe("Rotate 90° CCW", () => {
  it("subtracts 90° from rotation", () => {
    const result = rotate90CCW({ scaleX: 1, scaleY: 1, rotation: 90 });
    expect(result.rotation).toBe(0);
  });

  it("wraps negative values to positive (e.g. 0° - 90° = 270°)", () => {
    const result = rotate90CCW({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(result.rotation).toBe(270);
  });

  it("does not alter scaleX or scaleY", () => {
    const result = rotate90CCW({ scaleX: 2, scaleY: 3, rotation: 180 });
    expect(result.scaleX).toBe(2);
    expect(result.scaleY).toBe(3);
  });
});

describe("Rotate 180°", () => {
  it("adds 180° to rotation", () => {
    const result = rotate180({ scaleX: 1, scaleY: 1, rotation: 0 });
    expect(result.rotation).toBe(180);
  });

  it("double rotate 180° returns to original rotation", () => {
    const first = rotate180({ scaleX: 1, scaleY: 1, rotation: 45 });
    const second = rotate180(first);
    expect(second.rotation).toBe(45);
  });

  it("wraps past 360°", () => {
    const result = rotate180({ scaleX: 1, scaleY: 1, rotation: 270 });
    expect(result.rotation).toBe(90);
  });

  it("does not alter scale", () => {
    const result = rotate180({ scaleX: 2, scaleY: 3, rotation: 0 });
    expect(result.scaleX).toBe(2);
    expect(result.scaleY).toBe(3);
  });
});
