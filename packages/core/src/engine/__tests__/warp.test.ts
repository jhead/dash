/**
 * Unit tests for the Free Transform Distort / Envelope mesh-warp math (warp.ts).
 *
 * Covers:
 *  - identityWarp reproduces the source rect (corners + envelope edge controls)
 *  - (u,v) parameterization
 *  - bilinear (distort) interpolation, incl. a perspective-style corner drag
 *  - Coons-patch (envelope) evaluation, incl. the identity-reduces-to-bilinear
 *    invariant and a bent-edge bulge
 *  - warpShape geometry mapping (line + curve subdivision)
 */

import { describe, it, expect } from "vitest";
import {
  identityWarp,
  pointToUV,
  bilinear,
  coons,
  evalWarp,
  warpPoint,
  warpShape,
  type ShapeWarp,
} from "../warp.js";
import type { Rect, Shape, Point } from "../types.js";

const EPS = 1e-9;
function near(a: number, b: number, eps = 1e-6): void {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}
function nearPt(p: Point, x: number, y: number, eps = 1e-6): void {
  near(p.x, x, eps);
  near(p.y, y, eps);
}

const BOUNDS: Rect = { x: 10, y: 20, width: 100, height: 40 };

describe("identityWarp", () => {
  it("distort corners equal the rect corners", () => {
    const w = identityWarp(BOUNDS, "distort");
    expect(w.mode).toBe("distort");
    expect(w.edges).toBeUndefined();
    nearPt(w.corners.nw, 10, 20);
    nearPt(w.corners.ne, 110, 20);
    nearPt(w.corners.se, 110, 60);
    nearPt(w.corners.sw, 10, 60);
  });

  it("envelope edge controls sit at 1/3 and 2/3 of each straight edge", () => {
    const w = identityWarp(BOUNDS, "envelope");
    expect(w.mode).toBe("envelope");
    const e = w.edges!;
    // top nw(10,20) → ne(110,20): controls at x=10+100/3 and 10+200/3, y=20
    nearPt(e.t0, 10 + 100 / 3, 20);
    nearPt(e.t1, 10 + 200 / 3, 20);
    // left nw(10,20) → sw(10,60): controls at y=20+40/3, 20+80/3, x=10
    nearPt(e.l0, 10, 20 + 40 / 3);
    nearPt(e.l1, 10, 20 + 80 / 3);
    // right ne(110,20) → se(110,60)
    nearPt(e.r0, 110, 20 + 40 / 3);
    // bottom sw(10,60) → se(110,60), stored left→right
    nearPt(e.b0, 10 + 100 / 3, 60);
    nearPt(e.b1, 10 + 200 / 3, 60);
  });
});

describe("pointToUV", () => {
  const w = identityWarp(BOUNDS, "distort");
  it("maps the four corners to the unit square", () => {
    expect(pointToUV(w, { x: 10, y: 20 })).toEqual({ u: 0, v: 0 });
    expect(pointToUV(w, { x: 110, y: 20 })).toEqual({ u: 1, v: 0 });
    expect(pointToUV(w, { x: 110, y: 60 })).toEqual({ u: 1, v: 1 });
    expect(pointToUV(w, { x: 10, y: 60 })).toEqual({ u: 0, v: 1 });
  });
  it("maps the center to (0.5, 0.5)", () => {
    expect(pointToUV(w, { x: 60, y: 40 })).toEqual({ u: 0.5, v: 0.5 });
  });
  it("guards against a zero-extent rect (no NaN)", () => {
    const flat = identityWarp({ x: 0, y: 0, width: 0, height: 10 }, "distort");
    const uv = pointToUV(flat, { x: 0, y: 5 });
    expect(uv.u).toBe(0);
    near(uv.v, 0.5);
  });
});

describe("bilinear (distort) interpolation", () => {
  const w = identityWarp(BOUNDS, "distort");
  it("identity warp maps every point to itself", () => {
    nearPt(bilinear(w.corners, 0, 0), 10, 20);
    nearPt(bilinear(w.corners, 1, 1), 110, 60);
    nearPt(bilinear(w.corners, 0.5, 0.5), 60, 40);
    nearPt(bilinear(w.corners, 0.25, 0.75), 10 + 25, 20 + 30);
  });

  it("a corner drag warps the quad and re-maps interior points", () => {
    // Drag the NE corner outward to (200, 0) — a perspective-like skew.
    const dist: ShapeWarp = {
      mode: "distort",
      origBounds: BOUNDS,
      corners: {
        nw: { x: 10, y: 20 },
        ne: { x: 200, y: 0 },
        se: { x: 110, y: 60 },
        sw: { x: 10, y: 60 },
      },
    };
    // Corners map exactly.
    nearPt(warpPoint(dist, { x: 110, y: 20 }), 200, 0); // ne
    nearPt(warpPoint(dist, { x: 10, y: 20 }), 10, 20);  // nw unchanged
    // Top-edge midpoint is the average of nw and the dragged ne.
    nearPt(warpPoint(dist, { x: 60, y: 20 }), (10 + 200) / 2, (20 + 0) / 2);
    // The mapping is affine within the bilinear patch along v=0 (top edge stays
    // a straight line from nw to the new ne).
    const q = warpPoint(dist, { x: 35, y: 20 }); // u=0.25 on top edge
    nearPt(q, 10 + 0.25 * (200 - 10), 20 + 0.25 * (0 - 20));
  });
});

describe("coons (envelope) evaluation", () => {
  it("an identity envelope reduces EXACTLY to the bilinear map", () => {
    const env = identityWarp(BOUNDS, "envelope");
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const u = i / 4;
        const v = j / 4;
        const c = coons(env, u, v);
        const b = bilinear(env.corners, u, v);
        near(c.x, b.x, 1e-9);
        near(c.y, b.y, 1e-9);
        // and it reproduces the original rect point
        near(c.x, BOUNDS.x + u * BOUNDS.width, 1e-9);
        near(c.y, BOUNDS.y + v * BOUNDS.height, 1e-9);
      }
    }
  });

  it("corners and edge controls are honoured at the boundary", () => {
    const env = identityWarp(BOUNDS, "envelope");
    // Bend the top edge upward by pulling both top controls up by 30px.
    const bent: ShapeWarp = {
      ...env,
      edges: {
        ...env.edges!,
        t0: { x: env.edges!.t0.x, y: env.edges!.t0.y - 30 },
        t1: { x: env.edges!.t1.x, y: env.edges!.t1.y - 30 },
      },
    };
    // Corners are unchanged (cubic endpoints are the corners).
    nearPt(evalWarp(bent, 0, 0), 10, 20);
    nearPt(evalWarp(bent, 1, 0), 110, 20);
    // The top-edge midpoint bulges upward (smaller y). For a cubic with both
    // inner controls pulled up 30, the midpoint rises by 3/4 * 30 = 22.5.
    const mid = evalWarp(bent, 0.5, 0);
    near(mid.x, 60);
    near(mid.y, 20 - 22.5);
    // The bottom edge is untouched.
    nearPt(evalWarp(bent, 0.5, 1), 60, 60);
  });

  it("evalWarp dispatches by mode", () => {
    const dist = identityWarp(BOUNDS, "distort");
    const env = identityWarp(BOUNDS, "envelope");
    nearPt(evalWarp(dist, 0.5, 0.5), 60, 40);
    nearPt(evalWarp(env, 0.5, 0.5), 60, 40);
  });
});

describe("warpShape geometry mapping", () => {
  function rectShape(): Shape {
    // A unit-square-ish shape in LOCAL space (object origin at 0,0).
    return {
      id: "s1",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 100, y: 0 } },
            { type: "line", to: { x: 100, y: 40 } },
            { type: "line", to: { x: 0, y: 40 } },
            { type: "line", to: { x: 0, y: 0 } },
          ],
          fill: { type: "solid", color: { r: 0, g: 0, b: 0, a: 255 } },
          closed: true,
        },
      ],
    };
  }

  it("identity warp leaves geometry unchanged (modulo the object offset)", () => {
    const shape = rectShape();
    const w = identityWarp(BOUNDS, "distort");
    // object at (10,20) so local (0,0)→stage(10,20) maps to itself under identity.
    const out = warpShape(shape, w, 10, 20);
    const p = out.paths[0];
    nearPt(p.start, 10, 20);
    expect(p.segments[0].type).toBe("line");
    nearPt((p.segments[0] as { to: Point }).to, 110, 20);
    nearPt((p.segments[2] as { to: Point }).to, 10, 60);
  });

  it("a distort corner drag moves shape points accordingly", () => {
    const shape = rectShape();
    const dist: ShapeWarp = {
      mode: "distort",
      origBounds: BOUNDS,
      corners: {
        nw: { x: 10, y: 20 },
        ne: { x: 160, y: 20 },  // dragged NE +50 in x
        se: { x: 110, y: 60 },
        sw: { x: 10, y: 60 },
      },
    };
    const out = warpShape(shape, dist, 10, 20);
    const p = out.paths[0];
    // local (100,0) → stage (110,20) = ne corner → dragged to (160,20)
    nearPt((p.segments[0] as { to: Point }).to, 160, 20);
    // local (0,0) → nw unchanged
    nearPt(p.start, 10, 20);
  });

  it("subdivides curve segments into chords through the warp", () => {
    const curved: Shape = {
      id: "c1",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "curve", control: { x: 50, y: -40 }, to: { x: 100, y: 0 } },
          ],
          closed: false,
        },
      ],
    };
    const w = identityWarp(BOUNDS, "distort");
    const out = warpShape(curved, w, 10, 20, 8);
    // 1 curve → 8 line chords.
    expect(out.paths[0].segments.length).toBe(8);
    expect(out.paths[0].segments.every((s) => s.type === "line")).toBe(true);
    // The last chord lands on the curve endpoint (100,0)+offset = (110,20).
    const last = out.paths[0].segments[7] as { to: Point };
    nearPt(last.to, 110, 20);
  });
});
