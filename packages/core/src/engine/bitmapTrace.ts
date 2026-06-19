/**
 * Bitmap Trace — raster-to-vector contour extraction (Modify > Bitmap > Trace
 * Bitmap, Flash 8).
 *
 * Unlike the original bounding-box MVP, this tracer reconstructs the *actual
 * outline* of each color region:
 *
 *   1. Quantize every pixel to a color bucket (Color Threshold). Near-transparent
 *      pixels collapse into one transparent bucket that is dropped.
 *   2. Flood-fill connected same-color regions (4-connectivity).
 *   3. Drop regions smaller than Minimum Area.
 *   4. Trace each region's boundary with **marching squares** on a 1px-padded
 *      binary mask, yielding a closed pixel-edge polygon (corners snap to the
 *      pixel grid, so axis-aligned region edges are exact).
 *   5. Simplify the polygon with **Douglas-Peucker**; the epsilon is derived
 *      from Curve Fit (tighter fit = smaller epsilon = more vertices).
 *   6. Convert the simplified polygon into a closed, solid-filled `ShapePath`.
 *      When Curve Fit asks for smoothing, near-straight vertices are emitted as
 *      quadratic curves and sharp vertices (turn angle >= the Corner Threshold
 *      angle) are preserved as hard corners.
 *
 * The module is pure (DOM-free) and operates on already-extracted RGBA data, so
 * it is unit-testable without a canvas. The UI layer rasterizes the bitmap
 * (draw to canvas + `getImageData`) and feeds the pixel buffer in.
 *
 * Contour/simplify patterns mirror `engine/magicWand.ts` (Douglas-Peucker,
 * pixel-edge boundary tracing) for consistency across the lasso + trace tools.
 */

import type { Point, ShapePath, SolidFill } from "./types.js";

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

/** Curve-fit modes (Flash 8 "Trace Bitmap" dialog), tight → smooth. */
export type TraceCurveFit =
  | "pixels"
  | "very-tight"
  | "tight"
  | "normal"
  | "smooth"
  | "very-smooth";

/** Corner-threshold modes (Flash 8 "Trace Bitmap" dialog). */
export type TraceCornerThreshold = "many" | "normal" | "few";

export interface BitmapTraceOptions {
  /**
   * Color similarity threshold (1–500). Pixels whose quantized colors land in
   * the same bucket are merged into one region. Higher = fewer, larger regions.
   */
  colorThreshold: number;
  /** Minimum region area in pixels; smaller regions are discarded. */
  minimumArea: number;
  /** Curve-fit mode — controls Douglas-Peucker epsilon + curve emission. */
  curveFit: TraceCurveFit;
  /** Corner-threshold mode — controls which vertices stay sharp corners. */
  cornerThreshold: TraceCornerThreshold;
}

export const DEFAULT_BITMAP_TRACE_OPTIONS: BitmapTraceOptions = {
  colorThreshold: 100,
  minimumArea: 8,
  curveFit: "normal",
  cornerThreshold: "normal",
};

/** Minimal ImageData-like input (avoids a DOM dependency in unit tests). */
export interface BitmapTraceImageData {
  readonly width: number;
  readonly height: number;
  /** Flat RGBA buffer, 4 bytes/pixel, row-major. Pixel (x,y) at (y*w+x)*4. */
  readonly data: Uint8ClampedArray | Uint8Array | number[];
}

// ---------------------------------------------------------------------------
// Parameter mapping
// ---------------------------------------------------------------------------

/**
 * Douglas-Peucker epsilon (in pixels) for a curve-fit mode. Tighter fit hugs the
 * raster (small epsilon, more vertices); smoother fit collapses jaggies.
 */
export function curveFitEpsilon(mode: TraceCurveFit): number {
  switch (mode) {
    case "pixels":
      return 0; // keep every pixel-edge vertex
    case "very-tight":
      return 0.5;
    case "tight":
      return 1;
    case "normal":
      return 2;
    case "smooth":
      return 4;
    case "very-smooth":
      return 8;
    default:
      return 2;
  }
}

/** Whether a curve-fit mode should emit smooth quadratic curves. */
export function curveFitSmooths(mode: TraceCurveFit): boolean {
  return mode === "smooth" || mode === "very-smooth" || mode === "normal";
}

/**
 * Turn-angle (radians) at or above which a vertex stays a hard corner.
 * "many" keeps lots of corners (low threshold), "few" keeps almost none.
 */
export function cornerThresholdAngle(mode: TraceCornerThreshold): number {
  switch (mode) {
    case "many":
      return Math.PI / 12; // 15° — most vertices are corners
    case "normal":
      return Math.PI / 4; // 45°
    case "few":
      return (Math.PI * 2) / 3; // 120° — only very sharp vertices
    default:
      return Math.PI / 4;
  }
}

// ---------------------------------------------------------------------------
// Color quantization
// ---------------------------------------------------------------------------

function quantizeChannel(value: number, step: number): number {
  return Math.min(255, Math.round(value / step) * step);
}

/**
 * Pack a pixel's quantized RGB into a single int key. Near-transparent pixels
 * map to the sentinel -1 (collected into one transparent bucket, dropped later).
 */
function pixelKey(
  data: BitmapTraceImageData["data"],
  offset: number,
  step: number,
): number {
  const a = data[offset + 3];
  if (a < 16) return -1;
  const r = quantizeChannel(data[offset], step);
  const g = quantizeChannel(data[offset + 1], step);
  const b = quantizeChannel(data[offset + 2], step);
  return (r << 16) | (g << 8) | b;
}

function keyToColor(key: number): SolidFill["color"] {
  return {
    r: (key >> 16) & 0xff,
    g: (key >> 8) & 0xff,
    b: key & 0xff,
    a: 255,
  };
}

// ---------------------------------------------------------------------------
// Marching squares contour extraction
// ---------------------------------------------------------------------------

/**
 * Marching-squares boundary trace of a binary mask.
 *
 * The mask is treated as cell occupancy on a `(width) × (height)` grid; the
 * traced contour walks the *edges between cells* (pixel-grid coordinates), so an
 * axis-aligned region produces an exact rectangle and the polygon is the outer
 * boundary of the filled cells. Returns a closed polygon of grid points
 * (first vertex is not repeated at the end).
 *
 * Algorithm: find the first boundary corner (top-left of the first filled cell),
 * then walk edge-to-edge choosing the next direction from the 2×2 cell
 * configuration around the current grid vertex, until we return to the start.
 *
 * The walk is a CONSISTENT-HANDEDNESS loop — clockwise in screen coordinates
 * (y-down), keeping the filled region on the RIGHT of travel. At a vertex the
 * next direction is the edge whose right-hand cell is filled and left-hand cell
 * empty. For the two diagonal "saddle" configs (cases 5 and 10) both edges
 * qualify, so the ENTRY direction disambiguates the turn.
 *
 * Tracking handedness this way is what lets convex/diagonal regions (circles,
 * diamonds, ellipses, the traced-bitmap vector logos) close around their whole
 * outline. The previous per-case table ignored the entry direction and had two
 * wrong cells (case 14 and the case-10 saddle), so at a bottom/side tip the
 * walker turned up an interior line-of-symmetry chord and quit — enclosing only
 * ~half the region's true area (task 1227).
 *
 * @param mask    1 = inside region, 0 = outside (row-major, length w*h).
 * @param width   grid width in cells.
 * @param height  grid height in cells.
 */
export function marchingSquaresContour(
  mask: Uint8Array | number[],
  width: number,
  height: number,
): Point[] {
  const at = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return mask[y * width + x] ? 1 : 0;
  };

  // Find the starting cell (topmost, then leftmost filled cell). Its top-left
  // grid corner (x,y) is guaranteed to sit on the outer boundary.
  let startX = -1;
  let startY = -1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y)) {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  if (startX < 0) return [];

  // We walk along grid vertices. At a vertex (vx, vy), the four surrounding
  // cells are: TL=(vx-1,vy-1) TR=(vx,vy-1) BL=(vx-1,vy) BR=(vx,vy).
  // Directions (grid-vertex space, screen coords / y-down):
  const UP = 0;
  const RIGHT = 1;
  const DOWN = 2;
  const LEFT = 3;

  const contour: Point[] = [];
  let vx = startX;
  let vy = startY;
  // Seed the entry direction as RIGHT: the start corner is the TL of the
  // topmost-leftmost filled cell (case 2, BR-only), whose first move is RIGHT
  // along the region's top edge. Seeding RIGHT also resolves a saddle that
  // happens to sit at the very start vertex.
  let prevDir = RIGHT;
  const maxSteps = (width + 2) * (height + 2) * 4 + 8;
  let steps = 0;

  do {
    contour.push({ x: vx, y: vy });

    const tl = at(vx - 1, vy - 1);
    const tr = at(vx, vy - 1);
    const bl = at(vx - 1, vy);
    const br = at(vx, vy);

    // Marching-squares case index (TL,TR,BR,BL bits).
    const caseIdx = (tl << 3) | (tr << 2) | (br << 1) | bl;

    // Next direction so the filled region stays on our RIGHT (clockwise outer
    // walk). Derived from "for edge dir d the right-hand cell is filled, the
    // left-hand cell empty": UP→(left TL,right TR), RIGHT→(TR,BR),
    // DOWN→(BR,BL), LEFT→(BL,TL).
    let dir: number;
    switch (caseIdx) {
      // --- one filled corner ---
      case 1: // BL only
        dir = DOWN;
        break;
      case 2: // BR only
        dir = RIGHT;
        break;
      case 4: // TR only
        dir = UP;
        break;
      case 8: // TL only
        dir = LEFT;
        break;
      // --- two filled, shared edge ---
      case 3: // BL+BR (bottom row)
        dir = RIGHT;
        break;
      case 6: // TR+BR (right col)
        dir = UP;
        break;
      case 9: // TL+BL (left col)
        dir = DOWN;
        break;
      case 12: // TL+TR (top row)
        dir = LEFT;
        break;
      // --- three filled corners (single empty corner) ---
      case 7: // empty = TL
        dir = UP;
        break;
      case 11: // empty = TR
        dir = RIGHT;
        break;
      case 13: // empty = BR
        dir = DOWN;
        break;
      case 14: // empty = BL
        dir = LEFT;
        break;
      // --- saddles: ambiguous, resolve by entry direction ---
      case 5: // TR + BL filled (╱): valid UP or DOWN
        dir = prevDir === RIGHT ? UP : DOWN;
        break;
      case 10: // TL + BR filled (╲): valid RIGHT or LEFT
        dir = prevDir === DOWN ? RIGHT : LEFT;
        break;
      default:
        // 0 (empty) or 15 (full) should never occur on a boundary vertex.
        return contour;
    }

    prevDir = dir;
    switch (dir) {
      case UP:
        vy -= 1;
        break;
      case RIGHT:
        vx += 1;
        break;
      case DOWN:
        vy += 1;
        break;
      case LEFT:
        vx -= 1;
        break;
    }
    steps++;
  } while (steps < maxSteps && !(vx === startX && vy === startY));

  return contour;
}

// ---------------------------------------------------------------------------
// Douglas-Peucker
// ---------------------------------------------------------------------------

function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const nx = a.x + t * dx;
  const ny = a.y + t * dy;
  return Math.hypot(p.x - nx, p.y - ny);
}

/**
 * Douglas-Peucker simplification of an OPEN polyline. Endpoints are kept.
 */
export function simplifyPolyline(points: Point[], epsilon: number): Point[] {
  if (epsilon <= 0 || points.length <= 2) return points.slice();

  const keep = new Set<number>([0, points.length - 1]);
  const stack: Array<[number, number]> = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDist(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep.add(maxIdx);
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  return points.filter((_, i) => keep.has(i));
}

/**
 * Douglas-Peucker for a CLOSED polygon. Splits the loop at the two most distant
 * vertices, simplifies each arc, then rejoins — so no vertex is artificially
 * pinned just because it happened to be index 0.
 */
export function simplifyClosedPolygon(points: Point[], epsilon: number): Point[] {
  const n = points.length;
  if (epsilon <= 0 || n <= 3) return points.slice();

  // Anchor 1: the first vertex. Anchor 2: the vertex farthest from it.
  let farIdx = 0;
  let farDist = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
    if (d > farDist) {
      farDist = d;
      farIdx = i;
    }
  }

  const arcA = points.slice(0, farIdx + 1);
  const arcB = points.slice(farIdx).concat([points[0]]);

  const simpA = simplifyPolyline(arcA, epsilon);
  const simpB = simplifyPolyline(arcB, epsilon);

  // Rejoin: simpA is [0..far], simpB is [far..0]. Drop the duplicated shared
  // endpoints (far at the start of B, and the closing 0 at the end of B).
  const result = simpA
    .slice(0, simpA.length - 1)
    .concat(simpB.slice(0, simpB.length - 1));
  // Guarantee a valid polygon.
  return result.length >= 3 ? result : points.slice();
}

// ---------------------------------------------------------------------------
// Polygon → ShapePath (with optional curve fitting)
// ---------------------------------------------------------------------------

function turnAngle(prev: Point, cur: Point, next: Point): number {
  const ax = cur.x - prev.x;
  const ay = cur.y - prev.y;
  const bx = next.x - cur.x;
  const by = next.y - cur.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return 0;
  let cos = (ax * bx + ay * by) / (la * lb);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos); // 0 = straight, π = full reversal
}

/**
 * Convert a closed polygon to a `ShapePath`. When `smooth` is true, vertices
 * whose turn angle is below `cornerAngle` are rounded into quadratic curves
 * (the vertex becomes the curve control point, midpoints of adjacent edges
 * become anchors), while sharp vertices stay as line corners. When `smooth` is
 * false the polygon is emitted as straight line segments.
 */
export function polygonToShapePath(
  polygon: Point[],
  fill: SolidFill,
  smooth: boolean,
  cornerAngle: number,
): ShapePath | null {
  const pts = polygon;
  const n = pts.length;
  if (n < 3) return null;

  if (!smooth) {
    const segments = pts.slice(1).map((p) => ({ type: "line" as const, to: p }));
    segments.push({ type: "line" as const, to: pts[0] });
    return { start: pts[0], segments, closed: true, fill };
  }

  // Smooth: classify each vertex as corner (keep sharp) or smooth (round).
  const isCorner = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    isCorner[i] = turnAngle(prev, cur, next) >= cornerAngle;
  }

  const mid = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  type Seg = { type: "line"; to: Point } | { type: "curve"; control: Point; to: Point };

  // First pass: flatten each vertex into the (pen-point, optional-segment)
  // pairs it contributes. A corner contributes a single point; a smooth vertex
  // contributes its entry midpoint (a line target) and a curve through it to the
  // exit midpoint. The resulting `points` list, walked in order, gives the path.
  const ops: Array<{ pt: Point; curveControl?: Point }> = [];
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    if (isCorner[i]) {
      ops.push({ pt: cur });
    } else {
      ops.push({ pt: mid(prev, cur) });
      ops.push({ pt: mid(cur, next), curveControl: cur });
    }
  }
  if (ops.length < 2) return null;

  const start: Point = ops[0].pt;
  let pen: Point = start;
  const segments: Seg[] = [];
  for (let i = 1; i < ops.length; i++) {
    const op = ops[i];
    if (op.curveControl) {
      segments.push({ type: "curve", control: op.curveControl, to: op.pt });
    } else if (pen.x !== op.pt.x || pen.y !== op.pt.y) {
      segments.push({ type: "line", to: op.pt });
    }
    pen = op.pt;
  }
  // Close the loop back to the start point.
  if (pen.x !== start.x || pen.y !== start.y) {
    segments.push({ type: "line", to: start });
  }
  if (segments.length < 2) return null;
  return { start, segments, closed: true, fill };
}

// ---------------------------------------------------------------------------
// ShapePath id helper
// ---------------------------------------------------------------------------

let _traceCounter = 0;
/** Generate a unique id for a traced shape (avoids importing from shapes.ts). */
export function nextTraceShapeId(): string {
  return `trace-shape-${++_traceCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Top-level tracer
// ---------------------------------------------------------------------------

/**
 * Trace a bitmap into a list of closed, solid-filled contour `ShapePath`s — one
 * (or more) per connected color region. Region pixel coordinates map 1:1 to the
 * output path coordinates (the UI applies the bitmap's stage offset).
 *
 * @param imageData RGBA pixel buffer (width × height × 4).
 * @param options   trace parameters (defaults applied for omitted fields).
 */
export function traceBitmapToPaths(
  imageData: BitmapTraceImageData,
  options: Partial<BitmapTraceOptions> = {},
): ShapePath[] {
  const opts: BitmapTraceOptions = { ...DEFAULT_BITMAP_TRACE_OPTIONS, ...options };
  const { width, height, data } = imageData;
  const totalPixels = width * height;
  if (totalPixels === 0) return [];

  // 1. Quantize: threshold 1..500 → quantization step. Lower threshold keeps
  //    more color detail (finer buckets).
  const step = Math.max(1, Math.floor(opts.colorThreshold / 4));
  const keys = new Int32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    keys[i] = pixelKey(data, i * 4, step);
  }

  // 2. Flood-fill connected regions of identical color key.
  const labels = new Int32Array(totalPixels).fill(-1);
  const regions: Array<{ key: number; pixels: number[] }> = [];
  const stack: number[] = [];

  for (let start = 0; start < totalPixels; start++) {
    if (labels[start] !== -1) continue;
    const targetKey = keys[start];
    const label = regions.length;
    const region = { key: targetKey, pixels: [] as number[] };
    regions.push(region);
    stack.length = 0;
    stack.push(start);

    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (labels[idx] !== -1) continue;
      if (keys[idx] !== targetKey) continue;
      labels[idx] = label;
      region.pixels.push(idx);
      const px = idx % width;
      const py = (idx - px) / width;
      if (px > 0) stack.push(idx - 1);
      if (px < width - 1) stack.push(idx + 1);
      if (py > 0) stack.push(idx - width);
      if (py < height - 1) stack.push(idx + width);
    }
  }

  // 3–6. Trace + simplify + emit paths.
  const epsilon = curveFitEpsilon(opts.curveFit);
  const smooth = curveFitSmooths(opts.curveFit);
  const cornerAngle = cornerThresholdAngle(opts.cornerThreshold);
  const paths: ShapePath[] = [];

  for (const region of regions) {
    if (region.key === -1) continue; // transparent bucket
    if (region.pixels.length < opts.minimumArea) continue;

    // Build a tight binary mask (region-local bounding box) so tracing cost
    // scales with the region, not the whole image.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const idx of region.pixels) {
      const px = idx % width;
      const py = (idx - px) / width;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const mw = maxX - minX + 1;
    const mh = maxY - minY + 1;
    const mask = new Uint8Array(mw * mh);
    for (const idx of region.pixels) {
      const px = idx % width;
      const py = (idx - px) / width;
      mask[(py - minY) * mw + (px - minX)] = 1;
    }

    let contour = marchingSquaresContour(mask, mw, mh);
    if (contour.length < 3) continue;

    // Translate contour back into full-image pixel coordinates.
    contour = contour.map((p) => ({ x: p.x + minX, y: p.y + minY }));

    if (epsilon > 0) {
      contour = simplifyClosedPolygon(contour, epsilon);
    }
    if (contour.length < 3) continue;

    const fill: SolidFill = { type: "solid", color: keyToColor(region.key) };
    const path = polygonToShapePath(contour, fill, smooth, cornerAngle);
    if (path) paths.push(path);
  }

  return paths;
}

/** Wrap traced paths into a Shape-compatible structure with a generated id. */
export function tracedPathsToShape(paths: ShapePath[]): {
  id: string;
  paths: readonly ShapePath[];
} {
  return { id: nextTraceShapeId(), paths };
}
