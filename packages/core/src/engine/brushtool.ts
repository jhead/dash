/**
 * Brush tool stroke builder.
 *
 * Converts a sequence of BrushPoints into a closed filled ShapeDisplayObject
 * that outlines the brush stroke at the given width.
 * Pure data — no canvas, no React.
 */

import type { FlashDocument, Frame, Layer, Scene } from "../model/types.js";
import type { DisplayObject, ShapeDisplayObject, ShapePath } from "./types.js";
import { hexToColor } from "./shapes.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BrushPoint {
  x: number;
  y: number;
  /** Pressure 0..1, default 1.0 */
  pressure?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let _brushIdCounter = 0;
function nextId(): string {
  return "brush-" + ++_brushIdCounter + "-" + Date.now().toString(36);
}

/**
 * Return the normalized perpendicular normal to the segment (p0 → p1).
 * The normal points to the "left" side of the direction of travel.
 */
function segmentNormal(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [0, 1];
  // Normal perpendicular (rotated 90° left): (-dy, dx)
  return [-dy / len, dx / len];
}

/**
 * Build a closed outline polygon for the brush stroke.
 *
 * Strategy:
 *   Forward pass: left side of each segment at (point + normal * halfW)
 *   Backward pass: right side of each segment at (point - normal * halfW)
 *
 * Returns an array of [x, y] pairs forming the closed polygon.
 */
function buildOutline(
  points: BrushPoint[],
  width: number
): Array<[number, number]> {
  const n = points.length;
  const halfW = width / 2;

  // Compute a normal for each point (average of adjacent segment normals)
  const normals: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    if (i === 0) {
      const q = points[1]!;
      normals.push(segmentNormal(p.x, p.y, q.x, q.y));
    } else if (i === n - 1) {
      const prev = points[n - 2]!;
      normals.push(segmentNormal(prev.x, prev.y, p.x, p.y));
    } else {
      const prev = points[i - 1]!;
      const next = points[i + 1]!;
      const [nx0, ny0] = segmentNormal(prev.x, prev.y, p.x, p.y);
      const [nx1, ny1] = segmentNormal(p.x, p.y, next.x, next.y);
      // Average and re-normalize
      let nx = (nx0 + nx1) / 2;
      let ny = (ny0 + ny1) / 2;
      const len = Math.sqrt(nx * nx + ny * ny);
      if (len > 0) { nx /= len; ny /= len; }
      normals.push([nx, ny]);
    }
  }

  // Left side: forward
  const left: Array<[number, number]> = points.map((p, i) => {
    const [nx, ny] = normals[i]!;
    const scale = halfW * (p.pressure ?? 1);
    return [p.x + nx * scale, p.y + ny * scale];
  });

  // Right side: reverse
  const right: Array<[number, number]> = (points.map((p, i) => {
    const [nx, ny] = normals[i]!;
    const scale = halfW * (p.pressure ?? 1);
    return [p.x - nx * scale, p.y - ny * scale] as [number, number];
  }) as Array<[number, number]>).reverse();

  return [...left, ...right];
}

/**
 * Convert an outline polygon (array of [x,y] pairs) into a ShapePath.
 */
function polygonToShapePath(
  outline: Array<[number, number]>,
  color: string
): ShapePath {
  const fill = { type: "solid" as const, color: hexToColor(color) };
  const [startX, startY] = outline[0]!;
  const segments: ShapePath["segments"][number][] = outline
    .slice(1)
    .map(([tx, ty]) => ({ type: "line" as const, to: { x: tx, y: ty } }));

  return {
    start: { x: startX, y: startY },
    segments,
    fill,
    closed: true,
  };
}

/**
 * Return a new document with the given display object appended to the
 * governing keyframe at (sceneIdx, layerIdx, frameIdx).
 */
function appendDisplayObject(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  obj: DisplayObject
): FlashDocument {
  const scene = doc.scenes[sceneIdx];
  if (!scene) return doc;

  const layer = scene.timeline.layers[layerIdx];
  if (!layer) return doc;

  // Find governing keyframe (latest keyframe at or before frameIdx)
  let keyframe: Frame | null = null;
  for (const frame of layer.frames) {
    if (frame.index <= frameIdx && frame.isKeyframe) {
      keyframe = frame;
    }
  }
  if (!keyframe) return doc;

  const newFrame: Frame = {
    ...keyframe,
    displayObjects: [...keyframe.displayObjects, obj],
  };

  const newFrames: readonly Frame[] = layer.frames.map((f) =>
    f === keyframe ? newFrame : f
  );

  const newLayer: Layer = { ...layer, frames: newFrames };

  const newLayers: readonly Layer[] = scene.timeline.layers.map((l, i) =>
    i === layerIdx ? newLayer : l
  );

  const newScene: Scene = {
    ...scene,
    timeline: { ...scene.timeline, layers: newLayers },
  };

  const newScenes: readonly Scene[] = doc.scenes.map((s, i) =>
    i === sceneIdx ? newScene : s
  );

  return { ...doc, scenes: newScenes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a brush stroke as a filled ShapeDisplayObject.
 *
 * The stroke is represented as a closed filled path outlining the brush width.
 * Requires at least 2 points; returns doc unchanged for fewer.
 *
 * @param doc       - Source document (never mutated).
 * @param sceneIdx  - 0-based scene index.
 * @param layerIdx  - 0-based layer index within the scene.
 * @param frameIdx  - Target frame index; uses governing keyframe.
 * @param points    - Ordered array of brush points.
 * @param color     - CSS hex fill color (e.g. "#000000").
 * @param width     - Brush width in pixels.
 * @returns New FlashDocument with the stroke added, or original doc if insufficient points.
 */
export function addBrushStroke(
  doc: FlashDocument,
  sceneIdx: number,
  layerIdx: number,
  frameIdx: number,
  points: BrushPoint[],
  color: string,
  width: number
): FlashDocument {
  if (points.length < 2) return doc;

  const outline = buildOutline(points, width);
  const shapePath = polygonToShapePath(outline, color);

  const shapeId = nextId();
  const obj: ShapeDisplayObject = {
    type: "shape",
    id: shapeId,
    shape: { id: shapeId + "-s", paths: [shapePath] },
    x: 0,
    y: 0,
  };

  return appendDisplayObject(doc, sceneIdx, layerIdx, frameIdx, obj);
}
