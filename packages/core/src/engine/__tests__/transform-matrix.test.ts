/**
 * Unit tests for transform matrix operations (matrix.ts).
 * Tests compose(), applyToPoint(), and related utilities for SymbolInstance
 * transform parameters (x, y, scaleX, scaleY, rotation).
 */

import { describe, it, expect } from "vitest";
import { compose as composeMatrix, applyToPoint, identity } from "../matrix.js";

const EPSILON = 1e-6;

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

describe("transform matrix: compose", () => {
  it("identity (x=0, y=0, scaleX=1, scaleY=1, rotation=0) produces identity matrix", () => {
    const m = composeMatrix({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(approx(m.a, 1)).toBe(true);
    expect(approx(m.b, 0)).toBe(true);
    expect(approx(m.c, 0)).toBe(true);
    expect(approx(m.d, 1)).toBe(true);
    expect(approx(m.tx, 0)).toBe(true);
    expect(approx(m.ty, 0)).toBe(true);
  });

  it("translation only (x=10, y=20) sets tx=10, ty=20 with scale 1 and no rotation", () => {
    const m = composeMatrix({ tx: 10, ty: 20, scaleX: 1, scaleY: 1, rotation: 0 });
    expect(approx(m.tx, 10)).toBe(true);
    expect(approx(m.ty, 20)).toBe(true);
    expect(approx(m.a, 1)).toBe(true);
    expect(approx(m.d, 1)).toBe(true);
    expect(approx(m.b, 0)).toBe(true);
    expect(approx(m.c, 0)).toBe(true);
  });

  it("scale only (scaleX=2, scaleY=3) sets a=2, d=3", () => {
    const m = composeMatrix({ tx: 0, ty: 0, scaleX: 2, scaleY: 3, rotation: 0 });
    expect(approx(m.a, 2)).toBe(true);
    expect(approx(m.d, 3)).toBe(true);
    expect(approx(m.b, 0)).toBe(true);
    expect(approx(m.c, 0)).toBe(true);
    expect(approx(m.tx, 0)).toBe(true);
    expect(approx(m.ty, 0)).toBe(true);
  });

  it("rotation 90 degrees produces a≈0, b≈1, c≈-1, d≈0", () => {
    const m = composeMatrix({ tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: 90 });
    expect(approx(m.a, 0)).toBe(true);
    expect(approx(m.b, 1)).toBe(true);
    expect(approx(m.c, -1)).toBe(true);
    expect(approx(m.d, 0)).toBe(true);
  });

  it("combined transform (x=5, y=10, scaleX=2, scaleY=2, rotation=0) sets tx, ty and scale", () => {
    const m = composeMatrix({ tx: 5, ty: 10, scaleX: 2, scaleY: 2, rotation: 0 });
    expect(approx(m.a, 2)).toBe(true);
    expect(approx(m.d, 2)).toBe(true);
    expect(approx(m.tx, 5)).toBe(true);
    expect(approx(m.ty, 10)).toBe(true);
  });
});

describe("transform matrix: applyToPoint", () => {
  it("identity matrix leaves point unchanged", () => {
    const m = identity();
    const p = applyToPoint(m, { x: 3, y: 7 });
    expect(approx(p.x, 3)).toBe(true);
    expect(approx(p.y, 7)).toBe(true);
  });

  it("translation moves a point by (tx, ty)", () => {
    const m = composeMatrix({ tx: 10, ty: 20 });
    const p = applyToPoint(m, { x: 5, y: 5 });
    expect(approx(p.x, 15)).toBe(true);
    expect(approx(p.y, 25)).toBe(true);
  });

  it("scale doubles point coordinates", () => {
    const m = composeMatrix({ scaleX: 2, scaleY: 3 });
    const p = applyToPoint(m, { x: 4, y: 5 });
    expect(approx(p.x, 8)).toBe(true);
    expect(approx(p.y, 15)).toBe(true);
  });

  it("rotation 90° maps (1,0) to approximately (0,1)", () => {
    const m = composeMatrix({ rotation: 90 });
    const p = applyToPoint(m, { x: 1, y: 0 });
    expect(approx(p.x, 0)).toBe(true);
    expect(approx(p.y, 1)).toBe(true);
  });
});
