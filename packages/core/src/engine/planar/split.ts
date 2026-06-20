/**
 * P3 — split-on-move. Moving a PARTIAL selection (some faces / segments of the
 * merged planar map) EXTRACTS the selected pieces into a new standalone shape and
 * leaves the COMPLEMENT (the rest of the map, with a hole / cut where the
 * extracted faces were) as the remaining merged shape — the defining authentic
 * Flash 8 merge behavior (docs/36-vector-merge-model.md §1.1: "click a fill half
 * and move it", "removing an overlapping island leaves a hole").
 *
 * Implementation reuses the proven read-back ({@link planarShapeToShape}) with the
 * P3 {@link PlanarEmitFilter}: emit only the selected faces/edges for the
 * extracted shape (then translate by the drag delta), and emit only the COMPLEMENT
 * for the remainder. A face removed from the middle of a same-fill component is no
 * longer unioned, so the read-back's component tracer emits the surrounding ring
 * with the extracted region as a cut — the hole appears for free, with no DCEL
 * surgery. Curve-preserving throughout.
 */

import type { Point, Shape, ShapePath } from "../types.js";
import { planarShapeToShape } from "./query.js";
import {
  resolveFace,
  resolveSegment,
  type SubKey,
} from "./subselection.js";
import type { PlanarShape } from "../types.js";

export interface SplitResult {
  /** The extracted faces/segments as a standalone Shape, offset by (dx,dy). Null when nothing resolved. */
  readonly extracted: Shape | null;
  /** The remaining map (original minus extracted) as a Shape. Null when everything was extracted. */
  readonly remainder: Shape | null;
}

/** Translate a single ShapePath by (dx, dy) (curve-preserving). */
function translatePath(path: ShapePath, dx: number, dy: number): ShapePath {
  if (dx === 0 && dy === 0) return path;
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...path,
    start: t(path.start),
    segments: path.segments.map((seg) =>
      seg.type === "line"
        ? { type: "line", to: t(seg.to) }
        : { type: "curve", control: t(seg.control), to: t(seg.to) }
    ),
  };
}

function translateShape(shape: Shape, dx: number, dy: number): Shape {
  return { id: shape.id, paths: shape.paths.map((p) => translatePath(p, dx, dy)) };
}

/**
 * Compute the extracted + remainder shapes for moving the partial selection
 * `keys` by `(dx, dy)`.
 */
export function splitOnMove(
  ps: PlanarShape,
  keys: readonly SubKey[],
  dx: number,
  dy: number,
  extractedId: string,
  remainderId: string
): SplitResult {
  // Resolve keys -> selected face ids + selected undirected-edge ids.
  const selFaces = new Set<number>();
  const selEdges = new Set<number>(); // canonical (min of twin pair)
  for (const k of keys) {
    if (k.kind === "face") {
      const fid = resolveFace(ps, k);
      if (fid >= 0) selFaces.add(fid);
    } else {
      const heId = resolveSegment(ps, k);
      if (heId >= 0) {
        const u = Math.min(heId, ps.halfEdges[heId].twin);
        selEdges.add(u);
      }
    }
  }

  if (selFaces.size === 0 && selEdges.size === 0) {
    return { extracted: null, remainder: null };
  }

  const canonical = (heId: number): number => Math.min(heId, ps.halfEdges[heId].twin);

  // EXTRACTED: only the selected faces + selected edges. A stroked edge bounding a
  // selected face is carried with it (so the moved half keeps its outline).
  const extractedShape = planarShapeToShape(ps, extractedId, {
    faceFilter: (fid) => selFaces.has(fid),
    edgeFilter: (heId) => {
      if (selEdges.has(canonical(heId))) return true;
      const he = ps.halfEdges[heId];
      const tw = ps.halfEdges[he.twin];
      return selFaces.has(he.face) || selFaces.has(tw.face);
    },
  });

  // REMAINDER: the complement. Faces NOT selected; edges NOT selected and NOT a
  // stroke that was carried away by an extracted face only.
  const remainderShape = planarShapeToShape(ps, remainderId, {
    faceFilter: (fid) => !selFaces.has(fid),
    edgeFilter: (heId) => {
      if (selEdges.has(canonical(heId))) return false;
      const he = ps.halfEdges[heId];
      const tw = ps.halfEdges[he.twin];
      // A stroke whose BOTH incident faces were extracted goes with the extraction.
      const fa = ps.faces[he.face];
      const fb = ps.faces[tw.face];
      const aExtracted = selFaces.has(he.face) && fa && !fa.unbounded && fa.fill != null;
      const bExtracted = selFaces.has(tw.face) && fb && !fb.unbounded && fb.fill != null;
      const aBoundary = !fa || fa.unbounded || fa.fill == null;
      const bBoundary = !fb || fb.unbounded || fb.fill == null;
      // Drop the stroke from the remainder only if it is fully interior to the
      // extracted region (both sides extracted). Otherwise keep it (it still
      // bounds a remaining face or the background).
      if (aExtracted && bExtracted) return false;
      if (aExtracted && bBoundary) return false;
      if (bExtracted && aBoundary) return false;
      return true;
    },
  });

  const extracted =
    extractedShape.paths.length > 0
      ? translateShape(extractedShape, dx, dy)
      : null;
  const remainder = remainderShape.paths.length > 0 ? remainderShape : null;

  return { extracted, remainder };
}
