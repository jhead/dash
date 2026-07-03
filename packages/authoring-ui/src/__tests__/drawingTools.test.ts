/**
 * Unit tests for drawing tool helper logic in StageArea.tsx.
 *
 * Since the helpers (pencilPointsToShape, brushPointsToShape, etc.) are
 * module-private, we test the equivalent logic extracted here to verify
 * correctness of:
 *   - pencil stroke alpha propagation
 *   - paint bucket No Color (remove fill) behavior
 *   - ink bottle stroke removal (alpha=0 / width=0)
 *   - pen anchors-to-path conversion (line + curve segments)
 *   - lasso point-in-polygon selection
 *   - brush path perpendicular extrusion
 */

import { describe, it, expect } from "vitest";
import type { BitmapFill, Fill, SolidStroke, ShapePath, ShapeDisplayObject, Point } from "@flash/core";
import { transformedShapeBounds, buildBrushRibbon, type BrushStampSample } from "@flash/core";

// ---------------------------------------------------------------------------
// Inline copies of the pure helper logic from StageArea.tsx
// These must stay in sync with the source.
// ---------------------------------------------------------------------------

function smoothPoints(points: Point[], passes: number): Point[] {
  let pts = [...points];
  for (let p = 0; p < passes; p++) {
    const smoothed: Point[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      smoothed.push({
        x: (pts[i - 1].x + pts[i].x + pts[i + 1].x) / 3,
        y: (pts[i - 1].y + pts[i].y + pts[i + 1].y) / 3,
      });
    }
    smoothed.push(pts[pts.length - 1]);
    pts = smoothed;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Straighten mode — shape recognition helpers (inline copy from StageArea.tsx)
// ---------------------------------------------------------------------------

interface StrokeAnalysis {
  isClosed: boolean;
  aspectRatio: number;
  cornerCount: number;
  totalAngle: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  corners: Point[];
}

function analyzeStroke(points: Point[]): StrokeAnalysis {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  const bbox = { minX, minY, maxX, maxY };
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const aspectRatio = width / height;
  const endDist = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y
  );
  const isClosed = endDist < 15;
  const step = Math.max(1, Math.floor(points.length / 40));
  const raw: Point[] = [];
  for (let i = 0; i < points.length; i += step) raw.push(points[i]);
  if (raw[raw.length - 1] !== points[points.length - 1]) {
    raw.push(points[points.length - 1]);
  }
  const sampled: Point[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y) > 0.5) {
      sampled.push(raw[i]);
    }
  }
  let totalAngle = 0;
  let cornerCount = 0;
  const corners: Point[] = [];
  const CORNER_THRESH = Math.PI / 3;
  for (let i = 1; i < sampled.length - 1; i++) {
    const ax = sampled[i].x - sampled[i - 1].x;
    const ay = sampled[i].y - sampled[i - 1].y;
    const bx = sampled[i + 1].x - sampled[i].x;
    const by = sampled[i + 1].y - sampled[i].y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1 || lb < 1) continue;
    const dot = (ax * bx + ay * by) / (la * lb);
    const cross = (ax * by - ay * bx) / (la * lb);
    const angle = Math.atan2(cross, dot);
    totalAngle += angle;
    if (Math.abs(angle) > CORNER_THRESH) {
      cornerCount++;
      corners.push(sampled[i]);
    }
  }
  return { isClosed, aspectRatio, cornerCount, totalAngle, bbox, corners };
}

function recognizeShape(
  analysis: StrokeAnalysis
): "line" | "rect" | "oval" | "triangle" | "freehand" {
  if (!analysis.isClosed) return "line";
  const absAngle = Math.abs(analysis.totalAngle);
  if (absAngle > Math.PI * 1.5) {
    if (analysis.cornerCount === 3) return "triangle";
    if (analysis.cornerCount >= 4 && analysis.cornerCount <= 6) return "rect";
    return "oval";
  }
  return "freehand";
}

function buildRectPath(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  stroke: SolidStroke
): ShapePath {
  const { minX, minY, maxX, maxY } = bbox;
  return {
    start: { x: minX, y: minY },
    segments: [
      { type: "line", to: { x: maxX, y: minY } },
      { type: "line", to: { x: maxX, y: maxY } },
      { type: "line", to: { x: minX, y: maxY } },
      { type: "line", to: { x: minX, y: minY } },
    ],
    closed: true,
    stroke,
  };
}

function buildOvalPath(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  stroke: SolidStroke,
  segments: number = 16
): ShapePath {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const rx = (bbox.maxX - bbox.minX) / 2;
  const ry = (bbox.maxY - bbox.minY) / 2;
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    pts.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  return {
    start: pts[0],
    segments: pts.slice(1).map((pt) => ({ type: "line" as const, to: pt })),
    closed: true,
    stroke,
  };
}

function buildTrianglePath(corners: Point[], stroke: SolidStroke): ShapePath {
  if (corners.length < 3) return buildRectPath({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, stroke);
  const [a, b, c] = corners;
  return {
    start: a,
    segments: [
      { type: "line", to: b },
      { type: "line", to: c },
      { type: "line", to: a },
    ],
    closed: true,
    stroke,
  };
}

function buildLinePath(start: Point, end: Point, stroke: SolidStroke): ShapePath {
  return {
    start,
    segments: [{ type: "line", to: end }],
    closed: false,
    stroke,
  };
}

function pencilPointsToShape(
  points: Point[],
  stroke: SolidStroke,
  mode: "straighten" | "smooth" | "ink"
): { id: string; paths: ShapePath[] } {
  if (points.length < 2) return { id: "draw-empty", paths: [] };
  let processedPoints = points;
  if (mode === "smooth") {
    processedPoints = smoothPoints(points, 3);
  } else if (mode === "straighten") {
    const analysis = analyzeStroke(points);
    const recognized = recognizeShape(analysis);

    let path: ShapePath;
    switch (recognized) {
      case "rect":
        path = buildRectPath(analysis.bbox, stroke);
        break;
      case "oval":
        path = buildOvalPath(analysis.bbox, stroke);
        break;
      case "triangle": {
        const triCorners =
          analysis.corners.length >= 3
            ? analysis.corners.slice(0, 3)
            : [
                { x: analysis.bbox.minX, y: analysis.bbox.maxY },
                { x: (analysis.bbox.minX + analysis.bbox.maxX) / 2, y: analysis.bbox.minY },
                { x: analysis.bbox.maxX, y: analysis.bbox.maxY },
              ];
        path = buildTrianglePath(triCorners, stroke);
        break;
      }
      case "line":
      default: {
        const dx = points[points.length - 1].x - points[0].x;
        const dy = points[points.length - 1].y - points[0].y;
        const len = Math.hypot(dx, dy);
        let maxDev = 0;
        for (const pt of points) {
          const t = ((pt.x - points[0].x) * dx + (pt.y - points[0].y) * dy) / (len * len || 1);
          const projX = points[0].x + t * dx;
          const projY = points[0].y + t * dy;
          maxDev = Math.max(maxDev, Math.hypot(pt.x - projX, pt.y - projY));
        }
        if (maxDev < 10) {
          path = buildLinePath(points[0], points[points.length - 1], stroke);
        } else {
          processedPoints = smoothPoints(points, 1);
          path = {
            start: processedPoints[0],
            segments: processedPoints.slice(1).map((pt) => ({ type: "line" as const, to: pt })),
            closed: false,
            stroke,
          };
        }
        break;
      }
    }
    return { id: "draw-1", paths: [path] };
  }
  const path: ShapePath = {
    start: processedPoints[0],
    segments: processedPoints.slice(1).map((pt) => ({ type: "line" as const, to: pt })),
    closed: false,
    stroke,
  };
  return { id: "draw-1", paths: [path] };
}

// The brush ribbon is now built by the shared `@flash/core` stamp-union builder
// (task 1426): a nib disk per sample + a bridging capsule per segment, each a
// distinct-Fill simple loop so fill sampling resolves them as a UNION. This thin
// wrapper mirrors StageArea's `brushPointsToShape` (constant nib half-width; no
// pressure/tilt in these geometry tests).
function brushPointsToShape(
  points: Point[],
  brushSize: number,
  fill: Fill,
  nib: "round" | "square" = "round"
): { id: string; paths: ShapePath[] } {
  const half = brushSize / 2;
  const samples: BrushStampSample[] = points.map((p) => ({ x: p.x, y: p.y, half }));
  return buildBrushRibbon("draw-1", samples, fill, nib) as { id: string; paths: ShapePath[] };
}

function anchorsToShapePath(
  anchors: { x: number; y: number; handleOut?: { x: number; y: number } }[],
  fill: Fill | undefined,
  stroke: SolidStroke | undefined,
): ShapePath {
  if (anchors.length < 1) {
    return { start: { x: 0, y: 0 }, segments: [], closed: false };
  }
  const start = { x: anchors[0].x, y: anchors[0].y };
  const segments: ShapePath["segments"][number][] = [];
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    if (prev.handleOut) {
      segments.push({ type: "curve", control: prev.handleOut, to: { x: curr.x, y: curr.y } });
    } else {
      segments.push({ type: "line", to: { x: curr.x, y: curr.y } });
    }
  }
  return {
    start,
    segments,
    closed: true,
    ...(fill !== undefined ? { fill } : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };
}

function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findShapeInLasso(polygon: Point[], objects: ShapeDisplayObject[]): string | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    const bounds = transformedShapeBounds(obj);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    if (pointInPolygon(cx, cy, polygon)) {
      return obj.id;
    }
  }
  return null;
}

/** Simulate the ink bottle stroke-update logic from StageArea.tsx */
function inkBottleApply(
  shape: { paths: ShapePath[] },
  strokeColor: string,
  strokeAlpha: number,
  strokeWidth: number
): { paths: ShapePath[] } {
  function hexToColorSimple(hex: string, alpha = 255) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b, a: alpha };
  }
  const newStroke: SolidStroke | null = (strokeAlpha > 0 && strokeWidth > 0)
    ? {
        type: "solid",
        color: hexToColorSimple(strokeColor, Math.round((strokeAlpha / 100) * 255)),
        width: strokeWidth,
        caps: "round",
        joints: "round",
        miterLimit: 3,
      }
    : null;
  const newPaths = shape.paths.map((p) => ({ ...p, stroke: newStroke ?? undefined }));
  return { ...shape, paths: newPaths };
}

/** Simulate the paint bucket fill-update logic from StageArea.tsx */
function paintBucketApply(
  shape: { paths: ShapePath[] },
  fill: Fill | null
): { paths: ShapePath[] } {
  if (fill) {
    const newPaths = shape.paths.map((p) => ({ ...p, fill }));
    return { ...shape, paths: newPaths };
  } else {
    // No Color: remove fill
    const newPaths = shape.paths.map((p) => {
      const { fill: _fill, ...rest } = p;
      return rest as typeof p;
    });
    return { ...shape, paths: newPaths };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RED: Fill = { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } };
const BLUE: Fill = { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } };
const STROKE_BLACK: SolidStroke = {
  type: "solid",
  color: { r: 0, g: 0, b: 0, a: 255 },
  width: 2,
  caps: "round",
  joints: "round",
  miterLimit: 3,
};

function makeSimplePath(fill?: Fill, stroke?: SolidStroke): ShapePath {
  return {
    start: { x: 0, y: 0 },
    segments: [
      { type: "line", to: { x: 100, y: 0 } },
      { type: "line", to: { x: 100, y: 100 } },
      { type: "line", to: { x: 0, y: 100 } },
    ],
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };
}

function makeShapeDisplayObject(
  id: string,
  x: number,
  y: number,
  fill?: Fill,
  stroke?: SolidStroke
): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: { id, paths: [makeSimplePath(fill, stroke)] },
    x,
    y,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pencil tool", () => {
  it("creates a path with one segment per point in ink mode", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }];
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "ink");
    expect(shape.paths).toHaveLength(1);
    const path = shape.paths[0];
    expect(path.stroke).toBe(STROKE_BLACK);
    expect(path.closed).toBe(false);
    expect(path.segments).toHaveLength(2);
    expect(path.start).toEqual({ x: 0, y: 0 });
    expect(path.segments[1].to).toEqual({ x: 20, y: 5 });
  });

  it("returns empty paths for fewer than 2 points", () => {
    const shape = pencilPointsToShape([{ x: 0, y: 0 }], STROKE_BLACK, "ink");
    expect(shape.paths).toHaveLength(0);
  });

  it("straighten mode collapses near-line strokes to 2 points", () => {
    // Points very close to the diagonal 0,0 → 100,100
    const pts = [
      { x: 0, y: 0 }, { x: 25, y: 25 }, { x: 50, y: 50 }, { x: 75, y: 75 }, { x: 100, y: 100 },
    ];
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    expect(shape.paths[0].segments).toHaveLength(1); // only 2 points: start + 1 segment
  });

  it("smooth mode returns same start/end points", () => {
    const pts = [
      { x: 0, y: 0 }, { x: 25, y: 50 }, { x: 50, y: 20 }, { x: 75, y: 60 }, { x: 100, y: 0 },
    ];
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "smooth");
    expect(shape.paths[0].start).toEqual({ x: 0, y: 0 });
    const lastSeg = shape.paths[0].segments[shape.paths[0].segments.length - 1];
    expect(lastSeg.to).toEqual({ x: 100, y: 0 });
  });

  it("stroke includes alpha from the stroke object", () => {
    const semiStroke: SolidStroke = { ...STROKE_BLACK, color: { r: 0, g: 0, b: 0, a: 128 } };
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
    const shape = pencilPointsToShape(pts, semiStroke, "ink");
    expect(shape.paths[0].stroke?.color.a).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Shape recognition — straighten mode geometric primitives
// ---------------------------------------------------------------------------

/** Build a dense rectangular stroke by walking the 4 sides with many points. */
function makeRectStroke(
  x0: number, y0: number, x1: number, y1: number, steps = 20
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) pts.push({ x: x0 + (x1 - x0) * i / steps, y: y0 });
  for (let i = 0; i <= steps; i++) pts.push({ x: x1, y: y0 + (y1 - y0) * i / steps });
  for (let i = 0; i <= steps; i++) pts.push({ x: x1 + (x0 - x1) * i / steps, y: y1 });
  for (let i = 0; i <= steps; i++) pts.push({ x: x0, y: y1 + (y0 - y1) * i / steps });
  // Close to near start
  pts.push({ x: x0 + 2, y: y0 + 2 });
  return pts;
}

/** Build a dense circular stroke with N samples. */
function makeCircleStroke(cx: number, cy: number, r: number, samples = 60): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const a = (2 * Math.PI * i) / samples;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  // Close near start
  pts.push({ x: cx + r + 2, y: cy + 2 });
  return pts;
}

/** Build a dense triangle stroke. */
function makeTriangleStroke(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  steps = 15
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) pts.push({ x: ax + (bx - ax) * i / steps, y: ay + (by - ay) * i / steps });
  for (let i = 0; i <= steps; i++) pts.push({ x: bx + (cx - bx) * i / steps, y: by + (cy - by) * i / steps });
  for (let i = 0; i <= steps; i++) pts.push({ x: cx + (ax - cx) * i / steps, y: cy + (ay - cy) * i / steps });
  pts.push({ x: ax + 2, y: ay + 2 });
  return pts;
}

describe("Pencil tool — straighten shape recognition", () => {
  it("analyzeStroke detects closed stroke", () => {
    const pts = makeRectStroke(0, 0, 100, 50);
    const analysis = analyzeStroke(pts);
    expect(analysis.isClosed).toBe(true);
  });

  it("analyzeStroke detects open (line) stroke", () => {
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 100 }];
    const analysis = analyzeStroke(pts);
    expect(analysis.isClosed).toBe(false);
  });

  it("recognizeShape returns 'line' for open stroke", () => {
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 100 }];
    expect(recognizeShape(analyzeStroke(pts))).toBe("line");
  });

  it("recognizeShape returns 'rect' for rectangular stroke", () => {
    const pts = makeRectStroke(0, 0, 100, 50);
    const result = recognizeShape(analyzeStroke(pts));
    expect(result).toBe("rect");
  });

  it("recognizeShape returns 'oval' for circular stroke", () => {
    const pts = makeCircleStroke(50, 50, 40);
    const result = recognizeShape(analyzeStroke(pts));
    expect(result).toBe("oval");
  });

  it("straighten recognizes rectangle strokes and produces 4 corner segments", () => {
    const pts = makeRectStroke(0, 0, 100, 50);
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    expect(shape.paths).toHaveLength(1);
    const path = shape.paths[0];
    expect(path.closed).toBe(true);
    // 4 corner segments: top-right, bottom-right, bottom-left, back to top-left
    expect(path.segments).toHaveLength(4);
  });

  it("straighten rect path uses bounding box corners", () => {
    const pts = makeRectStroke(10, 20, 110, 70);
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    const path = shape.paths[0];
    expect(path.start).toEqual({ x: 10, y: 20 });
    // Last corner should close back to (10, 20)
    const lastSeg = path.segments[path.segments.length - 1];
    expect(lastSeg.to).toEqual({ x: 10, y: 20 });
  });

  it("straighten recognizes oval strokes and produces 16+ segments", () => {
    const pts = makeCircleStroke(50, 50, 40);
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    expect(shape.paths).toHaveLength(1);
    const path = shape.paths[0];
    expect(path.closed).toBe(true);
    // 16 segments polygon for oval
    expect(path.segments.length).toBeGreaterThanOrEqual(16);
  });

  it("straighten recognizes triangle strokes and produces closed 3-corner shape", () => {
    const pts = makeTriangleStroke(50, 0, 100, 100, 0, 100);
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    expect(shape.paths).toHaveLength(1);
    const path = shape.paths[0];
    expect(path.closed).toBe(true);
    expect(path.segments).toHaveLength(3);
  });

  it("buildRectPath creates correct bounding-box rectangle", () => {
    const bbox = { minX: 5, minY: 10, maxX: 55, maxY: 35 };
    const path = buildRectPath(bbox, STROKE_BLACK);
    expect(path.start).toEqual({ x: 5, y: 10 });
    expect(path.segments).toHaveLength(4);
    expect(path.segments[0].to).toEqual({ x: 55, y: 10 }); // top-right
    expect(path.segments[1].to).toEqual({ x: 55, y: 35 }); // bottom-right
    expect(path.segments[2].to).toEqual({ x: 5, y: 35 });  // bottom-left
    expect(path.segments[3].to).toEqual({ x: 5, y: 10 });  // back to start
    expect(path.closed).toBe(true);
  });

  it("buildOvalPath creates closed polygon with correct center approximation", () => {
    const bbox = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const path = buildOvalPath(bbox, STROKE_BLACK);
    expect(path.closed).toBe(true);
    // 16 segments by default (17 pts including wrap-around closing point)
    expect(path.segments).toHaveLength(16);
    // Start point should be on the right of the circle (angle 0)
    expect(path.start.x).toBeCloseTo(100, 0); // cx + rx = 50 + 50
    expect(path.start.y).toBeCloseTo(50, 0);  // cy
  });

  it("buildTrianglePath creates 3-sided closed shape", () => {
    const corners: Point[] = [{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const path = buildTrianglePath(corners, STROKE_BLACK);
    expect(path.start).toEqual({ x: 50, y: 0 });
    expect(path.segments).toHaveLength(3);
    expect(path.segments[0].to).toEqual({ x: 100, y: 100 });
    expect(path.segments[1].to).toEqual({ x: 0, y: 100 });
    expect(path.segments[2].to).toEqual({ x: 50, y: 0 }); // closes
    expect(path.closed).toBe(true);
  });

  it("straighten stroke preserves stroke style on recognized rect", () => {
    const pts = makeRectStroke(0, 0, 100, 50);
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    expect(shape.paths[0].stroke).toBe(STROKE_BLACK);
  });

  it("straighten stroke preserves stroke style on recognized oval", () => {
    const pts = makeCircleStroke(50, 50, 40);
    const shape = pencilPointsToShape(pts, STROKE_BLACK, "straighten");
    expect(shape.paths[0].stroke).toBe(STROKE_BLACK);
  });
});

/** All anchors (start + segment endpoints) across every path of a shape. */
function allAnchors(shape: { paths: ShapePath[] }): Point[] {
  const out: Point[] = [];
  for (const p of shape.paths) {
    out.push(p.start, ...p.segments.map((s) => s.to));
  }
  return out;
}

describe("Brush tool (stamp-union ribbon — task 1426)", () => {
  it("creates closed filled stamp loops from brush points", () => {
    const pts = [
      { x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 },
    ];
    const shape = brushPointsToShape(pts, 10, RED);
    // A capsule per segment + the end-cap disks. On a COLLINEAR run the interior
    // disk is exactly covered by the two bridge quads (which share the same
    // canonical end-edge diameter — task 1434) and is skipped:
    // 2 end disks + 2 capsules = 4 loops.
    expect(shape.paths).toHaveLength(4);
    for (const p of shape.paths) {
      expect(p.closed).toBe(true);
      expect(p.segments.length).toBeGreaterThan(0);
    }
    // Every loop carries the SAME fill VALUE but a DISTINCT Fill OBJECT (so build
    // sampling groups each as its own region → last-covering-wins UNION).
    for (const p of shape.paths) {
      expect(p.fill).toEqual(RED);
      expect(p.fill).not.toBe(RED);
    }
    expect(new Set(shape.paths.map((p) => p.fill)).size).toBe(shape.paths.length);
  });

  it("returns empty paths only for zero points", () => {
    const shape = brushPointsToShape([], 8, RED);
    expect(shape.paths).toHaveLength(0);
  });

  it("a single dab produces a ROUND circle, not a rectangle (Flash 8 round nib)", () => {
    const shape = brushPointsToShape([{ x: 50, y: 50 }], 20, RED);
    expect(shape.paths).toHaveLength(1);
    const path = shape.paths[0];
    expect(path.closed).toBe(true);
    // Round dab is a FINE INSCRIBED POLYGON on the true circle (>=40 line
    // segments, <=0.31% sagitta — task 1434). The old 4-quadratic disk was a
    // +6.07% SQUIRCLE (corner control points), visibly fat at the diagonals.
    expect(path.segments.every((s) => s.type === "line")).toBe(true);
    expect(path.segments.length).toBeGreaterThanOrEqual(40);

    // Geometry must lie ON the circle of radius brushSize/2 (=10) about (50,50):
    // every vertex is radius from center (+- the twip snap the stamp bakes in).
    const radius = 10;
    const anchors = [path.start, ...path.segments.map((s) => s.to)];
    for (const a of anchors) {
      const d = Math.hypot(a.x - 50, a.y - 50);
      expect(Math.abs(d - radius)).toBeLessThan(0.05);
    }
    // Bounding box is the full diameter in BOTH axes (a circle, not a sliver).
    const xs = anchors.map((p) => p.x);
    const ys = anchors.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * radius, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * radius, 1);
  });

  it("a single SQUARE dab produces an axis-aligned square (line segments)", () => {
    const shape = brushPointsToShape([{ x: 50, y: 50 }], 20, RED, "square");
    expect(shape.paths).toHaveLength(1);
    expect(shape.paths[0].segments.every((s) => s.type === "line")).toBe(true);
  });

  it("perpendicular extrusion creates width roughly equal to brushSize", () => {
    const pts = [{ x: 0, y: 50 }, { x: 100, y: 50 }]; // horizontal line, half=10
    const shape = brushPointsToShape(pts, 20, RED);
    const ys = allAnchors(shape).map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 0);
  });

  it("a straight stroke has ROUND end caps (the end nib disks bulge past the tips)", () => {
    const pts = [{ x: 0, y: 50 }, { x: 100, y: 50 }]; // horizontal line, half=10
    const shape = brushPointsToShape(pts, 20, RED);
    // The end/start nib disks reach half PAST the last/first samples: x=110 / x=-10.
    const xs = allAnchors(shape).map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(110, 5); // 100 + half(10)
    expect(Math.min(...xs)).toBeCloseTo(-10, 5); // 0 - half(10)
    // The caps are round POLYGONAL disks (task 1434: all-line construction —
    // curve arcs formed near-tangent triples with the capsule sides that twip
    // snapping fragmented). Each cap contributes a fine half-circle fan: many
    // vertices at nib radius from the end samples.
    const anchors = allAnchors(shape);
    const onEndCircles = anchors.filter((p) => {
      const d0 = Math.hypot(p.x - 0, p.y - 50);
      const d1 = Math.hypot(p.x - 100, p.y - 50);
      return Math.abs(d0 - 10) < 0.05 || Math.abs(d1 - 10) < 0.05;
    });
    expect(onEndCircles.length).toBeGreaterThanOrEqual(40); // 2 caps x >=20 verts
  });
});

// ---------------------------------------------------------------------------
// Pen tool commit helpers — simulate the stroke-build logic from StageArea.tsx
// ---------------------------------------------------------------------------

function buildPenStroke(
  strokeColor: string,
  strokeAlpha: number,
  strokeWidth: number
): SolidStroke | undefined {
  if (strokeAlpha <= 0 || strokeWidth <= 0) return undefined;
  function hexToColorSimple(hex: string, alpha = 255) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b, a: alpha };
  }
  return {
    type: "solid",
    color: hexToColorSimple(strokeColor, Math.round((strokeAlpha / 100) * 255)),
    width: strokeWidth,
    caps: "round",
    joints: "round",
    miterLimit: 3,
  };
}

/** Simulate the close-path commit: 3 anchors → closed shape. */
function simulatePenClosePath(
  anchors: { x: number; y: number; handleOut?: { x: number; y: number } }[],
  fill: Fill | null,
  strokeColor: string,
  strokeAlpha: number,
  strokeWidth: number
): { id: string; paths: ShapePath[] } {
  const penStroke = buildPenStroke(strokeColor, strokeAlpha, strokeWidth);
  const shapePath = anchorsToShapePath(anchors, fill ?? undefined, penStroke);
  return { id: "shape-pen-test", paths: [shapePath] };
}

/** Simulate the double-click commit: anchors → open shape. */
function simulatePenDoubleClickCommit(
  anchors: { x: number; y: number; handleOut?: { x: number; y: number } }[],
  fill: Fill | null,
  strokeColor: string,
  strokeAlpha: number,
  strokeWidth: number
): { id: string; paths: ShapePath[] } {
  const penStroke = buildPenStroke(strokeColor, strokeAlpha, strokeWidth);
  const shapePath = anchorsToShapePath(anchors, fill ?? undefined, penStroke);
  const openPath = { ...shapePath, closed: false };
  return { id: "shape-pen-test", paths: [openPath] };
}

describe("Pen tool", () => {
  it("creates straight line segments when no handleOut", () => {
    const anchors = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 50 },
    ];
    const path = anchorsToShapePath(anchors, RED, undefined);
    expect(path.start).toEqual({ x: 0, y: 0 });
    expect(path.segments).toHaveLength(2);
    expect(path.segments[0]).toEqual({ type: "line", to: { x: 50, y: 0 } });
    expect(path.segments[1]).toEqual({ type: "line", to: { x: 100, y: 50 } });
    expect(path.closed).toBe(true);
    expect(path.fill).toBe(RED);
  });

  it("creates curve segments when handleOut is provided", () => {
    const anchors = [
      { x: 0, y: 0, handleOut: { x: 0, y: -30 } },
      { x: 100, y: 0 },
    ];
    const path = anchorsToShapePath(anchors, undefined, STROKE_BLACK);
    expect(path.segments[0]).toEqual({
      type: "curve",
      control: { x: 0, y: -30 },
      to: { x: 100, y: 0 },
    });
  });

  it("returns empty path for zero anchors", () => {
    const path = anchorsToShapePath([], undefined, undefined);
    expect(path.segments).toHaveLength(0);
  });

  it("applies fill and stroke correctly", () => {
    const anchors = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const path = anchorsToShapePath(anchors, RED, STROKE_BLACK);
    expect(path.fill).toBe(RED);
    expect(path.stroke).toBe(STROKE_BLACK);
  });

  it("close-path commit: 3 clicks produces closed shape with current stroke/fill", () => {
    const anchors = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 55, y: 80 },
    ];
    const shape = simulatePenClosePath(anchors, RED, "#0000ff", 100, 2);
    expect(shape.paths).toHaveLength(1);
    const path = shape.paths[0];
    expect(path.closed).toBe(true);
    expect(path.segments).toHaveLength(2);
    expect(path.start).toEqual({ x: 10, y: 10 });
    expect(path.fill).toBe(RED);
    expect(path.stroke).toBeDefined();
    expect(path.stroke?.width).toBe(2);
    expect(path.stroke?.color.b).toBe(255); // #0000ff
  });

  it("double-click commit: produces open (unclosed) path", () => {
    const anchors = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ];
    const shape = simulatePenDoubleClickCommit(anchors, null, "#000000", 100, 1);
    expect(shape.paths).toHaveLength(1);
    expect(shape.paths[0].closed).toBe(false);
    expect(shape.paths[0].segments).toHaveLength(2);
  });

  it("close-path commit: no stroke when strokeAlpha is 0", () => {
    const anchors = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const shape = simulatePenClosePath(anchors, RED, "#000000", 0, 2);
    expect(shape.paths[0].stroke).toBeUndefined();
  });

  it("close-path commit: no fill when fill is null (No Color)", () => {
    const anchors = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const shape = simulatePenClosePath(anchors, null, "#000000", 100, 1);
    expect(shape.paths[0].fill).toBeUndefined();
  });

  it("close-path commit: curve segment preserved from handleOut", () => {
    const anchors = [
      { x: 0, y: 0, handleOut: { x: 50, y: -50 } },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];
    const shape = simulatePenClosePath(anchors, RED, "#000000", 100, 1);
    expect(shape.paths[0].segments[0].type).toBe("curve");
    expect((shape.paths[0].segments[0] as { type: "curve"; control: { x: number; y: number }; to: { x: number; y: number } }).control).toEqual({ x: 50, y: -50 });
  });
});

describe("Lasso tool", () => {
  it("point-in-polygon: center point inside a square", () => {
    const square: Point[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    expect(pointInPolygon(50, 50, square)).toBe(true);
  });

  it("point-in-polygon: point outside a square", () => {
    const square: Point[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    expect(pointInPolygon(150, 50, square)).toBe(false);
  });

  it("findShapeInLasso selects shape whose center is inside the polygon", () => {
    const obj = makeShapeDisplayObject("shape-1", 20, 20, RED);
    // Center of obj = 20 + 50, 20 + 50 = (70, 70) — inside the large square
    const polygon: Point[] = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ];
    expect(findShapeInLasso(polygon, [obj])).toBe("shape-1");
  });

  it("findShapeInLasso returns null when shape center is outside polygon", () => {
    const obj = makeShapeDisplayObject("shape-1", 20, 20, RED);
    // Small polygon that does NOT contain center (70, 70)
    const polygon: Point[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(findShapeInLasso(polygon, [obj])).toBeNull();
  });

  it("findShapeInLasso picks last object (top of stack) when multiple overlap", () => {
    const obj1 = makeShapeDisplayObject("shape-1", 20, 20, RED);
    const obj2 = makeShapeDisplayObject("shape-2", 20, 20, BLUE);
    const polygon: Point[] = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 },
    ];
    // findShapeInLasso iterates from last to first, so obj2 should win
    expect(findShapeInLasso(polygon, [obj1, obj2])).toBe("shape-2");
  });
});

describe("Ink Bottle tool", () => {
  it("applies stroke color and width to all paths", () => {
    const shape = { paths: [makeSimplePath(RED)] };
    const result = inkBottleApply(shape, "#ff0000", 100, 3);
    expect(result.paths[0].stroke).toBeDefined();
    expect(result.paths[0].stroke?.width).toBe(3);
    expect(result.paths[0].stroke?.color.r).toBe(255);
    expect(result.paths[0].stroke?.color.a).toBe(255);
  });

  it("applies partial alpha from strokeAlpha to stroke color", () => {
    const shape = { paths: [makeSimplePath(RED)] };
    const result = inkBottleApply(shape, "#000000", 50, 2);
    // 50% alpha → Math.round(50/100 * 255) = 128
    expect(result.paths[0].stroke?.color.a).toBe(128);
  });

  it("removes stroke when strokeAlpha=0", () => {
    const shape = { paths: [makeSimplePath(RED, STROKE_BLACK)] };
    const result = inkBottleApply(shape, "#000000", 0, 2);
    expect(result.paths[0].stroke).toBeUndefined();
  });

  it("removes stroke when strokeWidth=0", () => {
    const shape = { paths: [makeSimplePath(RED, STROKE_BLACK)] };
    const result = inkBottleApply(shape, "#000000", 100, 0);
    expect(result.paths[0].stroke).toBeUndefined();
  });
});

describe("Paint Bucket tool", () => {
  it("applies fill to all paths", () => {
    const shape = { paths: [makeSimplePath(RED)] };
    const result = paintBucketApply(shape, BLUE);
    expect(result.paths[0].fill).toBe(BLUE);
  });

  it("removes fill when No Color (null) is selected", () => {
    const shape = { paths: [makeSimplePath(RED)] };
    const result = paintBucketApply(shape, null);
    expect(result.paths[0].fill).toBeUndefined();
  });

  it("applies fill to multiple paths", () => {
    const shape = { paths: [makeSimplePath(RED), makeSimplePath(BLUE)] };
    const newFill: Fill = { type: "solid", color: { r: 0, g: 255, b: 0, a: 255 } };
    const result = paintBucketApply(shape, newFill);
    expect(result.paths[0].fill).toBe(newFill);
    expect(result.paths[1].fill).toBe(newFill);
  });

  it("removes fill from all paths when No Color applied to multi-path shape", () => {
    const shape = { paths: [makeSimplePath(RED), makeSimplePath(BLUE)] };
    const result = paintBucketApply(shape, null);
    expect(result.paths[0].fill).toBeUndefined();
    expect(result.paths[1].fill).toBeUndefined();
  });

  it("applies a BitmapFill (tiled) to all paths", () => {
    const bitmapFill: BitmapFill = {
      type: "bitmap",
      bitmapId: "img1",
      repeat: true,
      smooth: false,
    };
    const shape = { paths: [makeSimplePath(RED), makeSimplePath(BLUE)] };
    const result = paintBucketApply(shape, bitmapFill);
    expect(result.paths[0].fill).toStrictEqual(bitmapFill);
    expect(result.paths[1].fill).toStrictEqual(bitmapFill);
    // Type guard: confirm it's a bitmap fill
    const f0 = result.paths[0].fill;
    expect(f0?.type).toBe("bitmap");
    if (f0?.type === "bitmap") {
      expect(f0.bitmapId).toBe("img1");
      expect(f0.repeat).toBe(true);
      expect(f0.smooth).toBe(false);
    }
  });

  it("applies a BitmapFill (clipped, smoothed) to a shape", () => {
    const bitmapFill: BitmapFill = {
      type: "bitmap",
      bitmapId: "img2",
      repeat: false,
      smooth: true,
    };
    const shape = { paths: [makeSimplePath()] };
    const result = paintBucketApply(shape, bitmapFill);
    const f = result.paths[0].fill;
    expect(f?.type).toBe("bitmap");
    if (f?.type === "bitmap") {
      expect(f.bitmapId).toBe("img2");
      expect(f.repeat).toBe(false);
      expect(f.smooth).toBe(true);
    }
  });

  it("replaces an existing BitmapFill with a new BitmapFill", () => {
    const oldBitmapFill: BitmapFill = { type: "bitmap", bitmapId: "old-img", repeat: true, smooth: false };
    const newBitmapFill: BitmapFill = { type: "bitmap", bitmapId: "new-img", repeat: false, smooth: true };
    const shape = { paths: [makeSimplePath(oldBitmapFill)] };
    const result = paintBucketApply(shape, newBitmapFill);
    const f = result.paths[0].fill;
    expect(f?.type).toBe("bitmap");
    if (f?.type === "bitmap") {
      expect(f.bitmapId).toBe("new-img");
    }
  });

  it("replaces a solid fill with a BitmapFill", () => {
    const bitmapFill: BitmapFill = { type: "bitmap", bitmapId: "img1", repeat: true, smooth: false };
    const shape = { paths: [makeSimplePath(RED)] };
    const result = paintBucketApply(shape, bitmapFill);
    expect(result.paths[0].fill?.type).toBe("bitmap");
  });
});

// ---------------------------------------------------------------------------
// Bitmap Fill — Color Mixer selection logic
// ---------------------------------------------------------------------------

/**
 * Simulate the ColorMixerPanel.handleBitmapSelect logic:
 * selecting a bitmap from the thumbnail grid sets the fill to a BitmapFill
 * with the chosen bitmapId.
 */
function colorMixerSelectBitmap(
  bitmapId: string,
  repeat: boolean,
  smooth: boolean
): BitmapFill {
  return { type: "bitmap", bitmapId, repeat, smooth };
}

/**
 * Simulate switching the Color Mixer type dropdown to "bitmap",
 * which auto-picks the first available bitmap item if none is already selected.
 */
function colorMixerSwitchToBitmap(
  firstAvailableId: string | null,
  alreadySelectedId: string | null,
  repeat: boolean,
  smooth: boolean
): BitmapFill | null {
  const initId = alreadySelectedId ?? firstAvailableId;
  if (!initId) return null;
  return { type: "bitmap", bitmapId: initId, repeat, smooth };
}

describe("Bitmap Fill — Color Mixer selection", () => {
  it("selecting a bitmap id produces a BitmapFill with correct id", () => {
    const fill = colorMixerSelectBitmap("img1", true, false);
    expect(fill.type).toBe("bitmap");
    expect(fill.bitmapId).toBe("img1");
    expect(fill.repeat).toBe(true);
    expect(fill.smooth).toBe(false);
  });

  it("switching to bitmap type auto-picks the first available bitmap", () => {
    const fill = colorMixerSwitchToBitmap("auto-img", null, true, false);
    expect(fill).not.toBeNull();
    expect(fill?.bitmapId).toBe("auto-img");
  });

  it("switching to bitmap type keeps already-selected bitmap", () => {
    const fill = colorMixerSwitchToBitmap("other-img", "my-img", true, false);
    expect(fill?.bitmapId).toBe("my-img");
  });

  it("switching to bitmap type returns null when no bitmaps are available", () => {
    const fill = colorMixerSwitchToBitmap(null, null, true, false);
    expect(fill).toBeNull();
  });

  it("BitmapFill → Paint Bucket: selecting bitmap then clicking shape sets bitmap fill", () => {
    const bitmapFill: BitmapFill = colorMixerSelectBitmap("img1", true, false);
    const shape = { paths: [makeSimplePath(RED)] };
    const result = paintBucketApply(shape, bitmapFill);
    expect(result.paths[0].fill?.type).toBe("bitmap");
    if (result.paths[0].fill?.type === "bitmap") {
      expect(result.paths[0].fill.bitmapId).toBe("img1");
    }
  });

  it("BitmapFill is round-tripped through paintBucketApply without mutation", () => {
    const bitmapFill: BitmapFill = { type: "bitmap", bitmapId: "img1", repeat: true, smooth: false };
    const shape = { paths: [makeSimplePath()] };
    const result = paintBucketApply(shape, bitmapFill);
    // The fill object itself is preserved by reference (no cloning)
    expect(result.paths[0].fill).toBe(bitmapFill);
  });
});

// ---------------------------------------------------------------------------
// Object Drawing mode — display-object type selection
// ---------------------------------------------------------------------------

/**
 * Simulate the logic in handleShapeCreated that decides between
 * type:"shape" and type:"drawing-object" based on toolState.objectDrawing.
 */
function buildDisplayObject(
  shapeId: string,
  paths: ShapePath[],
  x: number,
  y: number,
  objectDrawing: boolean
): { type: "shape" | "drawing-object"; id: string; x: number; y: number } {
  const shape = { id: shapeId, paths };
  if (objectDrawing) {
    return { type: "drawing-object", id: shapeId, shape, x, y } as { type: "drawing-object"; id: string; x: number; y: number };
  }
  return { type: "shape", id: shapeId, shape, x, y } as { type: "shape"; id: string; x: number; y: number };
}

describe("Object Drawing mode", () => {
  it("emits type:'shape' when objectDrawing is false", () => {
    const obj = buildDisplayObject("s1", [makeSimplePath(RED)], 10, 20, false);
    expect(obj.type).toBe("shape");
    expect(obj.id).toBe("s1");
    expect(obj.x).toBe(10);
    expect(obj.y).toBe(20);
  });

  it("emits type:'drawing-object' when objectDrawing is true", () => {
    const obj = buildDisplayObject("s1", [makeSimplePath(RED)], 10, 20, true);
    expect(obj.type).toBe("drawing-object");
    expect(obj.id).toBe("s1");
    expect(obj.x).toBe(10);
    expect(obj.y).toBe(20);
  });

  it("same shape data is preserved regardless of objectDrawing flag", () => {
    const path = makeSimplePath(RED);
    const obj1 = buildDisplayObject("s1", [path], 0, 0, false) as unknown as { shape: { paths: ShapePath[] } };
    const obj2 = buildDisplayObject("s1", [path], 0, 0, true) as unknown as { shape: { paths: ShapePath[] } };
    expect(obj1.shape.paths[0]).toBe(path);
    expect(obj2.shape.paths[0]).toBe(path);
  });
});
