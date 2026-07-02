/**
 * Tests for shape-hint-based vertex correspondence in interpolateShapeTween.
 *
 * Shape hints guide morphing by reordering vertices so that hint-matched
 * vertices align between the start and end shape, producing better
 * interpolation than naive index-based matching.
 */

import { describe, it, expect } from "vitest";
import { interpolateShapeTween } from "../interpolate.js";
import type { ShapeDisplayObject } from "../../engine/types.js";
import type { ShapeHint } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a closed square ShapeDisplayObject.
 *
 * Vertices (in order): topLeft, topRight, bottomRight, bottomLeft.
 * The `startIdx` parameter rotates the vertex order so we can test reordering.
 */
function makeSquare(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startIdx = 0 // rotate starting vertex: 0=TL, 1=TR, 2=BR, 3=BL
): ShapeDisplayObject {
  const corners = [
    { x: x1, y: y1 }, // 0: TL
    { x: x2, y: y1 }, // 1: TR
    { x: x2, y: y2 }, // 2: BR
    { x: x1, y: y2 }, // 3: BL
  ];
  const rotated = [...corners.slice(startIdx), ...corners.slice(0, startIdx)];
  const [start, ...rest] = rotated;
  return {
    type: "shape",
    id,
    shape: {
      id: `sh-${id}`,
      paths: [
        {
          start: start!,
          segments: [
            ...rest.map((pt) => ({ type: "line" as const, to: pt })),
            // Close back to start
            { type: "line" as const, to: start! },
          ],
          closed: true,
        },
      ],
    },
    x: 0,
    y: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests — no hints: baseline behaviour is unchanged
// ---------------------------------------------------------------------------

describe("interpolateShapeTween — no hints (baseline)", () => {
  it("at t=0 returns start shape start vertex", () => {
    const start = [makeSquare("s", 0, 0, 100, 100)];
    const end = [makeSquare("e", 200, 200, 300, 300)];
    const result = interpolateShapeTween(start, end, 0, 0, "distributive");
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(0);
    expect(path.start.y).toBeCloseTo(0);
  });

  it("at t=1 returns end shape start vertex", () => {
    const start = [makeSquare("s", 0, 0, 100, 100)];
    const end = [makeSquare("e", 200, 200, 300, 300)];
    const result = interpolateShapeTween(start, end, 1, 0, "distributive");
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(200);
    expect(path.start.y).toBeCloseTo(200);
  });

  it("at t=0.5 start vertex is midpoint", () => {
    const start = [makeSquare("s", 0, 0, 100, 100)];
    const end = [makeSquare("e", 200, 200, 300, 300)];
    const result = interpolateShapeTween(start, end, 0.5, 0, "distributive");
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    // Without hints, startIdx=0 for both: TL(0,0) → TL(200,200), midpoint=(100,100)
    expect(path.start.x).toBeCloseTo(100);
    expect(path.start.y).toBeCloseTo(100);
  });
});

// ---------------------------------------------------------------------------
// Tests — hints change vertex correspondence
// ---------------------------------------------------------------------------

describe("interpolateShapeTween — with shape hints", () => {
  /**
   * Two squares:
   *  - Start square: TL(0,0) TR(100,0) BR(100,100) BL(0,100). vertex[0] = TL.
   *  - End square  : TL(200,200) TR(300,200) BR(300,300) BL(200,300).
   *    But rotated so vertex[0] = BR(300,300) (startIdx=2).
   *
   * Without hints: vertex[0]Start (TL=0,0) ↔ vertex[0]End (BR=300,300)
   *   → midpoint start = (150, 150)
   *
   * With hints anchoring TL↔TL:
   *   startHint 'a' at (0,0)  → closest vertex in start = vertex[0] (TL, no rotation needed)
   *   endHint   'a' at (200,200) → closest vertex in end = vertex[2] (TL=200,200 after rotation)
   *   After reordering end: vertex[0] becomes TL(200,200)
   *   → midpoint start = lerp(TL(0,0), TL(200,200)) = (100, 100)
   */
  it("hints reorder end vertices so TL↔TL correspondence is used at t=0.5", () => {
    const startObjs = [makeSquare("s", 0, 0, 100, 100, 0)];  // starts at TL
    const endObjs = [makeSquare("e", 200, 200, 300, 300, 2)]; // starts at BR

    // Without hints: start[0]=TL(0,0) ↔ end[0]=BR(300,300)
    const noHints = interpolateShapeTween(startObjs, endObjs, 0.5, 0, "distributive");
    const noHintsPath = (noHints[0] as ShapeDisplayObject).shape.paths[0]!;
    // midpoint TL(0,0) ↔ BR(300,300) = (150, 150)
    expect(noHintsPath.start.x).toBeCloseTo(150);
    expect(noHintsPath.start.y).toBeCloseTo(150);

    // With hints: anchor 'a' at TL(0,0) in start and TL(200,200) in end
    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    const withHints = interpolateShapeTween(
      startObjs, endObjs, 0.5, 0, "distributive",
      null, startHints, endHints
    );
    const withHintsPath = (withHints[0] as ShapeDisplayObject).shape.paths[0]!;

    // With TL↔TL correspondence: midpoint = lerp((0,0),(200,200)) = (100,100)
    // This is different from the no-hints result (150,150)
    expect(withHintsPath.start.x).toBeCloseTo(100);
    expect(withHintsPath.start.y).toBeCloseTo(100);

    // The with-hints result should differ from the no-hints result
    expect(withHintsPath.start.x).not.toBeCloseTo(noHintsPath.start.x);
    expect(withHintsPath.start.y).not.toBeCloseTo(noHintsPath.start.y);
  });

  it("at t=0 the start shape is unchanged regardless of hints", () => {
    const startObjs = [makeSquare("s", 0, 0, 100, 100, 0)];
    const endObjs = [makeSquare("e", 200, 200, 300, 300, 2)];
    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    const result = interpolateShapeTween(
      startObjs, endObjs, 0, 0, "distributive",
      null, startHints, endHints
    );
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(path.start.x).toBeCloseTo(0);
    expect(path.start.y).toBeCloseTo(0);
  });

  it("at t=1 the end shape vertex is the hint-matched end vertex", () => {
    const startObjs = [makeSquare("s", 0, 0, 100, 100, 0)];
    const endObjs = [makeSquare("e", 200, 200, 300, 300, 2)]; // BR-first
    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];   // TL in start
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }]; // TL in end

    const result = interpolateShapeTween(
      startObjs, endObjs, 1, 0, "distributive",
      null, startHints, endHints
    );
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;
    // At t=1 with TL↔TL: result should be TL of end = (200, 200)
    expect(path.start.x).toBeCloseTo(200);
    expect(path.start.y).toBeCloseTo(200);
  });

  it("unmatched hint ids are ignored (no error)", () => {
    const startObjs = [makeSquare("s", 0, 0, 100, 100, 0)];
    const endObjs = [makeSquare("e", 200, 200, 300, 300, 0)];
    // 'a' in start but 'b' in end — no match → falls back to normal interpolation
    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "b", x: 200, y: 200 }];

    expect(() =>
      interpolateShapeTween(
        startObjs, endObjs, 0.5, 0, "distributive",
        null, startHints, endHints
      )
    ).not.toThrow();
  });

  it("empty hint arrays fall back to normal interpolation", () => {
    const startObjs = [makeSquare("s", 0, 0, 100, 100, 0)];
    const endObjs = [makeSquare("e", 200, 200, 300, 300, 0)];

    const noHints = interpolateShapeTween(startObjs, endObjs, 0.5, 0, "distributive");
    const emptyHints = interpolateShapeTween(
      startObjs, endObjs, 0.5, 0, "distributive", null, [], []
    );

    const noHintsPath = (noHints[0] as ShapeDisplayObject).shape.paths[0]!;
    const emptyPath = (emptyHints[0] as ShapeDisplayObject).shape.paths[0]!;
    expect(emptyPath.start.x).toBeCloseTo(noHintsPath.start.x);
    expect(emptyPath.start.y).toBeCloseTo(noHintsPath.start.y);
  });
});

// ---------------------------------------------------------------------------
// Tests — hints must NOT flatten curves into polylines (task 1397)
// ---------------------------------------------------------------------------

/**
 * Build a closed quad whose four edges are all quadratic curves.
 *
 * Vertices (in order): TL, TR, BR, BL. `startIdx` rotates the starting vertex so
 * a shape hint can be forced to reorder the path (pivot != 0).
 */
function makeCurvedQuad(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  startIdx = 0
): ShapeDisplayObject {
  const corners = [
    { x: x1, y: y1 }, // 0: TL
    { x: x2, y: y1 }, // 1: TR
    { x: x2, y: y2 }, // 2: BR
    { x: x1, y: y2 }, // 3: BL
  ];
  const rotated = [...corners.slice(startIdx), ...corners.slice(0, startIdx)];
  // One curve segment per edge, closing back to the first vertex.
  const cyclic = [...rotated, rotated[0]!];
  const segments = cyclic.slice(1).map((to, i) => {
    const from = cyclic[i]!;
    return {
      type: "curve" as const,
      // Control bulges the edge outward so it is a genuine (non-degenerate) curve.
      control: { x: (from.x + to.x) / 2 + 15, y: (from.y + to.y) / 2 - 15 },
      to,
    };
  });
  return {
    type: "shape",
    id,
    shape: {
      id: `sh-${id}`,
      paths: [{ start: rotated[0]!, segments, closed: true }],
    },
    x: 0,
    y: 0,
  };
}

describe("interpolateShapeTween — shape hints preserve curves (task 1397)", () => {
  it("a hinted curved morph keeps curve segments instead of faceting to lines", () => {
    // End quad is rotated (BR-first) so the TL↔TL hint forces a vertex reorder.
    const startObjs = [makeCurvedQuad("s", 0, 0, 100, 100, 0)];
    const endObjs = [makeCurvedQuad("e", 200, 200, 300, 300, 2)];

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];

    const result = interpolateShapeTween(
      startObjs, endObjs, 0.5, 0, "distributive",
      null, startHints, endHints
    );
    const path = (result[0] as ShapeDisplayObject).shape.paths[0]!;

    // Every edge must remain a quadratic curve — the reorder must not drop
    // control points and flatten the morph into a polyline.
    expect(path.segments.length).toBe(4);
    expect(path.segments.every((s) => s.type === "curve")).toBe(true);
  });

  it("reordering by hint preserves the same curve count as the unhinted morph", () => {
    const startObjs = [makeCurvedQuad("s", 0, 0, 100, 100, 0)];
    const endObjs = [makeCurvedQuad("e", 200, 200, 300, 300, 2)];

    const noHints = interpolateShapeTween(startObjs, endObjs, 0.5, 0, "distributive");
    const noHintsPath = (noHints[0] as ShapeDisplayObject).shape.paths[0]!;

    const startHints: ShapeHint[] = [{ id: "a", x: 0, y: 0 }];
    const endHints: ShapeHint[] = [{ id: "a", x: 200, y: 200 }];
    const withHints = interpolateShapeTween(
      startObjs, endObjs, 0.5, 0, "distributive",
      null, startHints, endHints
    );
    const withHintsPath = (withHints[0] as ShapeDisplayObject).shape.paths[0]!;

    const curveCount = (segs: typeof noHintsPath.segments) =>
      segs.filter((s) => s.type === "curve").length;
    expect(curveCount(withHintsPath.segments)).toBe(curveCount(noHintsPath.segments));
    expect(curveCount(withHintsPath.segments)).toBe(4);
  });
});
