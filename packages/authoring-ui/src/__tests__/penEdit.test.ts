/**
 * Task 1422 — Pen sub-tool anchor editing (Add / Delete / Convert Anchor).
 *
 * The Pen sub-tool selector + key bindings landed in task 1388; these are the
 * editing operations that were deferred. Verifies the pure geometry helpers add
 * an anchor on a segment, delete an anchor and rejoin neighbors, and toggle an
 * anchor between corner and smooth.
 */

import { describe, it, expect } from "vitest";
import type { Shape, ShapePath } from "@flash/core";

import { addAnchorAt, deleteAnchorAt, convertAnchorAt } from "../tools/penEdit.js";

/** A square path: anchors at the four corners (start + 3 segment ends + close). */
function square(): Shape {
  const path: ShapePath = {
    start: { x: 0, y: 0 },
    segments: [
      { type: "line", to: { x: 100, y: 0 } },
      { type: "line", to: { x: 100, y: 100 } },
      { type: "line", to: { x: 0, y: 100 } },
    ],
    closed: true,
  };
  return { id: "sq", paths: [path] };
}

function anchorCount(shape: Shape): number {
  const p = shape.paths[0];
  return 1 + p.segments.length;
}

describe("addAnchorAt", () => {
  it("inserts an anchor on the segment nearest the click", () => {
    const shape = square();
    const before = anchorCount(shape);
    // Midpoint of the top edge (0,0)->(100,0).
    const next = addAnchorAt(shape, { x: 50, y: 0 }, 6);
    expect(next).not.toBeNull();
    expect(anchorCount(next!)).toBe(before + 1);
  });

  it("splits a line into two lines preserving geometry", () => {
    const shape = square();
    const next = addAnchorAt(shape, { x: 50, y: 0 }, 6)!;
    const seg0 = next.paths[0].segments[0];
    const seg1 = next.paths[0].segments[1];
    expect(seg0.type).toBe("line");
    expect(seg0.to).toEqual({ x: 50, y: 0 });
    expect(seg1.to).toEqual({ x: 100, y: 0 });
  });

  it("returns null when the click is far from every segment", () => {
    expect(addAnchorAt(square(), { x: 50, y: 50 }, 6)).toBeNull();
  });
});

describe("deleteAnchorAt", () => {
  it("removes the anchor nearest the click and rejoins neighbors", () => {
    const shape = square();
    const before = anchorCount(shape);
    // Corner (100,0).
    const next = deleteAnchorAt(shape, { x: 100, y: 0 }, 6);
    expect(next).not.toBeNull();
    expect(anchorCount(next!)).toBe(before - 1);
  });

  it("returns null when no anchor is near the click", () => {
    expect(deleteAnchorAt(square(), { x: 50, y: 50 }, 6)).toBeNull();
  });
});

describe("convertAnchorAt", () => {
  it("converts a corner anchor to smooth (adjacent segments become curves)", () => {
    const shape = square();
    // Corner (100,0): segment entering (index 1) and leaving (index 2).
    const next = convertAnchorAt(shape, { x: 100, y: 0 }, 6);
    expect(next).not.toBeNull();
    const segs = next!.paths[0].segments;
    expect(segs[0].type).toBe("curve"); // entering the corner
    expect(segs[1].type).toBe("curve"); // leaving the corner
  });

  it("converts a smooth anchor back to a corner (segments become lines)", () => {
    const smoothed = convertAnchorAt(square(), { x: 100, y: 0 }, 6)!;
    const cornered = convertAnchorAt(smoothed, { x: 100, y: 0 }, 6)!;
    const segs = cornered.paths[0].segments;
    expect(segs[0].type).toBe("line");
    expect(segs[1].type).toBe("line");
  });

  it("returns null when no anchor is near the click", () => {
    expect(convertAnchorAt(square(), { x: 50, y: 50 }, 6)).toBeNull();
  });
});
