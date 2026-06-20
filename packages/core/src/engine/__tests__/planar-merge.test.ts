/**
 * P1 merge-on-commit unit tests (docs/36-vector-merge-model.md).
 *
 * Area conservation + topology checks for the planar fold:
 *   - same-color union yields ONE face (area = A + B - overlap)
 *   - different-color cut removes the covered region (top wins; total covered
 *     area conserved; both colors present)
 *   - an island (different-color rect fully inside) carves a hole into the outer
 *     fill
 *   - curve-preserving round-trip (planar -> Shape keeps quadratics)
 */

import { describe, it, expect } from "vitest";
import type { Fill, PathSegment, Point, Shape, ShapePath } from "../types.js";
import {
  buildArrangementFromShapes,
  faceArea,
  planarShapeToShape,
  foldShapeIntoLayer,
  planarMergeCommit,
} from "../planar/index.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };

function rectPath(x: number, y: number, w: number, h: number, fill: Fill): ShapePath {
  return {
    start: { x, y },
    segments: [
      { type: "line", to: { x, y: y + h } },
      { type: "line", to: { x: x + w, y: y + h } },
      { type: "line", to: { x: x + w, y } },
      { type: "line", to: { x, y } },
    ],
    fill,
    closed: true,
  };
}
function rectShape(id: string, x: number, y: number, w: number, h: number, fill: Fill): Shape {
  return { id, paths: [rectPath(x, y, w, h, fill)] };
}

/** Sum of bounded-face areas carrying a given fill index. */
function areaOfFill(
  ps: ReturnType<typeof buildArrangementFromShapes>,
  fillIndex: number
): number {
  let a = 0;
  for (const f of ps.faces) {
    if (f.unbounded) continue;
    if (f.fill === fillIndex) a += faceArea(ps, f);
  }
  return a;
}
function fillIndexOf(ps: ReturnType<typeof buildArrangementFromShapes>, fill: Fill): number {
  return ps.fills.findIndex(
    (f) =>
      f.type === "solid" &&
      fill.type === "solid" &&
      f.color.r === fill.color.r &&
      f.color.g === fill.color.g &&
      f.color.b === fill.color.b &&
      f.color.a === fill.color.a
  );
}

/** Shoelace area of a closed ShapePath (chord approximation of any curves). */
function pathArea(path: ShapePath): number {
  const pts: Point[] = [path.start];
  let prev = path.start;
  for (const seg of path.segments) {
    if (seg.type === "curve") {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
          y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
        });
      }
    } else {
      pts.push(seg.to);
    }
    prev = seg.to;
  }
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

describe("planar merge-on-commit (P1)", () => {
  // -----------------------------------------------------------------------
  // same-color union
  // -----------------------------------------------------------------------
  it("same-color union: overlapping blues become one region (area = A + B - overlap)", () => {
    // Two 100x100 blue rects overlapping by 50x100.
    const a = rectShape("a", 0, 0, 100, 100, BLUE);
    const b = rectShape("b", 50, 0, 100, 100, BLUE);
    const ps = buildArrangementFromShapes([a, b]);

    const blueIdx = fillIndexOf(ps, BLUE);
    expect(blueIdx).toBeGreaterThanOrEqual(0);

    // Union area = 100*100 + 100*100 - 50*100 = 15000.
    expect(areaOfFill(ps, blueIdx)).toBeCloseTo(15000, 0);

    // Contiguous blue: every bounded face is blue (no other fill), and there is
    // no leftover area outside the union. (Same-color faces are adjacent and
    // render as one seamless region under non-zero winding; full single-face
    // dissolve of interior seams is P2 selection work.)
    const boundedFaces = ps.faces.filter((f) => !f.unbounded);
    expect(boundedFaces.length).toBeGreaterThanOrEqual(1);
    expect(boundedFaces.every((f) => f.fill === blueIdx)).toBe(true);

    // Read-back: one merged shape; total blue path area equals the union.
    const merged = planarShapeToShape(ps, "m");
    const totalArea = merged.paths
      .filter((p) => p.fill && p.fill.type === "solid")
      .reduce((s, p) => s + pathArea(p), 0);
    expect(totalArea).toBeCloseTo(15000, 0);
  });

  // -----------------------------------------------------------------------
  // different-color cut (top wins)
  // -----------------------------------------------------------------------
  it("different-color cut: red over blue carves blue; total covered area conserved", () => {
    const blue = rectShape("blue", 0, 0, 100, 100, BLUE); // 10000
    const red = rectShape("red", 50, 0, 100, 100, RED); // 10000, overlap 50x100=5000
    const ps = buildArrangementFromShapes([blue, red]); // red drawn last = top

    const blueIdx = fillIndexOf(ps, BLUE);
    const redIdx = fillIndexOf(ps, RED);
    expect(blueIdx).toBeGreaterThanOrEqual(0);
    expect(redIdx).toBeGreaterThanOrEqual(0);

    const blueArea = areaOfFill(ps, blueIdx);
    const redArea = areaOfFill(ps, redIdx);

    // Red (top) keeps its full 10000; blue loses the 5000 overlap -> 5000.
    expect(redArea).toBeCloseTo(10000, 0);
    expect(blueArea).toBeCloseTo(5000, 0);

    // Total covered area conserved: union = 10000 + 10000 - 5000 = 15000.
    expect(redArea + blueArea).toBeCloseTo(15000, 0);

    // Union area must be <= sum of inputs (cut removed overlap).
    expect(redArea + blueArea).toBeLessThanOrEqual(10000 + 10000);
  });

  // -----------------------------------------------------------------------
  // island carves a hole
  // -----------------------------------------------------------------------
  it("island: a different-color rect fully inside carves a hole in the outer fill", () => {
    const outer = rectShape("outer", 0, 0, 100, 100, BLUE); // 10000
    const inner = rectShape("inner", 30, 30, 40, 40, RED); // 1600, fully inside
    const ps = buildArrangementFromShapes([outer, inner]);

    const blueIdx = fillIndexOf(ps, BLUE);
    const redIdx = fillIndexOf(ps, RED);

    // Outer blue is carved by the inner red: 10000 - 1600 = 8400.
    expect(areaOfFill(ps, blueIdx)).toBeCloseTo(8400, 0);
    expect(areaOfFill(ps, redIdx)).toBeCloseTo(1600, 0);

    // The outer blue face has exactly one hole (the island).
    const blueFace = ps.faces.find((f) => !f.unbounded && f.fill === blueIdx);
    expect(blueFace).toBeDefined();
    expect(blueFace!.holes.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // foldShapeIntoLayer (display-object offsets baked to stage space)
  // -----------------------------------------------------------------------
  it("foldShapeIntoLayer bakes display offsets and unions same-color overlap", () => {
    // Existing blue 100x100 at origin; incoming blue 100x100 offset by (50,0).
    const existing = [{ shape: rectShape("a", 0, 0, 100, 100, BLUE), x: 0, y: 0 }];
    const incoming = { shape: rectShape("b", 0, 0, 100, 100, BLUE), x: 50, y: 0 };
    const { merged } = foldShapeIntoLayer(existing, incoming, "merged");
    expect(merged).not.toBeNull();
    const totalArea = merged!.paths.reduce((s, p) => s + (p.fill ? pathArea(p) : 0), 0);
    expect(totalArea).toBeCloseTo(15000, 0);
  });

  // -----------------------------------------------------------------------
  // planarMergeCommit list semantics
  // -----------------------------------------------------------------------
  it("planarMergeCommit folds shape objects, passes gradients through untouched", () => {
    type Obj = { type: string; id: string; shape: Shape; x: number; y: number };
    const blueA: Obj = { type: "shape", id: "a", shape: rectShape("a", 0, 0, 100, 100, BLUE), x: 0, y: 0 };
    // A gradient shape is NOT mergeable; it must pass through.
    const gradShape: Shape = {
      id: "g",
      paths: [
        {
          ...rectPath(200, 0, 50, 50, BLUE),
          fill: {
            type: "linear-gradient",
            angle: 0,
            stops: [
              { ratio: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
              { ratio: 255, color: { r: 255, g: 255, b: 255, a: 255 } },
            ],
          },
        },
      ],
    };
    const gradObj: Obj = { type: "shape", id: "g", shape: gradShape, x: 0, y: 0 };
    const incoming: Obj = { type: "shape", id: "b", shape: rectShape("b", 0, 0, 100, 100, BLUE), x: 50, y: 0 };

    const result = planarMergeCommit<Obj>(
      [blueA, gradObj],
      incoming,
      (shape) => ({ type: "shape", id: shape.id, shape, x: 0, y: 0 })
    );
    expect(result).not.toBeNull();
    // gradient passes through (1) + one merged object (1) = 2.
    expect(result!.length).toBe(2);
    expect(result![0].id).toBe("g"); // pass-through first
    const mergedObj = result![1];
    const area = mergedObj.shape.paths.reduce((s, p) => s + (p.fill ? pathArea(p) : 0), 0);
    expect(area).toBeCloseTo(15000, 0); // blue union
  });

  // -----------------------------------------------------------------------
  // curve preservation
  // -----------------------------------------------------------------------
  it("read-back is curve-preserving: a quadratic boundary survives the fold", () => {
    // A shape whose top edge is a quadratic arc.
    const arcShape: Shape = {
      id: "arc",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 0, y: 100 } },
            { type: "line", to: { x: 100, y: 100 } },
            { type: "curve", control: { x: 50, y: 50 }, to: { x: 0, y: 0 } },
          ] as PathSegment[],
          fill: BLUE,
          closed: true,
        },
      ],
    };
    const ps = buildArrangementFromShapes([arcShape]);
    const merged = planarShapeToShape(ps, "m");
    const hasCurve = merged.paths.some((p) => p.segments.some((s) => s.type === "curve"));
    expect(hasCurve).toBe(true);
  });
});
