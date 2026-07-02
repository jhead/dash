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

/** Closed round nib disk as 4 quadratic quarter-arcs (curve-preserving). */
function diskPath(cx: number, cy: number, r: number, fill: Fill): ShapePath {
  const segments: PathSegment[] = [
    { type: "curve", control: { x: cx + r, y: cy + r }, to: { x: cx, y: cy + r } },
    { type: "curve", control: { x: cx - r, y: cy + r }, to: { x: cx - r, y: cy } },
    { type: "curve", control: { x: cx - r, y: cy - r }, to: { x: cx, y: cy - r } },
    { type: "curve", control: { x: cx + r, y: cy - r }, to: { x: cx + r, y: cy } },
  ];
  return { start: { x: cx + r, y: cy }, segments, closed: true, fill };
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
 * varying nib width) rectangle whose long sides are the outer tangents of the
 * two nib circles. Round joints/caps are supplied by the disks stamped at each
 * end, so this quad only needs to bridge the straight run. Null for a
 * zero-length segment.
 */
function capsulePath(
  a: BrushStampSample,
  b: BrushStampSample,
  fill: Fill
): ShapePath | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const p0 = { x: a.x + nx * a.half, y: a.y + ny * a.half };
  const p1 = { x: b.x + nx * b.half, y: b.y + ny * b.half };
  const p2 = { x: b.x - nx * b.half, y: b.y - ny * b.half };
  const p3 = { x: a.x - nx * a.half, y: a.y - ny * a.half };
  const segments: PathSegment[] = [
    { type: "line", to: p1 },
    { type: "line", to: p2 },
    { type: "line", to: p3 },
    { type: "line", to: p0 },
  ];
  return { start: p0, segments, closed: true, fill };
}

/**
 * Build a brush ribbon as the boolean UNION of a nib STAMP at every sample plus
 * a bridging CAPSULE per segment — the Flash 8 brush "solid fill swept along the
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
 * A single sample → one dab (round circle / square). Zero samples → empty shape.
 */
export function buildBrushRibbon(
  id: string,
  samples: readonly BrushStampSample[],
  fill: Fill,
  nib: "round" | "square" = "round"
): Shape {
  const paths: ShapePath[] = [];
  if (samples.length === 0) return { id, paths };
  const stamp = (s: BrushStampSample): ShapePath =>
    nib === "square"
      ? squarePath(s.x, s.y, s.half, cloneFill(fill))
      : diskPath(s.x, s.y, s.half, cloneFill(fill));

  paths.push(stamp(samples[0]));
  for (let i = 1; i < samples.length; i++) {
    const cap = capsulePath(samples[i - 1], samples[i], cloneFill(fill));
    if (cap) paths.push(cap);
    paths.push(stamp(samples[i]));
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
