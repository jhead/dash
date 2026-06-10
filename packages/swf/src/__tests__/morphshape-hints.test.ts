/**
 * Tests for shape-hint vertex reordering in encodeDefineMorphShape2.
 *
 * When shape hints are provided, vertices of the morph shape's start and end
 * paths should be reordered so that hint-anchored vertices align at the same
 * array index — ensuring smooth morphing in Ruffle.
 */

import { describe, it, expect } from "vitest";
import { encodeDefineMorphShape2 } from "../morphshape.js";
import type { ShapePath } from "@flash/core";
import type { ShapeHint } from "@flash/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make a closed square ShapePath with vertices starting at the given cornerIdx.
 *
 * Corner order: 0=TL, 1=TR, 2=BR, 3=BL.
 * `cornerIdx` rotates the vertex order.
 */
function makeSquarePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerIdx = 0
): ShapePath {
  const corners = [
    { x: x1, y: y1 }, // TL
    { x: x2, y: y1 }, // TR
    { x: x2, y: y2 }, // BR
    { x: x1, y: y2 }, // BL
  ];
  const rotated = [...corners.slice(cornerIdx), ...corners.slice(0, cornerIdx)];
  const [start, ...rest] = rotated;
  return {
    start: start!,
    segments: [
      ...rest.map((pt) => ({ type: "line" as const, to: pt })),
      { type: "line" as const, to: start! }, // close
    ],
    closed: true,
    fill: {
      type: "solid" as const,
      color: { r: 255, g: 0, b: 0, a: 255 },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — encodeDefineMorphShape2 accepts hints without error
// ---------------------------------------------------------------------------

describe("encodeDefineMorphShape2 — shape hints", () => {
  it("encodes without error when hints are provided", () => {
    const startPath = makeSquarePath(0, 0, 100, 100, 0);
    const endPath = makeSquarePath(200, 200, 300, 300, 2);

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    expect(() =>
      encodeDefineMorphShape2(1, [startPath], [endPath], startHints, endHints)
    ).not.toThrow();
  });

  it("returns a Uint8Array when hints are provided", () => {
    const startPath = makeSquarePath(0, 0, 100, 100, 0);
    const endPath = makeSquarePath(200, 200, 300, 300, 2);

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    const result = encodeDefineMorphShape2(1, [startPath], [endPath], startHints, endHints);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("hint reordering produces DIFFERENT bytes than no hints (different vertex order)", () => {
    // Start square: starts at TL(0,0), end square starts at BR(300,300)
    // Without hints: TL↔BR pairing
    // With hint at TL(0,0) ↔ TL(200,200): pivots end to start at TL
    const startPath = makeSquarePath(0, 0, 100, 100, 0);
    const endPath = makeSquarePath(200, 200, 300, 300, 2); // BR-first

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    const withHints = encodeDefineMorphShape2(1, [startPath], [endPath], startHints, endHints);
    const noHints = encodeDefineMorphShape2(1, [startPath], [endPath]);

    // The encoded bytes should differ when hints change the vertex order
    let differs = false;
    const len = Math.min(withHints.length, noHints.length);
    for (let i = 0; i < len; i++) {
      if (withHints[i] !== noHints[i]) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it("same-order vertices with matching hints produces same bytes as no hints", () => {
    // Both start and end squares start at TL — no rotation needed
    // Hints at TL↔TL should produce same result as no hints
    const startPath = makeSquarePath(0, 0, 100, 100, 0);
    const endPath = makeSquarePath(200, 200, 300, 300, 0); // also TL-first

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    const withHints = encodeDefineMorphShape2(1, [startPath], [endPath], startHints, endHints);
    const noHints = encodeDefineMorphShape2(1, [startPath], [endPath]);

    // Should produce the same bytes since TL is already at index 0 in both
    expect(withHints).toEqual(noHints);
  });

  it("encodes without error when hints are null/undefined", () => {
    const startPath = makeSquarePath(0, 0, 100, 100);
    const endPath = makeSquarePath(200, 200, 300, 300);

    expect(() =>
      encodeDefineMorphShape2(1, [startPath], [endPath], null, null)
    ).not.toThrow();

    expect(() =>
      encodeDefineMorphShape2(1, [startPath], [endPath], undefined, undefined)
    ).not.toThrow();
  });

  it("encodes without error when hint ids don't match (no reordering applied)", () => {
    const startPath = makeSquarePath(0, 0, 100, 100, 0);
    const endPath = makeSquarePath(200, 200, 300, 300, 2);

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "b", x: 200, y: 200 }]; // no match

    expect(() =>
      encodeDefineMorphShape2(1, [startPath], [endPath], startHints, endHints)
    ).not.toThrow();
  });
});
