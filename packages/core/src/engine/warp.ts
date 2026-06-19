import type {
  Point, Rect, Shape, ShapePath, PathSegment,
  ShapeWarp, WarpCorners, WarpEdges,
} from "./types.js";

export type { ShapeWarp, WarpCorners, WarpEdges } from "./types.js";

// ---------------------------------------------------------------------------
// Free Transform — Distort & Envelope (mesh warp)
// ---------------------------------------------------------------------------
//
// Flash 8's Free Transform tool has two non-affine modes that REPLACE the
// object's affine box with a four-sided mesh the user drags directly:
//
//   • Distort  — drag any of the 4 CORNERS freely. The original axis-aligned
//                bounding box maps to an arbitrary quadrilateral. Edges stay
//                straight; the interior is interpolated bilinearly. Holding the
//                tool over a corner and dragging gives a perspective-like skew.
//
//   • Envelope — distort plus two BÉZIER CONTROL POINTS per edge (8 total), so
//                each of the four edges becomes a cubic Bézier curve. The
//                interior is filled by a Coons patch (bicubically blended from
//                the four boundary curves). This is Flash's bendable "envelope".
//
// Both are stored as a {@link ShapeWarp}: the four corners (always) plus the
// eight edge control points (envelope only). All points are in STAGE space.
//
// To warp a shape we parameterize the object's ORIGINAL transformed bounding
// box by (u,v) ∈ [0,1]² (u = horizontal, v = vertical) and map each shape point
// to its (u,v) coordinate, then evaluate the mesh at (u,v) to get the warped
// stage-space position. The renderer draws the warped paths directly — the warp
// supersedes the affine translate/rotate/scale, exactly like Flash.
//
// Corner naming (matches the editor handles):
//   nw ── n ── ne          (u,v): nw=(0,0) ne=(1,0)
//   │           │                 sw=(0,1) se=(1,1)
//   w           e
//   │           │
//   sw ── s ── se
//
// Edge control points run two-per-edge in the edge's forward direction:
//   top:    nw → (t0,t1) → ne     (along u, v=0)
//   right:  ne → (r0,r1) → se     (along v, u=1)
//   bottom: sw → (b0,b1) → se     (along u, v=1)   [stored left→right]
//   left:   nw → (l0,l1) → sw     (along v, u=0)   [stored top→bottom]

// The ShapeWarp / WarpCorners / WarpEdges data interfaces live in ./types.ts
// (so the display-object model can reference them without a circular import);
// they are re-exported above for convenience.

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Lerp between two points. */
function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Build an identity warp for a rect: corners at the rect corners and (for
 * envelope) edge controls evenly spaced at 1/3, 2/3 along each straight edge,
 * so an untouched envelope reproduces the rect exactly.
 */
export function identityWarp(bounds: Rect, mode: "distort" | "envelope"): ShapeWarp {
  const nw: Point = { x: bounds.x, y: bounds.y };
  const ne: Point = { x: bounds.x + bounds.width, y: bounds.y };
  const se: Point = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
  const sw: Point = { x: bounds.x, y: bounds.y + bounds.height };
  const corners: WarpCorners = { nw, ne, se, sw };
  if (mode === "distort") {
    return { mode, origBounds: bounds, corners };
  }
  const edges: WarpEdges = {
    t0: lerp(nw, ne, 1 / 3), t1: lerp(nw, ne, 2 / 3),
    r0: lerp(ne, se, 1 / 3), r1: lerp(ne, se, 2 / 3),
    b0: lerp(sw, se, 1 / 3), b1: lerp(sw, se, 2 / 3),
    l0: lerp(nw, sw, 1 / 3), l1: lerp(nw, sw, 2 / 3),
  };
  return { mode, origBounds: bounds, corners, edges };
}

// ---------------------------------------------------------------------------
// (u,v) parameterization
// ---------------------------------------------------------------------------

/** Map a stage point into the warp's (u,v) space using its origBounds. */
export function pointToUV(warp: ShapeWarp, p: Point): { u: number; v: number } {
  const b = warp.origBounds;
  const u = b.width === 0 ? 0 : (p.x - b.x) / b.width;
  const v = b.height === 0 ? 0 : (p.y - b.y) / b.height;
  return { u, v };
}

// ---------------------------------------------------------------------------
// Mesh evaluation
// ---------------------------------------------------------------------------

/** Bilinear interpolation of the four corners at (u,v). Used by Distort. */
export function bilinear(c: WarpCorners, u: number, v: number): Point {
  // top edge nw→ne, bottom edge sw→se, then blend vertically.
  const top = lerp(c.nw, c.ne, u);
  const bottom = lerp(c.sw, c.se, u);
  return lerp(top, bottom, v);
}

/** Cubic Bézier point at parameter t for control quartet p0..p3. */
function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * Coons-patch evaluation of an envelope warp at (u,v). The four boundary
 * curves are cubic Béziers; the interior is the bilinearly-blended Coons patch:
 *
 *   S(u,v) = (1−v)·top(u) + v·bottom(u)
 *          + (1−u)·left(v) + u·right(v)
 *          − bilinear(corners)(u,v)
 *
 * With straight edges (identity envelope) this reduces exactly to the bilinear
 * map, so an untouched envelope is geometrically identical to distort.
 */
export function coons(warp: ShapeWarp, u: number, v: number): Point {
  const c = warp.corners;
  const e = warp.edges!;
  // Boundary curves, each from one corner through 2 controls to the next.
  const top = cubic(c.nw, e.t0, e.t1, c.ne, u);     // v = 0
  const bottom = cubic(c.sw, e.b0, e.b1, c.se, u);  // v = 1
  const left = cubic(c.nw, e.l0, e.l1, c.sw, v);    // u = 0
  const right = cubic(c.ne, e.r0, e.r1, c.se, v);   // u = 1
  const bl = bilinear(c, u, v);
  return {
    x: (1 - v) * top.x + v * bottom.x + (1 - u) * left.x + u * right.x - bl.x,
    y: (1 - v) * top.y + v * bottom.y + (1 - u) * left.y + u * right.y - bl.y,
  };
}

/** Evaluate a warp at (u,v): bilinear for distort, Coons for envelope. */
export function evalWarp(warp: ShapeWarp, u: number, v: number): Point {
  if (warp.mode === "envelope" && warp.edges) return coons(warp, u, v);
  return bilinear(warp.corners, u, v);
}

/** Map a single stage-space point through the warp. */
export function warpPoint(warp: ShapeWarp, p: Point): Point {
  const { u, v } = pointToUV(warp, p);
  return evalWarp(warp, u, v);
}

// ---------------------------------------------------------------------------
// Shape geometry warping
// ---------------------------------------------------------------------------

/**
 * Warp every point of a shape's paths through the mesh. The input shape's
 * points are in LOCAL space (relative to the object origin); `offsetX/offsetY`
 * (the object's x/y) shift them into the warp's stage space before mapping.
 *
 * Curves are SUBDIVIDED into line segments so the (curved) warp deformation is
 * visible on every quadratic control as well as its endpoints — a single
 * mapped control point would not follow a bent envelope edge.
 */
export function warpShape(
  shape: Shape,
  warp: ShapeWarp,
  offsetX: number,
  offsetY: number,
  subdivisions = 8,
): Shape {
  const map = (p: Point): Point => {
    const stagePt = { x: p.x + offsetX, y: p.y + offsetY };
    return warpPoint(warp, stagePt);
  };

  const paths: ShapePath[] = shape.paths.map((path) => {
    const start = map(path.start);
    const segments: PathSegment[] = [];
    let prev = path.start;
    for (const seg of path.segments) {
      if (seg.type === "line") {
        segments.push({ type: "line", to: map(seg.to) });
        prev = seg.to;
      } else {
        // Subdivide the quadratic into straight chords through the warp so the
        // curve bends with the mesh instead of mapping only 2 points.
        for (let i = 1; i <= subdivisions; i++) {
          const t = i / subdivisions;
          const mt = 1 - t;
          const qx = mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x;
          const qy = mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y;
          segments.push({ type: "line", to: map({ x: qx, y: qy }) });
        }
        prev = seg.to;
      }
    }
    return { ...path, start, segments };
  });

  return { ...shape, paths };
}
