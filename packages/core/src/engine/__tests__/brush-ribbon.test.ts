/**
 * Oracle tests for the Flash 8 brush RIBBON geometry (task 1426).
 *
 * Flash 8's brush paints a solid FILL: the nib swept along the path, self-unioning
 * where the stroke overlaps itself. The old builder emitted the ribbon as ONE
 * closed outline (forward offsets + reversed backward offsets + caps); a stroke
 * that crossed itself wound that outline TWICE and the crossing region sampled
 * even-odd as OUTSIDE → a HOLE. Averaged-normal joints also thinned the ribbon by
 * cos(θ/2) and bowtied at hairpins.
 *
 * The fix ({@link buildBrushRibbon}) is a STAMP UNION — a disk per sample + a
 * capsule per segment, each carrying a distinct Fill object so the arrangement's
 * fill sampling resolves them as a last-covering-wins UNION. This file pins the
 * three defects: no hole at a self-crossing, no null-fill notch at a hairpin, and
 * full width at a sharp joint. A contrast case proves the naive single-outline
 * DOES hole (so the assertions actually detect the bug).
 */

import { describe, it, expect } from "vitest";
import type { Fill, Point, Shape, ShapePath, PathSegment } from "../types.js";
import { buildBrushRibbon, type BrushStampSample } from "../planar/brushpaint.js";
import { buildArrangementFromShapes } from "../planar/build.js";
import { locateFace } from "../planar/query.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };

/** True when the sampled arrangement has a non-null fill at `pt`. */
function filledAt(shape: Shape, pt: Point): boolean {
  const ps = buildArrangementFromShapes([shape]);
  const f = locateFace(ps, pt);
  return f !== null && f.fill !== null;
}

/** Samples with a constant half-width. */
function samples(pts: readonly Point[], half: number): BrushStampSample[] {
  return pts.map((p) => ({ x: p.x, y: p.y, half }));
}

/**
 * The OLD single-outline ribbon builder (averaged normals + one closed loop),
 * reconstructed here so the contrast test can prove it holes at a self-crossing.
 */
function naiveOutlineRibbon(pts: readonly Point[], half: number, fill: Fill): Shape {
  const forward: Point[] = [];
  const backward: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tlen;
    const ny = tx / tlen;
    forward.push({ x: pts[i].x + nx * half, y: pts[i].y + ny * half });
    backward.push({ x: pts[i].x - nx * half, y: pts[i].y - ny * half });
  }
  const segments: PathSegment[] = [];
  for (let i = 1; i < forward.length; i++) segments.push({ type: "line", to: forward[i] });
  for (let i = backward.length - 1; i >= 0; i--) segments.push({ type: "line", to: backward[i] });
  segments.push({ type: "line", to: forward[0] });
  const path: ShapePath = { start: forward[0], segments, closed: true, fill };
  return { id: "naive", paths: [path] };
}

describe("brush ribbon — self-crossing (task 1426)", () => {
  // A path that runs right along y=50, loops up and comes back DOWN through itself
  // at x≈60 — the crossing region is covered twice.
  const crossing: Point[] = [
    { x: 20, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 90 },
  ];

  it("contrast: the naive single-outline ribbon PUNCHES A HOLE at the crossing", () => {
    const ribbon = naiveOutlineRibbon(crossing, 8, RED);
    // The crossing point reads even-odd OUTSIDE → hole (this is the bug).
    expect(filledAt(ribbon, { x: 60, y: 50 })).toBe(false);
  });

  it("stamp-union ribbon has NO hole at the self-crossing", () => {
    const ribbon = buildBrushRibbon("s", samples(crossing, 8), RED);
    expect(filledAt(ribbon, { x: 60, y: 50 })).toBe(true);
  });

  it("stamp-union ribbon still fills a singly-covered point", () => {
    const ribbon = buildBrushRibbon("s", samples(crossing, 8), RED);
    expect(filledAt(ribbon, { x: 40, y: 50 })).toBe(true);
  });

  it("stamp-union ribbon leaves genuinely-outside points empty", () => {
    const ribbon = buildBrushRibbon("s", samples(crossing, 8), RED);
    // Well inside the loop's open middle (above the y=50 bar, left of the x=60 arm).
    expect(filledAt(ribbon, { x: 40, y: 25 })).toBe(false);
    expect(filledAt(ribbon, { x: 200, y: 200 })).toBe(false);
  });
});

describe("brush ribbon — hairpin (task 1426)", () => {
  // Go right, then reverse straight back almost on top of the outbound run.
  const hairpin: Point[] = [
    { x: 20, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 56 },
    { x: 20, y: 56 },
  ];

  it("no interior null-fill notch at the hairpin turn", () => {
    const ribbon = buildBrushRibbon("s", samples(hairpin, 10), RED);
    // The turn region around the far end (x≈100) must be solid, not a bowtie notch.
    expect(filledAt(ribbon, { x: 100, y: 53 })).toBe(true);
    expect(filledAt(ribbon, { x: 96, y: 53 })).toBe(true);
    // The overlap of the two nearly-collinear runs stays filled (would be even-odd
    // cancelled by a single doubly-wound outline).
    expect(filledAt(ribbon, { x: 60, y: 52 })).toBe(true);
  });
});

describe("brush ribbon — sharp joint keeps full width (task 1426)", () => {
  // A right-angle L. Averaged-normal offsetting narrows the inside of the corner
  // by cos(θ/2); the round-joint stamp union keeps the full nib radius.
  const elbow: Point[] = [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
  ];
  const half = 12;

  it("the corner is filled out to the full nib radius (no cos(θ/2) thinning)", () => {
    const ribbon = buildBrushRibbon("s", samples(elbow, half), RED);
    // The outer corner: a round nib centred at the elbow (80,20) reaches to
    // (80+half, 20-half)/√2 diagonally; a point just inside that radius must fill.
    const d = (half - 2) / Math.SQRT2;
    expect(filledAt(ribbon, { x: 80 + d, y: 20 - d })).toBe(true);
    // The elbow centre itself and the two arms are solid.
    expect(filledAt(ribbon, { x: 80, y: 20 })).toBe(true);
    expect(filledAt(ribbon, { x: 50, y: 20 })).toBe(true);
    expect(filledAt(ribbon, { x: 80, y: 50 })).toBe(true);
  });
});

describe("brush ribbon — square nib sweeps an AXIS-ALIGNED square (task 1433)", () => {
  // A 45° stroke. The OLD square nib merely flattened the end caps of the SAME
  // perpendicular-offset ribbon as the round nib → a ROTATED constant-width band.
  // The fix sweeps an axis-aligned square STAMP (Minkowski sum with the segment).
  const diag: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ];

  it("covers the axis-aligned corner a rotated round ribbon would MISS", () => {
    const sq = buildBrushRibbon("s", samples(diag, 10), RED, "square");
    // (9,-9) is inside the axis-aligned start square (|x|,|y| < 10) but ~12.7px
    // from both the round disk centre AND the diagonal travel line → it is OUTSIDE
    // a rotated round/capsule ribbon.
    expect(filledAt(sq, { x: 9, y: -9 })).toBe(true);
  });

  it("contrast: the round nib does NOT cover that corner (proves square ≠ rotated round)", () => {
    const rnd = buildBrushRibbon("s", samples(diag, 10), RED, "round");
    expect(filledAt(rnd, { x: 9, y: -9 })).toBe(false);
  });

  it("a 45° square stroke is √2× wider (perpendicular) than an axis-aligned one", () => {
    // Perpendicular to travel n=(-1,1)/√2. An axis-aligned square's support width
    // along n is side·√2 ≈ 28.3 (half ≈ 14.1), vs 20 (half 10) for a horizontal
    // stroke. A point 13px off the centre line is covered on the diagonal…
    const sqDiag = buildBrushRibbon("s", samples(diag, 10), RED, "square");
    const t = 13 / Math.SQRT2;
    expect(filledAt(sqDiag, { x: 50 - t, y: 50 + t })).toBe(true);

    // …but the same 13px perpendicular offset is NOT covered by a horizontal
    // square stroke (its half-width is only the nib half-side = 10).
    const horiz: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const sqHoriz = buildBrushRibbon("s", samples(horiz, 10), RED, "square");
    expect(filledAt(sqHoriz, { x: 50, y: 13 })).toBe(false);
    expect(filledAt(sqHoriz, { x: 50, y: 9 })).toBe(true);
  });

  it("the mid-stroke bridge is solid (no gap between the axis-aligned end stamps)", () => {
    const sqDiag = buildBrushRibbon("s", samples(diag, 10), RED, "square");
    expect(filledAt(sqDiag, { x: 50, y: 50 })).toBe(true);
  });
});

describe("brush ribbon — degenerate inputs", () => {
  it("zero samples → empty shape", () => {
    expect(buildBrushRibbon("s", [], RED).paths).toHaveLength(0);
  });

  it("a single sample → one round dab (fine inscribed polygon, task 1434)", () => {
    // The round stamp is an ALL-LINE inscribed polygon on the true circle (like
    // the eraser's disk stamp, but ≥40 segments → ≤0.31% sagitta, matching the
    // oval tool). The old 4-quadratic disk was a +6.07% squircle whose arcs also
    // formed near-tangent triples with the capsule sides that twip snapping
    // fragmented (task 1434) — curves are gone from the brush ribbon.
    const ribbon = buildBrushRibbon("s", samples([{ x: 50, y: 50 }], 10), RED);
    expect(ribbon.paths).toHaveLength(1);
    expect(ribbon.paths[0].segments.every((s) => s.type === "line")).toBe(true);
    expect(ribbon.paths[0].segments.length).toBeGreaterThanOrEqual(40);
    // Every vertex lies on the true circle (± twip snap): no squircle overshoot.
    const pts = [ribbon.paths[0].start, ...ribbon.paths[0].segments.map((s) => (s as { to: { x: number; y: number } }).to)];
    for (const p of pts) {
      const r = Math.hypot(p.x - 50, p.y - 50);
      expect(r).toBeGreaterThan(10 - 0.1);
      expect(r).toBeLessThan(10 + 0.1);
    }
    expect(filledAt(ribbon, { x: 50, y: 50 })).toBe(true);
  });

  it("a single square dab → one axis-aligned square (line segments)", () => {
    const ribbon = buildBrushRibbon("s", samples([{ x: 50, y: 50 }], 10), RED, "square");
    expect(ribbon.paths).toHaveLength(1);
    expect(ribbon.paths[0].segments.every((s) => s.type === "line")).toBe(true);
    expect(filledAt(ribbon, { x: 55, y: 55 })).toBe(true);
  });

  it("each stamp carries a DISTINCT Fill object (union grouping, not even-odd)", () => {
    const ribbon = buildBrushRibbon("s", samples([{ x: 0, y: 0 }, { x: 20, y: 0 }], 6), RED);
    const fills = ribbon.paths.map((p) => p.fill);
    const uniq = new Set(fills);
    expect(uniq.size).toBe(ribbon.paths.length);
  });
});
