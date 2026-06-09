/**
 * Unit tests for symbol instance transform matrix utilities:
 *   makeIdentityMatrix, createInstanceMatrix, decomposeMatrix, multiplyMatrix.
 *
 * Flash 8 affine transform matrix (column-major):
 *   [ a  c  tx ]
 *   [ b  d  ty ]
 *   [ 0  0   1 ]
 */

import { describe, it, expect } from "vitest";
import {
  makeIdentityMatrix,
  createInstanceMatrix,
  decomposeMatrix,
  multiplyMatrix,
} from "../matrix.js";

const EPSILON = 1e-6;

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

describe("makeIdentityMatrix", () => {
  it("returns a=1, b=0, c=0, d=1, tx=0, ty=0", () => {
    const m = makeIdentityMatrix();
    expect(approx(m.a, 1)).toBe(true);
    expect(approx(m.b, 0)).toBe(true);
    expect(approx(m.c, 0)).toBe(true);
    expect(approx(m.d, 1)).toBe(true);
    expect(approx(m.tx, 0)).toBe(true);
    expect(approx(m.ty, 0)).toBe(true);
  });
});

describe("createInstanceMatrix", () => {
  it("no rotation → a=scaleX, d=scaleY, b=0, c=0", () => {
    const m = createInstanceMatrix(0, 0, 2, 3, 0);
    expect(approx(m.a, 2)).toBe(true);
    expect(approx(m.d, 3)).toBe(true);
    expect(approx(m.b, 0)).toBe(true);
    expect(approx(m.c, 0)).toBe(true);
  });

  it("90° rotation with scaleX=2, scaleY=3: a≈0, b≈2, c≈-3, d≈0", () => {
    const m = createInstanceMatrix(0, 0, 2, 3, 90);
    expect(approx(m.a, 0)).toBe(true);
    expect(approx(m.b, 2)).toBe(true);
    expect(approx(m.c, -3)).toBe(true);
    expect(approx(m.d, 0)).toBe(true);
  });

  it("position x=100, y=200 → tx=100, ty=200", () => {
    const m = createInstanceMatrix(100, 200, 1, 1, 0);
    expect(approx(m.tx, 100)).toBe(true);
    expect(approx(m.ty, 200)).toBe(true);
  });
});

describe("decomposeMatrix", () => {
  it("round-trips x, y positions", () => {
    const m = createInstanceMatrix(50, 75, 1, 1, 0);
    const d = decomposeMatrix(m);
    expect(approx(d.x, 50)).toBe(true);
    expect(approx(d.y, 75)).toBe(true);
  });

  it("round-trips scaleX, scaleY", () => {
    const m = createInstanceMatrix(0, 0, 2.5, 4, 0);
    const d = decomposeMatrix(m);
    expect(approx(d.scaleX, 2.5)).toBe(true);
    expect(approx(d.scaleY, 4)).toBe(true);
  });

  it("round-trips rotation (within floating point precision)", () => {
    const m = createInstanceMatrix(0, 0, 1, 1, 45);
    const d = decomposeMatrix(m);
    expect(approx(d.rotation, 45)).toBe(true);
  });
});

describe("multiplyMatrix", () => {
  it("identity × M = M", () => {
    const id = makeIdentityMatrix();
    const m = createInstanceMatrix(10, 20, 2, 3, 30);
    const result = multiplyMatrix(id, m);
    expect(approx(result.a, m.a)).toBe(true);
    expect(approx(result.b, m.b)).toBe(true);
    expect(approx(result.c, m.c)).toBe(true);
    expect(approx(result.d, m.d)).toBe(true);
    expect(approx(result.tx, m.tx)).toBe(true);
    expect(approx(result.ty, m.ty)).toBe(true);
  });

  it("M × identity = M", () => {
    const id = makeIdentityMatrix();
    const m = createInstanceMatrix(10, 20, 2, 3, 30);
    const result = multiplyMatrix(m, id);
    expect(approx(result.a, m.a)).toBe(true);
    expect(approx(result.b, m.b)).toBe(true);
    expect(approx(result.c, m.c)).toBe(true);
    expect(approx(result.d, m.d)).toBe(true);
    expect(approx(result.tx, m.tx)).toBe(true);
    expect(approx(result.ty, m.ty)).toBe(true);
  });

  it("translation composition: T(5,10) × T(3,7) = T(8,17)", () => {
    const t1 = createInstanceMatrix(5, 10, 1, 1, 0);
    const t2 = createInstanceMatrix(3, 7, 1, 1, 0);
    const result = multiplyMatrix(t1, t2);
    expect(approx(result.tx, 8)).toBe(true);
    expect(approx(result.ty, 17)).toBe(true);
    expect(approx(result.a, 1)).toBe(true);
    expect(approx(result.d, 1)).toBe(true);
  });
});
