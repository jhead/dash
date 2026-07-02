import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ToolId } from "./tools/types";
import type { PlacedInstance } from "./PropertiesPanel";
import type { BitmapDisplayObject, BitmapItem, Fill, Library, Shape, ShapeDisplayObject, ShapePath, PathSegment, SceneGraph, SolidStroke, Symbol as FlashSymbol, SymbolInstance, TextDisplayObject, Viewport, Guide, Point, Timeline as TimelineModel, MagicWandSmoothing, ShapeWarp, WarpCorners, WarpEdges, SubSelection } from "@flash/core";
import { createOvalShape, createRectShape, createRoundedRectShape, createLineShape, createPolygonShape, createStarShape, CanvasRenderer, transformedShapeBounds, hexToColor, getTweenedFrame, getGoverningKeyframe, getGuideLayerPath, findGuideLayerAbove, magicWandSelectPixels, pointInPolygon, shouldClosePolygon, POLYGON_CLOSE_DISTANCE, identityWarp, evalWarp, buildEraserPolygon, eraseShape, livePlanarShape, pickAt as planarPickAt, pickConnected as planarPickConnected, pickInRect as planarPickInRect, subSelectionPolylines, splitOnMove as planarSplitOnMove, planarEraseShape, faucetEraseShape, isMergeableShape, type EraserMode } from "@flash/core";
import type { FreeTransformMode, PolyStarOptions } from "./tools/types";
import { content as themeContent, halo as themeHalo, chrome as themeChrome } from "./theme/flash8Theme";
import { isWithinRufflePlayer } from "./dispatch/playerFocus.js";
import { isTimelinePanelFocused } from "./dispatch/timelineFocus.js";

// Text-edit overlay (<textarea>) chrome. The textarea's text content box is inset from
// its top-left by border + padding; the canvas paints text with its top-left exactly at
// the object origin (textBaseline:"top"). To align the overlay text with where the canvas
// would draw, the overlay box is shifted up-left by this inset (and grown so its content
// region still covers the object). See the textarea overlay in StageArea.
const TEXT_OVERLAY_BORDER = 1;
const TEXT_OVERLAY_PADDING = 2;
const TEXT_OVERLAY_INSET = TEXT_OVERLAY_BORDER + TEXT_OVERLAY_PADDING; // 3px

// ---------------------------------------------------------------------------
// Pencil tool helpers
// ---------------------------------------------------------------------------

let _drawShapeCounter = 0;
function nextDrawId(): string {
  return "draw-" + ++_drawShapeCounter + "-" + Date.now().toString(36);
}

/**
 * Map a stage-space point into a shape display object's LOCAL coordinate space —
 * the inverse of the renderer's transform order (translate(x,y) ∘ rotate ∘
 * scale). Used by the vector eraser to subtract the eraser stamp from the
 * shape's own untransformed geometry.
 */
function stageToShapeLocal(p: Point, obj: ShapeDisplayObject): Point {
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;
  const rad = ((obj.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Undo translation.
  const dx = p.x - obj.x;
  const dy = p.y - obj.y;
  // Undo rotation (rotate by -θ).
  const rx = dx * cos + dy * sin;
  const ry = -dx * sin + dy * cos;
  // Undo scale.
  return { x: rx / (sx || 1), y: ry / (sy || 1) };
}

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
// Straighten mode — shape recognition helpers
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
  // Bounding box
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

  // Closed: start and end within ~15px
  const endDist = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y
  );
  const isClosed = endDist < 15;

  // Detect corners: direction changes > 60° using simplified tangent vectors.
  // Downsample to avoid noise — use every Nth point, then deduplicate consecutive
  // near-identical points (which would cause zero-length vectors and NaN angles).
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
  const CORNER_THRESH = Math.PI / 3; // 60°

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
    // Closed loop — distinguish by corner count
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

// ---------------------------------------------------------------------------
// Main pencil helper
// ---------------------------------------------------------------------------

function pencilPointsToShape(
  points: Point[],
  stroke: SolidStroke,
  mode: "straighten" | "smooth" | "ink"
): Shape {
  if (points.length < 2) return { id: nextDrawId(), paths: [] };

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
        // Pick the 3 most prominent corner points; fall back to bbox corners
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
        // Detect if roughly a straight line: use first and last point
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

    return { id: nextDrawId(), paths: [path] };
  }

  const path: ShapePath = {
    start: processedPoints[0],
    segments: processedPoints.slice(1).map((pt) => ({ type: "line" as const, to: pt })),
    closed: false,
    stroke,
  };
  return { id: nextDrawId(), paths: [path] };
}

/**
 * Build a closed circular ShapePath (4 quadratic-Bézier quarter arcs) centered
 * at (cx,cy) with the given radius. Used for the round brush nib / single dab.
 *
 * For a 90° quadratic arc the control point sits at the intersection of the two
 * endpoint tangents — i.e. the corner of the axis-aligned bounding box. That
 * approximation is round enough to be visually indistinguishable from a true
 * circle at brush sizes, and matches Flash 8's round brush tip.
 */
function circlePath(cx: number, cy: number, radius: number, fill: Fill): ShapePath {
  const r = radius;
  // Cardinal points (start at the right, go clockwise: right→bottom→left→top).
  const right = { x: cx + r, y: cy };
  const bottom = { x: cx, y: cy + r };
  const left = { x: cx - r, y: cy };
  const top = { x: cx, y: cy - r };
  // Corner control points (tangent intersections).
  const br = { x: cx + r, y: cy + r };
  const bl = { x: cx - r, y: cy + r };
  const tl = { x: cx - r, y: cy - r };
  const tr = { x: cx + r, y: cy - r };
  return {
    start: right,
    segments: [
      { type: "curve" as const, control: br, to: bottom },
      { type: "curve" as const, control: bl, to: left },
      { type: "curve" as const, control: tl, to: top },
      { type: "curve" as const, control: tr, to: right },
    ],
    closed: true,
    fill,
  };
}

/**
 * Append a semicircular cap (two quadratic quarter arcs) to `segments`, bowing
 * AWAY from the ribbon along `dir`. The cap connects `from` to `to`, both on the
 * circle of radius `half` centered at `center`; `dir` is the unit outward
 * direction (the stroke tangent at that end). Each quarter arc's control point
 * is the tangent intersection (endpoint + dir*half), matching `circlePath`.
 */
function appendRoundCap(
  segments: PathSegment[],
  center: Point,
  from: Point,
  to: Point,
  dir: { x: number; y: number },
  half: number
): void {
  // Far tip of the cap on the circle = center + dir*half.
  const tip = { x: center.x + dir.x * half, y: center.y + dir.y * half };
  const c1 = { x: from.x + dir.x * half, y: from.y + dir.y * half };
  const c2 = { x: to.x + dir.x * half, y: to.y + dir.y * half };
  segments.push({ type: "curve", control: c1, to: tip });
  segments.push({ type: "curve", control: c2, to });
}

function squareDabPath(cx: number, cy: number, half: number, fill: Fill): ShapePath {
  return {
    start: { x: cx - half, y: cy - half },
    segments: [
      { type: "line", to: { x: cx + half, y: cy - half } },
      { type: "line", to: { x: cx + half, y: cy + half } },
      { type: "line", to: { x: cx - half, y: cy + half } },
      { type: "line", to: { x: cx - half, y: cy - half } },
    ],
    closed: true,
    fill,
  };
}

function brushPointsToShape(
  points: Point[],
  brushSize: number,
  fill: Fill,
  nib: "round" | "square" = "round"
): Shape {
  const half = brushSize / 2;

  // Single dab (click or near-zero drag): a round nib = a circle of diameter
  // brushSize centered on the point; a square nib = a square. Flash 8's brush is
  // round by default.
  if (points.length < 2) {
    if (points.length === 0) return { id: nextDrawId(), paths: [] };
    const p = points[0];
    const dab = nib === "square" ? squareDabPath(p.x, p.y, half, fill) : circlePath(p.x, p.y, half, fill);
    return { id: nextDrawId(), paths: [dab] };
  }

  const forward: Point[] = [];
  const backward: Point[] = [];
  const tangents: { x: number; y: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    // Compute tangent direction
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    const txu = tx / tlen;
    const tyu = ty / tlen;
    tangents.push({ x: txu, y: tyu });
    // Perpendicular to tangent (left side).
    const nx = -tyu;
    const ny = txu;
    forward.push({ x: curr.x + nx * half, y: curr.y + ny * half });
    backward.push({ x: curr.x - nx * half, y: curr.y - ny * half });
  }

  // Sweep a ribbon with ROUND caps at both ends so the stroke head/tail are
  // semicircles, not square butts. Walk the forward (left) edge start→end, cap
  // around the end point, walk the backward (right) edge end→start, cap around
  // the start point, then close.
  const segments: PathSegment[] = [];

  // Forward edge: forward[0] → forward[n-1].
  for (let i = 1; i < forward.length; i++) {
    segments.push({ type: "line", to: forward[i] });
  }

  // End cap: round nib bows a semicircle around the LAST point; square nib uses
  // a flat butt cap (a straight edge across to the backward side).
  if (nib === "square") {
    segments.push({ type: "line", to: backward[backward.length - 1] });
  } else {
    const lastPt = points[points.length - 1];
    const endDir = tangents[tangents.length - 1];
    appendRoundCap(
      segments,
      lastPt,
      forward[forward.length - 1],
      backward[backward.length - 1],
      endDir,
      half
    );
  }

  // Backward edge: backward[n-1] → backward[0].
  for (let i = backward.length - 2; i >= 0; i--) {
    segments.push({ type: "line", to: backward[i] });
  }

  // Start cap: round nib bows a semicircle around the FIRST point; square nib
  // relies on the closing edge (backward[0] → start = forward[0]) as a flat cap.
  if (nib !== "square") {
    const firstPt = points[0];
    const startDir = { x: -tangents[0].x, y: -tangents[0].y };
    appendRoundCap(segments, firstPt, backward[0], forward[0], startDir, half);
  }

  const path: ShapePath = {
    start: forward[0],
    segments,
    closed: true,
    fill,
  };
  return { id: nextDrawId(), paths: [path] };
}

// ---------------------------------------------------------------------------
// Pen tool types
// ---------------------------------------------------------------------------

interface PenAnchor {
  x: number;
  y: number;
  /** Outgoing Bézier control handle (used as control point for the segment TO the next anchor) */
  handleOut?: { x: number; y: number };
}

interface PenState {
  anchors: PenAnchor[];
  /** Stage coords when pointer went down for current anchor (before up = drag determines handle) */
  dragStart: { x: number; y: number } | null;
  /** Current drag handle preview (while mouse is held) */
  currentHandleOut: { x: number; y: number } | null;
  /** Current cursor position (for rubber-band preview) */
  cursorPos: { x: number; y: number } | null;
}

/** Convert pen anchors to a closed ShapePath using the existing fill/stroke */
function anchorsToShapePath(
  anchors: PenAnchor[],
  fill: import("@flash/core").Fill | undefined,
  stroke: import("@flash/core").SolidStroke | undefined,
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

// ---------------------------------------------------------------------------
// Lasso tool helpers
//
// The pure selection algorithms (flood fill, contour tracing, polygon close
// logic, point-in-polygon) live in @flash/core's engine/magicWand so they can
// be unit-tested without a DOM and shared with any consumer. This module keeps
// only the thin DOM-bound wrapper that rasterizes a bitmap before delegating to
// the core helper, plus the document-aware shape hit test.
// ---------------------------------------------------------------------------

/**
 * Given a closed lasso polygon, find the first ShapeDisplayObject whose center
 * falls inside the polygon. Returns the shape id or null.
 */
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

/**
 * Run magic wand selection on a BitmapDisplayObject.
 *
 * Draws the bitmap to an offscreen canvas, reads its RGBA pixels, then delegates
 * the flood fill + selection-polygon shaping to the pure core helper
 * `magicWandSelectPixels`. Returns the resulting lasso polygon in stage
 * coordinates, or null if the bitmap cannot be loaded (e.g. no dataUri).
 */
function magicWandSelect(
  bitmapObj: BitmapDisplayObject,
  bitmapItem: BitmapItem,
  stageX: number,
  stageY: number,
  threshold: number,
  smoothing: MagicWandSmoothing,
): Promise<Point[] | null> {
  return new Promise((resolve) => {
    if (!bitmapItem.dataUri) { resolve(null); return; }

    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || bitmapObj.width;
        const h = img.naturalHeight || bitmapObj.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);

        const polygon = magicWandSelectPixels(
          imageData.data,
          w,
          h,
          bitmapObj,
          stageX,
          stageY,
          threshold,
          smoothing,
        );
        resolve(polygon);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = bitmapItem.dataUri;
  });
}

export type ViewMode = "normal" | "outlines" | "antialias";

// ---------------------------------------------------------------------------
// Symbol instance bounds helper
// ---------------------------------------------------------------------------

/**
 * Compute a stage-space bounding box for a SymbolInstance.
 * Resolves the symbol's first-frame shapes from the library to get real content
 * bounds, then applies the instance's x/y offset. Falls back to a 40×40 px
 * box centered on the instance origin when the symbol cannot be resolved.
 */
export function getSymbolInstanceBounds(
  inst: SymbolInstance,
  library: Library | undefined
): { x: number; y: number; width: number; height: number } {
  const FALLBACK_HALF = 40;

  if (!library) {
    return { x: inst.x - FALLBACK_HALF, y: inst.y - FALLBACK_HALF, width: FALLBACK_HALF * 2, height: FALLBACK_HALF * 2 };
  }

  const sym = library.items.find((i) => i.id === inst.symbolId && i.itemType === "symbol") as FlashSymbol | undefined;

  if (!sym) {
    return { x: inst.x - FALLBACK_HALF, y: inst.y - FALLBACK_HALF, width: FALLBACK_HALF * 2, height: FALLBACK_HALF * 2 };
  }

  // Gather all shapes from the first keyframe of every layer in the symbol
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasShape = false;
  for (const layer of sym.timeline.layers) {
    const kf = [...layer.frames]
      .filter((f) => f.isKeyframe && f.index === 0)
      .sort((a, b) => b.index - a.index)[0];
    if (!kf) continue;
    for (const obj of kf.displayObjects) {
      if (!("shape" in obj)) continue;
      const b = transformedShapeBounds(obj as ShapeDisplayObject);
      if (b.width === 0 && b.height === 0) continue;
      hasShape = true;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
  }

  if (!hasShape) {
    return { x: inst.x - FALLBACK_HALF, y: inst.y - FALLBACK_HALF, width: FALLBACK_HALF * 2, height: FALLBACK_HALF * 2 };
  }

  const scaleX = inst.scaleX ?? 1;
  const scaleY = inst.scaleY ?? 1;

  return {
    x: inst.x + minX * scaleX,
    y: inst.y + minY * scaleY,
    width: (maxX - minX) * scaleX,
    height: (maxY - minY) * scaleY,
  };
}

// ---------------------------------------------------------------------------
// Marquee selection helpers
// ---------------------------------------------------------------------------

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function boundsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// ---------------------------------------------------------------------------
// Motion path drawing
// ---------------------------------------------------------------------------

/**
 * Draw dashed motion path overlays for all layers that have an active motion
 * tween at the given frame. The canvas is drawn at 1:1 stage-space (zoom/pan
 * is handled by the parent CSS transform), so no coordinate conversion needed.
 *
 * Also draws guide layer paths as dashed cyan overlays so the author can see
 * the motion guide while editing.
 *
 * @param timeline  Full timeline model — used both to find guide layers and to
 *                  pass to getTweenedFrame so guided layers follow the path.
 */
function drawMotionPaths(
  ctx: CanvasRenderingContext2D,
  layers: import("@flash/core").Layer[],
  currentFrame: number,
  timeline?: import("@flash/core").Timeline
): void {
  for (const layer of layers) {
    if (!layer.visible) continue;

    // Guide layers: draw their shape path as a dashed cyan overlay.
    if (layer.type === "guide") {
      const guidePath = getGuideLayerPath(layer);
      if (!guidePath) continue;

      ctx.save();
      // Guide-layer path overlay — cyan guides (System C content.guide).
      ctx.strokeStyle = themeContent.guide;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(guidePath.start.x + (layer.frames[0]?.displayObjects[0]?.x ?? 0),
                 guidePath.start.y + (layer.frames[0]?.displayObjects[0]?.y ?? 0));
      // Draw the path segments with the display object's offset applied
      const obj = layer.frames[0]?.displayObjects[0];
      const ox = obj?.x ?? 0;
      const oy = obj?.y ?? 0;
      ctx.beginPath();
      ctx.moveTo(guidePath.start.x + ox, guidePath.start.y + oy);
      for (const seg of guidePath.segments) {
        if (seg.type === "line") {
          ctx.lineTo(seg.to.x + ox, seg.to.y + oy);
        } else {
          ctx.quadraticCurveTo(
            seg.control.x + ox, seg.control.y + oy,
            seg.to.x + ox, seg.to.y + oy
          );
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      continue;
    }

    // Find the governing keyframe at the current frame
    const kf = getGoverningKeyframe(layer, currentFrame);
    if (!kf || kf.tweenType !== "motion") continue;

    const startIdx = kf.index;
    // Find the next keyframe to determine the end of the tween span
    const nextKf = layer.frames
      .filter((f) => f.isKeyframe && f.index > startIdx)
      .sort((a, b) => a.index - b.index)[0];
    const endIdx = nextKf?.index ?? layer.frameCount - 1;

    if (endIdx <= startIdx) continue;

    // For guided layers check if there's a guide layer whose path we should follow.
    // When the guide layer path exists, sample from it directly for a smoother preview.
    let guidePathForLayer: import("@flash/core").ShapePath | null = null;
    if (layer.type === "guided" && timeline) {
      const guideLayer = findGuideLayerAbove(timeline, layer);
      if (guideLayer) {
        guidePathForLayer = getGuideLayerPath(guideLayer);
      }
    }

    // Sample the interpolated position at each frame in the tween span
    const points: { x: number; y: number }[] = [];
    for (let fi = startIdx; fi <= endIdx; fi++) {
      // Pass timeline so that getTweenedFrame can apply guide-path following
      const tweened = getTweenedFrame(layer, fi, timeline);
      if (tweened && tweened.displayObjects[0]) {
        const obj = tweened.displayObjects[0];
        points.push({ x: obj.x, y: obj.y });
      }
    }

    if (points.length < 2) continue;

    // Draw the dashed motion path
    ctx.save();
    // Use a different color for guide-following layers to distinguish from free tweens
    ctx.strokeStyle = guidePathForLayer ? "#0066cc" : "#0000cc";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // Draw keyframe diamonds at start and end positions
    ctx.fillStyle = guidePathForLayer ? "#0066cc" : "#0000cc";
    ctx.setLineDash([]);
    for (const pt of [points[0], points[points.length - 1]]) {
      const cx = pt.x;
      const cy = pt.y;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4);
      ctx.lineTo(cx + 4, cy);
      ctx.lineTo(cx, cy + 4);
      ctx.lineTo(cx - 4, cy);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Onion skin types
// ---------------------------------------------------------------------------

export interface OnionFrame {
  frameIndex: number;
  opacity: number;
  tint: "before" | "after";
  sceneGraph: import("@flash/core").SceneGraph;
  /** When true, render this ghost frame as stroke outlines only (no fill). */
  outlineMode?: boolean;
}

/**
 * Selectable display objects on a single non-active, stage-selectable layer,
 * grouped by the kinds the Selection tool hit-tests. Mirrors the
 * `LayerSelectables` produced by `selectors/derived.ts otherLayerSelectables`.
 */
export interface LayerSelectables {
  readonly layerIndex: number;
  readonly shapes: ShapeDisplayObject[];
  readonly instances: SymbolInstance[];
  readonly texts: TextDisplayObject[];
}

export interface StageAreaProps {
  stageWidth?: number;
  stageHeight?: number;
  backgroundColor?: string;
  zoom?: number;
  panX?: number;
  panY?: number;
  showGrid?: boolean;
  gridWidth?: number;
  gridHeight?: number;
  gridColor?: string;
  snapToPixels?: boolean;
  viewMode?: ViewMode;
  activeTool?: ToolId;
  instances?: PlacedInstance[];
  instanceNames?: Record<string, string>; // id -> library item name
  selectedInstanceId?: string | null;
  onZoomChange?: (zoom: number) => void;
  onPanChange?: (x: number, y: number) => void;
  onDrop?: (libraryItemId: string, x: number, y: number) => void;
  /** A built-in component (by class/display name) was dragged from the Components panel. */
  onDropComponent?: (componentName: string, x: number, y: number) => void;
  onInstanceSelect?: (id: string | null) => void;
  // Drawing tool props
  currentFrame?: number;
  shapeDisplayObjects?: ShapeDisplayObject[];
  onShapeCreated?: (shape: Shape, x: number, y: number) => void;
  selectedShapeId?: string | null;
  /** Full set of selected display object IDs (for multi-selection). */
  selectedShapeIds?: string[];
  onShapeSelect?: (id: string | null, shiftKey?: boolean) => void;
  /** Called when a marquee or shift+click produces a multi-selection result. */
  onShapeSelectMultiple?: (ids: string[], replace: boolean) => void;
  // --- P3 partial (face/segment) selection on the planar merge map ---
  /**
   * When true (planarMergeOnCommit flag ON + selection tool), clicking a merged
   * shape selects ONE fill region or line segment instead of the whole object,
   * and dragging splits it off (split-on-move). Off ⇒ whole-object behavior
   * (byte-identical to before).
   */
  partialSelectEnabled?: boolean;
  /** The current partial selection (a set of stable face/segment keys), or null. */
  subSelection?: SubSelection | null;
  /** Replace the partial selection (null clears it). */
  onSubSelect?: (s: SubSelection | null) => void;
  /** Commit a split-on-move of the partial selection by (dx, dy) in stage px. */
  onSubSplitMove?: (s: SubSelection, dx: number, dy: number) => void;
  onShapeMove?: (id: string, dx: number, dy: number) => void;
  /** Called once when a shape drag gesture finishes (mouse-up). Use to commit to undo history. */
  onShapeMoveEnd?: () => void;
  onShapeDelete?: (id: string) => void;
  /** Called to delete all currently selected objects. */
  onDeleteSelected?: () => void;
  onShapeResize?: (id: string, newX: number, newY: number, scaleX: number, scaleY: number) => void;
  onShapeRotate?: (id: string, newRotation: number) => void;
  /** Free Transform Distort / Envelope: persist the mesh warp on the object. */
  onShapeWarp?: (id: string, warp: ShapeWarp) => void;
  /** Called by pen tool when a new path is complete (uses onShapeCreated); by subselection when geometry changes */
  onShapeUpdate?: (id: string, newShape: Shape) => void;
  // Bitmap display objects
  bitmapDisplayObjects?: BitmapDisplayObject[];
  /** All BitmapItems from the library, used to load images into the renderer. */
  bitmapLibraryItems?: BitmapItem[];
  /** Called when the CanvasRenderer is initialized, so parent can call loadImage. */
  onRendererReady?: (renderer: CanvasRenderer) => void;
  // Guide props
  guides?: readonly Guide[];
  showGuides?: boolean;
  snapToGuides?: boolean;
  onGuideMove?: (id: string, newPosition: number) => void;
  onGuideDelete?: (id: string) => void;
  // Snap props
  snapToGrid?: boolean;
  snapToObjects?: boolean;
  // Text tool props
  textDisplayObjects?: TextDisplayObject[];
  onTextCreated?: (textObj: Omit<TextDisplayObject, "id">) => void;
  /**
   * Called when the text tool clicks an empty area of the stage to immediately
   * place a new TextDisplayObject. Shell creates the object and calls back with
   * the assigned id so StageArea can open the inline textarea for that object.
   */
  onTextPlace?: (textObj: Omit<TextDisplayObject, "id">, onPlaced: (id: string) => void) => void;
  editingTextId?: string | null;
  onTextEdit?: (id: string, newText: string) => void;
  onTextEditEnd?: () => void;
  textFormat?: {
    fontFamily: string;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    align: TextDisplayObject["align"];
    color: string;
  };
  // Draw tool options
  pencilMode?: "straighten" | "smooth" | "ink";
  brushSize?: number;
  /** Brush nib shape (round/square). Default 'round'. */
  brushShape?: "round" | "square";
  /** Rectangle corner radius in px (0 = square). Default 0. */
  rectCornerRadius?: number;
  eraserSize?: number;
  /** Flash 8 eraser mode (planar path, flag ON): normal/fills/lines/selected/inside. */
  eraserMode?: EraserMode;
  /** Faucet mode: a single click deletes a whole fill or line (planar path). */
  eraserFaucet?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  /** Stroke opacity 0-100; 0 means no stroke */
  strokeAlpha?: number;
  fill?: Fill | null;
  onEyedropperSample?: (shapeId: string) => void;
  // Free Transform options
  freeTransformMode?: FreeTransformMode;
  /** Called when gradient transform tool drags a handle and updates the fill on a shape. */
  onShapeGradientUpdate?: (id: string, newShape: Shape) => void;
  // Lasso options
  lassoPolygonMode?: boolean;
  lassoMagicWand?: boolean;
  magicWandThreshold?: number;
  magicWandSmoothing?: "pixels" | "rough" | "normal" | "smooth";
  // PolyStar options
  polyStarOptions?: PolyStarOptions;
  /**
   * Full multi-layer scene graph for rendering.  When provided, this overrides
   * the synthetic single-layer SceneGraph that StageArea would otherwise build
   * from `shapeDisplayObjects`/`textDisplayObjects`/`bitmapDisplayObjects`.
   * The interaction props (shapeDisplayObjects etc.) still control hit-testing
   * and selection — they should represent the active layer only.
   */
  sceneGraph?: SceneGraph;
  /**
   * Library for resolving symbol instance content in the CanvasRenderer.
   */
  library?: Library;
  /** Called when F8 is pressed (Convert to Symbol). */
  onConvertToSymbol?: () => void;
  /** Called when user double-clicks a placed symbol instance (edit-in-place). */
  onInstanceDoubleClick?: (instanceId: string) => void;
  /**
   * Symbol instances from the active layer at the current frame.
   * Used for hit-testing double-clicks to enter symbol edit mode.
   */
  symbolInstanceDisplayObjects?: SymbolInstance[];
  /**
   * Selectable objects on the OTHER (non-active) stage-selectable layers, grouped
   * per layer in z-order (index 0 = topmost). Used ONLY as a fallback hit-test
   * pass for the Selection tool: when the active-layer hit-tests all miss, a hit
   * here selects the object AND makes its layer active (Flash 8 auto-switch —
   * task 1364). The active layer drives selection/edit via the primary arrays;
   * once a fallback hit switches the active layer, the object joins those arrays
   * on the next render and behaves identically. Locked/hidden/guide layers are
   * pre-excluded by the producer (`otherLayerSelectables`).
   */
  otherLayerSelectables?: LayerSelectables[];
  /**
   * Called when user double-clicks a SymbolInstance on stage with the selection tool.
   * Receives the instance id and symbolId.
   */
  onSymbolInstanceDoubleClick?: (instanceId: string, symbolId: string) => void;
  /**
   * Parent scene graph rendered dimmed behind the symbol contents when in symbol edit mode.
   * When provided, this is rendered at reduced opacity before the main sceneGraph.
   */
  parentSceneGraph?: SceneGraph;
  /**
   * Called when user clicks on empty stage space while in symbol edit mode
   * (i.e., when parentSceneGraph is provided and no object is hit).
   * Shell uses this to exit symbol edit mode.
   */
  onExitSymbolEdit?: () => void;
  /** Called when Ctrl+C is pressed (copy selected object). */
  onCopy?: () => void;
  /** Called when Ctrl+X is pressed (cut selected object). */
  onCut?: () => void;
  /** Called when Ctrl+V is pressed (paste with offset). */
  onPaste?: () => void;
  /** Called when Ctrl+Shift+V is pressed (paste in place). */
  onPasteInPlace?: () => void;
  /** Called when Ctrl+D is pressed (duplicate with offset). */
  onDuplicate?: () => void;
  /** Called when Ctrl+Shift+Up/Down/Up-plain/Down-plain are pressed (z-order). */
  onArrange?: (direction: "front" | "back" | "forward" | "backward") => void;
  /** Called when Ctrl+G is pressed (group). */
  onGroup?: () => void;
  /** Called when Ctrl+Shift+G is pressed (ungroup). */
  onUngroup?: () => void;
  /** Called when Ctrl+B is pressed (break apart). */
  onBreakApart?: () => void;
  /** Called when Space or Enter is pressed to toggle playback. */
  onPlayToggle?: () => void;
  /** Called on every mouse-move with the current stage-space cursor coordinates. */
  onCursorMove?: (x: number, y: number) => void;
  /** Ghost frames for onion skinning. When provided, rendered before the main frame. */
  onionFrames?: OnionFrame[];
  /**
   * Full timeline (with all layers) for drawing motion path overlays.
   * When provided, dashed motion paths are drawn on the stage for layers
   * that have an active motion tween at the current frame.
   */
  timeline?: TimelineModel;
  /**
   * Optional overlay rendered inside the stage container (in stage coordinate space,
   * with CSS zoom/pan applied). Use this to render SVG overlays like transform handles.
   */
  stageOverlay?: React.ReactNode;
  /**
   * When true, clicking on an object from a ghost frame (onion range) will jump
   * the timeline to that frame. Used for Edit Multiple Frames mode.
   */
  editMultipleFrames?: boolean;
  /**
   * Called when the user clicks an object from a non-current ghost frame while
   * editMultipleFrames is active. The timeline should jump to this frame index.
   */
  onEditMultipleFrameClick?: (frameIndex: number) => void;
  /**
   * When true, hovering or clicking a button instance on stage previews its
   * Over/Down/Up state (Control > Enable Simple Buttons).
   */
  simpleButtonsEnabled?: boolean;
}

// Draw tools that create shapes via drag
const SHAPE_DRAW_TOOLS: ReadonlySet<ToolId> = new Set(["oval", "rect", "line", "polystar"]);

/** Returns the first gradient fill found in a shape's paths, or null. */
function getShapeGradientFill(shape: Shape): import("@flash/core").LinearGradientFill | import("@flash/core").RadialGradientFill | null {
  for (const path of shape.paths) {
    if (path.fill && (path.fill.type === "linear-gradient" || path.fill.type === "radial-gradient")) {
      return path.fill as import("@flash/core").LinearGradientFill | import("@flash/core").RadialGradientFill;
    }
  }
  return null;
}

/** Returns the gradient transform handle positions in stage coords given shape bounds. */
function getGradientHandlePositions(bounds: { x: number; y: number; width: number; height: number }, angle: number) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  // Scale handle: along gradient angle direction, half-width out from center
  const rad = (angle * Math.PI) / 180;
  const scaleHandleDist = bounds.width / 2;
  const scaleX = cx + Math.cos(rad) * scaleHandleDist;
  const scaleY = cy + Math.sin(rad) * scaleHandleDist;
  // Rotate handle: perpendicular to gradient, half-height out from center
  const rotHandleDist = bounds.height / 2 + 20;
  const rotX = cx + Math.cos(rad - Math.PI / 2) * rotHandleDist;
  const rotY = cy + Math.sin(rad - Math.PI / 2) * rotHandleDist;
  return { cx, cy, scaleX, scaleY, rotX, rotY };
}

// ---------------------------------------------------------------------------
// Transform handle types and helpers
// ---------------------------------------------------------------------------

type TransformHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

interface HandlePosition {
  id: TransformHandle;
  x: number;
  y: number;
}

function getHandlePositions(b: { x: number; y: number; width: number; height: number }): HandlePosition[] {
  const { x, y, width: w, height: h } = b;
  return [
    { id: "nw", x, y },
    { id: "n", x: x + w / 2, y },
    { id: "ne", x: x + w, y },
    { id: "e", x: x + w, y: y + h / 2 },
    { id: "se", x: x + w, y: y + h },
    { id: "s", x: x + w / 2, y: y + h },
    { id: "sw", x, y: y + h },
    { id: "w", x, y: y + h / 2 },
  ];
}

const HANDLE_CURSORS: Record<TransformHandle, React.CSSProperties["cursor"]> = {
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
  rotate: "crosshair",
};

// ---------------------------------------------------------------------------
// Free Transform — Distort / Envelope mesh-handle plumbing
// ---------------------------------------------------------------------------

/** A draggable warp control point: one of 4 corners or 8 envelope edge controls. */
type WarpHandleId =
  | "nw" | "ne" | "se" | "sw"
  | "t0" | "t1" | "r0" | "r1" | "b0" | "b1" | "l0" | "l1";

interface WarpHandle {
  id: WarpHandleId;
  x: number;
  y: number;
  /** Corners draw as squares; edge controls draw as circles. */
  kind: "corner" | "edge";
}

/**
 * Return the object's current warp, or build an identity warp from its
 * transformed AABB when none has been applied yet. The mode argument forces
 * the warp into the requested editor mode (switching distort↔envelope reuses
 * the existing corners and synthesises identity edges as needed).
 */
function getOrInitWarp(
  obj: ShapeDisplayObject,
  bounds: { x: number; y: number; width: number; height: number },
  mode: "distort" | "envelope"
): ShapeWarp {
  const existing = obj.warp;
  if (!existing) return identityWarp(bounds, mode);
  if (existing.mode === mode && (mode === "distort" || existing.edges)) return existing;
  // Switching modes: keep corners, (re)derive edges for envelope.
  if (mode === "distort") {
    return { mode, origBounds: existing.origBounds, corners: existing.corners };
  }
  const c = existing.corners;
  const lerp = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const edges: WarpEdges = existing.edges ?? {
    t0: lerp(c.nw, c.ne, 1 / 3), t1: lerp(c.nw, c.ne, 2 / 3),
    r0: lerp(c.ne, c.se, 1 / 3), r1: lerp(c.ne, c.se, 2 / 3),
    b0: lerp(c.sw, c.se, 1 / 3), b1: lerp(c.sw, c.se, 2 / 3),
    l0: lerp(c.nw, c.sw, 1 / 3), l1: lerp(c.nw, c.sw, 2 / 3),
  };
  return { mode, origBounds: existing.origBounds, corners: c, edges };
}

/** Enumerate the draggable handle positions for a warp (corners + envelope edges). */
function getWarpHandles(warp: ShapeWarp): WarpHandle[] {
  const c = warp.corners;
  const handles: WarpHandle[] = [
    { id: "nw", x: c.nw.x, y: c.nw.y, kind: "corner" },
    { id: "ne", x: c.ne.x, y: c.ne.y, kind: "corner" },
    { id: "se", x: c.se.x, y: c.se.y, kind: "corner" },
    { id: "sw", x: c.sw.x, y: c.sw.y, kind: "corner" },
  ];
  if (warp.mode === "envelope" && warp.edges) {
    const e = warp.edges;
    (["t0", "t1", "r0", "r1", "b0", "b1", "l0", "l1"] as const).forEach((id) => {
      const p = e[id];
      handles.push({ id, x: p.x, y: p.y, kind: "edge" });
    });
  }
  return handles;
}

/**
 * Apply a new absolute position to one warp control point, returning a new
 * ShapeWarp. Dragging a CORNER also drags its two adjacent edge controls by the
 * same delta (envelope), so the corner's tangents follow it — matching Flash's
 * behaviour where moving a corner carries its handles.
 */
function moveWarpHandle(warp: ShapeWarp, id: WarpHandleId, nx: number, ny: number): ShapeWarp {
  const setP = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });
  if (id === "nw" || id === "ne" || id === "se" || id === "sw") {
    const old = warp.corners[id];
    const dx = nx - old.x;
    const dy = ny - old.y;
    const corners: WarpCorners = { ...warp.corners, [id]: { x: nx, y: ny } };
    if (warp.mode !== "envelope" || !warp.edges) {
      return { ...warp, corners };
    }
    // Carry the two edge controls anchored at this corner.
    const e = { ...warp.edges };
    const adj: Record<typeof id, (keyof WarpEdges)[]> = {
      nw: ["t0", "l0"],
      ne: ["t1", "r0"],
      se: ["r1", "b1"],
      sw: ["b0", "l1"],
    } as Record<typeof id, (keyof WarpEdges)[]>;
    for (const ek of adj[id]) {
      e[ek] = setP(warp.edges[ek], dx, dy);
    }
    return { ...warp, corners, edges: e };
  }
  // Edge control point.
  if (!warp.edges) return warp;
  const edges: WarpEdges = { ...warp.edges, [id]: { x: nx, y: ny } };
  return { ...warp, edges };
}

/** Build the polygon outline of the warped quad (used to draw the mesh frame). */
function warpOutlinePoints(warp: ShapeWarp, samplesPerEdge = 12): Point[] {
  const pts: Point[] = [];
  // top (v=0, u 0→1), right (u=1, v 0→1), bottom (v=1, u 1→0), left (u=0, v 1→0)
  for (let i = 0; i < samplesPerEdge; i++) pts.push(evalWarp(warp, i / samplesPerEdge, 0));
  for (let i = 0; i < samplesPerEdge; i++) pts.push(evalWarp(warp, 1, i / samplesPerEdge));
  for (let i = 0; i < samplesPerEdge; i++) pts.push(evalWarp(warp, 1 - i / samplesPerEdge, 1));
  for (let i = 0; i < samplesPerEdge; i++) pts.push(evalWarp(warp, 0, 1 - i / samplesPerEdge));
  return pts;
}

interface DrawPreview {
  tool: "oval" | "rect" | "line" | "polystar";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ---------------------------------------------------------------------------
// Snap helpers
// ---------------------------------------------------------------------------

/**
 * Snap a value to the nearest grid line if it is within snapRadius pixels.
 * Returns the snapped value when within range, otherwise the original value.
 */
function snapValueToGrid(val: number, gridSize: number, snapRadius: number = 5): number {
  const snapped = Math.round(val / gridSize) * gridSize;
  return Math.abs(val - snapped) < snapRadius ? snapped : val;
}

/**
 * Snap-to-grid: adjust dx/dy so the dragged object's edges/center land on grid lines.
 * We snap all three candidate X positions (left, center, right) and all three Y positions
 * (top, center, bottom) and pick the closest snap in each axis.
 */
function applySnapToGrid(
  dx: number,
  dy: number,
  bounds: { x: number; y: number; width: number; height: number },
  gridWidth: number,
  gridHeight: number,
  snapRadius: number = 5
): { dx: number; dy: number } {
  // Candidate X positions (left, center, right edges of dragged object after dx)
  const candidateXs = [
    bounds.x + dx,
    bounds.x + bounds.width / 2 + dx,
    bounds.x + bounds.width + dx,
  ];
  // Candidate Y positions (top, center, bottom edges of dragged object after dy)
  const candidateYs = [
    bounds.y + dy,
    bounds.y + bounds.height / 2 + dy,
    bounds.y + bounds.height + dy,
  ];

  // Find the best (smallest) snap delta for X
  let bestDX = 0;
  let bestDXDist = Infinity;
  for (const cx of candidateXs) {
    const snapped = snapValueToGrid(cx, gridWidth, snapRadius);
    const dist = Math.abs(cx - snapped);
    if (dist < bestDXDist) {
      bestDXDist = dist;
      bestDX = snapped - cx;
    }
  }

  // Find the best (smallest) snap delta for Y
  let bestDY = 0;
  let bestDYDist = Infinity;
  for (const cy of candidateYs) {
    const snapped = snapValueToGrid(cy, gridHeight, snapRadius);
    const dist = Math.abs(cy - snapped);
    if (dist < bestDYDist) {
      bestDYDist = dist;
      bestDY = snapped - cy;
    }
  }

  // Only apply snap if within the snap radius
  return {
    dx: bestDXDist < snapRadius ? dx + bestDX : dx,
    dy: bestDYDist < snapRadius ? dy + bestDY : dy,
  };
}

/**
 * Snap-to-objects: adjust dx/dy so the dragged object snaps to the edges/centers of
 * nearby objects. Checks all 9 point pairs (3 X × 3 Y positions of dragged vs other objects).
 */
function applySnapToObjects(
  dx: number,
  dy: number,
  draggedBounds: { x: number; y: number; width: number; height: number },
  otherBounds: Array<{ x: number; y: number; width: number; height: number }>,
  snapRadius: number = 5
): { dx: number; dy: number } {
  // The 3 candidate X coords of the dragged object after applying dx
  const dragXs = [
    draggedBounds.x + dx,
    draggedBounds.x + draggedBounds.width / 2 + dx,
    draggedBounds.x + draggedBounds.width + dx,
  ];
  // The 3 candidate Y coords of the dragged object after applying dy
  const dragYs = [
    draggedBounds.y + dy,
    draggedBounds.y + draggedBounds.height / 2 + dy,
    draggedBounds.y + draggedBounds.height + dy,
  ];

  let bestSnapDX = Infinity;
  let bestSnapDY = Infinity;

  for (const other of otherBounds) {
    // The 3 snap targets on the other object (left, center, right / top, center, bottom)
    const otherXs = [other.x, other.x + other.width / 2, other.x + other.width];
    const otherYs = [other.y, other.y + other.height / 2, other.y + other.height];

    for (const dragX of dragXs) {
      for (const otherX of otherXs) {
        const diff = otherX - dragX;
        if (Math.abs(diff) < snapRadius && Math.abs(diff) < Math.abs(bestSnapDX)) {
          bestSnapDX = diff;
        }
      }
    }

    for (const dragY of dragYs) {
      for (const otherY of otherYs) {
        const diff = otherY - dragY;
        if (Math.abs(diff) < snapRadius && Math.abs(diff) < Math.abs(bestSnapDY)) {
          bestSnapDY = diff;
        }
      }
    }
  }

  return {
    dx: isFinite(bestSnapDX) ? dx + bestSnapDX : dx,
    dy: isFinite(bestSnapDY) ? dy + bestSnapDY : dy,
  };
}

// Preset zoom levels (as fractions, e.g. 1 = 100%)
const ZOOM_LEVELS = [0.25, 0.5, 1.0, 1.5, 2.0, 4.0, 8.0];

function clampZoom(z: number): number {
  return Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], z));
}

function nearestZoomLevel(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = ZOOM_LEVELS.find((z) => z > current + 1e-9);
    return next !== undefined ? next : current;
  } else {
    const prev = [...ZOOM_LEVELS].reverse().find((z) => z < current - 1e-9);
    return prev !== undefined ? prev : current;
  }
}

// Tools that should use crosshair cursor
const DRAW_TOOLS: ReadonlySet<ToolId> = new Set([
  "line", "oval", "rect", "polystar", "pencil", "brush", "pen", "fill", "ink-bottle", "eyedropper", "text", "lasso",
]);

function getToolCursor(
  tool: ToolId | undefined,
  spaceHeld: boolean
): React.CSSProperties["cursor"] {
  if (spaceHeld || tool === "hand") return "grab";
  if (tool === "zoom") return "zoom-in";
  if (tool === "eyedropper") return "cell";
  // Eraser uses a custom circle cursor (cursor:none + overlay circle)
  if (tool === "eraser") return "none";
  if (tool && DRAW_TOOLS.has(tool)) return "crosshair";
  return "default";
}

// ---------------------------------------------------------------------------
// Stage area right-click context menu
// ---------------------------------------------------------------------------

interface StageContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onAction: (action: string) => void;
  onClose: () => void;
  canGroup: boolean;
  canUngroup: boolean;
  hasPaste: boolean;
}

function StageContextMenu({
  x,
  y,
  hasSelection,
  onAction,
  onClose,
  canGroup,
  canUngroup,
  hasPaste,
}: StageContextMenuProps): React.ReactElement {
  const items: {
    label: string;
    action: string;
    shortcut?: string;
    separator?: boolean;
    disabled?: boolean;
  }[] = hasSelection
    ? [
        { label: "Cut", action: "cut", shortcut: "Ctrl+X" },
        { label: "Copy", action: "copy", shortcut: "Ctrl+C" },
        { label: "Paste", action: "paste", shortcut: "Ctrl+V" },
        { label: "Delete", action: "delete", shortcut: "Del" },
        { label: "Select All", action: "select-all", shortcut: "Ctrl+A" },
        { label: "---", action: "---1", separator: true },
        { label: "Convert to Symbol...", action: "convert-to-symbol", shortcut: "F8" },
        ...(canGroup
          ? [{ label: "Group", action: "group", shortcut: "Ctrl+G" }]
          : []),
        ...(canUngroup
          ? [{ label: "Ungroup", action: "ungroup", shortcut: "Ctrl+Shift+G" }]
          : []),
        { label: "---", action: "---2", separator: true },
        { label: "Bring to Front", action: "bring-to-front", shortcut: "Ctrl+Shift+↑" },
        { label: "Send to Back", action: "send-to-back", shortcut: "Ctrl+Shift+↓" },
      ]
    : [
        { label: "Select All", action: "select-all", shortcut: "Ctrl+A" },
        ...(hasPaste
          ? [{ label: "Paste", action: "paste", shortcut: "Ctrl+V" }]
          : []),
      ];

  return (
    <>
      {/* Backdrop to dismiss on outside click */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
        }}
        onMouseDown={() => onClose()}
      />
      {/* Menu popup */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: x,
          top: y,
          // Flash 8 / XP light context menu.
          background: themeChrome.panelBg,
          border: `1px solid ${themeChrome.separator}`,
          borderRadius: 3,
          zIndex: 9999,
          minWidth: 180,
          boxShadow: "2px 4px 12px rgba(0,0,0,0.35)",
          padding: "3px 0",
        }}
      >
        {items.map((item) => {
          if (item.separator) {
            return (
              <div
                key={item.action}
                style={{
                  height: 1,
                  background: themeChrome.separator,
                  margin: "3px 0",
                }}
              />
            );
          }
          const isDisabled = !!item.disabled;
          return (
            <div
              key={item.action}
              onClick={() => {
                if (!isDisabled) {
                  onAction(item.action);
                  onClose();
                }
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 12px",
                fontSize: 11,
                color: isDisabled ? themeChrome.textDisabled : themeChrome.textDefault,
                cursor: isDisabled ? "default" : "pointer",
                gap: 16,
              }}
              onMouseEnter={(e) => {
                if (!isDisabled) {
                  (e.currentTarget as HTMLElement).style.background = themeHalo.haloBlue;
                  (e.currentTarget as HTMLElement).style.color = "#ffffff";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = isDisabled
                  ? themeChrome.textDisabled
                  : themeChrome.textDefault;
              }}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <span style={{ fontSize: 10, color: themeChrome.textDisabled }}>{item.shortcut}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Pasteboard (work-area) margin in stage pixels surrounding the white stage rect.
 *
 * Real Flash 8 renders and lets you fully select/drag objects sitting on the gray
 * pasteboard OUTSIDE the white stage — the stage rect is only the publish crop guide.
 * Our render <canvas> + grid canvas + CanvasRenderer backing buffer used to be sized
 * to EXACTLY stageW×H, so anything at x<0 / y<0 / x>stageW / y>stageH was clipped
 * away by the canvas's own dimensions (invisible, and its selection halo too). We now
 * enlarge those surfaces by this margin on every side and translate all drawing by it,
 * so off-stage content renders on the pasteboard and is fully visible/selectable. The
 * stage rect (white fill + edge shadow) remains the visual boundary on top.
 *
 * Sized generously relative to the stage so common "tween in from off-screen" staging
 * (a symbol parked just past the left/top edge) lands on the visible pasteboard, while
 * staying bounded so the backing bitmap doesn't balloon on huge stages.
 */
export function computePasteboardMargin(stageWidth: number, stageHeight: number): number {
  const byStage = Math.round(Math.max(stageWidth, stageHeight) * 0.6);
  return Math.max(220, Math.min(byStage, 900));
}

export function StageArea({
  stageWidth = 550,
  stageHeight = 400,
  backgroundColor = "#ffffff",
  zoom = 1,
  panX = 0,
  panY = 0,
  showGrid = false,
  gridWidth = 18,
  gridHeight = 18,
  gridColor = "#999999",
  snapToPixels = false,
  viewMode = "normal",
  activeTool,
  instances = [],
  instanceNames: _instanceNames = {},
  selectedInstanceId,
  onZoomChange,
  onPanChange,
  onDrop,
  onDropComponent,
  onInstanceSelect,
  currentFrame: _currentFrame = 0,
  shapeDisplayObjects = [],
  onShapeCreated,
  selectedShapeId,
  selectedShapeIds = [],
  onShapeSelect,
  onShapeSelectMultiple,
  partialSelectEnabled = false,
  subSelection = null,
  onSubSelect,
  onSubSplitMove,
  onShapeMove,
  onShapeMoveEnd,
  onShapeDelete,
  onDeleteSelected,
  onShapeResize,
  onShapeRotate,
  onShapeWarp,
  onShapeUpdate,
  guides = [],
  showGuides = true,
  snapToGuides = false,
  onGuideMove,
  onGuideDelete,
  snapToGrid = false,
  snapToObjects = false,
  textDisplayObjects = [],
  onTextCreated,
  onTextPlace,
  editingTextId,
  onTextEdit,
  onTextEditEnd,
  textFormat = {
    fontFamily: "Arial",
    fontSize: 12,
    bold: false,
    italic: false,
    align: "left" as const,
    color: "#000000",
  },
  bitmapDisplayObjects = [],
  bitmapLibraryItems = [],
  onRendererReady,
  pencilMode = "ink",
  brushSize = 8,
  brushShape = "round",
  rectCornerRadius = 0,
  eraserSize = 16,
  eraserMode = "normal",
  eraserFaucet = false,
  strokeColor: propStrokeColor = "#000000",
  strokeWidth: propStrokeWidth = 1,
  strokeAlpha: propStrokeAlpha = 100,
  fill: propFill = null,
  onEyedropperSample,
  freeTransformMode = "rotate-scale",
  lassoPolygonMode = false,
  lassoMagicWand = false,
  magicWandThreshold = 20,
  magicWandSmoothing = "pixels" as const,
  polyStarOptions = { shapeType: "polygon", sides: 5, pointSize: 0.5 },
  onShapeGradientUpdate,
  sceneGraph: propSceneGraph,
  library,
  onConvertToSymbol,
  onInstanceDoubleClick,
  symbolInstanceDisplayObjects = [],
  otherLayerSelectables = [],
  onSymbolInstanceDoubleClick,
  parentSceneGraph,
  onExitSymbolEdit,
  onCopy,
  onCut,
  onPaste,
  onPasteInPlace,
  onDuplicate,
  onArrange,
  onGroup,
  onUngroup,
  onBreakApart,
  onPlayToggle,
  onionFrames = [],
  timeline,
  stageOverlay,
  editMultipleFrames = false,
  onEditMultipleFrameClick,
  onCursorMove,
  simpleButtonsEnabled = false,
}: StageAreaProps): React.ReactElement {
  const workAreaRef = useRef<HTMLDivElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);

  // Pasteboard margin (stage px) around the white stage. The render/grid canvases and
  // the renderer backing buffer span stage + this margin on every side; stage origin
  // (0,0) maps to canvas pixel (pasteboardMargin, pasteboardMargin). This is what lets
  // off-stage content render and be selectable on the gray pasteboard. The canvases are
  // positioned at top/left = -pasteboardMargin inside the stage box so the stage rect
  // (white fill + edge shadow) stays exactly where it was visually.
  const pasteboardMargin = useMemo(
    () => computePasteboardMargin(stageWidth, stageHeight),
    [stageWidth, stageHeight]
  );
  const canvasWidth = stageWidth + pasteboardMargin * 2;
  const canvasHeight = stageHeight + pasteboardMargin * 2;

  // Internal pan/zoom state — we manage locally and call callbacks
  const [internalZoom, setInternalZoom] = useState(zoom);
  const [internalPanX, setInternalPanX] = useState(panX);
  const [internalPanY, setInternalPanY] = useState(panY);
  // Ref mirrors internalZoom so event handlers can read current value without stale closures
  const internalZoomRef = useRef(zoom);
  useEffect(() => { internalZoomRef.current = internalZoom; }, [internalZoom]);

  // Drawing tool state
  const [drawPreview, setDrawPreview] = useState<DrawPreview | null>(null);
  const drawStartRef = useRef<{ stageX: number; stageY: number } | null>(null);
  const selectionDragRef = useRef<{
    shapeId: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  } | null>(null);

  // P3 — partial (face/segment) split-on-move drag state. Armed when a partial
  // selection is dragged; the split is committed on mouse-up (no per-frame rebuild).
  const subSplitDragRef = useRef<{
    selection: SubSelection;
    startMouseX: number;
    startMouseY: number;
  } | null>(null);

  // P3 live drag-preview (task 1331). While a split-on-move drag is in flight we
  // show the dragged piece following the cursor WITHOUT mutating the doc (the
  // authoritative split is committed once on mouse-up via onSubSplitMove). The
  // planar split is run ONCE when the drag first crosses the click threshold to
  // extract the {remainder, extracted} geometry; subsequent moves only translate
  // the already-extracted geometry by the live offset (a pure render translate —
  // no per-move planar recompute). `baseX/baseY` is the dragged shape's display
  // origin (kept fixed); `dx/dy` is the live cursor offset in stage units.
  const subSplitPreviewRef = useRef<{
    shapeId: string;
    remainder: Shape | null;
    extracted: Shape | null;
    baseX: number;
    baseY: number;
  } | null>(null);
  // State mirror so a render fires on each preview move. Holds the live offset.
  const [subSplitPreview, setSubSplitPreview] = useState<{
    shapeId: string;
    extractedId: string;
    remainder: Shape | null;
    extracted: Shape | null;
    baseX: number;
    baseY: number;
    dx: number;
    dy: number;
  } | null>(null);

  // Transform drag state (resize / rotate handles)
  const transformDragRef = useRef<{
    handle: TransformHandle;
    shapeId: string;
    startStageX: number;
    startStageY: number;
    origBounds: { x: number; y: number; width: number; height: number };
    origX: number;
    origY: number;
    origScaleX: number;
    origScaleY: number;
    origRotation: number;
    /** Angle (degrees) from shape center to mouse at drag start — used for rotate delta. */
    startAngle?: number;
  } | null>(null);

  // Free Transform Distort / Envelope mesh-warp drag state. Holds the control
  // point being dragged and the warp snapshot at drag start.
  const warpDragRef = useRef<{
    handle: WarpHandleId;
    shapeId: string;
    warp: ShapeWarp;
  } | null>(null);

  // Cursor to show when hovering over a handle
  const [handleCursor, setHandleCursor] = useState<React.CSSProperties["cursor"]>(undefined);

  // Gradient transform drag state
  type GradientHandle = "center" | "scale" | "rotate";
  const gradientDragRef = useRef<{
    handle: GradientHandle;
    shapeId: string;
    startStageX: number;
    startStageY: number;
    /** Center of the shape bounds at drag start */
    centerX: number;
    centerY: number;
    /** Original gradient angle (for linear) or focalPoint (for radial) */
    origAngle: number;
    origFocalPoint: number;
    /** Angle from center to mouse at drag start (for rotation handle) */
    startAngle: number;
  } | null>(null);

  // Guide drag state
  const guideDragRef = useRef<{
    guideId: string;
    orientation: "horizontal" | "vertical";
  } | null>(null);

  // Text tool editing state
  const [textEditState, setTextEditState] = useState<{
    stageX: number;
    stageY: number;
    editingId: string | null; // null = creating new, non-null = editing existing
    initialText: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pen tool state
  const [penState, setPenState] = useState<PenState>({
    anchors: [],
    dragStart: null,
    currentHandleOut: null,
    cursorPos: null,
  });

  // Subselection tool state
  const [subselState, setSubselState] = useState<{
    selectedObjectId: string | null;
    selectedAnchorIndex: number | null;
  }>({ selectedObjectId: null, selectedAnchorIndex: null });
  const subselDragRef = useRef<{
    anchorIndex: number;
    objectId: string;
    startMouseX: number;
    startMouseY: number;
    origAnchorX: number;
    origAnchorY: number;
  } | null>(null);

  // Pencil tool state
  const pencilPointsRef = useRef<Point[]>([]);
  const [pencilPreviewPoints, setPencilPreviewPoints] = useState<Point[]>([]);

  // Brush tool state
  const brushPointsRef = useRef<Point[]>([]);
  const [brushPreviewPoints, setBrushPreviewPoints] = useState<Point[]>([]);

  // Eraser tool state
  const eraserPointsRef = useRef<Point[] | null>(null);
  // Tracks erased object IDs during the current drag to avoid double-deleting
  const erasedIdsRef = useRef<Set<string>>(new Set());
  // Eraser cursor position in stage coords (for circle overlay)
  const [eraserCursorPos, setEraserCursorPos] = useState<{ stageX: number; stageY: number } | null>(null);

  // Lasso tool state
  const [lassoPoints, setLassoPoints] = useState<Point[]>([]);
  const lassoCapturingRef = useRef(false);
  // Polygon lasso: vertices added per-click; close on double-click or near start
  const [lassoPolyVertices, setLassoPolyVertices] = useState<Point[]>([]);
  const lassoPolyLastClickRef = useRef<{ x: number; y: number; time: number } | null>(null);
  // Mirror of lassoPolyVertices for use inside window keydown handlers (whose
  // effects close over a stale snapshot of the state).
  const lassoPolyVerticesRef = useRef<Point[]>([]);
  lassoPolyVerticesRef.current = lassoPolyVertices;

  // Free Transform marquee selection state
  const [ftMarqueeStart, setFtMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [ftMarqueeEnd, setFtMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  const [ftIsMarqueeSelecting, setFtIsMarqueeSelecting] = useState(false);

  // Arrow (selection) tool marquee state
  const [selMarqueeStart, setSelMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [selMarqueeEnd, setSelMarqueeEnd] = useState<{ x: number; y: number } | null>(null);
  const [selIsMarqueeSelecting, setSelIsMarqueeSelecting] = useState(false);

  // Enable Simple Buttons: track which button instance is hovered / pressed
  const [hoveredButtonId, setHoveredButtonId] = useState<string | null>(null);
  const [pressedButtonId, setPressedButtonId] = useState<string | null>(null);

  // Stage context menu state
  const [stageContextMenu, setStageContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Keep internal state in sync with props when they change externally
  useEffect(() => { setInternalZoom(zoom); }, [zoom]);
  useEffect(() => { setInternalPanX(panX); }, [panX]);
  useEffect(() => { setInternalPanY(panY); }, [panY]);

  // Track whether spacebar is held for hand-tool pan
  const [spaceHeld, setSpaceHeld] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null);

  // Convert viewport (screen) coordinates to stage coordinates
  const toStageCoords = useCallback(
    (clientX: number, clientY: number): { stageX: number; stageY: number } => {
      const workArea = workAreaRef.current;
      if (!workArea) return { stageX: 0, stageY: 0 };
      const rect = workArea.getBoundingClientRect();
      const containerCenterX = rect.left + rect.width / 2;
      const containerCenterY = rect.top + rect.height / 2;
      const stageCenterScreenX = containerCenterX + internalPanX * internalZoom;
      const stageCenterScreenY = containerCenterY + internalPanY * internalZoom;
      const stageX = (clientX - stageCenterScreenX) / internalZoom + stageWidth / 2;
      const stageY = (clientY - stageCenterScreenY) / internalZoom + stageHeight / 2;
      return { stageX, stageY };
    },
    [internalPanX, internalPanY, internalZoom, stageWidth, stageHeight]
  );

  // Compute "fit" zoom so stage fits inside the work area
  const computeFitZoom = useCallback((): number => {
    const el = workAreaRef.current;
    if (!el) return 1;
    const containerW = el.clientWidth;
    const containerH = el.clientHeight;
    const margin = 40;
    const fitZ = Math.min(
      (containerW - margin) / stageWidth,
      (containerH - margin) / stageHeight
    );
    return clampZoom(fitZ);
  }, [stageWidth, stageHeight]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isWithinRufflePlayer(e)) return;
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only activate hand tool if not typing in an input
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          setSpaceHeld(true);
        }
      }
      const isModifier = e.ctrlKey || e.metaKey;
      if (isModifier && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        // Read current zoom from ref to avoid stale closure; compute next outside updater
        const next = nearestZoomLevel(internalZoomRef.current, 1);
        setInternalZoom(next);
        if (next !== internalZoomRef.current) onZoomChange?.(next);
      }
      if (isModifier && e.key === "-") {
        e.preventDefault();
        const next = nearestZoomLevel(internalZoomRef.current, -1);
        setInternalZoom(next);
        if (next !== internalZoomRef.current) onZoomChange?.(next);
      }
      if (isModifier && e.key === "0") {
        e.preventDefault();
        const fit = computeFitZoom();
        setInternalZoom(fit);
        setInternalPanX(0);
        setInternalPanY(0);
        onZoomChange?.(fit);
        onPanChange?.(0, 0);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [computeFitZoom, onZoomChange, onPanChange]);

  // Mouse wheel → zoom centered on cursor
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      setInternalZoom((prevZoom) => {
        const direction: 1 | -1 = e.deltaY < 0 ? 1 : -1;
        const nextZoom = nearestZoomLevel(prevZoom, direction);
        if (nextZoom === prevZoom) return prevZoom;
        return nextZoom;
      });
    },
    []
  );

  // After wheel zoom, adjust pan to keep the cursor-point fixed and notify parent
  const wheelCursorRef = useRef<{ x: number; y: number } | null>(null);
  const prevWheelZoomRef = useRef<number | null>(null);

  const onWheelCapture = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const workArea = workAreaRef.current;
      if (!workArea) return;
      const rect = workArea.getBoundingClientRect();
      wheelCursorRef.current = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };
      prevWheelZoomRef.current = internalZoom;
    },
    [internalZoom]
  );

  useEffect(() => {
    const cursor = wheelCursorRef.current;
    const prevZoom = prevWheelZoomRef.current;
    if (cursor === null || prevZoom === null || internalZoom === prevZoom) return;
    wheelCursorRef.current = null;
    prevWheelZoomRef.current = null;

    const nextZoom = internalZoom;
    const stageCoordX = (cursor.x - internalPanX * prevZoom) / prevZoom;
    const newPanX = (cursor.x - stageCoordX * nextZoom) / nextZoom;
    const stageCoordY = (cursor.y - internalPanY * prevZoom) / prevZoom;
    const newPanY = (cursor.y - stageCoordY * nextZoom) / nextZoom;

    setInternalPanX(newPanX);
    setInternalPanY(newPanY);
    onZoomChange?.(nextZoom);
    onPanChange?.(newPanX, newPanY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internalZoom]);

  // Mouse events for panning (middle mouse, space+drag, or hand tool drag)
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Enable Simple Buttons: track pressed state on button instances
      if (simpleButtonsEnabled && e.button === 0 && hoveredButtonId) {
        setPressedButtonId(hoveredButtonId);
      }

      const isMiddle = e.button === 1;
      const isSpaceDrag = e.button === 0 && spaceHeld;
      const isHandTool = e.button === 0 && activeTool === "hand";

      if (isMiddle || isSpaceDrag || isHandTool) {
        e.preventDefault();
        isPanningRef.current = true;
        panStartRef.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          panX: internalPanX,
          panY: internalPanY,
        };
        return;
      }

      // Drawing tools: start a draw gesture
      if (e.button === 0 && activeTool && SHAPE_DRAW_TOOLS.has(activeTool as "oval" | "rect" | "line")) {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        drawStartRef.current = { stageX, stageY };
        return;
      }

      // Pencil tool: start capturing freehand stroke
      if (e.button === 0 && activeTool === "pencil") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        pencilPointsRef.current = [{ x: stageX, y: stageY }];
        setPencilPreviewPoints([{ x: stageX, y: stageY }]);
        return;
      }

      // Brush tool: start capturing brush stroke
      if (e.button === 0 && activeTool === "brush") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        brushPointsRef.current = [{ x: stageX, y: stageY }];
        setBrushPreviewPoints([{ x: stageX, y: stageY }]);
        return;
      }

      // Eraser tool: start erase gesture
      if (e.button === 0 && activeTool === "eraser") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        // P4 Faucet mode (planar): a single click removes a WHOLE fill
        // or line under the cursor. Operate on the topmost merged mergeable shape.
        if (eraserFaucet) {
          for (let i = shapeDisplayObjects.length - 1; i >= 0; i--) {
            const obj = shapeDisplayObjects[i];
            if ((obj.x ?? 0) !== 0 || (obj.y ?? 0) !== 0 || !isMergeableShape(obj.shape)) continue;
            const { shape: next } = faucetEraseShape(obj.shape, { x: stageX, y: stageY });
            if (next === null) {
              onShapeDelete?.(obj.id);
              break;
            } else if (next !== obj.shape) {
              onShapeUpdate?.(obj.id, next);
              break;
            }
          }
          return;
        }
        eraserPointsRef.current = [{ x: stageX, y: stageY }];
        erasedIdsRef.current = new Set();
        return;
      }

      // Ink Bottle tool: click to apply stroke to a shape
      if (e.button === 0 && activeTool === "ink-bottle") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        if (hit && onShapeUpdate) {
          // Stroke None: alpha 0 or width 0 removes stroke
          const newStroke: SolidStroke | null = (propStrokeAlpha > 0 && propStrokeWidth > 0)
            ? {
                type: "solid",
                color: hexToColor(propStrokeColor, Math.round((propStrokeAlpha / 100) * 255)),
                width: propStrokeWidth,
                caps: "round",
                joints: "round",
                miterLimit: 3,
              }
            : null;
          const newPaths = hit.shape.paths.map((p) => ({ ...p, stroke: newStroke ?? undefined }));
          onShapeUpdate(hit.id, { ...hit.shape, paths: newPaths });
        }
        return;
      }

      // Paint Bucket tool: click to apply fill to a shape
      // propFill === null means "No Color" — remove the fill from the shape
      if (e.button === 0 && activeTool === "fill") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        if (hit && onShapeUpdate) {
          if (propFill) {
            // Apply the current fill to all paths
            const newPaths = hit.shape.paths.map((p) => ({ ...p, fill: propFill }));
            onShapeUpdate(hit.id, { ...hit.shape, paths: newPaths });
          } else {
            // No Color selected: remove fill from all paths
            const newPaths = hit.shape.paths.map((p) => {
              const { fill: _fill, ...rest } = p;
              return rest as typeof p;
            });
            onShapeUpdate(hit.id, { ...hit.shape, paths: newPaths });
          }
        }
        return;
      }

      // Eyedropper tool: click to sample fill/stroke from a shape
      if (e.button === 0 && activeTool === "eyedropper") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        if (hit) {
          onEyedropperSample?.(hit.id);
        }
        return;
      }

      // Lasso tool: start/continue lasso selection
      if (e.button === 0 && activeTool === "lasso") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);

        // Magic Wand sub-mode: flood-fill selection on a bitmap instance
        if (lassoMagicWand) {
          const hitBitmap = [...bitmapDisplayObjects].reverse().find((obj) =>
            stageX >= obj.x && stageX <= obj.x + obj.width &&
            stageY >= obj.y && stageY <= obj.y + obj.height
          );
          if (hitBitmap) {
            const bitmapItem = bitmapLibraryItems.find((item) => item.id === hitBitmap.libraryItemId);
            if (bitmapItem) {
              magicWandSelect(hitBitmap, bitmapItem, stageX, stageY, magicWandThreshold, magicWandSmoothing)
                .then((polygon) => {
                  if (polygon && polygon.length >= 3) {
                    const selectedId = findShapeInLasso([...polygon, polygon[0]], shapeDisplayObjects);
                    if (selectedId) onShapeSelect?.(selectedId);
                    else onShapeSelect?.(null);
                    setLassoPoints(polygon);
                  }
                });
            } else {
              // Bitmap item not found — log for debugging
              console.warn("[magic wand] bitmap library item not found:", hitBitmap.libraryItemId);
            }
          }
          return;
        }

        if (lassoPolygonMode) {
          // Polygon mode: each click adds a vertex. A double-click (within the
          // time/distance window) or a click on the start vertex closes the
          // polygon — decision delegated to the shared core helper so the close
          // logic is unit-tested. closeDistance is zoom-adjusted here.
          const now = Date.now();
          const last = lassoPolyLastClickRef.current;
          const closeDistance = POLYGON_CLOSE_DISTANCE / internalZoom;
          if (shouldClosePolygon(lassoPolyVertices, stageX, stageY, last, now, closeDistance)) {
            const verts = lassoPolyVertices;
            const selectedId = findShapeInLasso([...verts, verts[0]], shapeDisplayObjects);
            onShapeSelect?.(selectedId);
            setLassoPolyVertices([]);
            lassoPolyLastClickRef.current = null;
            return;
          }
          setLassoPolyVertices((prev) => [...prev, { x: stageX, y: stageY }]);
          lassoPolyLastClickRef.current = { x: stageX, y: stageY, time: now };
        } else {
          // Freehand mode: start capturing
          lassoCapturingRef.current = true;
          setLassoPoints([{ x: stageX, y: stageY }]);
        }
        return;
      }

      // Text tool: click to create or edit text
      if (e.button === 0 && activeTool === "text") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        // Check if clicking on an existing text object
        const hitText = [...textDisplayObjects].reverse().find((obj) => {
          return (
            stageX >= obj.x &&
            stageX <= obj.x + obj.width &&
            stageY >= obj.y &&
            stageY <= obj.y + obj.height
          );
        });
        if (hitText) {
          setTextEditState({
            stageX: hitText.x,
            stageY: hitText.y,
            editingId: hitText.id,
            initialText: hitText.text,
          });
          setTimeout(() => textareaRef.current?.focus(), 0);
        } else if (onTextPlace) {
          // Immediately place a new text object in the document, then open textarea
          const newTextObj: Omit<TextDisplayObject, "id"> = {
            type: "text",
            x: stageX,
            y: stageY,
            width: 100,
            height: 22,
            text: "Text",
            textType: "static",
            fontFamily: textFormat.fontFamily,
            fontSize: textFormat.fontSize,
            bold: textFormat.bold,
            italic: textFormat.italic,
            color: hexToColor(textFormat.color),
            align: textFormat.align,
            multiline: false,
            wordWrap: false,
          };
          onTextPlace(newTextObj, (id) => {
            setTextEditState({
              stageX,
              stageY,
              editingId: id,
              initialText: "Text",
            });
            setTimeout(() => textareaRef.current?.focus(), 0);
          });
        } else {
          // Fallback: open textarea without pre-creating (legacy behavior)
          setTextEditState({
            stageX,
            stageY,
            editingId: null,
            initialText: "",
          });
          setTimeout(() => textareaRef.current?.focus(), 0);
        }
        return;
      }

      // Pen tool: click or click-drag to add anchor points, close path on first anchor
      if (e.button === 0 && activeTool === "pen") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        // Check if clicking near the first anchor to close the path
        if (penState.anchors.length >= 2) {
          const first = penState.anchors[0];
          const dist = Math.hypot(stageX - first.x, stageY - first.y);
          if (dist <= 8 / internalZoom) {
            // Close the path and create the shape using current stroke/fill settings
            const anchors = penState.anchors;
            const penStroke: SolidStroke | undefined = (propStrokeAlpha > 0 && propStrokeWidth > 0)
              ? {
                  type: "solid",
                  color: hexToColor(propStrokeColor, Math.round((propStrokeAlpha / 100) * 255)),
                  width: propStrokeWidth,
                  caps: "round",
                  joints: "round",
                  miterLimit: 3,
                }
              : undefined;
            const shapePath = anchorsToShapePath(anchors, propFill ?? undefined, penStroke);
            const shapeId = "shape-pen-" + Date.now();
            const closedShape: Shape = {
              id: shapeId,
              paths: [shapePath],
            };
            onShapeCreated?.(closedShape, 0, 0);
            setPenState({ anchors: [], dragStart: null, currentHandleOut: null, cursorPos: null });
            return;
          }
        }
        // Start a new anchor — record drag start; handleOut determined on mouseMove/mouseUp
        setPenState((prev) => ({
          ...prev,
          dragStart: { x: stageX, y: stageY },
          currentHandleOut: null,
          cursorPos: { x: stageX, y: stageY },
        }));
        return;
      }

      // Subselection tool: click on shape or anchor point
      if (e.button === 0 && activeTool === "subselect") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);

        // Check if clicking on an anchor point of the selected object
        if (subselState.selectedObjectId) {
          const selObj = shapeDisplayObjects.find((o) => o.id === subselState.selectedObjectId);
          if (selObj) {
            // Build list of anchor points from shape path
            const path = selObj.shape.paths[0];
            if (path) {
              const anchPoints = [
                { x: selObj.x + path.start.x, y: selObj.y + path.start.y },
                ...path.segments.map((s) => ({ x: selObj.x + s.to.x, y: selObj.y + s.to.y })),
              ];
              for (let i = 0; i < anchPoints.length; i++) {
                const ap = anchPoints[i];
                if (Math.hypot(stageX - ap.x, stageY - ap.y) <= 6 / internalZoom) {
                  setSubselState((prev) => ({ ...prev, selectedAnchorIndex: i }));
                  subselDragRef.current = {
                    anchorIndex: i,
                    objectId: subselState.selectedObjectId!,
                    startMouseX: e.clientX,
                    startMouseY: e.clientY,
                    origAnchorX: ap.x - selObj.x,
                    origAnchorY: ap.y - selObj.y,
                  };
                  return;
                }
              }
            }
          }
        }

        // Hit-test shapes
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        if (hit) {
          setSubselState({ selectedObjectId: hit.id, selectedAnchorIndex: null });
        } else {
          setSubselState({ selectedObjectId: null, selectedAnchorIndex: null });
        }
        return;
      }

      // Gradient Transform tool: drag handles to rotate/scale gradient fills
      if (e.button === 0 && activeTool === "gradientTransform") {
        e.preventDefault();
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);

        if (selectedShapeId) {
          const selObj = shapeDisplayObjects.find((o) => o.id === selectedShapeId);
          if (selObj) {
            const gradFill = getShapeGradientFill(selObj.shape);
            if (gradFill) {
              const bounds = transformedShapeBounds(selObj);
              const angle = gradFill.type === "linear-gradient" ? gradFill.angle : 0;
              const { cx, cy, scaleX, scaleY, rotX, rotY } = getGradientHandlePositions(bounds, angle);
              const origAngle = gradFill.type === "linear-gradient" ? gradFill.angle : 0;
              const origFocalPoint = gradFill.type === "radial-gradient" ? gradFill.focalPoint : 0;

              // Check rotate handle
              if (Math.hypot(stageX - rotX, stageY - rotY) <= 10) {
                gradientDragRef.current = {
                  handle: "rotate",
                  shapeId: selectedShapeId,
                  startStageX: stageX,
                  startStageY: stageY,
                  centerX: cx,
                  centerY: cy,
                  origAngle,
                  origFocalPoint,
                  startAngle: Math.atan2(stageY - cy, stageX - cx) * (180 / Math.PI),
                };
                return;
              }

              // Check scale handle
              if (Math.hypot(stageX - scaleX, stageY - scaleY) <= 10) {
                gradientDragRef.current = {
                  handle: "scale",
                  shapeId: selectedShapeId,
                  startStageX: stageX,
                  startStageY: stageY,
                  centerX: cx,
                  centerY: cy,
                  origAngle,
                  origFocalPoint,
                  startAngle: 0,
                };
                return;
              }

              // Check center handle
              if (Math.hypot(stageX - cx, stageY - cy) <= 10) {
                gradientDragRef.current = {
                  handle: "center",
                  shapeId: selectedShapeId,
                  startStageX: stageX,
                  startStageY: stageY,
                  centerX: cx,
                  centerY: cy,
                  origAngle,
                  origFocalPoint,
                  startAngle: 0,
                };
                return;
              }
            }
          }
        }

        // Hit-test for shape selection
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        if (hit) {
          onShapeSelect?.(hit.id);
        } else if (editMultipleFrames && onionFrames.length > 0) {
          // In Edit Multiple Frames mode: if no current-frame hit, check ghost frames
          // sorted closest-to-current first so we prefer the nearest frame.
          const sortedGhosts = [...onionFrames].sort((a, b) => b.opacity - a.opacity);
          let ghostHit = false;
          for (const ghost of sortedGhosts) {
            for (const layer of ghost.sceneGraph.layers) {
              if (!layer.visible) continue;
              const shapes = layer.objects.filter((o): o is import("@flash/core").ShapeDisplayObject => o.type === "shape");
              const ghostShape = [...shapes].reverse().find((obj) => {
                const bounds = transformedShapeBounds(obj);
                return (
                  stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
                  stageY >= bounds.y && stageY <= bounds.y + bounds.height
                );
              });
              if (ghostShape) {
                onEditMultipleFrameClick?.(ghost.frameIndex);
                ghostHit = true;
                break;
              }
            }
            if (ghostHit) break;
          }
          if (!ghostHit) onShapeSelect?.(null);
        } else {
          onShapeSelect?.(null);
        }
        return;
      }

      // Free Transform tool: select shape + allow resize/rotate/distort handles
      if (e.button === 0 && activeTool === "free-transform") {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);

        // Check transform handles first if a shape is selected
        if (selectedShapeId) {
          const selObj = shapeDisplayObjects.find((o) => o.id === selectedShapeId);
          if (selObj) {
            const bounds = transformedShapeBounds(selObj);

            // Distort / Envelope: hit-test the warp mesh control points (4
            // corners always; +8 bezier edge controls in envelope mode) at
            // their warped positions. The drag updates a ShapeWarp, not scale.
            if (freeTransformMode === "distort" || freeTransformMode === "envelope") {
              const warp = getOrInitWarp(selObj, bounds, freeTransformMode);
              const warpHandles = getWarpHandles(warp);
              const tol = 8 / internalZoom;
              const hit = warpHandles.find(
                (h) => Math.abs(stageX - h.x) <= tol && Math.abs(stageY - h.y) <= tol
              );
              if (hit) {
                e.preventDefault();
                warpDragRef.current = {
                  handle: hit.id,
                  shapeId: selectedShapeId,
                  warp,
                };
                return;
              }
            }

            // Check rotation handle (rotate-scale mode)
            if (freeTransformMode === "rotate-scale") {
              const rotHandleX = bounds.x + bounds.width / 2;
              const rotHandleY = bounds.y - 20;
              const distToRot = Math.hypot(stageX - rotHandleX, stageY - rotHandleY);
              if (distToRot <= 10) {
                e.preventDefault();
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                transformDragRef.current = {
                  handle: "rotate",
                  shapeId: selectedShapeId,
                  startStageX: stageX,
                  startStageY: stageY,
                  origBounds: bounds,
                  origX: selObj.x,
                  origY: selObj.y,
                  origScaleX: selObj.scaleX ?? 1,
                  origScaleY: selObj.scaleY ?? 1,
                  origRotation: selObj.rotation ?? 0,
                  startAngle: Math.atan2(stageY - centerY, stageX - centerX) * (180 / Math.PI),
                };
                return;
              }

              // Check 8 resize handles
              const handles = getHandlePositions(bounds);
              const hitHandle = handles.find(
                (h) => Math.abs(stageX - h.x) <= 6 && Math.abs(stageY - h.y) <= 6
              );
              if (hitHandle) {
                e.preventDefault();
                transformDragRef.current = {
                  handle: hitHandle.id,
                  shapeId: selectedShapeId,
                  startStageX: stageX,
                  startStageY: stageY,
                  origBounds: bounds,
                  origX: selObj.x,
                  origY: selObj.y,
                  origScaleX: selObj.scaleX ?? 1,
                  origScaleY: selObj.scaleY ?? 1,
                  origRotation: selObj.rotation ?? 0,
                };
                return;
              }
            }
          }
        }

        // Hit-test shapes for selection
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        if (hit) {
          e.preventDefault();
          onShapeSelect?.(hit.id);
          selectionDragRef.current = {
            shapeId: hit.id,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startX: hit.x,
            startY: hit.y,
          };
        } else {
          // Start marquee selection on empty stage
          e.preventDefault();
          onShapeSelect?.(null);
          setFtMarqueeStart({ x: stageX, y: stageY });
          setFtMarqueeEnd({ x: stageX, y: stageY });
          setFtIsMarqueeSelecting(true);
        }
        return;
      }

      // Selection tool: hit-test shapes for drag
      if (e.button === 0 && activeTool === "selection") {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);

        // --- Check transform handles first (only if a shape is selected) ---
        if (selectedShapeId) {
          const selObj = shapeDisplayObjects.find((o) => o.id === selectedShapeId);
          if (selObj) {
            const bounds = transformedShapeBounds(selObj);

            // Check rotation handle
            const rotHandleX = bounds.x + bounds.width / 2;
            const rotHandleY = bounds.y - 20;
            const distToRot = Math.hypot(stageX - rotHandleX, stageY - rotHandleY);
            if (distToRot <= 10) {
              e.preventDefault();
              const centerX = bounds.x + bounds.width / 2;
              const centerY = bounds.y + bounds.height / 2;
              transformDragRef.current = {
                handle: "rotate",
                shapeId: selectedShapeId,
                startStageX: stageX,
                startStageY: stageY,
                origBounds: bounds,
                origX: selObj.x,
                origY: selObj.y,
                origScaleX: selObj.scaleX ?? 1,
                origScaleY: selObj.scaleY ?? 1,
                origRotation: selObj.rotation ?? 0,
                startAngle: Math.atan2(stageY - centerY, stageX - centerX) * (180 / Math.PI),
              };
              return;
            }

            // Check 8 resize handles
            const handles = getHandlePositions(bounds);
            const hitHandle = handles.find(
              (h) => Math.abs(stageX - h.x) <= 6 && Math.abs(stageY - h.y) <= 6
            );
            if (hitHandle) {
              e.preventDefault();
              transformDragRef.current = {
                handle: hitHandle.id,
                shapeId: selectedShapeId,
                startStageX: stageX,
                startStageY: stageY,
                origBounds: bounds,
                origX: selObj.x,
                origY: selObj.y,
                origScaleX: selObj.scaleX ?? 1,
                origScaleY: selObj.scaleY ?? 1,
                origRotation: selObj.rotation ?? 0,
              };
              return;
            }
          }
        }

        // --- Hit test shape bounding boxes (simple AABB) ---
        const hit = [...shapeDisplayObjects].reverse().find((obj) => {
          const bounds = transformedShapeBounds(obj);
          return (
            stageX >= bounds.x &&
            stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y &&
            stageY <= bounds.y + bounds.height
          );
        });
        if (hit) {
          e.preventDefault();
          // P3 — partial (face/segment) selection on the planar merge map. When
          // the flag is on, clicking a merged shape selects ONE fill region or
          // line segment; a drag splits it off (split-on-move). Dragging an
          // already-partial-selected piece keeps the selection and starts the
          // split drag. Whole-object selection (the block below) is used when the
          // flag is off — byte-identical to before.
          if (partialSelectEnabled && onSubSelect && !e.shiftKey) {
            const ps = livePlanarShape(hit.shape);
            const pt = { x: stageX - hit.x, y: stageY - hit.y };
            const dbl = (e as unknown as { detail?: number }).detail === 2;
            const keys = dbl ? planarPickConnected(ps, pt) : (() => {
              const k = planarPickAt(ps, pt, 4 / internalZoom);
              return k ? [k] : [];
            })();
            if (keys.length > 0) {
              const sel: SubSelection = { shapeId: hit.id, keys };
              onSubSelect(sel);
              // Arm the split-on-move drag (committed on mouse-up).
              subSplitDragRef.current = {
                selection: sel,
                startMouseX: e.clientX,
                startMouseY: e.clientY,
              };
            } else {
              onSubSelect(null);
            }
            return;
          }
          const hitAlreadySelected = selectedShapeIds.includes(hit.id);
          // If clicking an already-selected object in multi-select mode (no shift), start drag
          // without changing the selection. Otherwise, update selection normally.
          if (!hitAlreadySelected || e.shiftKey) {
            onShapeSelect?.(hit.id, e.shiftKey);
          }
          // Start a drag if not shift-toggling
          if (!e.shiftKey) {
            selectionDragRef.current = {
              shapeId: hit.id,
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              startX: hit.x,
              startY: hit.y,
            };
          }
          return;
        }

        // --- Hit test symbol instances (AABB derived from library bounds) ---
        const hitInst = [...symbolInstanceDisplayObjects].reverse().find((inst) => {
          const bounds = getSymbolInstanceBounds(inst, library);
          return (
            stageX >= bounds.x &&
            stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y &&
            stageY <= bounds.y + bounds.height
          );
        });
        if (hitInst) {
          e.preventDefault();
          const hitInstAlreadySelected = selectedShapeIds.includes(hitInst.id);
          if (!hitInstAlreadySelected || e.shiftKey) {
            onShapeSelect?.(hitInst.id, e.shiftKey);
          }
          if (!e.shiftKey) {
            selectionDragRef.current = {
              shapeId: hitInst.id,
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              startX: hitInst.x,
              startY: hitInst.y,
            };
          }
          return;
        }

        // --- Hit test text objects (simple AABB) ---
        const hitText = [...textDisplayObjects].reverse().find((obj) => {
          return (
            stageX >= obj.x &&
            stageX <= obj.x + obj.width &&
            stageY >= obj.y &&
            stageY <= obj.y + obj.height
          );
        });
        if (hitText) {
          e.preventDefault();
          const hitTextAlreadySelected = selectedShapeIds.includes(hitText.id);
          if (!hitTextAlreadySelected || e.shiftKey) {
            onShapeSelect?.(hitText.id, e.shiftKey);
          }
          if (!e.shiftKey) {
            selectionDragRef.current = {
              shapeId: hitText.id,
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              startX: hitText.x,
              startY: hitText.y,
            };
          }
          return;
        }

        // --- Cross-layer fallback hit-test (Flash 8 auto-switch — task 1364) ---
        // The active-layer hit-tests above all missed. Flash makes the clicked
        // object's layer active even when it lives on another layer, so probe the
        // other stage-selectable layers (visible/!locked/!guide, pre-filtered by
        // the producer) front-to-back. A hit selects the object via onShapeSelect;
        // Shell's handler resolves the owning layer and switches the active layer,
        // after which the object joins the active-layer arrays and drags/edits
        // normally. We don't arm a drag here (the object isn't on the active layer
        // yet). Skipped in symbol-edit mode (other-layer arrays are scene-scoped).
        if (otherLayerSelectables.length > 0 && !parentSceneGraph) {
          for (const layer of otherLayerSelectables) {
            // Shapes (top-most within the layer first)
            const ls = [...layer.shapes].reverse().find((obj) => {
              const bounds = transformedShapeBounds(obj);
              return (
                stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
                stageY >= bounds.y && stageY <= bounds.y + bounds.height
              );
            });
            if (ls) {
              e.preventDefault();
              onShapeSelect?.(ls.id, e.shiftKey);
              return;
            }
            const li = [...layer.instances].reverse().find((inst) => {
              const bounds = getSymbolInstanceBounds(inst, library);
              return (
                stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
                stageY >= bounds.y && stageY <= bounds.y + bounds.height
              );
            });
            if (li) {
              e.preventDefault();
              onShapeSelect?.(li.id, e.shiftKey);
              return;
            }
            const lt = [...layer.texts].reverse().find((obj) => (
              stageX >= obj.x && stageX <= obj.x + obj.width &&
              stageY >= obj.y && stageY <= obj.y + obj.height
            ));
            if (lt) {
              e.preventDefault();
              onShapeSelect?.(lt.id, e.shiftKey);
              return;
            }
          }
        }

        // Start marquee selection on empty stage (arrow tool rubber-band)
        e.preventDefault();
        onShapeSelect?.(null);
        // When in symbol edit mode and clicking empty space, exit edit mode.
        if (parentSceneGraph && onExitSymbolEdit) {
          onExitSymbolEdit();
        }
        setSelMarqueeStart({ x: stageX, y: stageY });
        setSelMarqueeEnd({ x: stageX, y: stageY });
        setSelIsMarqueeSelecting(true);
      }
    },
    [spaceHeld, activeTool, internalPanX, internalPanY, internalZoom, toStageCoords, shapeDisplayObjects, onShapeSelect, partialSelectEnabled, onSubSelect, onShapeCreated, selectedShapeId, selectedShapeIds, textDisplayObjects, onTextPlace, penState, subselState, onShapeUpdate, onEyedropperSample, propStrokeColor, propStrokeWidth, propStrokeAlpha, propFill, lassoPolygonMode, lassoMagicWand, magicWandThreshold, magicWandSmoothing, bitmapDisplayObjects, bitmapLibraryItems, lassoPolyVertices, freeTransformMode, parentSceneGraph, onExitSymbolEdit, symbolInstanceDisplayObjects, otherLayerSelectables, library, editMultipleFrames, onionFrames, onEditMultipleFrameClick, simpleButtonsEnabled, hoveredButtonId]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Always report stage-space cursor position to parent
      if (onCursorMove) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        onCursorMove(stageX, stageY);
      }

      // Panning
      if (isPanningRef.current && panStartRef.current) {
        const dx = (e.clientX - panStartRef.current.mouseX) / internalZoom;
        const dy = (e.clientY - panStartRef.current.mouseY) / internalZoom;
        const newPanX = panStartRef.current.panX + dx;
        const newPanY = panStartRef.current.panY + dy;
        setInternalPanX(newPanX);
        setInternalPanY(newPanY);
        onPanChange?.(newPanX, newPanY);
        return;
      }

      // Guide drag
      if (guideDragRef.current) {
        const { guideId, orientation } = guideDragRef.current;
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const newPos = orientation === "horizontal" ? stageY : stageX;

        // Check if dragged off the stage
        const workArea = workAreaRef.current;
        if (workArea) {
          const rect = workArea.getBoundingClientRect();
          const outside =
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom;
          if (outside) {
            onGuideDelete?.(guideId);
            guideDragRef.current = null;
            return;
          }
        }
        onGuideMove?.(guideId, Math.round(newPos));
        return;
      }

      // Gradient Transform drag: update angle/focalPoint live
      if (gradientDragRef.current && activeTool === "gradientTransform") {
        const gd = gradientDragRef.current;
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const selObj = shapeDisplayObjects.find((o) => o.id === gd.shapeId);
        if (selObj) {
          const gradFill = getShapeGradientFill(selObj.shape);
          if (gradFill) {
            if (gd.handle === "rotate" && gradFill.type === "linear-gradient") {
              // Compute new angle from center to current mouse position
              const currentAngle = Math.atan2(stageY - gd.centerY, stageX - gd.centerX) * (180 / Math.PI);
              const newAngle = gd.origAngle + (currentAngle - gd.startAngle);
              const newFill: Fill = { ...gradFill, angle: newAngle };
              const newPaths = selObj.shape.paths.map((p) =>
                p.fill?.type === "linear-gradient" ? { ...p, fill: newFill } : p
              );
              onShapeGradientUpdate?.(gd.shapeId, { ...selObj.shape, paths: newPaths });
            } else if (gd.handle === "rotate" && gradFill.type === "radial-gradient") {
              // For radial, rotate handle adjusts focal point
              const dx = stageX - gd.centerX;
              const bounds = transformedShapeBounds(selObj);
              const newFocalPoint = Math.max(-1, Math.min(1, dx / (bounds.width / 2)));
              const newFill: Fill = { ...gradFill, focalPoint: newFocalPoint };
              const newPaths = selObj.shape.paths.map((p) =>
                p.fill?.type === "radial-gradient" ? { ...p, fill: newFill } : p
              );
              onShapeGradientUpdate?.(gd.shapeId, { ...selObj.shape, paths: newPaths });
            }
            // center and scale handles: visual only in this implementation (no extra data fields)
          }
        }
        return;
      }

      // Pencil tool: accumulate points
      if (activeTool === "pencil" && pencilPointsRef.current.length > 0) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        pencilPointsRef.current.push({ x: stageX, y: stageY });
        // Update preview every few points to avoid excessive re-renders
        if (pencilPointsRef.current.length % 3 === 0) {
          setPencilPreviewPoints([...pencilPointsRef.current]);
        }
        return;
      }

      // Brush tool: accumulate points
      if (activeTool === "brush" && brushPointsRef.current.length > 0) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        brushPointsRef.current.push({ x: stageX, y: stageY });
        if (brushPointsRef.current.length % 3 === 0) {
          setBrushPreviewPoints([...brushPointsRef.current]);
        }
        return;
      }

      // Eraser tool: update cursor position and erase overlapping shapes in real-time
      if (activeTool === "eraser") {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        setEraserCursorPos({ stageX, stageY });
        if (eraserPointsRef.current) {
          // The eraser stamp for THIS move is the swept segment from the
          // previous sample to the current point (the prev point may equal the
          // current at gesture start → a single disk).
          const prev =
            eraserPointsRef.current.length > 0
              ? eraserPointsRef.current[eraserPointsRef.current.length - 1]
              : { x: stageX, y: stageY };
          eraserPointsRef.current.push({ x: stageX, y: stageY });
          const half = eraserSize / 2;

          // Vector erase (Flash 8): boolean-subtract the eraser stamp from each
          // overlapping shape's geometry (in the shape's LOCAL coordinate space),
          // splitting/reshaping the vector rather than deleting the whole object.
          // Only when the subtraction removes the entire shape do we fall back to
          // onShapeDelete (the genuine fully-covered case).
          const sweptStage: Point[] =
            Math.hypot(stageX - prev.x, stageY - prev.y) < 0.01
              ? [{ x: stageX, y: stageY }]
              : [{ x: prev.x, y: prev.y }, { x: stageX, y: stageY }];

          for (const obj of shapeDisplayObjects) {
            if (erasedIdsRef.current.has(obj.id)) continue;
            // Quick reject: stage-space circle-vs-AABB against the swept segment
            // endpoints + midpoint (cheap pre-filter before the boolean op).
            const bounds = transformedShapeBounds(obj);
            const probes =
              sweptStage.length === 2
                ? [
                    sweptStage[0],
                    { x: (sweptStage[0].x + sweptStage[1].x) / 2, y: (sweptStage[0].y + sweptStage[1].y) / 2 },
                    sweptStage[1],
                  ]
                : sweptStage;
            const touches = probes.some((p) => {
              const cx = Math.max(bounds.x, Math.min(p.x, bounds.x + bounds.width));
              const cy = Math.max(bounds.y, Math.min(p.y, bounds.y + bounds.height));
              return Math.hypot(p.x - cx, p.y - cy) <= half;
            });
            if (!touches) continue;

            // P4: when this is a merged mergeable shape (placed at 0,0, geometry
            // in stage space), erase on the planar mesh — curve-preserving
            // cut/trim with Flash 8 eraser modes. Otherwise fall back to the
            // legacy per-object curve-FLATTENING GH eraser (Object Drawing shapes
            // / non-identity transforms / gradient/bitmap fills) — unchanged.
            const usePlanar =
              (obj.x ?? 0) === 0 &&
              (obj.y ?? 0) === 0 &&
              (obj.scaleX ?? 1) === 1 &&
              (obj.scaleY ?? 1) === 1 &&
              (obj.rotation ?? 0) === 0 &&
              isMergeableShape(obj.shape);

            if (usePlanar) {
              const stamp = buildEraserPolygon(sweptStage, half);
              const { shape: next } = planarEraseShape(obj.shape, stamp, {
                mode: eraserMode,
                insideAt: eraserMode === "inside" ? sweptStage[0] : undefined,
              });
              if (next === null) {
                erasedIdsRef.current.add(obj.id);
                onShapeDelete?.(obj.id);
              } else if (next !== obj.shape) {
                onShapeUpdate?.(obj.id, next);
              }
              continue;
            }

            // Map the swept eraser path into the shape's LOCAL space (inverse of
            // the display-object transform: translate(x,y) ∘ rotate ∘ scale).
            const localPts = sweptStage.map((p) => stageToShapeLocal(p, obj));
            // Radius in local space (account for scale; use the average so a
            // uniformly-scaled shape still erases a round region).
            const sx = obj.scaleX ?? 1;
            const sy = obj.scaleY ?? 1;
            const localR = half / ((Math.abs(sx) + Math.abs(sy)) / 2 || 1);
            const eraserLoops = buildEraserPolygon(localPts, localR);

            const next = eraseShape(obj.shape, eraserLoops);
            if (next === null) {
              // Whole shape covered → remove the display object.
              erasedIdsRef.current.add(obj.id);
              onShapeDelete?.(obj.id);
            } else if (next !== obj.shape) {
              onShapeUpdate?.(obj.id, next);
            }
          }
        }
        return;
      }

      // Lasso tool: accumulate freehand points
      if (activeTool === "lasso" && !lassoPolygonMode && lassoCapturingRef.current) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        setLassoPoints((prev) => [...prev, { x: stageX, y: stageY }]);
        return;
      }

      // Pen tool: update drag handle or cursor position
      if (activeTool === "pen") {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        if (penState.dragStart) {
          // Dragging from an anchor to set handleOut
          const dx = stageX - penState.dragStart.x;
          const dy = stageY - penState.dragStart.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 2 / internalZoom) {
            setPenState((prev) => ({
              ...prev,
              currentHandleOut: { x: stageX, y: stageY },
              cursorPos: { x: stageX, y: stageY },
            }));
          }
        } else {
          // Just update rubber-band cursor
          setPenState((prev) => ({ ...prev, cursorPos: { x: stageX, y: stageY } }));
        }
        return;
      }

      // Subselection: drag selected anchor
      if (activeTool === "subselect" && subselDragRef.current) {
        const drag = subselDragRef.current;
        const dx = (e.clientX - drag.startMouseX) / internalZoom;
        const dy = (e.clientY - drag.startMouseY) / internalZoom;
        const newAnchorX = drag.origAnchorX + dx;
        const newAnchorY = drag.origAnchorY + dy;

        // Update the shape's path anchor point
        const selObj = shapeDisplayObjects.find((o) => o.id === drag.objectId);
        if (selObj && selObj.shape.paths[0]) {
          const path = selObj.shape.paths[0];
          const anchorIndex = drag.anchorIndex;
          let newPath: ShapePath;
          if (anchorIndex === 0) {
            // Moving the start point
            newPath = { ...path, start: { x: newAnchorX, y: newAnchorY } };
          } else {
            const newSegments = path.segments.map((seg, i) =>
              i === anchorIndex - 1
                ? { ...seg, to: { x: newAnchorX, y: newAnchorY } }
                : seg
            );
            newPath = { ...path, segments: newSegments };
          }
          const newShape: Shape = { ...selObj.shape, paths: [newPath] };
          onShapeUpdate?.(drag.objectId, newShape);
        }
        return;
      }

      // Arrow (selection) tool marquee: update end point while dragging
      if (selIsMarqueeSelecting) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        setSelMarqueeEnd({ x: stageX, y: stageY });
        return;
      }

      // Free Transform marquee: update end point while dragging
      if (ftIsMarqueeSelecting) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        setFtMarqueeEnd({ x: stageX, y: stageY });
        return;
      }

      // Draw gesture preview
      if (drawStartRef.current && activeTool && SHAPE_DRAW_TOOLS.has(activeTool as "oval" | "rect" | "line" | "polystar")) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        setDrawPreview({
          tool: activeTool as "oval" | "rect" | "line" | "polystar",
          x1: drawStartRef.current.stageX,
          y1: drawStartRef.current.stageY,
          x2: stageX,
          y2: stageY,
        });
        return;
      }

      // Free Transform Distort / Envelope mesh-warp drag.
      if (warpDragRef.current) {
        e.preventDefault();
        const wd = warpDragRef.current;
        let { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        if (snapToPixels) {
          stageX = Math.round(stageX);
          stageY = Math.round(stageY);
        }
        const next = moveWarpHandle(wd.warp, wd.handle, stageX, stageY);
        wd.warp = next;
        onShapeWarp?.(wd.shapeId, next);
        return;
      }

      // Transform handle drag (resize / rotate)
      if (transformDragRef.current) {
        const td = transformDragRef.current;
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const { handle, shapeId, origBounds, origX, origY, origScaleX, origScaleY } = td;

        if (handle === "rotate") {
          // Compute rotation delta from the stored start angle so dragging always
          // feels relative to where the user grabbed the handle.
          const cx = origBounds.x + origBounds.width / 2;
          const cy = origBounds.y + origBounds.height / 2;
          const currentAngle = Math.atan2(stageY - cy, stageX - cx) * (180 / Math.PI);
          const startAngle = td.startAngle ?? (currentAngle - 90);
          const newRotation = td.origRotation + (currentAngle - startAngle);
          onShapeRotate?.(shapeId, newRotation);
          return;
        }

        // Resize: scale about the shape's center so the center stays fixed.
        //
        // origBounds is the transformed (visual) AABB from drag start.
        // The shape's visual center in stage coords:
        const centerX = origBounds.x + origBounds.width / 2;
        const centerY = origBounds.y + origBounds.height / 2;

        // The raw (un-transformed) local-space half-extents:
        // rawWidth / rawHeight are the original path extents before scale.
        const rawWidth  = origBounds.width  / Math.max(0.0001, origScaleX);
        const rawHeight = origBounds.height / Math.max(0.0001, origScaleY);

        // Each handle only affects certain axes
        const isNorth = handle === "nw" || handle === "n" || handle === "ne";
        const isSouth = handle === "se" || handle === "s" || handle === "sw";
        const isWest  = handle === "nw" || handle === "sw" || handle === "w";
        const isEast  = handle === "ne" || handle === "e" || handle === "se";

        let newScaleX = origScaleX;
        let newScaleY = origScaleY;

        // For handles that affect X: distance from center to mouse X determines new half-width
        if (isEast || isWest) {
          const halfW = Math.max(0.5, Math.abs(stageX - centerX));
          newScaleX = (halfW * 2) / Math.max(0.0001, rawWidth);
        }
        // For handles that affect Y: distance from center to mouse Y determines new half-height
        if (isNorth || isSouth) {
          const halfH = Math.max(0.5, Math.abs(stageY - centerY));
          newScaleY = (halfH * 2) / Math.max(0.0001, rawHeight);
        }

        // Adjust obj.x/obj.y so that the visual center stays fixed.
        // Renderer applies: translate(obj.x, obj.y) → rotate → scale → draw at local coords.
        // The local-space center of the raw shape (relative to obj.x, obj.y):
        const localCenterX = centerX - origX;
        const localCenterY = centerY - origY;
        // After new scale, the rendered center would be at:
        //   obj.x + localCenterX * newScaleX  (for rotation=0)
        // To keep it at centerX: newObjX = centerX - localCenterX * newScaleX
        // This is a simplified (rotation=0) formula but keeps the shape centered.
        let newX = centerX - localCenterX * (newScaleX / origScaleX);
        let newY = centerY - localCenterY * (newScaleY / origScaleY);

        // Snap-to-pixels: round position to integer coords
        if (snapToPixels) {
          newX = Math.round(newX);
          newY = Math.round(newY);
        }

        onShapeResize?.(shapeId, newX, newY, newScaleX, newScaleY);
        return;
      }

      // P3 split-on-move LIVE drag preview (task 1331). When a partial selection
      // is being dragged, render the extracted piece following the cursor every
      // move (the legacy whole-object path does the same via onShapeMove). The
      // doc is NOT mutated here — the authoritative split is committed once on
      // mouse-up. We run the planar split ONCE (when the drag first passes the
      // click threshold) to get the {remainder, extracted} geometry, then only
      // translate the extracted geometry by the live offset on later moves.
      if (subSplitDragRef.current) {
        const sd = subSplitDragRef.current;
        const dxMouse = e.clientX - sd.startMouseX;
        const dyMouse = e.clientY - sd.startMouseY;
        const dx = dxMouse / internalZoom;
        const dy = dyMouse / internalZoom;
        // Below the click-vs-drag threshold a plain click just selects — do not
        // start the preview yet (matches the mouse-up >3px gate).
        if (Math.hypot(dxMouse, dyMouse) <= 3) {
          return;
        }
        // Lazily extract the geometry once, on the first move past threshold.
        if (
          !subSplitPreviewRef.current ||
          subSplitPreviewRef.current.shapeId !== sd.selection.shapeId
        ) {
          const target = shapeDisplayObjects.find((o) => o.id === sd.selection.shapeId);
          if (target) {
            const ps = livePlanarShape(target.shape);
            // Extract at zero offset: `extracted` is origin-aligned with the
            // remainder, so we translate it purely in the render below.
            const { extracted, remainder } = planarSplitOnMove(
              ps,
              sd.selection.keys,
              0,
              0,
              `${target.id}-preview`,
              target.shape.id
            );
            subSplitPreviewRef.current = {
              shapeId: target.id,
              remainder,
              extracted,
              baseX: target.x,
              baseY: target.y,
            };
          }
        }
        const pv = subSplitPreviewRef.current;
        if (pv && pv.shapeId === sd.selection.shapeId) {
          setSubSplitPreview({
            shapeId: pv.shapeId,
            extractedId: `${pv.shapeId}-preview`,
            remainder: pv.remainder,
            extracted: pv.extracted,
            baseX: pv.baseX,
            baseY: pv.baseY,
            dx,
            dy,
          });
        }
        return;
      }

      // Selection drag (move)
      if (selectionDragRef.current && onShapeMove) {
        const drag = selectionDragRef.current;
        let dx = (e.clientX - drag.startMouseX) / internalZoom;
        let dy = (e.clientY - drag.startMouseY) / internalZoom;

        // Helper: resolve the axis-aligned bounds of the dragged object regardless of type.
        // Searches shapes, symbol instances, and text objects.
        const getDraggedBounds = (id: string) => {
          const shape = shapeDisplayObjects.find((o) => o.id === id);
          if (shape) return { bounds: transformedShapeBounds(shape), x: shape.x, y: shape.y };
          const inst = symbolInstanceDisplayObjects.find((o) => o.id === id);
          if (inst) return { bounds: getSymbolInstanceBounds(inst, library), x: inst.x, y: inst.y };
          const text = textDisplayObjects.find((o) => o.id === id);
          if (text) return { bounds: { x: text.x, y: text.y, width: text.width, height: text.height }, x: text.x, y: text.y };
          return null;
        };

        // Collect axis-aligned bounds for all objects except the one being dragged.
        const getAllOtherBounds = (excludeId: string) => {
          const result: { x: number; y: number; width: number; height: number }[] = [];
          for (const o of shapeDisplayObjects) {
            if (o.id !== excludeId) result.push(transformedShapeBounds(o));
          }
          for (const o of symbolInstanceDisplayObjects) {
            if (o.id !== excludeId) result.push(getSymbolInstanceBounds(o, library));
          }
          for (const o of textDisplayObjects) {
            if (o.id !== excludeId) result.push({ x: o.x, y: o.y, width: o.width, height: o.height });
          }
          return result;
        };

        // Snap-to-guides: snap the dragged object's edges/center to nearby guides
        if (snapToGuides && guides.length > 0) {
          const dragged = getDraggedBounds(drag.shapeId);
          if (dragged) {
            const { bounds } = dragged;
            const snapThreshold = 5;

            // Check horizontal guides (snap top, center, or bottom edge of object)
            const candidateYs = [
              bounds.y + dy,
              bounds.y + bounds.height / 2 + dy,
              bounds.y + bounds.height + dy,
            ];
            let bestSnapDY = Infinity;
            for (const guide of guides) {
              if (guide.orientation === "horizontal") {
                for (const candY of candidateYs) {
                  const diff = guide.position - candY;
                  if (Math.abs(diff) < snapThreshold && Math.abs(diff) < Math.abs(bestSnapDY)) {
                    bestSnapDY = diff;
                  }
                }
              }
            }
            if (isFinite(bestSnapDY)) dy += bestSnapDY;

            // Check vertical guides (snap left, center, or right edge of object)
            const candidateXs = [
              bounds.x + dx,
              bounds.x + bounds.width / 2 + dx,
              bounds.x + bounds.width + dx,
            ];
            let bestSnapDX = Infinity;
            for (const guide of guides) {
              if (guide.orientation === "vertical") {
                for (const candX of candidateXs) {
                  const diff = guide.position - candX;
                  if (Math.abs(diff) < snapThreshold && Math.abs(diff) < Math.abs(bestSnapDX)) {
                    bestSnapDX = diff;
                  }
                }
              }
            }
            if (isFinite(bestSnapDX)) dx += bestSnapDX;
          }
        }

        // Snap-to-grid: quantize dragged object's edges/center to nearest grid line
        if (snapToGrid && (gridWidth > 0 || gridHeight > 0)) {
          const dragged = getDraggedBounds(drag.shapeId);
          if (dragged) {
            const snapped = applySnapToGrid(dx, dy, dragged.bounds, gridWidth, gridHeight);
            dx = snapped.dx;
            dy = snapped.dy;
          }
        }

        // Snap-to-objects: snap dragged object's edges/center to other objects' edges/centers
        if (snapToObjects) {
          const dragged = getDraggedBounds(drag.shapeId);
          if (dragged) {
            const otherBounds = getAllOtherBounds(drag.shapeId);
            if (otherBounds.length > 0) {
              const snapped = applySnapToObjects(dx, dy, dragged.bounds, otherBounds);
              dx = snapped.dx;
              dy = snapped.dy;
            }
          }
        }

        // Snap-to-pixels: round the deltas so the final position lands on integer coords
        if (snapToPixels) {
          const dragged = getDraggedBounds(drag.shapeId);
          if (dragged) {
            const newX = Math.round(dragged.x + dx);
            const newY = Math.round(dragged.y + dy);
            dx = newX - dragged.x;
            dy = newY - dragged.y;
          }
        }

        onShapeMove(drag.shapeId, dx, dy);
        // Update start so next move is a delta from this position
        selectionDragRef.current = { ...drag, startMouseX: e.clientX, startMouseY: e.clientY };
        return;
      }

      // Update handle cursor based on mouse hover position
      if (activeTool === "selection" && selectedShapeId) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const selObj = shapeDisplayObjects.find((o) => o.id === selectedShapeId);
        if (selObj) {
          const bounds = transformedShapeBounds(selObj);
          // Check rotation handle
          const rotHandleX = bounds.x + bounds.width / 2;
          const rotHandleY = bounds.y - 20;
          if (Math.hypot(stageX - rotHandleX, stageY - rotHandleY) <= 10) {
            setHandleCursor("crosshair");
            return;
          }
          // Check resize handles
          const handles = getHandlePositions(bounds);
          const hitHandle = handles.find(
            (h) => Math.abs(stageX - h.x) <= 6 && Math.abs(stageY - h.y) <= 6
          );
          if (hitHandle) {
            setHandleCursor(HANDLE_CURSORS[hitHandle.id]);
            return;
          }
        }
        setHandleCursor(undefined);
      } else {
        setHandleCursor(undefined);
      }

      // Enable Simple Buttons: update hovered button instance
      if (simpleButtonsEnabled && symbolInstanceDisplayObjects.length > 0 && library) {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const hitButton = [...symbolInstanceDisplayObjects].reverse().find((inst) => {
          const sym = library.items.find((i) => i.id === inst.symbolId && i.itemType === "symbol") as import("@flash/core").Symbol | undefined;
          if (!sym || sym.symbolType !== "button") return false;
          const bounds = getSymbolInstanceBounds(inst, library);
          return (
            stageX >= bounds.x && stageX <= bounds.x + bounds.width &&
            stageY >= bounds.y && stageY <= bounds.y + bounds.height
          );
        });
        setHoveredButtonId(hitButton ? hitButton.id : null);
      } else if (!simpleButtonsEnabled && hoveredButtonId !== null) {
        setHoveredButtonId(null);
        setPressedButtonId(null);
      }
    },
    [internalZoom, onPanChange, activeTool, toStageCoords, onShapeMove, onShapeResize, onShapeRotate, onShapeWarp, freeTransformMode, onShapeUpdate, onShapeGradientUpdate, selectedShapeId, shapeDisplayObjects, onGuideMove, onGuideDelete, penState, subselState, eraserSize, eraserMode, lassoPolygonMode, snapToGuides, guides, snapToGrid, gridWidth, gridHeight, snapToObjects, snapToPixels, ftIsMarqueeSelecting, selIsMarqueeSelecting, onShapeDelete, onCursorMove, simpleButtonsEnabled, symbolInstanceDisplayObjects, library, hoveredButtonId]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const _e = e;
      isPanningRef.current = false;
      panStartRef.current = null;
      // P3 — commit a partial split-on-move on mouse-up. If the cursor barely
      // moved it is a plain click (keep the selection, no split).
      if (subSplitDragRef.current) {
        const sd = subSplitDragRef.current;
        subSplitDragRef.current = null;
        // Tear down the live drag-preview (task 1331) BEFORE committing, so the
        // transient render is replaced by the authoritative committed doc.
        subSplitPreviewRef.current = null;
        setSubSplitPreview(null);
        const dxMouse = e.clientX - sd.startMouseX;
        const dyMouse = e.clientY - sd.startMouseY;
        if (Math.hypot(dxMouse, dyMouse) > 3 && onSubSplitMove) {
          onSubSplitMove(sd.selection, dxMouse / internalZoom, dyMouse / internalZoom);
        }
        return;
      }
      const wasShapeDrag = selectionDragRef.current !== null;
      selectionDragRef.current = null;
      const wasWarpDrag = warpDragRef.current !== null;
      transformDragRef.current = null;
      warpDragRef.current = null;
      guideDragRef.current = null;
      gradientDragRef.current = null;
      // Notify parent that a shape drag gesture just ended so it can commit to undo history
      if (wasShapeDrag || wasWarpDrag) {
        onShapeMoveEnd?.();
      }
      // Enable Simple Buttons: clear pressed state on mouse up
      if (simpleButtonsEnabled) {
        setPressedButtonId(null);
      }

      // Finalize arrow (selection) tool marquee selection
      if (selIsMarqueeSelecting && selMarqueeStart && selMarqueeEnd) {
        const rect = normalizeRect(selMarqueeStart, selMarqueeEnd);
        // Only select if the marquee has non-trivial size (more than 2px in each direction)
        if (rect.width > 2 || rect.height > 2) {
          // P3 — partial marquee: select all faces/segments of a merged shape that
          // the rubber-band intersects (flag on). One merged shape per layer.
          if (partialSelectEnabled && onSubSelect) {
            const overlapped = [...shapeDisplayObjects].filter((obj) =>
              boundsOverlap(transformedShapeBounds(obj), rect)
            );
            if (overlapped.length > 0) {
              const target = overlapped[overlapped.length - 1];
              const ps = livePlanarShape(target.shape);
              const local = {
                x: rect.x - target.x,
                y: rect.y - target.y,
                width: rect.width,
                height: rect.height,
              };
              const keys = planarPickInRect(ps, local);
              onSubSelect(keys.length > 0 ? { shapeId: target.id, keys } : null);
            } else {
              onSubSelect(null);
            }
            setSelIsMarqueeSelecting(false);
            setSelMarqueeStart(null);
            setSelMarqueeEnd(null);
            return;
          }
          // Collect ALL objects whose bounds overlap the marquee rect
          const hits = [...shapeDisplayObjects].filter((obj) =>
            boundsOverlap(transformedShapeBounds(obj), rect)
          );
          // Also include symbol instances and text objects in marquee
          const hitInsts = [...symbolInstanceDisplayObjects].filter((inst) => {
            const bounds = getSymbolInstanceBounds(inst, library);
            return boundsOverlap(bounds, rect);
          });
          const hitTexts = [...textDisplayObjects].filter((obj) =>
            boundsOverlap({ x: obj.x, y: obj.y, width: obj.width, height: obj.height }, rect)
          );
          const allHitIds = [
            ...hits.map((o) => o.id),
            ...hitInsts.map((o) => o.id),
            ...hitTexts.map((o) => o.id),
          ];
          if (allHitIds.length > 0) {
            if (onShapeSelectMultiple) {
              // Shift held: union with existing selection; otherwise replace
              onShapeSelectMultiple(allHitIds, !_e.shiftKey);
            } else {
              onShapeSelect?.(allHitIds[0]);
            }
          }
        }
        setSelIsMarqueeSelecting(false);
        setSelMarqueeStart(null);
        setSelMarqueeEnd(null);
        return;
      }
      setSelIsMarqueeSelecting(false);
      setSelMarqueeStart(null);
      setSelMarqueeEnd(null);

      // Finalize Free Transform marquee selection
      if (ftIsMarqueeSelecting && ftMarqueeStart && ftMarqueeEnd) {
        const rect = normalizeRect(ftMarqueeStart, ftMarqueeEnd);
        const hits = [...shapeDisplayObjects].filter((obj) =>
          boundsOverlap(transformedShapeBounds(obj), rect)
        );
        if (hits.length > 0) {
          if (onShapeSelectMultiple) {
            onShapeSelectMultiple(hits.map((o) => o.id), !_e.shiftKey);
          } else {
            onShapeSelect?.(hits[0].id);
          }
        } else {
          onShapeSelect?.(null);
        }
        setFtIsMarqueeSelecting(false);
        setFtMarqueeStart(null);
        setFtMarqueeEnd(null);
        return;
      }
      setFtIsMarqueeSelecting(false);
      setFtMarqueeStart(null);
      setFtMarqueeEnd(null);

      // Finalize subselection anchor drag
      if (subselDragRef.current) {
        subselDragRef.current = null;
        return;
      }

      // Pen tool: finalize the current anchor on mouse up
      if (activeTool === "pen" && penState.dragStart) {
        const newAnchor: PenAnchor = {
          x: penState.dragStart.x,
          y: penState.dragStart.y,
          handleOut: penState.currentHandleOut ?? undefined,
        };
        setPenState((prev) => ({
          anchors: [...prev.anchors, newAnchor],
          dragStart: null,
          currentHandleOut: null,
          cursorPos: prev.cursorPos,
        }));
        return;
      }

      // Pencil tool: finalize freehand stroke
      if (activeTool === "pencil" && pencilPointsRef.current.length >= 2) {
        const stroke: SolidStroke = {
          type: "solid",
          color: hexToColor(propStrokeColor, Math.round((propStrokeAlpha / 100) * 255)),
          width: propStrokeWidth,
          caps: "round",
          joints: "round",
          miterLimit: 3,
        };
        const shape = pencilPointsToShape(pencilPointsRef.current, stroke, pencilMode);
        if (shape.paths.length > 0) {
          onShapeCreated?.(shape, 0, 0);
        }
        pencilPointsRef.current = [];
        setPencilPreviewPoints([]);
        return;
      }
      pencilPointsRef.current = [];
      setPencilPreviewPoints([]);

      // Brush tool: finalize brush stroke (>= 1 point: a single click/dab
      // produces a round nib circle, not nothing).
      if (activeTool === "brush" && brushPointsRef.current.length >= 1) {
        const fillColor: Fill = propFill ?? { type: "solid", color: hexToColor(propStrokeColor) };
        const shape = brushPointsToShape(brushPointsRef.current, brushSize, fillColor, brushShape);
        if (shape.paths.length > 0) {
          onShapeCreated?.(shape, 0, 0);
        }
        brushPointsRef.current = [];
        setBrushPreviewPoints([]);
        return;
      }
      brushPointsRef.current = [];
      setBrushPreviewPoints([]);

      // Eraser tool: finalize erase gesture (geometry already vector-subtracted
      // incrementally per move in onMouseMove)
      if (activeTool === "eraser") {
        eraserPointsRef.current = null;
        erasedIdsRef.current = new Set();
        return;
      }

      // Finalize lasso freehand selection
      if (activeTool === "lasso" && !lassoPolygonMode && lassoCapturingRef.current) {
        lassoCapturingRef.current = false;
        const pts = lassoPoints;
        if (pts.length >= 3) {
          const selectedId = findShapeInLasso([...pts, pts[0]], shapeDisplayObjects);
          if (selectedId) onShapeSelect?.(selectedId);
          else onShapeSelect?.(null);
        }
        setLassoPoints([]);
        return;
      }

      // Finalise draw gesture
      if (drawStartRef.current && drawPreview && onShapeCreated) {
        const { x1, y1, x2, y2 } = drawPreview;
        // Don't create zero-size shapes
        if (Math.abs(x2 - x1) > 1 || Math.abs(y2 - y1) > 1) {
          let shape: Shape;
          if (drawPreview.tool === "oval") {
            shape = createOvalShape(x1, y1, x2, y2, null, null);
          } else if (drawPreview.tool === "rect") {
            if (rectCornerRadius > 0) {
              // createRoundedRectShape takes (x, y, width, height, radius, ...);
              // the draw gesture gives two corners, so normalize to origin+size.
              const rx = Math.min(x1, x2);
              const ry = Math.min(y1, y2);
              const rw = Math.abs(x2 - x1);
              const rh = Math.abs(y2 - y1);
              shape = createRoundedRectShape(rx, ry, rw, rh, rectCornerRadius, null, null);
            } else {
              shape = createRectShape(x1, y1, x2, y2, null, null);
            }
          } else if (drawPreview.tool === "polystar") {
            // Compute center and radius from the drag gesture
            const cx = x1;
            const cy = y1;
            const radius = Math.hypot(x2 - x1, y2 - y1);
            const { shapeType, sides, pointSize } = polyStarOptions;
            if (shapeType === "star") {
              shape = createStarShape(cx, cy, radius, sides, pointSize, null, null);
            } else {
              shape = createPolygonShape(cx, cy, radius, sides, null, null);
            }
          } else {
            shape = createLineShape(x1, y1, x2, y2, {
              type: "solid",
              color: { r: 0, g: 0, b: 0, a: 255 },
              width: 1,
              caps: "round",
              joints: "round",
              miterLimit: 3,
            });
          }
          // Shapes are placed at origin (0,0); their paths contain absolute coords
          onShapeCreated(shape, 0, 0);
        }
      }
      drawStartRef.current = null;
      setDrawPreview(null);
    },
    [drawPreview, onShapeCreated, activeTool, penState, pencilMode, propStrokeColor, propStrokeWidth, propStrokeAlpha, propFill, brushSize, brushShape, rectCornerRadius, shapeDisplayObjects, onShapeDelete, lassoPolygonMode, lassoPoints, onShapeSelect, onShapeSelectMultiple, partialSelectEnabled, onSubSelect, onSubSplitMove, internalZoom, polyStarOptions, onShapeMoveEnd, ftIsMarqueeSelecting, ftMarqueeStart, ftMarqueeEnd, selIsMarqueeSelecting, selMarqueeStart, selMarqueeEnd, symbolInstanceDisplayObjects, textDisplayObjects, library, simpleButtonsEnabled]
  );

  // Escape key → cancel pen path or lasso; also propagates to Shell for exiting edit-in-place.
  // Enter key (polygon lasso) → close the in-progress polygon selection.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isWithinRufflePlayer(e)) return;
      if (e.key === "Escape") {
        if (activeTool === "pen") {
          setPenState({ anchors: [], dragStart: null, currentHandleOut: null, cursorPos: null });
        }
        if (activeTool === "lasso") {
          lassoCapturingRef.current = false;
          setLassoPoints([]);
          setLassoPolyVertices([]);
          lassoPolyLastClickRef.current = null;
        }
        return;
      }
      // Enter closes an in-progress polygon-lasso selection (Flash behaviour).
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && activeTool === "lasso") {
        const verts = lassoPolyVerticesRef.current;
        if (verts.length >= 3) {
          e.preventDefault();
          const selectedId = findShapeInLasso([...verts, verts[0]], shapeDisplayObjects);
          onShapeSelect?.(selectedId);
          setLassoPolyVertices([]);
          lassoPolyLastClickRef.current = null;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool, shapeDisplayObjects, onShapeSelect]);

  // Enter key → toggle playback (suppressed while a polygon-lasso selection is
  // in progress, where Enter closes the polygon instead).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isWithinRufflePlayer(e)) return;
      // Yield to the Timeline panel when it is focused: it toggles playback on
      // Enter itself, so acting here too would toggle twice (net no-op).
      if (isTimelinePanelFocused()) return;
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        if (activeTool === "lasso" && lassoPolyVerticesRef.current.length >= 3) return;
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.isContentEditable) {
          e.preventDefault();
          onPlayToggle?.();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPlayToggle, activeTool]);

  // F8 → Convert to Symbol
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isWithinRufflePlayer(e)) return;
      if (e.key === "F8") {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          e.preventDefault();
          onConvertToSymbol?.();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onConvertToSymbol]);

  // Delete key → delete selected shape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isWithinRufflePlayer(e)) return;
      // Yield to the Timeline panel when it is focused: Delete/Backspace there
      // removes a frame. Acting here too would ALSO delete the selected stage
      // object from that frame — a double-fire causing data loss.
      if (isTimelinePanelFocused()) return;
      if ((e.key === "Delete" || e.key === "Backspace") && (selectedShapeIds.length > 0 || selectedShapeId)) {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          if (selectedShapeIds.length > 1) {
            onDeleteSelected?.();
          } else if (selectedShapeId) {
            onShapeDelete?.(selectedShapeId);
          }
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedShapeId, selectedShapeIds, onShapeDelete, onDeleteSelected]);

  // Clipboard shortcuts: Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Shift+V, Ctrl+D
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isWithinRufflePlayer(e)) return;
      // Yield to the Timeline panel when it is focused: Ctrl+C/X/V there operate
      // on the FRAME clipboard. Acting here too would copy/cut/paste frames AND
      // the shape clipboard simultaneously on a single keypress.
      if (isTimelinePanelFocused()) return;
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      switch (e.key.toLowerCase()) {
        case "c":
          e.preventDefault();
          onCopy?.();
          break;
        case "x":
          e.preventDefault();
          onCut?.();
          break;
        case "v":
          e.preventDefault();
          if (e.shiftKey) onPasteInPlace?.();
          else onPaste?.();
          break;
        case "d":
          e.preventDefault();
          onDuplicate?.();
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCopy, onCut, onPaste, onPasteInPlace, onDuplicate]);

  // Arrange and Group shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isWithinRufflePlayer(e)) return;
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      switch (e.key) {
        case "ArrowUp":
          if (e.shiftKey) { e.preventDefault(); onArrange?.("front"); }
          else { e.preventDefault(); onArrange?.("forward"); }
          break;
        case "ArrowDown":
          if (e.shiftKey) { e.preventDefault(); onArrange?.("back"); }
          else { e.preventDefault(); onArrange?.("backward"); }
          break;
        case "g":
        case "G":
          if (e.shiftKey) { e.preventDefault(); onUngroup?.(); }
          else { e.preventDefault(); onGroup?.(); }
          break;
        case "b":
        case "B":
          if (!e.shiftKey) { e.preventDefault(); onBreakApart?.(); }
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onArrange, onGroup, onUngroup, onBreakApart]);

  // Draw grid on canvas whenever relevant props change
  useEffect(() => {
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Apply HiDPI scaling so grid lines are sharp on Retina/HiDPI displays.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stageWidth * dpr);
    canvas.height = Math.round(stageHeight * dpr);
    canvas.style.width = `${stageWidth}px`;
    canvas.style.height = `${stageHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, stageWidth, stageHeight);
    if (!showGrid) return;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = gridWidth; x < stageWidth; x += gridWidth) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, stageHeight);
      ctx.stroke();
    }
    // Horizontal lines
    for (let y = gridHeight; y < stageHeight; y += gridHeight) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(stageWidth, y + 0.5);
      ctx.stroke();
    }
  }, [showGrid, gridWidth, gridHeight, gridColor, stageWidth, stageHeight]);

  // Initialize CanvasRenderer once the render canvas is mounted
  useEffect(() => {
    if (!renderCanvasRef.current) return;
    const renderer = new CanvasRenderer(renderCanvasRef.current);
    rendererRef.current = renderer;
    onRendererReady?.(renderer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render shapes on canvas whenever relevant state changes
  useEffect(() => {
    if (!rendererRef.current || !renderCanvasRef.current) return;

    // HiDPI / Retina support: scale physical pixels by device pixel ratio.
    const dpr = window.devicePixelRatio || 1;

    // Resize the canvas buffer to stage + pasteboard margin on every side (with DPR
    // scaling) so off-stage content is not clipped by the canvas dimensions.
    rendererRef.current.resize(canvasWidth, canvasHeight, dpr);

    // Pre-load any bitmap images into renderer cache
    for (const bitmapItem of bitmapLibraryItems) {
      if (bitmapItem.dataUri) {
        rendererRef.current.loadImage(bitmapItem.id, bitmapItem.dataUri);
      }
    }

    // While a text object is being edited, the HTML <textarea> overlay draws it; the
    // canvas must NOT also paint the model object or it double-renders (a canvas copy
    // under the overlay). Prefer StageArea's own textEditState.editingId (the source of
    // truth inside this component) and fall back to the editingTextId prop round-trip.
    const inEditTextId = textEditState?.editingId ?? editingTextId ?? null;

    // Build SceneGraph: use the multi-layer scene graph from the parent when provided,
    // otherwise fall back to a synthetic single-layer graph from the flat prop arrays.
    let sceneGraph: SceneGraph = propSceneGraph ?? {
      layers: [
        {
          id: "main",
          name: "Layer 1",
          visible: true,
          locked: false,
          objects: [...shapeDisplayObjects, ...textDisplayObjects, ...bitmapDisplayObjects],
        },
      ],
    };

    // Exclude the in-edit text object from the canvas render (it is drawn by the overlay).
    if (inEditTextId) {
      sceneGraph = {
        ...sceneGraph,
        layers: sceneGraph.layers.map((layer) => ({
          ...layer,
          objects: layer.objects.filter((obj) => obj.id !== inEditTextId),
        })),
      };
    }

    // P3 split-on-move LIVE drag preview (task 1331). While dragging a partial
    // selection, swap the original (un-split) shape in the scene for its two
    // pieces: the remainder stays at the base origin, the extracted piece is
    // translated to follow the cursor. The doc is untouched — this is a transient
    // render only; the authoritative split commits on mouse-up. Because the
    // extracted geometry was pre-computed once (mousedown→first move), the only
    // per-move work is a cheap translate of the display origin.
    if (subSplitPreview && subSplitPreview.shapeId) {
      const pv = subSplitPreview;
      sceneGraph = {
        ...sceneGraph,
        layers: sceneGraph.layers.map((layer) => {
          if (!layer.objects.some((o) => o.id === pv.shapeId)) return layer;
          const objects: import("@flash/core").DisplayObject[] = [];
          for (const obj of layer.objects) {
            if (obj.id !== pv.shapeId) {
              objects.push(obj);
              continue;
            }
            // Replace the target with remainder (at base) + extracted (offset).
            if (pv.remainder) {
              objects.push({
                type: "shape",
                id: pv.shapeId,
                shape: pv.remainder,
                x: pv.baseX,
                y: pv.baseY,
              } as ShapeDisplayObject);
            }
            if (pv.extracted) {
              objects.push({
                type: "shape",
                id: pv.extractedId,
                shape: pv.extracted,
                x: pv.baseX + pv.dx,
                y: pv.baseY + pv.dy,
              } as ShapeDisplayObject);
            }
          }
          return { ...layer, objects };
        }),
      };
    }

    // Enable Simple Buttons: patch firstFrame on button SymbolInstances to show Over/Down/Up state.
    if (simpleButtonsEnabled && library && (hoveredButtonId || pressedButtonId)) {
      sceneGraph = {
        layers: sceneGraph.layers.map((layer) => ({
          ...layer,
          objects: layer.objects.map((obj) => {
            if (obj.type !== "instance") return obj;
            const inst = obj as SymbolInstance;
            const sym = library.items.find((i) => i.id === inst.symbolId && i.itemType === "symbol") as import("@flash/core").Symbol | undefined;
            if (!sym || sym.symbolType !== "button") return obj;
            // Determine button state frame: 2=Down, 1=Over, 0=Up
            let buttonFrame = 0; // Up
            if (pressedButtonId === inst.id) {
              buttonFrame = 2; // Down
            } else if (hoveredButtonId === inst.id) {
              buttonFrame = 1; // Over
            }
            return { ...inst, firstFrame: buttonFrame };
          }),
        })),
      };
    }

    // Viewport: no zoom/pan here — the parent div's CSS transform handles those.
    // We render at 1:1 scale so the canvas stays sharp. The negative pan shifts ALL
    // scene drawing by +pasteboardMargin (renderer applies translate(-viewport.x,
    // -viewport.y)), so stage coord (0,0) lands at canvas pixel (margin, margin) and
    // off-stage content (x<0 etc.) draws onto the enlarged pasteboard buffer instead of
    // being clipped. Direct halo/handle/preview draws below get the same offset via a
    // base-transform translate applied right after render() returns.
    const viewport: Viewport = { x: -pasteboardMargin, y: -pasteboardMargin, zoom: 1 };

    // Render onion skin ghost frames (sorted farthest-from-current first)
    if (onionFrames.length > 0) {
      const ctx = renderCanvasRef.current.getContext("2d")!;
      // Render main scene (to establish the canvas) then we'll re-render on top
      // First render ghost frames by drawing directly with globalAlpha + tint overlay
      rendererRef.current.resize(canvasWidth, canvasHeight, dpr);
      // Clear first
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Sort: farthest from current frame first (lowest opacity first)
      const sortedOnion = [...onionFrames].sort((a, b) => a.opacity - b.opacity);

      for (const ghost of sortedOnion) {
        // Render ghost scene to a temporary off-screen canvas (DPR-scaled).
        const offscreen = document.createElement("canvas");
        const ghostRenderer = new CanvasRenderer(offscreen);
        ghostRenderer.resize(canvasWidth, canvasHeight, dpr);
        // Copy image cache by loading bitmaps
        for (const bitmapItem of bitmapLibraryItems) {
          if (bitmapItem.dataUri) {
            ghostRenderer.loadImage(bitmapItem.id, bitmapItem.dataUri);
          }
        }

        // In outline mode, force all layers to outlineMode with a tint-matched color.
        let renderGraph = ghost.sceneGraph;
        if (ghost.outlineMode) {
          const outlineColor = ghost.tint === "before" ? "#4466dd" : "#44bb55";
          renderGraph = {
            layers: ghost.sceneGraph.layers.map((layer) => ({
              ...layer,
              outlineMode: true,
              outlineColor,
            })),
          };
        }
        ghostRenderer.render(renderGraph, viewport, library);

        // Draw the ghost frame onto main canvas with reduced opacity.
        // Specify logical destination size so the DPR-scaled image maps correctly.
        ctx.save();
        ctx.globalAlpha = ghost.opacity;
        ctx.drawImage(offscreen, 0, 0, canvasWidth, canvasHeight);

        // Apply a subtle color tint overlay (skip in outline mode — color is already baked in)
        if (!ghost.outlineMode) {
          const tintColor = ghost.tint === "before" ? "rgba(50,100,220,0.15)" : "rgba(50,180,80,0.15)";
          ctx.globalCompositeOperation = "source-atop";
          ctx.fillStyle = tintColor;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        ctx.restore();
      }

      // Now render the main frame on top at full opacity
      rendererRef.current.render(sceneGraph, viewport, library);
    } else if (parentSceneGraph) {
      // Symbol edit mode: render parent scene dimmed, then symbol contents at full opacity.
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // Render parent scene to an offscreen canvas, then composite at 35% opacity.
      const offscreen = document.createElement("canvas");
      const parentRenderer = new CanvasRenderer(offscreen);
      parentRenderer.resize(canvasWidth, canvasHeight, dpr);
      for (const bitmapItem of bitmapLibraryItems) {
        if (bitmapItem.dataUri) {
          parentRenderer.loadImage(bitmapItem.id, bitmapItem.dataUri);
        }
      }
      parentRenderer.render(parentSceneGraph, viewport, library);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(offscreen, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      // Render the symbol's contents at full opacity on top.
      rendererRef.current.render(sceneGraph, viewport, library);
    } else {
      rendererRef.current.render(sceneGraph, viewport, library);
    }

    // From here on, ALL direct halo/handle/preview/motion-path drawing uses raw STAGE
    // coordinates. Bake the pasteboard margin into the canvas 2D base transform so those
    // stage coords map to canvas pixels (stageX + margin, stageY + margin), matching the
    // scene content drawn above (which got the same offset via viewport). render() above
    // already restored the transform to the DPR scale, and none of the overlay blocks
    // below call setTransform (only save/restore), so this single base translate persists
    // across every overlay. Off-stage selection halos now render on the pasteboard too.
    {
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, pasteboardMargin * dpr, pasteboardMargin * dpr);
    }

    // Draw selection + transform overlay on top of rendered shapes
    // Build the effective selection set: use selectedShapeIds when available, fallback to selectedShapeId
    const effectiveSelectedIds = selectedShapeIds.length > 0
      ? selectedShapeIds
      : (selectedShapeId ? [selectedShapeId] : []);
    const isSingleSelect = effectiveSelectedIds.length === 1;

    if (effectiveSelectedIds.length > 0 && renderCanvasRef.current) {
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.save();

      for (const selId of effectiveSelectedIds) {
        const obj = shapeDisplayObjects.find((o) => o.id === selId);
        if (obj) {
          const bounds = transformedShapeBounds(obj);
          if (bounds.width > 0 || bounds.height > 0) {
            // Dashed bounding box
            ctx.strokeStyle = themeHalo.haloBlue;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 2]);
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            ctx.setLineDash([]);

            if (isSingleSelect) {
              // 8 resize handles (white squares with blue border)
              const handles = getHandlePositions(bounds);
              for (const h of handles) {
                ctx.fillStyle = "white";
                ctx.strokeStyle = themeHalo.haloBlue;
                ctx.lineWidth = 1;
                ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
                ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
              }

              // Rotation handle (circle above top-center)
              const rotHandleX = bounds.x + bounds.width / 2;
              const rotHandleY = bounds.y - 20;
              ctx.beginPath();
              ctx.moveTo(rotHandleX, bounds.y);
              ctx.lineTo(rotHandleX, rotHandleY);
              ctx.strokeStyle = themeHalo.haloBlue;
              ctx.lineWidth = 1;
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(rotHandleX, rotHandleY, 5, 0, Math.PI * 2);
              ctx.fillStyle = "white";
              ctx.fill();
              ctx.strokeStyle = themeHalo.haloBlue;
              ctx.stroke();
            }
          }
        } else {
          // Check if the selected object is a text or bitmap display object, or a
          // symbol/MC instance. Instances are NOT in shapeDisplayObjects, so their
          // bounds come from getSymbolInstanceBounds (the symbol's frame-0 geometry
          // scaled by the instance transform) — the same AABB the hit-test, snapping,
          // and Scale9Grid overlay already use.
          const textObj = textDisplayObjects.find((o) => o.id === selId);
          const bitmapObj = !textObj ? bitmapDisplayObjects.find((o) => o.id === selId) : undefined;
          const instObj = !textObj && !bitmapObj ? symbolInstanceDisplayObjects.find((o) => o.id === selId) : undefined;
          let bounds: { x: number; y: number; width: number; height: number } | undefined;
          if (textObj ?? bitmapObj) {
            const g = (textObj ?? bitmapObj)!;
            if (g.width > 0 && g.height > 0) {
              bounds = { x: g.x, y: g.y, width: g.width, height: g.height };
            }
          } else if (instObj) {
            const b = getSymbolInstanceBounds(instObj, library);
            if (b.width > 0 && b.height > 0) bounds = b;
          }
          if (bounds) {
            // Dashed bounding box
            ctx.strokeStyle = themeHalo.haloBlue;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 2]);
            ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            ctx.setLineDash([]);

            if (isSingleSelect) {
              // Corner and mid-edge handles
              const handles = getHandlePositions(bounds);
              for (const h of handles) {
                ctx.fillStyle = "white";
                ctx.strokeStyle = themeHalo.haloBlue;
                ctx.lineWidth = 1;
                ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
                ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
              }

              // Rotation handle (circle above top-center) — instances support rotation
              // via Free Transform, so draw it for instances to match the shape halo.
              if (instObj) {
                const rotHandleX = bounds.x + bounds.width / 2;
                const rotHandleY = bounds.y - 20;
                ctx.beginPath();
                ctx.moveTo(rotHandleX, bounds.y);
                ctx.lineTo(rotHandleX, rotHandleY);
                ctx.strokeStyle = themeHalo.haloBlue;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(rotHandleX, rotHandleY, 5, 0, Math.PI * 2);
                ctx.fillStyle = "white";
                ctx.fill();
                ctx.strokeStyle = themeHalo.haloBlue;
                ctx.stroke();
              }
            }
          }
        }
      }

      ctx.restore();
    }

    // P3 — partial (face/segment) selection halo. Stroke each selected fill
    // region boundary (+ holes) and line segment of the merged shape. Drawn in
    // stage coords (the merged shape is at x=0,y=0), matching the overlay base
    // transform above.
    if (subSelection && subSelection.keys.length > 0 && renderCanvasRef.current) {
      // During a live split-on-move drag (task 1331) the original shape is
      // swapped out of the scene for {remainder, extracted}; the selection halo
      // should outline the EXTRACTED piece at its dragged offset so it tracks the
      // cursor. Otherwise (idle selection) outline the live planar map in place.
      const dragPreview =
        subSplitPreview && subSplitPreview.shapeId === subSelection.shapeId
          ? subSplitPreview
          : null;
      const ctx = renderCanvasRef.current.getContext("2d")!;
      const strokePolylines = (
        polylines: { x: number; y: number }[][],
        ox: number,
        oy: number
      ) => {
        if (polylines.length === 0) return;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.strokeStyle = themeHalo.haloBlue;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        for (const poly of polylines) {
          if (poly.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
          ctx.stroke();
        }
        ctx.restore();
      };
      if (dragPreview && dragPreview.extracted) {
        // The extracted piece is a standalone Shape (it is entirely selected);
        // outline each of its contours at the dragged offset. Quadratic segments
        // are sampled to short chords for the halo polyline.
        const polylines: { x: number; y: number }[][] = [];
        for (const path of dragPreview.extracted.paths) {
          const poly: { x: number; y: number }[] = [{ x: path.start.x, y: path.start.y }];
          let prev = path.start;
          for (const seg of path.segments) {
            if (seg.type === "curve") {
              const steps = 8;
              for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const mt = 1 - t;
                poly.push({
                  x: mt * mt * prev.x + 2 * mt * t * seg.control.x + t * t * seg.to.x,
                  y: mt * mt * prev.y + 2 * mt * t * seg.control.y + t * t * seg.to.y,
                });
              }
            } else {
              poly.push({ x: seg.to.x, y: seg.to.y });
            }
            prev = seg.to;
          }
          if (path.closed) poly.push({ x: path.start.x, y: path.start.y });
          polylines.push(poly);
        }
        strokePolylines(
          polylines,
          dragPreview.baseX + dragPreview.dx,
          dragPreview.baseY + dragPreview.dy
        );
      } else if (!dragPreview) {
        const target = shapeDisplayObjects.find((o) => o.id === subSelection.shapeId);
        if (target) {
          const ps = livePlanarShape(target.shape);
          const polylines = subSelectionPolylines(ps, subSelection.keys);
          strokePolylines(polylines, target.x, target.y);
        }
      }
    }

    // Draw Scale9Grid overlay when a single SymbolInstance with scale9Grid is selected
    if (isSingleSelect && effectiveSelectedIds.length === 1 && renderCanvasRef.current && library) {
      const selId = effectiveSelectedIds[0];
      const instObj = symbolInstanceDisplayObjects.find((o) => o.id === selId);
      if (instObj) {
        const sym = library.items.find((i) => i.id === instObj.symbolId && i.itemType === "symbol") as FlashSymbol | undefined;
        if (sym && sym.scale9Grid) {
          const grid = sym.scale9Grid;
          const scaleX = instObj.scaleX ?? 1;
          const scaleY = instObj.scaleY ?? 1;
          // Compute the symbol bounds in stage space for line extents
          const symBounds = getSymbolInstanceBounds(instObj, library);
          const instX = instObj.x;
          const instY = instObj.y;
          // The four grid line positions in stage space
          const x1 = instX + grid.x * scaleX;
          const x2 = instX + (grid.x + grid.width) * scaleX;
          const y1 = instY + grid.y * scaleY;
          const y2 = instY + (grid.y + grid.height) * scaleY;
          // Extents: lines run across the full symbol bounds
          const left = symBounds.x;
          const right = symBounds.x + symBounds.width;
          const top = symBounds.y;
          const bottom = symBounds.y + symBounds.height;

          const ctx = renderCanvasRef.current.getContext("2d")!;
          ctx.save();
          ctx.strokeStyle = "rgba(0, 170, 255, 0.85)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);

          // Left vertical grid line
          ctx.beginPath();
          ctx.moveTo(x1 + 0.5, top);
          ctx.lineTo(x1 + 0.5, bottom);
          ctx.stroke();

          // Right vertical grid line
          ctx.beginPath();
          ctx.moveTo(x2 + 0.5, top);
          ctx.lineTo(x2 + 0.5, bottom);
          ctx.stroke();

          // Top horizontal grid line
          ctx.beginPath();
          ctx.moveTo(left, y1 + 0.5);
          ctx.lineTo(right, y1 + 0.5);
          ctx.stroke();

          // Bottom horizontal grid line
          ctx.beginPath();
          ctx.moveTo(left, y2 + 0.5);
          ctx.lineTo(right, y2 + 0.5);
          ctx.stroke();

          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    // Draw unselected text field outlines (dashed blue border on all text objects)
    if (textDisplayObjects.length > 0 && renderCanvasRef.current) {
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.save();
      ctx.strokeStyle = "#0066cc";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const tObj of textDisplayObjects) {
        if (!effectiveSelectedIds.includes(tObj.id) && tObj.width > 0 && tObj.height > 0) {
          ctx.strokeRect(tObj.x, tObj.y, tObj.width, tObj.height);
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Draw subselection anchor points overlay
    if (activeTool === "subselect" && subselState.selectedObjectId) {
      const selObj = shapeDisplayObjects.find((o) => o.id === subselState.selectedObjectId);
      if (selObj && selObj.shape.paths[0]) {
        const ctx = renderCanvasRef.current.getContext("2d")!;
        ctx.save();
        const path = selObj.shape.paths[0];
        const anchPoints = [
          { x: selObj.x + path.start.x, y: selObj.y + path.start.y },
          ...path.segments.map((s) => ({ x: selObj.x + s.to.x, y: selObj.y + s.to.y })),
        ];
        for (let i = 0; i < anchPoints.length; i++) {
          const ap = anchPoints[i];
          const isSelected = subselState.selectedAnchorIndex === i;
          ctx.fillStyle = isSelected ? themeHalo.haloBlue : "white";
          ctx.strokeStyle = themeHalo.haloBlue;
          ctx.lineWidth = 1;
          ctx.fillRect(ap.x - 4, ap.y - 4, 8, 8);
          ctx.strokeRect(ap.x - 4, ap.y - 4, 8, 8);
        }
        ctx.restore();
      }
    }

    // Draw pen path in-progress preview
    if (activeTool === "pen") {
      const { anchors, dragStart, currentHandleOut, cursorPos } = penState;
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.save();

      // Draw the committed path segments so far
      if (anchors.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(anchors[0].x, anchors[0].y);
        for (let i = 1; i < anchors.length; i++) {
          const prev = anchors[i - 1];
          const curr = anchors[i];
          if (prev.handleOut) {
            ctx.quadraticCurveTo(prev.handleOut.x, prev.handleOut.y, curr.x, curr.y);
          } else {
            ctx.lineTo(curr.x, curr.y);
          }
        }
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // Draw rubber-band segment from last anchor to cursor
      if (anchors.length >= 1 && cursorPos && !dragStart) {
        const last = anchors[anchors.length - 1];
        ctx.beginPath();
        if (last.handleOut) {
          ctx.moveTo(last.x, last.y);
          ctx.quadraticCurveTo(last.handleOut.x, last.handleOut.y, cursorPos.x, cursorPos.y);
        } else {
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(cursorPos.x, cursorPos.y);
        }
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw handle being dragged
      if (dragStart && currentHandleOut) {
        // Handle line from anchor to handle
        ctx.beginPath();
        ctx.moveTo(dragStart.x, dragStart.y);
        ctx.lineTo(currentHandleOut.x, currentHandleOut.y);
        ctx.strokeStyle = themeHalo.haloBlue;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.stroke();
        // Handle circle
        ctx.beginPath();
        ctx.arc(currentHandleOut.x, currentHandleOut.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.strokeStyle = themeHalo.haloBlue;
        ctx.fill();
        ctx.stroke();
      }

      // Draw anchor squares for placed anchors
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        const isFirst = i === 0;
        // First anchor: hollow square (close indicator)
        const atCursor = cursorPos && Math.hypot(cursorPos.x - anchor.x, cursorPos.y - anchor.y) <= 8 && isFirst && anchors.length >= 2;
        ctx.fillStyle = atCursor ? "rgba(0,153,255,0.3)" : "white";
        ctx.strokeStyle = isFirst ? "#ff6600" : "#333333";
        ctx.lineWidth = isFirst ? 2 : 1;
        ctx.fillRect(anchor.x - 4, anchor.y - 4, 8, 8);
        ctx.strokeRect(anchor.x - 4, anchor.y - 4, 8, 8);
        // Draw handle for this anchor if it has one
        if (anchor.handleOut) {
          ctx.beginPath();
          ctx.moveTo(anchor.x, anchor.y);
          ctx.lineTo(anchor.handleOut.x, anchor.handleOut.y);
          ctx.strokeStyle = themeHalo.haloBlue;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(anchor.handleOut.x, anchor.handleOut.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = "white";
          ctx.strokeStyle = themeHalo.haloBlue;
          ctx.fill();
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    // Draw lasso overlay (freehand or polygon mode)
    if (activeTool === "lasso") {
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.save();
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);

      if (!lassoPolygonMode && lassoPoints.length >= 2) {
        // Freehand lasso
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for (let i = 1; i < lassoPoints.length; i++) {
          ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        }
        ctx.stroke();
      } else if (lassoPolygonMode && lassoPolyVertices.length >= 1) {
        // Polygon lasso
        ctx.beginPath();
        ctx.moveTo(lassoPolyVertices[0].x, lassoPolyVertices[0].y);
        for (let i = 1; i < lassoPolyVertices.length; i++) {
          ctx.lineTo(lassoPolyVertices[i].x, lassoPolyVertices[i].y);
        }
        ctx.stroke();
        // Draw vertices as small circles
        ctx.setLineDash([]);
        for (const v of lassoPolyVertices) {
          ctx.beginPath();
          ctx.arc(v.x, v.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#333";
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Draw Free Transform distort/envelope mesh handles at their WARPED
    // positions (4 corners; +8 bezier edge controls in envelope mode), plus the
    // warped mesh frame. The live warp during a drag comes from warpDragRef.
    if (activeTool === "free-transform" && selectedShapeId && (freeTransformMode === "distort" || freeTransformMode === "envelope")) {
      const obj = shapeDisplayObjects.find((o) => o.id === selectedShapeId);
      if (obj) {
        const bounds = transformedShapeBounds(obj);
        const warp =
          warpDragRef.current && warpDragRef.current.shapeId === selectedShapeId
            ? warpDragRef.current.warp
            : getOrInitWarp(obj, bounds, freeTransformMode);
        const ctx = renderCanvasRef.current.getContext("2d")!;
        ctx.save();

        // Warped mesh outline (orange, dashed). Follows the bent envelope edges.
        const outline = warpOutlinePoints(warp);
        ctx.strokeStyle = "#ff6600";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);
        for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        for (const h of getWarpHandles(warp)) {
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#ff6600";
          if (h.kind === "corner") {
            ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
            ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
          } else {
            // Envelope edge control: a circle with a tether to its anchor edge.
            ctx.beginPath();
            ctx.arc(h.x, h.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // Draw Gradient Transform handles (center circle, scale handle, rotate handle)
    if (activeTool === "gradientTransform" && selectedShapeId && renderCanvasRef.current) {
      const obj = shapeDisplayObjects.find((o) => o.id === selectedShapeId);
      if (obj) {
        const gradFill = getShapeGradientFill(obj.shape);
        if (gradFill) {
          const bounds = transformedShapeBounds(obj);
          const angle = gradFill.type === "linear-gradient" ? gradFill.angle : 0;
          const { cx, cy, scaleX, scaleY, rotX, rotY } = getGradientHandlePositions(bounds, angle);
          const ctx = renderCanvasRef.current.getContext("2d")!;
          ctx.save();

          // Dashed outline showing gradient bounds
          ctx.strokeStyle = "#00cc99";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 2]);
          ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
          ctx.setLineDash([]);

          // Line from center to scale handle
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(scaleX, scaleY);
          ctx.strokeStyle = "#00cc99";
          ctx.lineWidth = 1;
          ctx.stroke();

          // Line from center to rotate handle
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(rotX, rotY);
          ctx.strokeStyle = "#00cc99";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Center circle
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#00cc99";
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          // Scale handle (square)
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#00cc99";
          ctx.lineWidth = 1;
          ctx.fillRect(scaleX - 5, scaleY - 5, 10, 10);
          ctx.strokeRect(scaleX - 5, scaleY - 5, 10, 10);

          // Rotate handle (circle)
          ctx.beginPath();
          ctx.arc(rotX, rotY, 5, 0, Math.PI * 2);
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#00cc99";
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();

          // For radial gradient, also show focal point handle
          if (gradFill.type === "radial-gradient") {
            const fpX = cx + gradFill.focalPoint * bounds.width / 2;
            const fpY = cy;
            ctx.beginPath();
            ctx.arc(fpX, fpY, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#00cc99";
            ctx.fill();
          }

          ctx.restore();
        }
      }
    }

    // Draw motion path overlays for layers with active motion tweens
    if (timeline && renderCanvasRef.current) {
      const ctx = renderCanvasRef.current.getContext("2d");
      if (ctx) {
        drawMotionPaths(ctx, [...timeline.layers] as import("@flash/core").Layer[], _currentFrame, timeline as import("@flash/core").Timeline);
      }
    }

    // Draw Free Transform marquee selection rectangle
    if (ftIsMarqueeSelecting && ftMarqueeStart && ftMarqueeEnd && renderCanvasRef.current) {
      const ctx = renderCanvasRef.current.getContext("2d")!;
      ctx.save();
      ctx.strokeStyle = "#0066cc";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const r = normalizeRect(ftMarqueeStart, ftMarqueeEnd);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.fillStyle = "rgba(0,102,204,0.05)";
      ctx.fillRect(r.x, r.y, r.width, r.height);
      ctx.restore();
    }
  }, [propSceneGraph, parentSceneGraph, shapeDisplayObjects, textDisplayObjects, bitmapDisplayObjects, bitmapLibraryItems, stageWidth, stageHeight, pasteboardMargin, canvasWidth, canvasHeight, selectedShapeId, selectedShapeIds, subSelection, subSplitPreview, activeTool, penState, subselState, lassoPoints, lassoPolyVertices, lassoPolygonMode, freeTransformMode, library, onionFrames, timeline, _currentFrame, ftIsMarqueeSelecting, ftMarqueeStart, ftMarqueeEnd, simpleButtonsEnabled, hoveredButtonId, pressedButtonId, symbolInstanceDisplayObjects, editingTextId, textEditState]);

  // CSS filter for view modes
  const stageFilter =
    viewMode === "antialias"
      ? "none"
      : viewMode === "outlines"
      ? "contrast(100) invert(1) grayscale(1)"
      : "none";

  // The CSS transform positions the stage using pan + zoom
  // We translate THEN scale so pan is in stage-space coordinates
  const transform = `scale(${internalZoom}) translate(${internalPanX}px, ${internalPanY}px)`;

  // Zoom tool: left-click = zoom in, alt+click or right-click = zoom out
  const onZoomToolClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool !== "zoom") return;
      e.preventDefault();
      const zoomOut = e.altKey || e.button === 2;
      setInternalZoom((z) => {
        const next = nearestZoomLevel(z, zoomOut ? -1 : 1);
        onZoomChange?.(next);
        return next;
      });
    },
    [activeTool, onZoomChange]
  );

  const workAreaStyle: React.CSSProperties = {
    flex: 1,
    // Flash 8 pasteboard / work area: light gray (System C content.pasteboard #D0D0D0).
    background: themeContent.pasteboard,
    overflow: "hidden",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: handleCursor ?? (simpleButtonsEnabled && hoveredButtonId ? "pointer" : getToolCursor(activeTool, spaceHeld)),
    // Own all touch gestures on the interaction surface so the browser does not
    // claim a finger drag for native pan/zoom/scroll — without this, pointer
    // handlers are pre-empted mid-stroke on touch devices (task 1275).
    touchAction: "none",
  };

  const stageContainerStyle: React.CSSProperties = {
    position: "relative",
    // Flash 8 stage edge: a crisp ~1px hairline drop-shadow (offset ~1px, NO soft blur)
    // in content.stageEdgeShadow (#CDCDCD) — the white stage sits on the gray pasteboard.
    boxShadow: `1px 1px 0 0 ${themeContent.stageEdgeShadow}`,
    transformOrigin: "center center",
    transform,
    willChange: "transform",
    flexShrink: 0,
  };

  const stageStyle: React.CSSProperties = {
    display: "block",
    width: `${stageWidth}px`,
    height: `${stageHeight}px`,
    background: backgroundColor,
    position: "relative",
    // Outlines mode: show only stroke outlines via filter (simplified approximation)
    filter: viewMode === "outlines" ? "grayscale(1) contrast(999)" : "none",
    // imageRendering for pixel grid at high zoom
    imageRendering: internalZoom >= 2 ? "pixelated" : "auto",
  };

  // Handle drag-over and drop for library items
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (
      e.dataTransfer.types.includes("application/flash-library-item") ||
      e.dataTransfer.types.includes("application/flash-component")
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const itemId = e.dataTransfer.getData("application/flash-library-item");
      const componentName = e.dataTransfer.getData("application/flash-component");
      if (!itemId && !componentName) return;
      if (itemId && !onDrop) return;
      if (componentName && !onDropComponent) return;
      e.preventDefault();

      // Convert screen coordinates to stage coordinates
      const workArea = workAreaRef.current;
      if (!workArea) return;
      const rect = workArea.getBoundingClientRect();
      // The stage is centered in the workArea with transform: scale(zoom) translate(panX, panY)
      const containerCenterX = rect.left + rect.width / 2;
      const containerCenterY = rect.top + rect.height / 2;

      // In screen space, the stage center is at containerCenter + (panX * zoom, panY * zoom)
      // Stage coords: x_stage = (screenX - stageCenterScreenX) / zoom + stageWidth/2
      const stageCenterScreenX = containerCenterX + internalPanX * internalZoom;
      const stageCenterScreenY = containerCenterY + internalPanY * internalZoom;

      const stageX = (e.clientX - stageCenterScreenX) / internalZoom + stageWidth / 2;
      const stageY = (e.clientY - stageCenterScreenY) / internalZoom + stageHeight / 2;

      if (componentName) {
        onDropComponent?.(componentName, stageX, stageY);
      } else if (itemId) {
        onDrop?.(itemId, stageX, stageY);
      }
    },
    [onDrop, onDropComponent, internalPanX, internalPanY, internalZoom, stageWidth, stageHeight]
  );

  // Double-click on pen tool: finalize path as open
  // Double-click on text object with selection tool: enter text edit mode
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (activeTool === "pen") {
        // Need at least 2 anchors to form an open path
        const anchors = penState.anchors;
        if (anchors.length < 2) {
          // Not enough points — just cancel
          setPenState({ anchors: [], dragStart: null, currentHandleOut: null, cursorPos: null });
          return;
        }
        e.preventDefault();
        // Build an open (unclosed) path using current stroke/fill settings
        const penStrokeForOpen: SolidStroke | undefined = (propStrokeAlpha > 0 && propStrokeWidth > 0)
          ? {
              type: "solid",
              color: hexToColor(propStrokeColor, Math.round((propStrokeAlpha / 100) * 255)),
              width: propStrokeWidth,
              caps: "round",
              joints: "round",
              miterLimit: 3,
            }
          : undefined;
        const shapePath = anchorsToShapePath(anchors, propFill ?? undefined, penStrokeForOpen);
        const openPath = { ...shapePath, closed: false };
        const shapeId = "shape-pen-" + Date.now();
        const openShape: Shape = { id: shapeId, paths: [openPath] };
        onShapeCreated?.(openShape, 0, 0);
        setPenState({ anchors: [], dragStart: null, currentHandleOut: null, cursorPos: null });
        return;
      }

      // Selection tool: double-click on a text object to enter inline edit mode,
      // or double-click on a SymbolInstance to enter symbol edit mode.
      if (activeTool === "selection") {
        const { stageX, stageY } = toStageCoords(e.clientX, e.clientY);
        const hitText = [...textDisplayObjects].reverse().find((obj) =>
          stageX >= obj.x &&
          stageX <= obj.x + obj.width &&
          stageY >= obj.y &&
          stageY <= obj.y + obj.height
        );
        if (hitText) {
          e.preventDefault();
          setTextEditState({
            stageX: hitText.x,
            stageY: hitText.y,
            editingId: hitText.id,
            initialText: hitText.text,
          });
          setTimeout(() => textareaRef.current?.focus(), 0);
        } else if (onSymbolInstanceDoubleClick && symbolInstanceDisplayObjects.length > 0) {
          // Hit-test symbol instances: use a proximity radius around the instance origin.
          // Try a 40px hit radius (covers most instances without needing to resolve symbol bounds).
          const HIT_RADIUS = 40;
          const hitInst = [...symbolInstanceDisplayObjects].reverse().find((inst) => {
            const dx = stageX - inst.x;
            const dy = stageY - inst.y;
            return Math.hypot(dx, dy) <= HIT_RADIUS;
          });
          if (hitInst) {
            e.preventDefault();
            onSymbolInstanceDoubleClick(hitInst.id, hitInst.symbolId);
          }
        }
      }
    },
    [activeTool, penState, onShapeCreated, toStageCoords, textDisplayObjects, symbolInstanceDisplayObjects, onSymbolInstanceDoubleClick, propStrokeColor, propStrokeAlpha, propStrokeWidth, propFill]
  );

  return (
    <div
      ref={workAreaRef}
      style={workAreaStyle}
      onWheelCapture={onWheelCapture}
      onWheel={onWheel}
      onPointerDown={(e) => {
        // Capture the pointer so a drag that leaves the element still delivers
        // move/up here (robust off-element drags on both mouse and touch).
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
        onMouseDown(e);
      }}
      onPointerMove={onMouseMove}
      onPointerUp={(e) => {
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
        onMouseUp(e);
      }}
      onPointerCancel={(e) => { onMouseUp(e); setEraserCursorPos(null); setHoveredButtonId(null); setPressedButtonId(null); }}
      onPointerLeave={(e) => {
        // With pointer capture active a real off-element leave won't fire until
        // release; this still covers the non-captured hover-exit case.
        onMouseUp(e); setEraserCursorPos(null); setHoveredButtonId(null); setPressedButtonId(null);
      }}
      onClick={onZoomToolClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        if (activeTool === "zoom") { onZoomToolClick(e); return; }
        e.preventDefault();
        setStageContextMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div style={stageContainerStyle}>
        <div style={stageStyle} onClick={() => onInstanceSelect?.(null)}>
          {/* Grid overlay canvas */}
          {showGrid && (
            <canvas
              ref={gridCanvasRef}
              width={stageWidth}
              height={stageHeight}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                zIndex: 10,
                filter: stageFilter,
              }}
            />
          )}

          {/* Placed instances — selection overlay only; rendering is done by CanvasRenderer */}
          {instances.map((inst) => {
            const w = 60 * inst.scaleX;
            const h = 40 * inst.scaleY;
            const isSelected = inst.id === selectedInstanceId;
            const instStyle: React.CSSProperties = {
              position: "absolute",
              left: inst.x - w / 2,
              top: inst.y - h / 2,
              width: w,
              height: h,
              transform: `rotate(${inst.rotation}deg)`,
              opacity: inst.alpha,
              background: "transparent",
              border: isSelected
                ? `2px solid ${themeHalo.haloBlue}`
                : "1px dashed rgba(80,140,220,0.5)",
              boxSizing: "border-box",
              cursor: "pointer",
              userSelect: "none",
              zIndex: 5,
            };
            return (
              <div
                key={inst.id}
                style={instStyle}
                onClick={(e) => { e.stopPropagation(); onInstanceSelect?.(inst.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); onInstanceDoubleClick?.(inst.id); }}
              />
            );
          })}

          {/* Canvas renderer for shape display objects. Spans stage + pasteboard margin
              on every side and is offset by -pasteboardMargin so the stage region still
              aligns to the stage box at (0,0); off-stage content draws onto the margin.
              The effect resizes the backing buffer (with DPR) — the width/height attrs
              here are the pre-mount fallback only. */}
          <canvas
            ref={renderCanvasRef}
            data-testid="stage-canvas"
            width={canvasWidth}
            height={canvasHeight}
            style={{
              position: "absolute",
              top: -pasteboardMargin,
              left: -pasteboardMargin,
              width: canvasWidth,
              height: canvasHeight,
              pointerEvents: "none",
              zIndex: 4,
            }}
          />

          {/* Draw preview overlay */}
          {drawPreview && (() => {
            const left = Math.min(drawPreview.x1, drawPreview.x2);
            const top = Math.min(drawPreview.y1, drawPreview.y2);
            const width = Math.abs(drawPreview.x2 - drawPreview.x1);
            const height = Math.abs(drawPreview.y2 - drawPreview.y1);
            const isLine = drawPreview.tool === "line";
            const isOval = drawPreview.tool === "oval";
            const isPolystar = drawPreview.tool === "polystar";

            if (isLine) {
              // For line, draw an SVG overlay
              const svgLeft = Math.min(drawPreview.x1, drawPreview.x2);
              const svgTop = Math.min(drawPreview.y1, drawPreview.y2);
              const svgW = Math.max(width, 1);
              const svgH = Math.max(height, 1);
              return (
                <svg
                  style={{
                    position: "absolute",
                    left: svgLeft,
                    top: svgTop,
                    pointerEvents: "none",
                    zIndex: 20,
                    overflow: "visible",
                  }}
                  width={svgW}
                  height={svgH}
                >
                  <line
                    x1={drawPreview.x1 - svgLeft}
                    y1={drawPreview.y1 - svgTop}
                    x2={drawPreview.x2 - svgLeft}
                    y2={drawPreview.y2 - svgTop}
                    stroke="#000"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                  />
                </svg>
              );
            }

            if (isPolystar) {
              // Render polystar preview as SVG polygon
              const cx = drawPreview.x1;
              const cy = drawPreview.y1;
              const radius = Math.hypot(drawPreview.x2 - cx, drawPreview.y2 - cy);
              const { shapeType, sides, pointSize } = polyStarOptions;
              const pts: string[] = [];
              if (shapeType === "star") {
                const innerR = radius * pointSize;
                for (let i = 0; i < sides * 2; i++) {
                  const angle = (i * Math.PI / sides) - Math.PI / 2;
                  const r = i % 2 === 0 ? radius : innerR;
                  pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
                }
              } else {
                for (let i = 0; i < sides; i++) {
                  const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
                  pts.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
                }
              }
              return (
                <svg
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: stageWidth,
                    height: stageHeight,
                    pointerEvents: "none",
                    zIndex: 20,
                    overflow: "visible",
                  }}
                >
                  <polygon
                    points={pts.join(" ")}
                    fill="rgba(200,200,200,0.1)"
                    stroke="#000"
                    strokeWidth={1}
                    strokeDasharray="4 2"
                  />
                </svg>
              );
            }

            const previewStyle: React.CSSProperties = {
              position: "absolute",
              left,
              top,
              width,
              height,
              border: "1px dashed #000",
              boxSizing: "border-box",
              pointerEvents: "none",
              zIndex: 20,
              borderRadius: isOval ? "50%" : 0,
              background: "rgba(200,200,200,0.1)",
            };
            return <div style={previewStyle} />;
          })()}
          {/* Pencil preview overlay */}
          {pencilPreviewPoints.length >= 2 && (
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: stageWidth,
                height: stageHeight,
                pointerEvents: "none",
                zIndex: 20,
                overflow: "visible",
              }}
            >
              <polyline
                points={pencilPreviewPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={propStrokeColor}
                strokeWidth={Math.max(1, propStrokeWidth)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.7}
              />
            </svg>
          )}

          {/* Brush preview overlay — a round-capped/round-joined thick stroke so
              the preview matches the round nib geometry committed on mouse-up. */}
          {brushPreviewPoints.length >= 1 && (() => {
            const fillCss = propFill?.type === "solid"
              ? `rgba(${propFill.color.r},${propFill.color.g},${propFill.color.b},${propFill.color.a / 255})`
              : propStrokeColor;
            const pathD = brushPreviewPoints.length === 1
              // Single dab: degenerate stroke renders as a round dot via linecap=round.
              ? `M ${brushPreviewPoints[0].x},${brushPreviewPoints[0].y} L ${brushPreviewPoints[0].x},${brushPreviewPoints[0].y}`
              : "M " + brushPreviewPoints.map((p) => `${p.x},${p.y}`).join(" L ");
            return (
              <svg
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: stageWidth,
                  height: stageHeight,
                  pointerEvents: "none",
                  zIndex: 20,
                  overflow: "visible",
                }}
              >
                <path
                  d={pathD}
                  fill="none"
                  stroke={fillCss}
                  strokeWidth={brushSize}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.6}
                />
              </svg>
            );
          })()}

          {/* Eraser cursor circle overlay — shown whenever eraser tool is active and cursor is over the stage */}
          {activeTool === "eraser" && eraserCursorPos && (
            <div
              style={{
                position: "absolute",
                left: eraserCursorPos.stageX - eraserSize / 2,
                top: eraserCursorPos.stageY - eraserSize / 2,
                width: eraserSize,
                height: eraserSize,
                borderRadius: "50%",
                border: "1.5px solid #333",
                boxSizing: "border-box",
                background: "rgba(255,255,255,0.15)",
                pointerEvents: "none",
                zIndex: 30,
              }}
            />
          )}

          {/* Arrow tool rubber-band marquee selection overlay */}
          {selIsMarqueeSelecting && selMarqueeStart && selMarqueeEnd && (() => {
            const r = normalizeRect(selMarqueeStart, selMarqueeEnd);
            return (
              <div
                style={{
                  position: "absolute",
                  left: r.x,
                  top: r.y,
                  width: r.width,
                  height: r.height,
                  border: "1px dashed #0066ff",
                  background: "rgba(0,102,255,0.08)",
                  boxSizing: "border-box",
                  pointerEvents: "none",
                  zIndex: 25,
                }}
              />
            );
          })()}

          {/* Text editing textarea overlay */}
          {textEditState && (() => {
            // When editing an existing text object, use its own font properties.
            // When creating a new one, fall back to the current textFormat state.
            const existingObj = textEditState.editingId
              ? textDisplayObjects.find((o) => o.id === textEditState.editingId)
              : undefined;
            const editFontItalic = existingObj ? existingObj.italic : textFormat.italic;
            const editFontBold = existingObj ? existingObj.bold : textFormat.bold;
            const editFontSize = existingObj ? existingObj.fontSize : textFormat.fontSize;
            const editFontFamily = existingObj ? existingObj.fontFamily : textFormat.fontFamily;
            const editColor = existingObj
              ? `#${existingObj.color.r.toString(16).padStart(2, "0")}${existingObj.color.g.toString(16).padStart(2, "0")}${existingObj.color.b.toString(16).padStart(2, "0")}`
              : textFormat.color;
            const editWidth = existingObj ? existingObj.width : 200;
            const editHeight = existingObj ? existingObj.height : 80;
            const fontStyle = editFontItalic ? "italic " : "";
            const fontWeight = editFontBold ? "bold " : "";
            const font = `${fontStyle}${fontWeight}${editFontSize}px ${editFontFamily}`;
            return (
              <textarea
                ref={textareaRef}
                defaultValue={textEditState.initialText}
                style={{
                  position: "absolute",
                  // The canvas paints text with its top-left exactly at the object's
                  // (x, y) (textBaseline:"top" in renderTextObject). The textarea's text
                  // content box is inset by its border (1px) + padding (2px), so shift the
                  // box up-left by that 3px inset to make the overlay text sit exactly
                  // where the canvas would have drawn it (no slight offset).
                  left: textEditState.stageX - TEXT_OVERLAY_INSET,
                  top: textEditState.stageY - TEXT_OVERLAY_INSET,
                  width: editWidth + TEXT_OVERLAY_INSET * 2,
                  height: editHeight + TEXT_OVERLAY_INSET * 2,
                  font,
                  color: editColor,
                  background: "rgba(255,255,255,0.1)",
                  border: `${TEXT_OVERLAY_BORDER}px dashed ${themeHalo.haloBlue}`,
                  outline: "none",
                  resize: "both",
                  zIndex: 50,
                  padding: TEXT_OVERLAY_PADDING,
                  boxSizing: "border-box",
                  overflow: "hidden",
                }}
                onBlur={(e) => {
                  const text = e.currentTarget.value;
                  if (textEditState.editingId) {
                    // Editing existing text object
                    onTextEdit?.(textEditState.editingId, text);
                    onTextEditEnd?.();
                  } else if (text.trim()) {
                    // Creating a new text object
                    const rect = e.currentTarget.getBoundingClientRect();
                    onTextCreated?.({
                      type: "text",
                      x: textEditState.stageX,
                      y: textEditState.stageY,
                      // offsetWidth/Height include the INSET*2 we added to the box; strip
                      // it back out so the model dimensions match the canvas text region.
                      width: (e.currentTarget.offsetWidth || 200) - TEXT_OVERLAY_INSET * 2,
                      height: (e.currentTarget.offsetHeight || 80) - TEXT_OVERLAY_INSET * 2,
                      text,
                      textType: "static",
                      fontFamily: textFormat.fontFamily,
                      fontSize: textFormat.fontSize,
                      bold: textFormat.bold,
                      italic: textFormat.italic,
                      color: hexToColor(textFormat.color),
                      align: textFormat.align,
                      multiline: true,
                      wordWrap: true,
                    });
                    void rect;
                  }
                  setTextEditState(null);
                }}
                onKeyDown={(e) => {
                  // Escape to cancel without saving
                  if (e.key === "Escape") {
                    setTextEditState(null);
                  }
                  e.stopPropagation();
                }}
              />
            );
          })()}

          {/* Guide lines overlay */}
          {showGuides && guides.map((guide) => {
            const isHorizontal = guide.orientation === "horizontal";
            const guideStyle: React.CSSProperties = isHorizontal
              ? {
                  position: "absolute",
                  left: 0,
                  top: guide.position,
                  width: "100%",
                  height: 1,
                  background: themeContent.guide,
                  cursor: "row-resize",
                  zIndex: 30,
                  pointerEvents: "auto",
                }
              : {
                  position: "absolute",
                  top: 0,
                  left: guide.position,
                  width: 1,
                  height: "100%",
                  background: themeContent.guide,
                  cursor: "col-resize",
                  zIndex: 30,
                  pointerEvents: "auto",
                };
            return (
              <div
                key={guide.id}
                style={guideStyle}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  guideDragRef.current = { guideId: guide.id, orientation: guide.orientation };
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onGuideDelete?.(guide.id);
                }}
              />
            );
          })}
          {/* Stage overlay slot — used for SVG overlays like transform handles */}
          {stageOverlay}
        </div>
        {/* Outlines view mode overlay label */}
        {viewMode === "outlines" && (
          <div
            style={{
              position: "absolute",
              top: 2,
              right: 4,
              fontSize: 9,
              // Readable dark label on the light pasteboard.
              color: themeChrome.textDisabled,
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            OUTLINES
          </div>
        )}
      </div>

      {/* Stage right-click context menu */}
      {stageContextMenu && (
        <StageContextMenu
          x={stageContextMenu.x}
          y={stageContextMenu.y}
          hasSelection={selectedShapeIds.length > 0 || !!selectedShapeId}
          canGroup={selectedShapeIds.length > 1 && !!onGroup}
          canUngroup={
            !!onUngroup &&
            (selectedShapeIds.length > 0 || !!selectedShapeId) &&
            (() => {
              const allSelected = selectedShapeIds.length > 0
                ? selectedShapeIds
                : selectedShapeId ? [selectedShapeId] : [];
              return allSelected.some((id) => {
                const shape = shapeDisplayObjects.find((s) => s.id === id);
                return shape && (shape.shape as { type?: string }).type === "group";
              });
            })()
          }
          hasPaste={!!onPaste}
          onClose={() => setStageContextMenu(null)}
          onAction={(action) => {
            switch (action) {
              case "cut": onCut?.(); break;
              case "copy": onCopy?.(); break;
              case "paste": onPaste?.(); break;
              case "delete": onDeleteSelected?.(); break;
              case "select-all": {
                const allIds = [
                  ...shapeDisplayObjects.map((s) => s.id),
                  ...textDisplayObjects.map((t) => t.id),
                  ...bitmapDisplayObjects.map((b) => b.id),
                ];
                if (allIds.length > 0) onShapeSelectMultiple?.(allIds, true);
                break;
              }
              case "convert-to-symbol": onConvertToSymbol?.(); break;
              case "group": onGroup?.(); break;
              case "ungroup": onUngroup?.(); break;
              case "bring-to-front": onArrange?.("front"); break;
              case "send-to-back": onArrange?.("back"); break;
              default: break;
            }
          }}
        />
      )}
    </div>
  );
}
