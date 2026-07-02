/**
 * Pen sub-tool anchor editing (task 1422 — completes the deferred behaviors of
 * task 1388, which wired the Pen sub-tool selector + key bindings but not the
 * editing operations).
 *
 * Pure geometry helpers that add / delete / convert an anchor on an existing
 * shape path, operating in the path's own coordinate space. No React, no canvas.
 *
 * The model path is a start point plus a list of quadratic segments (line: no
 * control; curve: single control). An "anchor" is the start point (index 0) or
 * any segment's `to` (index i+1). Add Anchor splits the nearest segment; Delete
 * Anchor removes an anchor and rejoins its neighbors; Convert Anchor toggles the
 * segments touching an anchor between corner (line) and smooth (curve).
 */

import type { Point, Shape, ShapePath, PathSegment } from "@flash/core";

const DEFAULT_TOL_PX = 6;

interface EditablePath {
  /** Anchor points in order (start, then each segment's endpoint). */
  anchors: Point[];
  /** Control point for the segment ENTERING anchor i (null = straight line). */
  controls: (Point | null)[];
  closed: boolean;
  fill?: ShapePath["fill"];
  stroke?: ShapePath["stroke"];
}

function toEditable(path: ShapePath): EditablePath {
  const anchors: Point[] = [{ x: path.start.x, y: path.start.y }];
  const controls: (Point | null)[] = [null]; // no segment enters anchor 0
  for (const seg of path.segments) {
    anchors.push({ x: seg.to.x, y: seg.to.y });
    controls.push(seg.type === "curve" ? { x: seg.control.x, y: seg.control.y } : null);
  }
  return { anchors, controls, closed: path.closed, fill: path.fill, stroke: path.stroke };
}

function fromEditable(ep: EditablePath): ShapePath {
  const segments: PathSegment[] = [];
  for (let i = 1; i < ep.anchors.length; i++) {
    const ctrl = ep.controls[i];
    if (ctrl) {
      segments.push({ type: "curve", control: ctrl, to: ep.anchors[i] });
    } else {
      segments.push({ type: "line", to: ep.anchors[i] });
    }
  }
  return {
    start: ep.anchors[0],
    segments,
    closed: ep.closed,
    ...(ep.fill ? { fill: ep.fill } : {}),
    ...(ep.stroke ? { stroke: ep.stroke } : {}),
  };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Quadratic Bézier point at parameter t. */
function quadAt(p0: Point, c: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x,
    y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y,
  };
}

/**
 * Find the anchor index nearest `pt` within `tolPx`, searching all paths of the
 * shape. Returns `{ pathIndex, anchorIndex }` or null.
 */
function findAnchor(
  shape: Shape,
  pt: Point,
  tolPx: number,
): { pathIndex: number; anchorIndex: number } | null {
  let best: { pathIndex: number; anchorIndex: number } | null = null;
  let bestD = tolPx;
  shape.paths.forEach((path, pi) => {
    const ep = toEditable(path);
    ep.anchors.forEach((a, ai) => {
      const d = dist(a, pt);
      if (d <= bestD) { bestD = d; best = { pathIndex: pi, anchorIndex: ai }; }
    });
  });
  return best;
}

/**
 * Find the nearest point ON a segment (its chord/curve) to `pt` within `tolPx`,
 * for Add Anchor. Returns the path + segment index and the split parameter t.
 */
function findSegment(
  shape: Shape,
  pt: Point,
  tolPx: number,
): { pathIndex: number; segIndex: number; t: number } | null {
  let best: { pathIndex: number; segIndex: number; t: number } | null = null;
  let bestD = tolPx;
  const SAMPLES = 16;
  shape.paths.forEach((path, pi) => {
    const ep = toEditable(path);
    for (let i = 1; i < ep.anchors.length; i++) {
      const p0 = ep.anchors[i - 1];
      const p1 = ep.anchors[i];
      const ctrl = ep.controls[i];
      for (let s = 0; s <= SAMPLES; s++) {
        const t = s / SAMPLES;
        const q = ctrl ? quadAt(p0, ctrl, p1, t) : lerp(p0, p1, t);
        const d = dist(q, pt);
        // Prefer interior splits (avoid the anchors themselves).
        if (d <= bestD && t > 0.05 && t < 0.95) {
          bestD = d;
          best = { pathIndex: pi, segIndex: i, t };
        }
      }
    }
  });
  return best;
}

/**
 * Add Anchor: insert a new anchor on the path segment nearest `pt`, splitting
 * that segment. A line splits into two lines; a curve splits (de Casteljau) into
 * two curves so the geometry is preserved. Returns a new Shape, or null if no
 * segment is within `tolPx`.
 */
export function addAnchorAt(
  shape: Shape,
  pt: Point,
  tolPx: number = DEFAULT_TOL_PX,
): Shape | null {
  const hit = findSegment(shape, pt, tolPx);
  if (!hit) return null;
  const path = shape.paths[hit.pathIndex];
  const ep = toEditable(path);
  const i = hit.segIndex;
  const p0 = ep.anchors[i - 1];
  const p1 = ep.anchors[i];
  const ctrl = ep.controls[i];
  const t = hit.t;

  if (!ctrl) {
    // Line → two lines at the split point.
    const mid = lerp(p0, p1, t);
    ep.anchors.splice(i, 0, mid);
    ep.controls.splice(i, 0, null); // segment into the new anchor: line
  } else {
    // Quadratic de Casteljau split at t: controls c1, c2 and split point m.
    const a = lerp(p0, ctrl, t);
    const b = lerp(ctrl, p1, t);
    const m = lerp(a, b, t);
    ep.anchors.splice(i, 0, m);
    ep.controls.splice(i, 0, a); // entering new anchor
    ep.controls[i + 1] = b;      // entering original p1 (now shifted)
  }
  const newPaths = [...shape.paths];
  newPaths[hit.pathIndex] = fromEditable(ep);
  return { ...shape, paths: newPaths };
}

/**
 * Delete Anchor: remove the anchor nearest `pt` and rejoin its neighbors with a
 * straight segment (Flash collapses the removed point). Returns a new Shape, or
 * null if no anchor is within `tolPx`. A path that would drop below 2 anchors is
 * removed entirely.
 */
export function deleteAnchorAt(
  shape: Shape,
  pt: Point,
  tolPx: number = DEFAULT_TOL_PX,
): Shape | null {
  const hit = findAnchor(shape, pt, tolPx);
  if (!hit) return null;
  const path = shape.paths[hit.pathIndex];
  const ep = toEditable(path);
  const k = hit.anchorIndex;

  if (ep.anchors.length <= 2) {
    // Removing an anchor leaves < 2 points → drop the whole path.
    const newPaths = shape.paths.filter((_, i) => i !== hit.pathIndex);
    return { ...shape, paths: newPaths };
  }

  ep.anchors.splice(k, 1);
  ep.controls.splice(k, 1);
  // The segment now entering the anchor that followed the deleted one becomes a
  // straight rejoin (its old control referenced the removed point).
  if (k < ep.controls.length) ep.controls[k] = null;
  if (k === 0) ep.controls[0] = null; // anchor 0 has no entering segment

  const newPaths = [...shape.paths];
  newPaths[hit.pathIndex] = fromEditable(ep);
  return { ...shape, paths: newPaths };
}

/**
 * Convert Anchor: toggle the anchor nearest `pt` between corner and smooth.
 *
 * - Smooth → corner: the segments touching the anchor become straight lines.
 * - Corner → smooth: those segments become curves whose control points are
 *   offset along the tangent through the anchor (rounding the corner), matching
 *   the visible effect of converting a corner point in Flash.
 *
 * Returns a new Shape, or null if no anchor is within `tolPx`.
 */
export function convertAnchorAt(
  shape: Shape,
  pt: Point,
  tolPx: number = DEFAULT_TOL_PX,
): Shape | null {
  const hit = findAnchor(shape, pt, tolPx);
  if (!hit) return null;
  const path = shape.paths[hit.pathIndex];
  const ep = toEditable(path);
  const k = hit.anchorIndex;
  const n = ep.anchors.length;

  // Segment entering anchor k (controls[k]) and segment leaving k (controls[k+1]).
  const inCtrl = k >= 1 ? ep.controls[k] : null;
  const outCtrl = k + 1 < n ? ep.controls[k + 1] : null;
  const isSmooth = !!inCtrl || !!outCtrl;

  if (isSmooth) {
    // Smooth → corner: straighten adjacent segments.
    if (k >= 1) ep.controls[k] = null;
    if (k + 1 < n) ep.controls[k + 1] = null;
  } else {
    // Corner → smooth: build a tangent through the anchor from its neighbors and
    // pull the adjacent control points along it to round the corner.
    const anchor = ep.anchors[k];
    const prev = k >= 1 ? ep.anchors[k - 1] : null;
    const next = k + 1 < n ? ep.anchors[k + 1] : null;
    const ref0 = prev ?? anchor;
    const ref1 = next ?? anchor;
    let tx = ref1.x - ref0.x;
    let ty = ref1.y - ref0.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    if (prev && k >= 1) {
      const d = dist(prev, anchor) / 3;
      ep.controls[k] = { x: anchor.x - tx * d, y: anchor.y - ty * d };
    }
    if (next && k + 1 < n) {
      const d = dist(next, anchor) / 3;
      ep.controls[k + 1] = { x: anchor.x + tx * d, y: anchor.y + ty * d };
    }
  }

  const newPaths = [...shape.paths];
  newPaths[hit.pathIndex] = fromEditable(ep);
  return { ...shape, paths: newPaths };
}
