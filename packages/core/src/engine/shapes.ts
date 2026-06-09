/**
 * Shape creation helpers for common Flash drawing tools.
 * All shapes use quadratic Bézier curves (Flash's native format).
 */

import type { FlashDocument } from '../model/types.js';
import type { Color, Fill, Shape, ShapePath, ShapeDisplayObject, DrawingObject, SolidStroke, DisplayObject } from "./types.js";

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

/**
 * Compute the axis-aligned bounding box of a Shape's paths.
 * Considers all path start points, segment endpoints, and curve control points.
 * Offset by offsetX/offsetY to account for the display object's world position.
 */
export function shapeBounds(
  shape: Shape,
  offsetX = 0,
  offsetY = 0
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const path of shape.paths) {
    const trackPt = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };

    trackPt(path.start.x, path.start.y);
    for (const seg of path.segments) {
      trackPt(seg.to.x, seg.to.y);
      if (seg.type === "curve") {
        trackPt(seg.control.x, seg.control.y);
      }
    }
  }

  if (!isFinite(minX)) {
    return { x: offsetX, y: offsetY, width: 0, height: 0 };
  }

  return {
    x: minX + offsetX,
    y: minY + offsetY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Compute the axis-aligned bounding box of a display object's shape,
 * accounting for its transform (x, y, scaleX, scaleY, rotation).
 *
 * The renderer for ShapeDisplayObject applies:
 *   ctx.translate(obj.x, obj.y) → ctx.rotate(rotation) → ctx.scale(scaleX, scaleY)
 * so the transform origin is (obj.x, obj.y).
 *
 * This function transforms the 4 corners of the raw (local-space) bounds by
 * that same matrix and returns the AABB of the resulting rotated corners.
 *
 * For DrawingObject (no rotation/scale fields) this degenerates to the same
 * result as shapeBounds(obj.shape, obj.x, obj.y).
 */
export function transformedShapeBounds(
  obj: ShapeDisplayObject | DrawingObject
): { x: number; y: number; width: number; height: number } {
  // Raw local-space bounds (no offset)
  const raw = shapeBounds(obj.shape, 0, 0);

  const scaleX = (obj as ShapeDisplayObject).scaleX ?? 1;
  const scaleY = (obj as ShapeDisplayObject).scaleY ?? 1;
  const rotationDeg = (obj as ShapeDisplayObject).rotation ?? 0;

  // Fast path: no transform
  if (scaleX === 1 && scaleY === 1 && rotationDeg === 0) {
    return {
      x: raw.x + obj.x,
      y: raw.y + obj.y,
      width: raw.width,
      height: raw.height,
    };
  }

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 4 corners of the raw (local-space) bounds
  const corners = [
    { x: raw.x,              y: raw.y },
    { x: raw.x + raw.width,  y: raw.y },
    { x: raw.x + raw.width,  y: raw.y + raw.height },
    { x: raw.x,              y: raw.y + raw.height },
  ];

  // Apply scale then rotate about origin (the renderer's transform order:
  // translate(obj.x, obj.y), rotate, scale — so local coords go through
  // scale first, then rotate, then the translation is added)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of corners) {
    const sx = c.x * scaleX;
    const sy = c.y * scaleY;
    const wx = obj.x + sx * cos - sy * sin;
    const wy = obj.y + sx * sin + sy * cos;
    if (wx < minX) minX = wx;
    if (wy < minY) minY = wy;
    if (wx > maxX) maxX = wx;
    if (wy > maxY) maxY = wy;
  }

  if (!isFinite(minX)) {
    return { x: obj.x, y: obj.y, width: 0, height: 0 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _shapeCounter = 0;
function nextId(): string {
  return "shape-" + ++_shapeCounter;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * Convert a CSS hex color string (e.g. "#ff0000" or "#f00") to a Color.
 */
export function hexToColor(hex: string, alpha = 255): Color {
  const clean = hex.replace(/^#/, "");
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return { r: r || 0, g: g || 0, b: b || 0, a: alpha };
}

// ---------------------------------------------------------------------------
// Shape factories
// ---------------------------------------------------------------------------

/**
 * Create a rectangle Shape from a bounding box.
 * Uses 4 line segments forming a closed path.
 */
export function createRectShape(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: Fill | null,
  stroke: SolidStroke | null
): Shape {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  const path: ShapePath = {
    start: { x: left, y: top },
    segments: [
      { type: "line", to: { x: right, y: top } },
      { type: "line", to: { x: right, y: bottom } },
      { type: "line", to: { x: left, y: bottom } },
      { type: "line", to: { x: left, y: top } },
    ],
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };

  return { id: nextId(), paths: [path] };
}

/**
 * Create an oval (ellipse) Shape from a bounding box.
 * Approximated with 8 quadratic Bézier segments (Flash-style approach).
 *
 * The "magic number" 0.5522847498 is the standard cubic-to-quadratic
 * approximation constant scaled appropriately. For a quadratic approximation
 * of a quarter-circle we use the control point factor:
 *   k = 4 * (sqrt(2) - 1) / 3 ≈ 0.5523  (for a cubic)
 * Converted to quadratic (8 segments of 45°): k_q ≈ tan(π/8) ≈ 0.4142
 */
export function createOvalShape(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: Fill | null,
  stroke: SolidStroke | null
): Shape {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2;
  const ry = Math.abs(y2 - y1) / 2;

  // k for 45-degree quadratic Bézier arc approximation
  const k = Math.tan(Math.PI / 8); // ≈ 0.4142

  // 8 points on the ellipse at every 45 degrees
  const angles = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => (d * Math.PI) / 180);

  function pt(angle: number) {
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
  }

  function controlPt(fromAngle: number, toAngle: number) {
    // Control point for quadratic Bézier approximating the arc
    const mid = (fromAngle + toAngle) / 2;
    // The control point lies on the tangent lines from the endpoints
    // For a quadratic arc segment of angle δ: control = intersection of tangents
    const cosA = Math.cos(fromAngle);
    const sinA = Math.sin(fromAngle);
    // Tangent direction at fromAngle: (-sin, cos)
    // control = endpoint + k * tangent_scaled_by_radius
    return {
      x: cx + rx * cosA - k * rx * sinA,
      y: cy + ry * sinA + k * ry * cosA,
    };
    void mid; // used only conceptually above
  }

  const startPt = pt(angles[0]);
  const segments = angles.map((angle, i) => {
    const nextAngle = angles[(i + 1) % 8];
    const cp = controlPt(angle, nextAngle);
    const endPt = pt(nextAngle);
    return {
      type: "curve" as const,
      control: cp,
      to: endPt,
    };
  });

  const path: ShapePath = {
    start: startPt,
    segments,
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };

  return { id: nextId(), paths: [path] };
}

/**
 * Create a regular polygon Shape centered at (cx, cy) with the given radius and number of sides.
 */
export function createPolygonShape(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  fill: Fill | null,
  stroke: SolidStroke | null
): Shape {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  const path: ShapePath = {
    start: points[0],
    segments: [
      ...points.slice(1).map((p) => ({ type: "line" as const, to: p })),
      { type: "line" as const, to: points[0] },
    ],
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };
  return { id: nextId(), paths: [path] };
}

/**
 * Create a star Shape centered at (cx, cy) with the given outer radius, number of points,
 * and inner radius as a fraction of outer radius (pointSize 0.0–1.0).
 */
export function createStarShape(
  cx: number,
  cy: number,
  outerRadius: number,
  sides: number,
  pointSize: number,
  fill: Fill | null,
  stroke: SolidStroke | null
): Shape {
  const innerRadius = outerRadius * pointSize;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < sides * 2; i++) {
    const angle = (i * Math.PI / sides) - Math.PI / 2;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  const path: ShapePath = {
    start: points[0],
    segments: [
      ...points.slice(1).map((p) => ({ type: "line" as const, to: p })),
      { type: "line" as const, to: points[0] },
    ],
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };
  return { id: nextId(), paths: [path] };
}

/**
 * Create a rounded-rectangle Shape from a position, size, and corner radius.
 *
 * Corners are approximated using quadratic Bézier curves (Flash's native format).
 * The corner radius is clamped to half the shorter dimension so the shape remains
 * valid even for extreme values.
 *
 * @param x            - Left edge in local (stage) pixels.
 * @param y            - Top edge in local (stage) pixels.
 * @param width        - Rectangle width in pixels.
 * @param height       - Rectangle height in pixels.
 * @param cornerRadius - Corner radius in pixels (clamped to min(w,h)/2).
 * @param fill         - Fill paint, or null for no fill.
 * @param stroke       - Stroke style, or null for no stroke.
 */
export function createRoundedRectShape(
  x: number,
  y: number,
  width: number,
  height: number,
  cornerRadius: number,
  fill: Fill | null,
  stroke: SolidStroke | null
): Shape {
  const r = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));
  const l = x;
  const t = y;
  const ri = x + width;
  const b = y + height;

  const segments: import("./types.js").PathSegment[] = [];

  if (r === 0) {
    // Plain rectangle — straight lines only
    segments.push(
      { type: "line", to: { x: ri, y: t } },
      { type: "line", to: { x: ri, y: b } },
      { type: "line", to: { x: l, y: b } },
      { type: "line", to: { x: l, y: t } }
    );
  } else {
    // Top edge (after top-left corner)
    segments.push({ type: "line",  to: { x: ri - r, y: t } });
    // Top-right corner (quadratic Bézier)
    segments.push({ type: "curve", control: { x: ri, y: t },     to: { x: ri, y: t + r } });
    // Right edge
    segments.push({ type: "line",  to: { x: ri, y: b - r } });
    // Bottom-right corner
    segments.push({ type: "curve", control: { x: ri, y: b },     to: { x: ri - r, y: b } });
    // Bottom edge
    segments.push({ type: "line",  to: { x: l + r, y: b } });
    // Bottom-left corner
    segments.push({ type: "curve", control: { x: l, y: b },      to: { x: l, y: b - r } });
    // Left edge
    segments.push({ type: "line",  to: { x: l, y: t + r } });
    // Top-left corner (closes back to start)
    segments.push({ type: "curve", control: { x: l, y: t },      to: { x: l + r, y: t } });
  }

  const path: ShapePath = {
    start: { x: l + r, y: t },
    segments,
    closed: true,
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
  };

  return { id: nextId(), paths: [path] };
}

/**
 * Create a line Shape from (x1,y1) to (x2,y2).
 * Uses a single LineSegment with the given stroke (no fill).
 */
export function createLineShape(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: SolidStroke
): Shape {
  const path: ShapePath = {
    start: { x: x1, y: y1 },
    segments: [{ type: "line", to: { x: x2, y: y2 } }],
    closed: false,
    stroke,
  };

  return { id: nextId(), paths: [path] };
}

// ---------------------------------------------------------------------------
// Document-level shape placement helpers
// ---------------------------------------------------------------------------

/**
 * Return a new document with a new DisplayObject appended to the governing
 * keyframe at or before frameIdx in the specified scene/layer.
 * Immutable — every ancestor object is spread.
 */
function replaceFrameDisplayObjects(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  newObj: DisplayObject
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;
  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  // Find governing keyframe at or before frameIdx
  const keyframe = [...layer.frames]
    .filter((f) => f.isKeyframe && f.index <= frameIdx)
    .sort((a, b) => b.index - a.index)[0];
  if (!keyframe) return doc;

  const newFrame = {
    ...keyframe,
    displayObjects: [...keyframe.displayObjects, newObj],
    isEmpty: false,
  };
  const newFrames = layer.frames.map((f) => (f === keyframe ? newFrame : f));
  const newLayer = { ...layer, frames: newFrames };
  const newLayers = scene.timeline.layers.map((l, i) =>
    i === layerIdx ? newLayer : l
  );
  const newScene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };
  const newScenes = doc.scenes.map((s, i) => (i === sceneIdx ? newScene : s));
  return { ...doc, scenes: newScenes };
}

/**
 * Add a rectangle ShapeDisplayObject to the specified frame.
 *
 * Path coordinates are in stage (absolute) space with obj.x = obj.y = 0.
 *
 * @param doc         - Source document (never mutated).
 * @param sceneIdx    - 0-based scene index.
 * @param layerIdx    - 0-based layer index within the scene.
 * @param frameIdx    - Target frame index; the governing keyframe at or before
 *                      this index receives the new object.
 * @param x           - Left edge in stage pixels.
 * @param y           - Top edge in stage pixels.
 * @param width       - Rectangle width in pixels.
 * @param height      - Rectangle height in pixels.
 * @param fillColor   - CSS hex fill color (e.g. "#ff0000") or null for no fill.
 * @param strokeColor - CSS hex stroke color or null for no stroke.
 * @param strokeWidth - Stroke width in pixels (default 1).
 * @returns New FlashDocument with the rectangle added.
 */
export function addRectangle(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor: string | null,
  strokeColor: string | null,
  strokeWidth = 1
): FlashDocument {
  const fill: Fill | null = fillColor
    ? { type: "solid", color: hexToColor(fillColor) }
    : null;
  const stroke: SolidStroke | null = strokeColor
    ? {
        type: "solid",
        color: hexToColor(strokeColor),
        width: strokeWidth,
        caps: "none",
        joints: "miter",
        miterLimit: 3,
      }
    : null;

  const shape = createRectShape(x, y, x + width, y + height, fill, stroke);
  const obj: ShapeDisplayObject = {
    id: nextId(),
    type: "shape",
    shape,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };

  return replaceFrameDisplayObjects(doc, sceneIdx, layerIdx, frameIdx, obj);
}

/**
 * Add an oval (ellipse) ShapeDisplayObject to the specified frame.
 *
 * @param doc         - Source document (never mutated).
 * @param sceneIdx    - 0-based scene index.
 * @param layerIdx    - 0-based layer index within the scene.
 * @param frameIdx    - Target frame index.
 * @param cx          - Center X in stage pixels.
 * @param cy          - Center Y in stage pixels.
 * @param rx          - Horizontal radius in pixels.
 * @param ry          - Vertical radius in pixels.
 * @param fillColor   - CSS hex fill color or null for no fill.
 * @param strokeColor - CSS hex stroke color or null for no stroke.
 * @param strokeWidth - Stroke width in pixels (default 1).
 * @returns New FlashDocument with the oval added.
 */
export function addOval(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fillColor: string | null,
  strokeColor: string | null,
  strokeWidth = 1
): FlashDocument {
  const fill: Fill | null = fillColor
    ? { type: "solid", color: hexToColor(fillColor) }
    : null;
  const stroke: SolidStroke | null = strokeColor
    ? {
        type: "solid",
        color: hexToColor(strokeColor),
        width: strokeWidth,
        caps: "none",
        joints: "miter",
        miterLimit: 3,
      }
    : null;

  // createOvalShape takes bounding box corners
  const shape = createOvalShape(cx - rx, cy - ry, cx + rx, cy + ry, fill, stroke);
  const obj: ShapeDisplayObject = {
    id: nextId(),
    type: "shape",
    shape,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };

  return replaceFrameDisplayObjects(doc, sceneIdx, layerIdx, frameIdx, obj);
}
