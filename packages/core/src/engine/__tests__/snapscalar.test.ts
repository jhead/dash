/**
 * Unit tests for scalar snap utilities in snap.ts.
 */

import { describe, it, expect } from "vitest";
import {
  snapScalarToGrid,
  snapScalarToPixel,
  snapScalarToGuide,
  snapScalarX,
  snapScalarY,
} from "../snap.js";
import type { Guide } from "../../model/types.js";

// ---------------------------------------------------------------------------
// snapScalarToGrid
// ---------------------------------------------------------------------------

describe("snapScalarToGrid", () => {
  it("snapToGrid(15, 18) → 18 (rounds up)", () => {
    expect(snapScalarToGrid(15, 18)).toBe(18);
  });

  it("snapToGrid(9, 18) → 18 (round up at midpoint — JS rounds 0.5 up)", () => {
    expect(snapScalarToGrid(9, 18)).toBe(18);
  });

  it("snapToGrid(8, 18) → 0 (below midpoint rounds down)", () => {
    expect(snapScalarToGrid(8, 18)).toBe(0);
  });

  it("snapToGrid(0, 18) → 0 (zero stays zero)", () => {
    expect(snapScalarToGrid(0, 18)).toBe(0);
  });

  it("snapToGrid(x, 0) → x (zero grid size returns value unchanged)", () => {
    expect(snapScalarToGrid(7.5, 0)).toBe(7.5);
    expect(snapScalarToGrid(100, 0)).toBe(100);
  });

  it("snapToGrid(negative gridSize) → x unchanged", () => {
    expect(snapScalarToGrid(15, -5)).toBe(15);
  });

  it("snaps to multiples larger than 1 correctly", () => {
    expect(snapScalarToGrid(27, 10)).toBe(30);
    expect(snapScalarToGrid(23, 10)).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// snapScalarToPixel
// ---------------------------------------------------------------------------

describe("snapScalarToPixel", () => {
  it("snapToPixel(1.7) → 2 (rounds up)", () => {
    expect(snapScalarToPixel(1.7)).toBe(2);
  });

  it("snapToPixel(1.3) → 1 (rounds down)", () => {
    expect(snapScalarToPixel(1.3)).toBe(1);
  });

  it("snapToPixel(1.5) → 2 (rounds half-up)", () => {
    expect(snapScalarToPixel(1.5)).toBe(2);
  });

  it("integer values remain unchanged", () => {
    expect(snapScalarToPixel(5)).toBe(5);
    expect(snapScalarToPixel(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// snapScalarToGuide
// ---------------------------------------------------------------------------

describe("snapScalarToGuide", () => {
  it("snaps to vertical guide when within threshold", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "vertical", position: 50 }];
    expect(snapScalarToGuide(48, guides, "vertical", 5)).toBe(50);
  });

  it("does not snap when outside threshold", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "vertical", position: 50 }];
    expect(snapScalarToGuide(48, guides, "vertical", 1)).toBe(48);
  });

  it("horizontal guide does not affect vertical-axis snapping", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "horizontal", position: 50 }];
    // Querying "vertical" orientation — horizontal guide should not snap
    expect(snapScalarToGuide(48, guides, "vertical", 5)).toBe(48);
  });

  it("snaps to horizontal guide for y-axis query", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "horizontal", position: 100 }];
    expect(snapScalarToGuide(97, guides, "horizontal", 5)).toBe(100);
  });

  it("picks the closest guide when multiple are within threshold", () => {
    const guides: Guide[] = [
      { id: "g1", orientation: "vertical", position: 40 },
      { id: "g2", orientation: "vertical", position: 48 },
    ];
    // value=47: dist to 40 = 7 (out), dist to 48 = 1 (in) → snap to 48
    expect(snapScalarToGuide(47, guides, "vertical", 5)).toBe(48);
  });

  it("returns value unchanged when no guides provided", () => {
    expect(snapScalarToGuide(55, [], "vertical", 5)).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// snapScalarX / snapScalarY
// ---------------------------------------------------------------------------

describe("snapScalarX with grid + pixel enabled", () => {
  it("snaps x to grid then to pixel", () => {
    // Grid 10: 14.7 → rounds to 10; pixel snap: 10 (already integer)
    const result = snapScalarX(14.7, {
      snapToGrid: true,
      snapToPixels: true,
      snapToGuides: false,
      grid: { gridWidth: 10, gridHeight: 10 },
      guides: [],
    });
    expect(result).toBe(10);
  });

  it("snaps x to grid correctly", () => {
    const result = snapScalarX(15, {
      snapToGrid: true,
      snapToPixels: false,
      snapToGuides: false,
      grid: { gridWidth: 18, gridHeight: 18 },
      guides: [],
    });
    expect(result).toBe(18);
  });

  it("snaps x to guide after grid snap", () => {
    const guides: Guide[] = [{ id: "g1", orientation: "vertical", position: 20 }];
    // grid snap of 18 → 18; guide at 20 within default threshold 5 → snap to 20
    const result = snapScalarX(18, {
      snapToGrid: true,
      snapToPixels: false,
      snapToGuides: true,
      grid: { gridWidth: 18, gridHeight: 18 },
      guides,
      snapThreshold: 5,
    });
    expect(result).toBe(20);
  });
});

describe("snapScalarY with grid + pixel enabled", () => {
  it("snaps y to grid", () => {
    const result = snapScalarY(15, {
      snapToGrid: true,
      snapToPixels: false,
      snapToGuides: false,
      grid: { gridWidth: 18, gridHeight: 18 },
      guides: [],
    });
    expect(result).toBe(18);
  });

  it("uses gridHeight for Y axis", () => {
    // gridHeight = 20; y = 11 → snaps to 20
    const result = snapScalarY(11, {
      snapToGrid: true,
      snapToPixels: false,
      snapToGuides: false,
      grid: { gridWidth: 10, gridHeight: 20 },
      guides: [],
    });
    expect(result).toBe(20);
  });
});
