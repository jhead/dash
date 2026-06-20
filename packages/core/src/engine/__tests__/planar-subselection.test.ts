/**
 * P3 — partial face/segment selection + split-on-move (task 1321).
 *
 * Unit tests for the live planar map, stable sub-selection keys, the pure picking
 * functions (click face/segment, double-click connected, marquee), and the
 * split-on-move geometry (extract a face/segment, leave a hole/cut behind).
 */

import { describe, it, expect } from "vitest";
import type { Fill, Shape, Stroke } from "../types.js";
import {
  buildArrangementFromShapes,
  livePlanarShape,
  faceKey,
  segmentKey,
  resolveFace,
  resolveSegment,
  pickAt,
  pickConnected,
  pickInRect,
  splitOnMove,
  planarShapeToShape,
  faceArea,
  locateFace,
  type SubKey,
} from "../planar/index.js";
import { createOvalShape } from "../shapes.js";

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const STROKE: Stroke = {
  color: { r: 0, g: 0, b: 0, a: 255 },
  width: 2,
  caps: "round",
  joints: "round",
  miterLimit: 3,
};

function rectShape(id: string, x: number, y: number, w: number, h: number, fill: Fill): Shape {
  return {
    id,
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x, y: y + h } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x, y } },
        ],
        fill,
        closed: true,
      },
    ],
  };
}

function lineShape(id: string, x0: number, y0: number, x1: number, y1: number): Shape {
  return {
    id,
    paths: [
      {
        start: { x: x0, y: y0 },
        segments: [{ type: "line", to: { x: x1, y: y1 } }],
        closed: false,
        stroke: STROKE,
      },
    ],
  };
}

function totalFillArea(shape: Shape): number {
  // Re-build and sum bounded-face areas as a coordinate-independent area check.
  const ps = buildArrangementFromShapes([shape]);
  let a = 0;
  for (const f of ps.faces) if (!f.unbounded && f.fill != null) a += faceArea(ps, f);
  return a;
}

/**
 * Hole-aware net fill area: sum the signed shoelace area of every fill path. An
 * outer loop is CCW (positive) and a hole loop is CW (negative), so the net is the
 * filled area minus the hole — the renderer's non-zero-winding result.
 */
function netSignedFillArea(shape: Shape): number {
  let a = 0;
  for (const p of shape.paths) {
    if (!p.fill) continue;
    const pts = [p.start, ...p.segments.map((s) => s.to)];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      s += pts[i].x * q.y - q.x * pts[i].y;
    }
    a += s / 2;
  }
  return Math.abs(a);
}

// ---------------------------------------------------------------------------
// 0. Refactor is behavior-preserving (no-filter == old full read-back)
// ---------------------------------------------------------------------------

describe("P3 — planarShapeToShape no-filter is the full read-back", () => {
  it("a line-split fill still reads back as 2 fill loops + the segmented stroke", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 60, BLUE),
      lineShape("div", -10, 30, 110, 30),
    ]);
    const merged = planarShapeToShape(ps, "m");
    const fillPaths = merged.paths.filter((p) => p.fill).length;
    const strokePaths = merged.paths.filter((p) => p.stroke && !p.fill).length;
    expect(fillPaths).toBe(2);
    expect(strokePaths).toBeGreaterThanOrEqual(1);
  });

  it("same-color overlap with no divider still unions to ONE loop (P1 preserved)", () => {
    const ps = buildArrangementFromShapes([
      rectShape("a", 0, 0, 100, 100, BLUE),
      rectShape("b", 60, 0, 100, 100, BLUE),
    ]);
    const merged = planarShapeToShape(ps, "m");
    expect(merged.paths.filter((p) => p.fill).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 1. Live planar map (memoized by Shape identity)
// ---------------------------------------------------------------------------

describe("P3 — livePlanarShape", () => {
  it("memoizes by Shape identity and rebuilds for a new Shape", () => {
    const shape = rectShape("r", 0, 0, 100, 100, RED);
    const a = livePlanarShape(shape);
    const b = livePlanarShape(shape);
    expect(a).toBe(b); // same reference -> cache hit
    const shape2 = rectShape("r", 0, 0, 100, 100, RED);
    const c = livePlanarShape(shape2);
    expect(c).not.toBe(a); // new Shape -> rebuilt
  });
});

// ---------------------------------------------------------------------------
// 2. Stable keys round-trip across a rebuild
// ---------------------------------------------------------------------------

describe("P3 — stable keys round-trip", () => {
  it("a FaceKey resolves to the same face after a rebuild", () => {
    const shape = rectShape("r", 20, 20, 80, 60, RED);
    const ps1 = buildArrangementFromShapes([shape]);
    const face = ps1.faces.find((f) => !f.unbounded && f.fill != null)!;
    const key = faceKey(ps1, face)!;
    expect(key.kind).toBe("face");
    // Rebuild from an identical-geometry shape (fresh ids).
    const ps2 = buildArrangementFromShapes([rectShape("r2", 20, 20, 80, 60, RED)]);
    const fid = resolveFace(ps2, key);
    expect(fid).toBeGreaterThanOrEqual(0);
    expect(ps2.faces[fid].fill).not.toBeNull();
  });

  it("a SegmentKey is undirected (twin yields the same key) and resolves back", () => {
    const ps = buildArrangementFromShapes([lineShape("l", 0, 0, 100, 0)]);
    const he = ps.halfEdges.find((h) => h.lineStyle != null)!;
    const k1 = segmentKey(ps, he);
    const k2 = segmentKey(ps, ps.halfEdges[he.twin]);
    expect(k1).toEqual(k2);
    const resolved = resolveSegment(ps, k1);
    expect(resolved).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Picking
// ---------------------------------------------------------------------------

describe("P3 — pickAt", () => {
  it("clicks a fill region (face) when the point is inside a fill", () => {
    const ps = buildArrangementFromShapes([rectShape("r", 0, 0, 100, 100, RED)]);
    const key = pickAt(ps, { x: 50, y: 50 });
    expect(key?.kind).toBe("face");
    const fid = resolveFace(ps, key as Extract<SubKey, { kind: "face" }>);
    expect(ps.faces[fid].fill).not.toBeNull();
  });

  it("clicks a line segment when the point is near a stroke (no fill)", () => {
    const ps = buildArrangementFromShapes([lineShape("l", 0, 50, 100, 50)]);
    const key = pickAt(ps, { x: 50, y: 50.3 }, 4);
    expect(key?.kind).toBe("segment");
  });

  it("picks ONE of the two halves of a line-split fill", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 60, BLUE),
      lineShape("div", -10, 30, 110, 30),
    ]);
    const top = pickAt(ps, { x: 50, y: 15 }) as Extract<SubKey, { kind: "face" }>;
    const bot = pickAt(ps, { x: 50, y: 45 }) as Extract<SubKey, { kind: "face" }>;
    expect(top.kind).toBe("face");
    expect(bot.kind).toBe("face");
    // Two distinct faces.
    expect(resolveFace(ps, top)).not.toBe(resolveFace(ps, bot));
  });
});

describe("P3 — pickInRect (marquee)", () => {
  it("selects all faces whose interior is in the rect + intersecting segments", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 60, BLUE),
      lineShape("div", -10, 30, 110, 30),
    ]);
    // Marquee covering the whole rect.
    const keys = pickInRect(ps, { x: -20, y: -20, width: 160, height: 120 });
    const faces = keys.filter((k) => k.kind === "face").length;
    const segs = keys.filter((k) => k.kind === "segment").length;
    expect(faces).toBe(2);
    expect(segs).toBeGreaterThanOrEqual(1);
  });
});

describe("P3 — pickConnected (double-click)", () => {
  it("two crossing lines: double-clicking one arm selects the whole stroke run", () => {
    const ps = buildArrangementFromShapes([
      lineShape("a", 0, 0, 100, 100),
      lineShape("b", 0, 100, 100, 0),
    ]);
    const keys = pickConnected(ps, { x: 20, y: 20 });
    // Four arms reachable through the shared crossing vertex.
    const segs = keys.filter((k) => k.kind === "segment").length;
    expect(segs).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 4. Split-on-move
// ---------------------------------------------------------------------------

describe("P3 — splitOnMove", () => {
  it("extracts one half of a line-split fill and leaves the other behind", () => {
    const ps = buildArrangementFromShapes([
      rectShape("rect", 0, 0, 100, 60, BLUE),
      lineShape("div", -10, 30, 110, 30),
    ]);
    const top = pickAt(ps, { x: 50, y: 15 })!;
    const { extracted, remainder } = splitOnMove(ps, [top], 200, 0, "ext", "rem");
    expect(extracted).not.toBeNull();
    expect(remainder).not.toBeNull();
    // Extracted has ~1 fill region (the top half), moved right by 200.
    expect(extracted!.paths.filter((p) => p.fill).length).toBe(1);
    // The remainder still has the bottom half.
    expect(remainder!.paths.filter((p) => p.fill).length).toBe(1);
    // Area conservation: top + bottom ≈ original fill area.
    const total = totalFillArea(extracted!) + totalFillArea(remainder!);
    expect(total).toBeCloseTo(100 * 60, -1);
    // Extracted moved: its fill is now centered around x≈250.
    const xs = extracted!.paths.flatMap((p) => [p.start.x, ...p.segments.map((s) => s.to.x)]);
    expect(Math.min(...xs)).toBeGreaterThan(150);
  });

  it("extracting an inner ISLAND leaves a HOLE in the surrounding fill", () => {
    // Blue outer 0..120; a RED island in the middle carves a hole (different
    // color). Extracting the red island should leave the blue with a hole.
    const ps = buildArrangementFromShapes([
      rectShape("outer", 0, 0, 120, 120, BLUE),
      rectShape("island", 40, 40, 40, 40, RED),
    ]);
    // The blue should already have the red as a different-color cut (a hole-ish
    // face). Pick the red island face.
    const islandKey = pickAt(ps, { x: 60, y: 60 })!;
    expect(islandKey.kind).toBe("face");
    const { extracted, remainder } = splitOnMove(ps, [islandKey], 300, 0, "ext", "rem");
    expect(extracted).not.toBeNull();
    expect(remainder).not.toBeNull();
    // Remainder is the blue ring: it emits an outer loop + a CW hole loop where
    // the island was, so the net (hole-aware) fill area = 120^2 - 40^2.
    expect(remainder!.paths.filter((p) => p.fill).length).toBe(2); // outer + hole
    const remArea = netSignedFillArea(remainder!);
    expect(remArea).toBeCloseTo(120 * 120 - 40 * 40, -1);
    // The remainder's hole loop winds OPPOSITE the outer loop (CW vs CCW): the
    // signed areas have opposite sign, which is what makes the renderer's
    // non-zero winding cut the hole.
    const signed = remainder!.paths
      .filter((p) => p.fill)
      .map((p) => {
        const pts = [p.start, ...p.segments.map((s) => s.to)];
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
          const q = pts[(i + 1) % pts.length];
          s += pts[i].x * q.y - q.x * pts[i].y;
        }
        return s / 2;
      });
    expect(signed.some((s) => s > 0)).toBe(true); // outer
    expect(signed.some((s) => s < 0)).toBe(true); // hole
    // The extracted island moved away and still has its area.
    expect(totalFillArea(extracted!)).toBeCloseTo(40 * 40, -1);
  });

  it("extracting a stroke SEGMENT removes it from the remainder", () => {
    const ps = buildArrangementFromShapes([
      lineShape("a", 0, 0, 100, 100),
      lineShape("b", 0, 100, 100, 0),
    ]);
    // One arm of the X.
    const arm = pickAt(ps, { x: 20, y: 20 }, 6)!;
    expect(arm.kind).toBe("segment");
    const { extracted, remainder } = splitOnMove(ps, [arm], 0, -300, "ext", "rem");
    expect(extracted).not.toBeNull();
    expect(extracted!.paths.filter((p) => p.stroke).length).toBe(1);
    // Remainder keeps the other three arms.
    expect(remainder!.paths.filter((p) => p.stroke).length).toBe(3);
  });

  it("extracting everything yields a null remainder", () => {
    const ps = buildArrangementFromShapes([rectShape("r", 0, 0, 80, 80, RED)]);
    const all = pickInRect(ps, { x: -10, y: -10, width: 200, height: 200 });
    const { extracted, remainder } = splitOnMove(ps, all, 50, 50, "ext", "rem");
    expect(extracted).not.toBeNull();
    expect(remainder).toBeNull();
  });

  // P3 LIVE drag-preview invariant (task 1331). The live preview extracts the
  // selection ONCE at delta 0 and then merely TRANSLATES the extracted geometry
  // each pointermove (a pure render translate — no per-move planar recompute),
  // committing the authoritative split only on mouse-up. That is only correct if
  // "split at delta 0, then translate by (dx,dy)" == "split with delta (dx,dy)".
  // This pins exactly that, and exercises it on a CURVE-based fill (oval) so the
  // preview is proven for brush/oval geometry, not just axis-aligned rects.
  it("extract-at-0-then-translate == split-with-delta (the preview optimization)", () => {
    const ovalCurveShape = (id: string): Shape => ({
      id,
      // A diamond of quadratic arcs around (50,50) r=40 — a curve-only fill loop
      // (no axis-aligned edges), like an oval / brush blob.
      paths: [
        {
          start: { x: 90, y: 50 },
          segments: [
            { type: "curve", control: { x: 90, y: 90 }, to: { x: 50, y: 90 } },
            { type: "curve", control: { x: 10, y: 90 }, to: { x: 10, y: 50 } },
            { type: "curve", control: { x: 10, y: 10 }, to: { x: 50, y: 10 } },
            { type: "curve", control: { x: 90, y: 10 }, to: { x: 90, y: 50 } },
          ],
          fill: BLUE,
          closed: true,
        },
      ],
    });

    const dx = 137;
    const dy = -42;
    for (const make of [
      () => rectShape("box", 0, 0, 100, 60, RED),
      () => ovalCurveShape("oval"),
    ]) {
      const shape = make();
      // Base extract (what the preview computes ONCE at drag start).
      const psBase = buildArrangementFromShapes([shape]);
      const keyBase = pickAt(psBase, { x: 50, y: 30 }) ?? pickAt(psBase, { x: 50, y: 50 })!;
      const base = splitOnMove(psBase, [keyBase], 0, 0, "ext", "rem");
      expect(base.extracted).not.toBeNull();

      // Authoritative split with the live delta (what commits on mouse-up).
      const psFull = buildArrangementFromShapes([shape]);
      const keyFull = pickAt(psFull, { x: 50, y: 30 }) ?? pickAt(psFull, { x: 50, y: 50 })!;
      const full = splitOnMove(psFull, [keyFull], dx, dy, "ext", "rem");
      expect(full.extracted).not.toBeNull();

      // The preview renders base.extracted translated by (dx,dy); that must equal
      // the committed full.extracted geometry point-for-point.
      const basePts = base.extracted!.paths.flatMap((p) =>
        [p.start, ...p.segments.map((s) => s.to)].map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
      );
      const fullPts = full.extracted!.paths.flatMap((p) =>
        [p.start, ...p.segments.map((s) => s.to)],
      );
      expect(basePts.length).toBe(fullPts.length);
      for (let i = 0; i < basePts.length; i++) {
        expect(basePts[i].x).toBeCloseTo(fullPts[i].x, 6);
        expect(basePts[i].y).toBeCloseTo(fullPts[i].y, 6);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// task 1334 — a STROKED ellipse/oval must pick & drag at its interior, exactly
// like a stroke-free oval. Regression for the centre-pick failure: the readback
// used to emit a stroked curved fill's boundary as ~12 separate single-segment
// stroke fragments (plus sub-twip stubs). Re-building the merge map (the live
// planar shape used by pickAt) from THAT committed shape produced coincident
// curves the arrangement could not merge → the curve/curve intersector flooded
// with spurious crossings → the interior shattered into tiny faces (or none) and
// pickAt at the centre returned null. The fix: (1) the curve/curve intersector
// reports coincident-overlap endpoints (not a flood); (2) zero-span split pieces
// are dropped; (3) read-back emits a uniformly-stroked fill loop as ONE combined
// fill+stroke path and drops sub-twip stroke stubs — so the rebuild stays clean.
// ---------------------------------------------------------------------------
describe("task 1334 — stroked oval picks & drags at its centre", () => {
  // The committed (merged) form: drive the freshly-drawn shape through the fold
  // (buildArrangementFromShapes) then read back to per-path loops, exactly as the
  // editor stores it; pickAt operates on the LIVE planar map rebuilt from that.
  function commitMerged(shape: Shape): Shape {
    return planarShapeToShape(buildArrangementFromShapes([shape]), "committed");
  }

  it("a STROKED oval read-back is one combined fill+stroke loop (not fragments)", () => {
    const stroked = createOvalShape(50, 50, 150, 150, RED, STROKE);
    const committed = commitMerged(stroked);
    const fillLoops = committed.paths.filter((p) => p.fill);
    const strokeLoops = committed.paths.filter((p) => p.stroke);
    expect(fillLoops.length, "exactly one fill loop").toBe(1);
    // The single fill loop also carries the stroke (the coincident boundary).
    expect(fillLoops[0].stroke, "fill loop is also stroked (combined)").toBeTruthy();
    // No dozen orphan single-segment stroke fragments left over.
    expect(strokeLoops.length, "no fragmented orphan strokes").toBeLessThanOrEqual(1);
  });

  it("pickAt at the centre of a STROKED oval resolves a FILL FACE (matches stroke-free)", () => {
    const centre = { x: 100, y: 100 };

    // Stroke-free baseline: must resolve a fill face.
    const free = livePlanarShape(commitMerged(createOvalShape(50, 50, 150, 150, RED, null)));
    const freeFace = locateFace(free, centre);
    expect(freeFace, "stroke-free oval centre resolves a face").not.toBeNull();
    const freePick = pickAt(free, centre);
    expect(freePick?.kind, "stroke-free oval centre picks a face").toBe("face");

    // Stroked oval: must behave identically.
    const ps = livePlanarShape(commitMerged(createOvalShape(50, 50, 150, 150, RED, STROKE)));
    const face = locateFace(ps, centre);
    expect(face, "stroked oval centre resolves a fill face").not.toBeNull();
    expect(face!.fill, "the resolved face carries the fill").not.toBeNull();
    // Same interior area as the stroke-free oval (the fill region is identical).
    expect(faceArea(ps, face!)).toBeCloseTo(faceArea(free, freeFace!), 0);

    const pick = pickAt(ps, centre);
    expect(pick, "stroked oval centre pick is non-null").not.toBeNull();
    expect(pick!.kind, "stroked oval centre picks a FACE (the interior fill)").toBe("face");
  });

  it("dragging a STROKED oval by its centre extracts the interior fill (split-on-move)", () => {
    const centre = { x: 100, y: 100 };
    const ps = livePlanarShape(commitMerged(createOvalShape(50, 50, 150, 150, RED, STROKE)));
    const key = pickAt(ps, centre);
    expect(key?.kind).toBe("face");

    // Whole-shape drag = split-on-move of the picked face by a live delta.
    const moved = splitOnMove(ps, [key as SubKey], 10, 10, "ext", "rem");
    expect(moved.extracted, "drag extracts geometry").not.toBeNull();
    const extractedFills = moved.extracted!.paths.filter((p) => p.fill);
    expect(extractedFills.length, "the extracted artwork carries the fill").toBeGreaterThanOrEqual(1);
  });

  it("a curved stroke-bordered fill survives a commit→rebuild cycle (general curved fills)", () => {
    // Not just the oval: any uniformly-stroked curved fill must keep a pickable
    // interior through one fold/read-back/rebuild round-trip.
    const cases: [string, Shape][] = [
      ["wide ellipse", createOvalShape(40, 80, 160, 120, BLUE, STROKE)],
      ["tall ellipse", createOvalShape(80, 40, 120, 160, RED, STROKE)],
    ];
    for (const [label, shape] of cases) {
      const ps = livePlanarShape(commitMerged(shape));
      // centre of the bounding box
      const c = { x: 100, y: 100 };
      const f = locateFace(ps, c);
      expect(f, `${label}: centre resolves a fill face`).not.toBeNull();
      expect(pickAt(ps, c)?.kind, `${label}: centre picks a face`).toBe("face");
    }
  });
});
