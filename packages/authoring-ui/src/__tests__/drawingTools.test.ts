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
import { transformedShapeBounds } from "@flash/core";

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
      processedPoints = [points[0], points[points.length - 1]];
    } else {
      processedPoints = smoothPoints(points, 1);
    }
  }
  const path: ShapePath = {
    start: processedPoints[0],
    segments: processedPoints.slice(1).map((pt) => ({ type: "line" as const, to: pt })),
    closed: false,
    stroke,
  };
  return { id: "draw-1", paths: [path] };
}

function brushPointsToShape(
  points: Point[],
  brushSize: number,
  fill: Fill
): { id: string; paths: ShapePath[] } {
  if (points.length < 2) return { id: "draw-empty", paths: [] };
  const half = brushSize / 2;
  const forward: Point[] = [];
  const backward: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    const nx = -ty / tlen;
    const ny = tx / tlen;
    forward.push({ x: curr.x + nx * half, y: curr.y + ny * half });
    backward.unshift({ x: curr.x - nx * half, y: curr.y - ny * half });
  }
  const allPoints = [...forward, ...backward];
  const path: ShapePath = {
    start: allPoints[0],
    segments: allPoints.slice(1).map((pt) => ({ type: "line" as const, to: pt })),
    closed: true,
    fill,
  };
  return { id: "draw-1", paths: [path] };
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

describe("Brush tool", () => {
  it("creates a closed filled shape from brush points", () => {
    const pts = [
      { x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 },
    ];
    const shape = brushPointsToShape(pts, 10, RED);
    expect(shape.paths).toHaveLength(1);
    expect(shape.paths[0].closed).toBe(true);
    expect(shape.paths[0].fill).toBe(RED);
    // Should produce 2*n points (forward + backward) closed
    expect(shape.paths[0].segments.length).toBeGreaterThan(0);
  });

  it("returns empty paths for fewer than 2 points", () => {
    const shape = brushPointsToShape([{ x: 0, y: 0 }], 8, RED);
    expect(shape.paths).toHaveLength(0);
  });

  it("perpendicular extrusion creates width roughly equal to brushSize", () => {
    const pts = [{ x: 0, y: 50 }, { x: 100, y: 50 }]; // horizontal line
    const shape = brushPointsToShape(pts, 20, RED);
    const path = shape.paths[0];
    const ys = [path.start.y, ...path.segments.map((s) => s.to.y)];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    expect(maxY - minY).toBeCloseTo(20, 0);
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
    const obj1 = buildDisplayObject("s1", [path], 0, 0, false) as { shape: { paths: ShapePath[] } };
    const obj2 = buildDisplayObject("s1", [path], 0, 0, true) as { shape: { paths: ShapePath[] } };
    expect(obj1.shape.paths[0]).toBe(path);
    expect(obj2.shape.paths[0]).toBe(path);
  });
});
