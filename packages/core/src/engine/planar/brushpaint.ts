/**
 * Brush paint-mode compositing (Flash 8 brush "Paint" modes) on the planar
 * arrangement / face model. See docs/04-toolbox.md (Brush) and
 * docs/36-vector-merge-model.md.
 *
 * The brush tool draws a filled ribbon shape (see StageArea `brushPointsToShape`
 * / engine `addBrushStroke`). By default (Paint Normal) that ribbon merges into
 * the layer top-wins like any other shape. The non-Normal paint modes CLIP the
 * ribbon to a region derived from the existing artwork BEFORE it merges:
 *
 *   - **Normal**    — no clip; paint over everything (default merge), replacing
 *                     any lines it covers.
 *   - **Fills**     — paint over fills AND empty areas, exactly like Normal
 *                     GEOMETRICALLY; the ONLY difference from Normal is that
 *                     existing LINES (strokes) are left intact under the stroke.
 *                     Line-preservation is not a clip: it is handled at merge time
 *                     (`commitBrushStrokeToTimeline` passes `preserveLines:true`,
 *                     task 1430), so this mode does not clip the ribbon at all.
 *   - **Behind**    — paint only where the layer is EMPTY (behind existing art).
 *   - **Selection** — paint only within the currently-selected fill region(s).
 *   - **Inside**    — start-region-locked: the stroke paints only inside the
 *                     region (fill face, or the empty background) that the stroke
 *                     STARTED in; crossing a boundary is clipped away.
 *
 * The clip is a boolean intersection of the incoming ribbon with a mask region,
 * realized on the kernel: we build one arrangement from the ribbon PLUS the
 * region-boundary edges (so the ribbon is subdivided along every mask boundary),
 * then keep only the sub-faces whose interior lies inside the ribbon AND passes
 * the mode predicate. The kept faces are read back (curve-preserving) as the
 * clipped ribbon shape. The caller then merges that clipped shape normally.
 *
 * Pure data — no canvas, no React.
 */

import type { Fill, Point, Shape, ShapePath, PathSegment } from "../types.js";
import { buildArrangementFromShapes } from "./build.js";
import {
  faceInteriorPoint,
  locateFace,
  planarShapeToShape,
  pointInFace,
  pointInPolygon,
  shapePathToEdgeGeometries,
} from "./query.js";
import { edgeAt } from "./geometry.js";
import { isMergeableShape, toStageSpaceShape } from "./merge.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BrushPaintMode =
  | "normal"
  | "fills"
  | "behind"
  | "selection"
  | "inside";

/** A mergeable shape with a stage offset (the layer's display objects). */
export interface PlacedShape {
  readonly shape: Shape;
  readonly x: number;
  readonly y: number;
}

export interface BrushPaintContext {
  /** All existing mergeable shapes on the target layer (stage space, draw order). */
  readonly existing: readonly PlacedShape[];
  /**
   * The subset of `existing` that is currently selected — used by the
   * "selection" mode to build the mask. Optional; empty ⇒ nothing to paint.
   */
  readonly selection?: readonly PlacedShape[];
  /**
   * Stroke start point (stage space) — used by the "inside" mode to lock the
   * paint to the region the stroke began in.
   */
  readonly startPoint?: Point | null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Strip fill+stroke from a shape's paths so it contributes only CUTTING edges. */
function toBoundaryShape(shape: Shape): Shape {
  return {
    id: shape.id + "-cut",
    paths: shape.paths.map((p) => {
      const { fill: _f, stroke: _s, ...rest } = p;
      return { ...rest } as ShapePath;
    }),
  };
}

/** Flatten a shape's paths to chord polygons (one per closed path) for point tests. */
function shapeChordPolys(shape: Shape): Point[][] {
  const polys: Point[][] = [];
  for (const path of shape.paths) {
    const poly: Point[] = [];
    for (const g of shapePathToEdgeGeometries(path)) {
      if (poly.length === 0) poly.push(g.p0);
      if (g.control === null) {
        poly.push(g.p1);
      } else {
        for (let i = 1; i <= 8; i++) poly.push(edgeAt(g, i / 8));
      }
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

/** True when `pt` lies inside the filled area of `shape` (any of its fill polys). */
function pointInShapeFill(polys: readonly Point[][], pt: Point): boolean {
  // The brush ribbon is the UNION of overlapping simple convex stamps (disk per
  // sample + capsule per segment; see {@link buildBrushRibbon}). A point is in
  // the ribbon fill iff it is inside ANY stamp — a UNION test, NOT even-odd:
  // even-odd would cancel the overlap regions (self-crossings, joints) back into
  // holes, exactly the task-1426 defect. The stamps carry no nested hole loops.
  for (const poly of polys) {
    if (pointInPolygon(pt, poly)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Brush ribbon geometry (Flash 8 nib sweep) — task 1426
// ---------------------------------------------------------------------------

/** One brush sample: stage position + the nib HALF-width to stamp there. */
export interface BrushStampSample {
  readonly x: number;
  readonly y: number;
  /** Nib half-width: radius for a round nib, half-side for a square nib. */
  readonly half: number;
}

/**
 * A distinct-identity clone of a fill. Each ribbon stamp MUST carry its own Fill
 * object so {@link import("./build.js").buildArrangementFromShapes} groups it as
 * its own single-loop region (keyed by Fill object identity) → last-covering-wins
 * UNION. Sharing one Fill object across the stamps would collapse them into a
 * single even-odd group and re-open the holes at overlaps (task 1426 root cause).
 */
function cloneFill(fill: Fill): Fill {
  return { ...fill } as Fill;
}

// ---------------------------------------------------------------------------
// Round nib disk stamp — polygonal, with the capsule corners as EXACT vertices
// (task 1434). See the block comment above {@link buildBrushRibbon}.
// ---------------------------------------------------------------------------

/**
 * Minimum disk tessellation: 40 segments → max inscribed-polygon sagitta
 * r·(1−cos(π/40)) ≈ 0.31% of r — matching the oval tool's arc fidelity
 * (`createOvalShape` errs +0.31%) and bettering the eraser's 24-gon (0.86%).
 * The polygon is INSCRIBED (vertices exactly ON the true circle), so it never
 * overshoots the radius at all — vs the old 4-quadratic "squircle" disk whose
 * corner control points overshot +6.07% at the diagonals.
 */
const MIN_DISK_SEGMENTS = 40;
/** Upper bound on tessellation for very large nibs. */
const MAX_DISK_SEGMENTS = 96;
/** Absolute sagitta cap (px) so large nibs stay visually round. */
const DISK_ABS_SAGITTA = 0.25;

/** Disk segment count scaled to the radius (relative AND absolute sagitta). */
function diskSegmentCount(r: number): number {
  if (!(r > 0)) return MIN_DISK_SEGMENTS;
  const relStep = (2 * Math.PI) / MIN_DISK_SEGMENTS;
  // Sagitta of a chord subtending `step`: r·(1 − cos(step/2)) ≤ DISK_ABS_SAGITTA.
  const c = Math.max(-1, Math.min(1, 1 - DISK_ABS_SAGITTA / r));
  const absStep = 2 * Math.acos(c);
  const step = Math.min(relStep, absStep);
  return Math.min(MAX_DISK_SEGMENTS, Math.max(MIN_DISK_SEGMENTS, Math.ceil((2 * Math.PI) / step)));
}

/**
 * Snap a constructed round-nib point to the twip grid (the arrangement kernel's
 * own snap, applied EARLY). Pre-snapping every emitted coordinate makes the
 * ribbon's chord polygons — which `buildArrangementFromShapes` samples face
 * interior points against — bit-identical to the snapped arrangement edges.
 * Without this, faces are bounded by SNAPPED edges while the fill regions are
 * tested UNSNAPPED, leaving a ≤0.035px disagreement band along every boundary
 * in which a face's sampled interior point can misclassify (observed: sliver
 * faces going fill=null inside the ribbon → unpainted cracks). With it, a face
 * is uniformly inside or outside every region polygon, so classification is
 * point-choice independent. Costs ≤ half a twip of radial fidelity (≤0.9% only
 * for nibs under ~4px — inherent to the twip grid, not the construction).
 */
function snapTwip(p: Point): Point {
  return { x: Math.round(p.x * 20) / 20, y: Math.round(p.y * 20) / 20 };
}

/** A required disk-boundary vertex: a capsule tangent corner at `angle`. */
interface DiskVertex {
  readonly angle: number;
  readonly point: Point;
}

/**
 * Per-sample registry of the REQUIRED disk vertices — the tangent corner points
 * of every capsule bridge adjacent to that sample. Registering a corner returns
 * a CANONICAL Point: corners of adjacent segments that land within a couple of
 * twips of each other (near-collinear travel, near-hairpins) are merged onto ONE
 * shared point so the arrangement sees a single snapped vertex there instead of
 * a micro edge. Both the capsule quads and the disk polygon are built from these
 * exact same Point values, which is the whole task-1434 invariant: every
 * disk/bridge junction shares a snapped vertex, exactly like the square nib.
 */
class NibCornerRegistry {
  private readonly perSample: DiskVertex[][];

  constructor(sampleCount: number) {
    this.perSample = Array.from({ length: sampleCount }, () => []);
  }

  /** Register (or reuse) the corner of sample `i` in unit direction (nx,ny). */
  corner(i: number, s: BrushStampSample, nx: number, ny: number): Point {
    const point = snapTwip({ x: s.x + nx * s.half, y: s.y + ny * s.half });
    // MERGE TOLERANCE (the load-bearing constant). Two adjacent segments' corner
    // points at the same sample sit `sep = 2h·sin(δ/2)` apart for a turn angle δ.
    // If kept distinct, the two tangent side edges CROSS on the inner side of the
    // turn with a perpendicular clearance that grows only QUADRATICALLY,
    // `h(1−cos δ) ≈ sep²/(2h)` — for gentle turns that whole miter corridor is
    // sub-twip and twip snapping slits it (the union seal breaks; whole band
    // faces leak into the unbounded face). And even ABOVE the sub-twip scale,
    // corner clusters under ~0.3px spawn sliver/dart faces whose interior-point
    // sampling (`faceInteriorPoint` — task 1435's file) can land within the
    // split-vertex snap disagreement band and misclassify. So merge the corners
    // whenever the clearance would be under 0.3px: `sep² < 2h·0.3`. Merged
    // corners give BOTH bridge quads the exact same canonical corner (and
    // therefore the same shared end-edge diameter) — the square nib's own
    // shared-corner mechanism — and the patched outgoing quad's slab then covers
    // the turn's outer wedge by construction. The patch shaves the tangent swath
    // by ≤ sep²/(2h) ≤ 0.3px — under the ±0.35px coverage acceptance band and
    // visually nil. Above the threshold every constructed feature pair is ≥0.3px
    // apart, which both the kernel and the fill sampler handle reliably.
    const tol = Math.min(Math.sqrt(0.6 * s.half), s.half);
    const list = this.perSample[i];
    for (const v of list) {
      if (Math.hypot(v.point.x - point.x, v.point.y - point.y) <= tol) return v.point;
    }
    list.push({ angle: Math.atan2(ny, nx), point });
    return point;
  }

  /** The required vertices of sample `i`, sorted by angle. */
  verticesFor(i: number): DiskVertex[] {
    return [...this.perSample[i]].sort((a, b) => a.angle - b.angle);
  }
}

/**
 * Closed round nib stamp: an inscribed polygon on the TRUE circle of radius
 * `s.half`, whose vertex set CONTAINS every required capsule corner exactly
 * (same Point values → same snapped twip vertex).
 *
 * TESSELLATION RULE (the load-bearing part — task 1434). An angular gap between
 * consecutive required vertices is subdivided into fine ≤2π/N chords ONLY when
 * its arc is NOT covered by an adjacent bridge quad:
 *   - the arc facing an adjacent sample (dot(dir, travel) toward it ≥ 0) lies
 *     under that segment's bridge quad — it gets a SINGLE chord. Filler
 *     vertices there would sit within a fraction of a twip of the quad's
 *     tangent side edges (the wedge between a tangent line and its circle is
 *     sub-twip deep for ~1px), and twip snapping fragments such grazing pairs
 *     into micro stubs that break the union seal — exactly the residual crack
 *     this rule eliminates on the inner side of gentle turns. The single chord
 *     is strictly interior to the covering quad (its circular segment is quad-
 *     covered), so cutting the arc costs NO coverage;
 *   - uncovered arcs (end caps; the outer wedge of a turn) get fine chords. No
 *     bridge edge runs alongside those arcs — the adjacent side edges END at
 *     the tangent vertices and extend away — so the fine chords meet other
 *     edges only at shared snapped vertices, with healthy divergence angles.
 *
 * All-line construction (like the square nib and the eraser's disk stamp): every
 * stamp/bridge interaction in the arrangement is an exact line/line crossing or
 * a shared vertex — no near-tangent curve triples for twip snapping to fragment.
 *
 * Returns null when EVERY gap is quad-covered (an interior sample on a straight
 * or near-straight run): the disk is then fully inside the union of the two
 * adjacent quads, whose end edges are the SAME canonical diameter segment
 * (shared corner points), so the seam is an exact collinear-edge merge — the
 * square nib's own mechanism — and the stamp would be pure redundant geometry.
 */
function roundStampPath(
  s: BrushStampSample,
  required: readonly DiskVertex[],
  tIn: Point | null,
  tOut: Point | null,
  fill: Fill
): ShapePath | null {
  const r = s.half;
  const N = diskSegmentCount(r);
  const step = (2 * Math.PI) / N;
  const verts: Point[] = [];
  if (required.length === 0) {
    // Free-standing dab: uniform N-gon from angle 0.
    for (let k = 0; k < N; k++) {
      const a = k * step;
      verts.push(snapTwip({ x: s.x + r * Math.cos(a), y: s.y + r * Math.sin(a) }));
    }
  } else {
    let allCovered = true;
    for (let j = 0; j < required.length; j++) {
      const cur = required[j];
      const nxt = required[(j + 1) % required.length];
      verts.push(cur.point);
      let gap = nxt.angle - cur.angle;
      if (j === required.length - 1) gap += 2 * Math.PI; // wrap-around arc
      if (gap <= 1e-12) continue; // coincident directions (merged / duplicates)
      // Covered when the arc's mid direction faces an adjacent sample: the
      // incoming quad covers the half-disk facing the PREVIOUS sample
      // (dot(d, tIn) ≤ 0), the outgoing quad the half facing the NEXT
      // (dot(d, tOut) ≥ 0). Required vertices sit exactly on the half-plane
      // boundaries (the ± tangent directions), so a gap is uniformly covered
      // or uncovered — the midpoint test is exact.
      const mid = cur.angle + gap / 2;
      const dx = Math.cos(mid);
      const dy = Math.sin(mid);
      const covered =
        (tIn !== null && dx * tIn.x + dy * tIn.y <= 1e-9) ||
        (tOut !== null && dx * tOut.x + dy * tOut.y >= -1e-9);
      if (covered) continue; // single chord under the quad
      allCovered = false;
      const fillers = Math.max(0, Math.ceil(gap / step) - 1);
      for (let k = 1; k <= fillers; k++) {
        const a = cur.angle + gap * (k / (fillers + 1));
        verts.push(snapTwip({ x: s.x + r * Math.cos(a), y: s.y + r * Math.sin(a) }));
      }
    }
    // Interior straight/near-straight sample: disk ⊆ quadIn ∪ quadOut exactly
    // (their shared end edge is the same canonical diameter) — skip the stamp.
    if (allCovered && tIn !== null && tOut !== null) return null;
  }
  // Drop consecutive vertices that snapped onto the same twip (tiny nibs).
  const clean: Point[] = [];
  for (const v of verts) {
    const prev = clean[clean.length - 1];
    if (prev && prev.x === v.x && prev.y === v.y) continue;
    clean.push(v);
  }
  while (
    clean.length > 1 &&
    clean[0].x === clean[clean.length - 1].x &&
    clean[0].y === clean[clean.length - 1].y
  ) {
    clean.pop();
  }
  if (clean.length < 3) return null; // degenerate (sub-twip nib)
  const segments: PathSegment[] = clean
    .slice(1)
    .map((p) => ({ type: "line" as const, to: p }));
  segments.push({ type: "line", to: clean[0] });
  return { start: clean[0], segments, closed: true, fill };
}

/** Closed square nib stamp (axis-aligned). */
function squarePath(cx: number, cy: number, h: number, fill: Fill): ShapePath {
  const segments: PathSegment[] = [
    { type: "line", to: { x: cx + h, y: cy - h } },
    { type: "line", to: { x: cx + h, y: cy + h } },
    { type: "line", to: { x: cx - h, y: cy + h } },
    { type: "line", to: { x: cx - h, y: cy - h } },
  ];
  return { start: { x: cx - h, y: cy - h }, segments, closed: true, fill };
}

/**
 * Bridging capsule quad between two samples: the (possibly trapezoidal, for a
 * varying nib width) rectangle whose long sides connect the perpendicular
 * tangent points of the two nib circles. Round joints/caps are supplied by the
 * disk stamps at each end, so this quad only needs to bridge the straight run.
 *
 * The four corners are the CANONICAL registry points (task 1434): the exact
 * same Point values are emitted as vertices of the adjacent disk stamps, so the
 * disk boundary and the bridge share a snapped vertex at every junction —
 * mirroring `squareBridgePath`, whose corners are the square stamp's own
 * corners. Null for a zero-length segment (no corners registered).
 */
function roundBridgePath(
  reg: NibCornerRegistry,
  aIdx: number,
  a: BrushStampSample,
  bIdx: number,
  b: BrushStampSample,
  fill: Fill
): ShapePath | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const p0 = reg.corner(aIdx, a, nx, ny);
  const p1 = reg.corner(bIdx, b, nx, ny);
  const p2 = reg.corner(bIdx, b, -nx, -ny);
  const p3 = reg.corner(aIdx, a, -nx, -ny);
  // Samples closer than a twip: both end edges snapped onto each other — the
  // stamps cover everything; a degenerate quad would only add zero-area edges.
  if (p0.x === p1.x && p0.y === p1.y && p2.x === p3.x && p2.y === p3.y) return null;
  const segments: PathSegment[] = [
    { type: "line", to: p1 },
    { type: "line", to: p2 },
    { type: "line", to: p3 },
    { type: "line", to: p0 },
  ];
  return { start: p0, segments, closed: true, fill };
}

/**
 * Bridging quad between two AXIS-ALIGNED SQUARE stamps: the parallelogram swept
 * by the square's two SILHOUETTE corners (the corners extreme in the direction
 * PERPENDICULAR to travel) from sample `a` to sample `b`.
 *
 * Unioned with the axis-aligned square stamp at each end, this covers exactly the
 * Minkowski sum of the segment with the axis-aligned square — the authentic
 * Flash 8 square-nib sweep. Consequences (vs the old perpendicular-offset capsule
 * that produced a ROTATED constant-width ribbon):
 *   - a diagonal stroke is measurably wider (up to √2×) than an axis-aligned one
 *     at the same nib size (the square's diagonal, not its side, faces across the
 *     travel);
 *   - the stroke ends and joints keep AXIS-ALIGNED square corners, not butt caps
 *     perpendicular to travel.
 *
 * ASSUMPTION (task 1433 marks the exact sweep PROFILE "unconfirmed"): we take the
 * real-Flash-8 reading of an axis-aligned square STAMP swept along the path
 * (Minkowski sum), consistent with the single-click square dab and with the
 * stamp-union construction of task 1426. Null for a zero-length segment.
 */
function squareBridgePath(
  a: BrushStampSample,
  b: BrushStampSample,
  fill: Fill
): ShapePath | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  // The 4 axis-aligned square corners as unit offsets from the center (y-down).
  const corners: readonly Point[] = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
  // Silhouette corners = the corners extreme along the perpendicular to travel.
  const nx = -dy;
  const ny = dx;
  let cMax = corners[0];
  let cMin = corners[0];
  let dMax = -Infinity;
  let dMin = Infinity;
  for (const c of corners) {
    const d = c.x * nx + c.y * ny;
    if (d > dMax) {
      dMax = d;
      cMax = c;
    }
    if (d < dMin) {
      dMin = d;
      cMin = c;
    }
  }
  const q0 = { x: a.x + cMax.x * a.half, y: a.y + cMax.y * a.half };
  const q1 = { x: b.x + cMax.x * b.half, y: b.y + cMax.y * b.half };
  const q2 = { x: b.x + cMin.x * b.half, y: b.y + cMin.y * b.half };
  const q3 = { x: a.x + cMin.x * a.half, y: a.y + cMin.y * a.half };
  const segments: PathSegment[] = [
    { type: "line", to: q1 },
    { type: "line", to: q2 },
    { type: "line", to: q3 },
    { type: "line", to: q0 },
  ];
  return { start: q0, segments, closed: true, fill };
}

/**
 * Build a brush ribbon as the boolean UNION of a nib STAMP at every sample plus
 * a bridging quad per segment — the Flash 8 brush "solid fill swept along the
 * path" (task 1426). This mirrors the eraser's disk+capsule stamp construction
 * ({@link import("./eraser.js").buildEraserStamp}).
 *
 * Emitting many overlapping simple convex loops — EACH with its own distinct
 * Fill object — makes `buildArrangementFromShapes` fill sampling resolve the
 * ribbon as an exact UNION (last-covering-wins across the distinct-Fill groups,
 * per task 1425). The result:
 *   - a stroke that crosses itself has NO hole at the crossing (the old single
 *     doubly-wound outline read even-odd → OUTSIDE → a hole);
 *   - a hairpin does not bowtie into an even-odd notch;
 *   - a sharp joint keeps full width (no averaged-normal cos(θ/2) thinning).
 * The subsequent merge fold reads the union back as one dissolved silhouette.
 *
 * ROUND-NIB CONSTRUCTION (task 1434 — square-nib parity). The square nib is
 * exact BY CONSTRUCTION: its bridge corners ARE the square stamp's own corners
 * (identical snapped vertices; collinear straight edges the arrangement merges
 * exactly). The round nib now has the same property:
 *   - the disk stamp is an inscribed POLYGON on the true circle (0 overshoot,
 *     ≤0.31% sagitta at {@link MIN_DISK_SEGMENTS}; segment count scaled to the
 *     radius) — replacing the old 4-quadratic disk that overshot +6.07% at the
 *     diagonals (a visibly fat/squarish "squircle" dab and end cap);
 *   - every capsule tangent corner `s ± n·half` is registered in a per-sample
 *     {@link NibCornerRegistry} and emitted as a vertex of BOTH the disk polygon
 *     and the bridge quad (the exact same Point values → the same snapped twip
 *     vertex). Previously the corner was NOT a vertex of the disk boundary: the
 *     disk arc + the two capsule side edges formed a near-tangent triple with
 *     sub-twip clearance, which twip snapping fragmented into ~0.1px stubs —
 *     breaking the union seal (a self-overlapping stroke painted its enclosed
 *     hole SOLID, and band faces flipped to null).
 * The all-line construction also makes the kernel's chord-polygon fill sampling
 * exact for the ribbon (a line-only loop IS its own chord polygon).
 *
 * A single sample → one dab (polygonal circle / square). Zero samples → empty.
 */
export function buildBrushRibbon(
  id: string,
  rawSamples: readonly BrushStampSample[],
  fill: Fill,
  nib: "round" | "square" = "round"
): Shape {
  const paths: ShapePath[] = [];
  if (rawSamples.length === 0) return { id, paths };

  // Drop consecutive (sub-twip) DUPLICATE samples: they contribute zero
  // coverage (the bridge is degenerate and the stamp is the same footprint),
  // but a duplicate ROUND sample would emit a second inscribed polygon of the
  // SAME circle at a different vertex phase — dozens of sub-twip lens
  // crossings between two approximations of one curve, exactly the
  // fragmentation class this task eliminates (task 1434).
  const samples: BrushStampSample[] = [rawSamples[0]];
  for (let i = 1; i < rawSamples.length; i++) {
    const prev = samples[samples.length - 1];
    const s = rawSamples[i];
    if (
      Math.abs(s.x - prev.x) < 0.05 &&
      Math.abs(s.y - prev.y) < 0.05 &&
      Math.abs(s.half - prev.half) < 0.05
    ) {
      continue;
    }
    samples.push(s);
  }

  // The bridge between consecutive stamps MUST match the nib: a round nib bridges
  // with a tangent-corner capsule quad; a SQUARE nib bridges with the parallelogram
  // swept by its axis-aligned silhouette corners (task 1433). Using the capsule
  // for a square nib would sweep a ROTATED constant-width ribbon between the
  // axis-aligned end stamps — the exact task-1433 defect.
  if (nib === "square") {
    paths.push(squarePath(samples[0].x, samples[0].y, samples[0].half, cloneFill(fill)));
    for (let i = 1; i < samples.length; i++) {
      const cap = squareBridgePath(samples[i - 1], samples[i], cloneFill(fill));
      if (cap) paths.push(cap);
      paths.push(squarePath(samples[i].x, samples[i].y, samples[i].half, cloneFill(fill)));
    }
    return { id, paths };
  }

  // Round nib, two passes. Pass 1: build every bridge quad, registering its
  // corners as canonical per-sample disk vertices, and record each sample's
  // unit travel directions (into / out of the sample) for the stamp's
  // quad-coverage test. Pass 2: emit the disk stamp polygons (which consume
  // those exact corner vertices) interleaved with the bridges in draw order
  // (stamp 0, bridge 0-1, stamp 1, …).
  const reg = new NibCornerRegistry(samples.length);
  const bridges: (ShapePath | null)[] = [];
  const tIn: (Point | null)[] = new Array(samples.length).fill(null);
  const tOut: (Point | null)[] = new Array(samples.length).fill(null);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len >= 1e-9) {
      const t = { x: dx / len, y: dy / len };
      tOut[i - 1] = t;
      tIn[i] = t;
    }
    bridges.push(
      roundBridgePath(reg, i - 1, samples[i - 1], i, samples[i], cloneFill(fill))
    );
  }
  const stamp0 = roundStampPath(
    samples[0], reg.verticesFor(0), tIn[0], tOut[0], cloneFill(fill)
  );
  if (stamp0) paths.push(stamp0);
  for (let i = 1; i < samples.length; i++) {
    const cap = bridges[i - 1];
    if (cap) paths.push(cap);
    const st = roundStampPath(
      samples[i], reg.verticesFor(i), tIn[i], tOut[i], cloneFill(fill)
    );
    if (st) paths.push(st);
  }
  return { id, paths };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Clip an incoming brush ribbon to the region allowed by `mode`. Returns the
 * clipped ribbon as a stage-space {@link Shape} (place at x=0,y=0), or `null`
 * when the mode leaves nothing to paint (the caller should then commit nothing).
 *
 * For "normal" the ribbon is returned unchanged (baked to stage space).
 *
 * @param incoming  The brush ribbon display object (solid-fill shape + offset).
 * @param mode      The Flash 8 brush paint mode.
 * @param ctx       Existing layer art / selection / stroke start.
 */
export function clipBrushStroke(
  incoming: PlacedShape,
  mode: BrushPaintMode,
  ctx: BrushPaintContext
): Shape | null {
  const ribbon = toStageSpaceShape(incoming);
  if (mode === "normal") return ribbon;
  if (ribbon.paths.length === 0) return null;

  // The mask region is derived from the existing mergeable art (stage space).
  const existingStage = ctx.existing
    .filter((e) => isMergeableShape(e.shape))
    .map(toStageSpaceShape);

  // Build a predicate `keep(interiorPoint)` deciding whether a sub-face of the
  // ribbon should be painted, plus the set of boundary shapes whose edges must
  // subdivide the ribbon so the predicate is representative per sub-face.
  let keep: (pt: Point) => boolean;
  let boundaries: Shape[];

  switch (mode) {
    case "fills": {
      // Flash 8 "Paint Fills" paints over BOTH existing fills AND empty areas —
      // it is GEOMETRICALLY identical to Paint Normal. Its sole distinction is
      // that it leaves existing LINES (strokes) untouched, and that is enforced
      // downstream at merge time (`commitBrushStrokeToTimeline` folds the ribbon
      // with `preserveLines:true`, task 1430), NOT here. So there is nothing to
      // clip: paint the whole ribbon anywhere on the canvas.
      //
      // (The former implementation clipped to existing filled faces only —
      // painting nothing on empty canvas and clipping at fill boundaries — which
      // matched the "only-over-existing-fills" bug, not Flash 8. Fixed: task 1429.)
      return ribbon;
    }
    case "behind": {
      // Paint only where empty. Region = complement of existing filled faces.
      if (existingStage.length === 0) return ribbon; // all empty ⇒ paint anywhere
      const regionPS = buildArrangementFromShapes(existingStage);
      keep = (pt) => {
        const f = locateFace(regionPS, pt);
        return f === null || f.fill === null;
      };
      boundaries = existingStage.map(toBoundaryShape);
      break;
    }
    case "selection": {
      // Paint only within the current selection's filled region(s).
      const selStage = (ctx.selection ?? [])
        .filter((e) => isMergeableShape(e.shape))
        .map(toStageSpaceShape);
      if (selStage.length === 0) return null;
      const regionPS = buildArrangementFromShapes(selStage);
      keep = (pt) => {
        const f = locateFace(regionPS, pt);
        return f !== null && f.fill !== null;
      };
      boundaries = selStage.map(toBoundaryShape);
      break;
    }
    case "inside": {
      // Start-region-locked. If the stroke started inside an existing fill, lock
      // to THAT face; if it started on empty, lock to the empty background.
      const start = ctx.startPoint ?? null;
      boundaries = existingStage.map(toBoundaryShape);
      if (existingStage.length === 0) {
        // Nothing to bound: whole layer is one empty region → paint anywhere.
        return ribbon;
      }
      const regionPS = buildArrangementFromShapes(existingStage);
      const startFace = start ? locateFace(regionPS, start) : null;
      if (startFace && startFace.fill !== null) {
        keep = (pt) => pointInFace(regionPS, startFace, pt);
      } else {
        // Started on empty (or unknown) → lock to the empty background.
        keep = (pt) => {
          const f = locateFace(regionPS, pt);
          return f === null || f.fill === null;
        };
      }
      break;
    }
    default:
      return ribbon;
  }

  return clipRibbonToPredicate(ribbon, boundaries, keep);
}

/**
 * Intersect the ribbon with a mask predicate on the kernel: subdivide the ribbon
 * along the boundary edges, then keep sub-faces whose interior is inside the
 * ribbon fill AND accepted by `keep`. Returns the clipped ribbon, or null.
 */
function clipRibbonToPredicate(
  ribbon: Shape,
  boundaries: readonly Shape[],
  keep: (pt: Point) => boolean
): Shape | null {
  const ribbonPolys = shapeChordPolys(ribbon);
  // Build one arrangement: boundary edges (no fill) subdivide, ribbon carries the
  // only fill so a face is "inside the ribbon" iff it picked up a non-null fill.
  const ps = buildArrangementFromShapes([...boundaries, ribbon]);

  const keptFaceIds = new Set<number>();
  for (const f of ps.faces) {
    if (f.unbounded || f.fill === null) continue; // must be inside the ribbon
    const ip = faceInteriorPoint(ps, f);
    if (!ip) continue;
    // Guard against boundary-only faces that the kernel may have colored via
    // sampling: require the interior to actually be in the ribbon outline too.
    if (!pointInShapeFill(ribbonPolys, ip)) continue;
    if (keep(ip)) keptFaceIds.add(f.id);
  }
  if (keptFaceIds.size === 0) return null;

  const clipped = planarShapeToShape(ps, ribbon.id, {
    faceFilter: (fid) => keptFaceIds.has(fid),
    edgeFilter: () => false, // brush ribbon emits fills only, never strokes
  });
  return clipped.paths.length > 0 ? clipped : null;
}
