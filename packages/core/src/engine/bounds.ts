import type { DisplayObject, Rect, SymbolInstance, ShapeDisplayObject, DrawingObject } from './types.js';
import { transformedShapeBounds } from './shapes.js';

export interface Bounds {
  x: number;       // left edge
  y: number;       // top edge
  width: number;
  height: number;
}

/** Return the effective width of a display object, using naturalWidth for SymbolInstance. */
function effectiveWidth(obj: DisplayObject): number {
  if (obj.type === 'instance') {
    const inst = obj as SymbolInstance;
    return (inst.naturalWidth ?? 0) * (inst.scaleX ?? 1);
  }
  return ('width' in obj ? (obj as any).width : 0) ?? 0;
}

/** Return the effective height of a display object, using naturalHeight for SymbolInstance. */
function effectiveHeight(obj: DisplayObject): number {
  if (obj.type === 'instance') {
    const inst = obj as SymbolInstance;
    return (inst.naturalHeight ?? 0) * (inst.scaleY ?? 1);
  }
  return ('height' in obj ? (obj as any).height : 0) ?? 0;
}

/**
 * Compute the axis-aligned bounding box for a display object,
 * accounting for rotation and scale transforms.
 * Returns bounds in parent coordinate space.
 */
export function getTransformedBounds(obj: DisplayObject): Bounds {
  // Raw vector shapes / drawing objects carry no width/height — their geometry
  // lives in shape.paths. Delegate to the geometry-aware shape bounds, which
  // also accounts for the object's own scale/rotation transform. Guard on the
  // presence of `shape`: a lightweight/placeholder shape object (e.g. a remote
  // presence selection target) may lack geometry, in which case we fall back to
  // its x/y/width/height rather than dereferencing an undefined shape.
  if ((obj.type === 'shape' || obj.type === 'drawing-object') && (obj as any).shape) {
    return transformedShapeBounds(obj as ShapeDisplayObject | DrawingObject);
  }

  const x = ('x' in obj ? (obj as any).x : 0) ?? 0;
  const y = ('y' in obj ? (obj as any).y : 0) ?? 0;
  const w = effectiveWidth(obj);
  const h = effectiveHeight(obj);
  const rotation = ('rotation' in obj ? (obj as any).rotation : 0) ?? 0;
  const scaleX = ('scaleX' in obj ? (obj as any).scaleX : 1) ?? 1;
  const scaleY = ('scaleY' in obj ? (obj as any).scaleY : 1) ?? 1;

  const scaledW = w * scaleX;
  const scaledH = h * scaleY;

  if (rotation === 0) {
    return { x, y, width: scaledW, height: scaledH };
  }

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 4 corners of the scaled, unrotated rectangle relative to (0,0)
  const corners = [
    { x: 0, y: 0 },
    { x: scaledW, y: 0 },
    { x: scaledW, y: scaledH },
    { x: 0, y: scaledH },
  ];

  // Rotate each corner and translate by (x, y)
  const rotated = corners.map(c => ({
    x: x + c.x * cos - c.y * sin,
    y: y + c.x * sin + c.y * cos,
  }));

  const xs = rotated.map(c => c.x);
  const ys = rotated.map(c => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Compute the union bounding box of multiple display objects.
 */
export function getUnionBounds(objects: DisplayObject[]): Bounds | null {
  if (objects.length === 0) return null;
  const boundsList = objects.map(getTransformedBounds);
  const minX = Math.min(...boundsList.map(b => b.x));
  const minY = Math.min(...boundsList.map(b => b.y));
  const maxX = Math.max(...boundsList.map(b => b.x + b.width));
  const maxY = Math.max(...boundsList.map(b => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Simple axis-aligned bounding box helpers (no rotation/scale)
// ---------------------------------------------------------------------------

/**
 * Return the simple axis-aligned bounding box {x,y,w,h} of a display object.
 *
 * For raw shapes / drawing objects (which carry no width/height — their
 * geometry lives in shape.paths) this delegates to the geometry-aware
 * transformedShapeBounds so callers see real extents instead of a zero-size
 * box anchored at the origin. All other object types use their raw
 * x/y/width/height.
 */
function simpleBox(obj: DisplayObject): { x: number; y: number; w: number; h: number } {
  if ((obj.type === 'shape' || obj.type === 'drawing-object') && (obj as any).shape) {
    const b = transformedShapeBounds(obj as ShapeDisplayObject | DrawingObject);
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  return { x: (obj as any).x ?? 0, y: (obj as any).y ?? 0, w: effectiveWidth(obj), h: effectiveHeight(obj) };
}

/**
 * Return the axis-aligned bounding box of a display object. For shapes and
 * drawing objects this reflects the actual path geometry; for other object
 * types it uses their raw x/y/width/height (no rotation or scale adjustment).
 */
export function getBoundingBox(obj: DisplayObject): Rect {
  const { x, y, w, h } = simpleBox(obj);
  return { x, y, width: w, height: h };
}

/**
 * Return the union bounding box of a selection of display objects, or null
 * when the selection is empty.
 */
export function getSelectionBounds(objects: readonly DisplayObject[]): Rect | null {
  if (objects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objects) {
    const { x, y, w, h } = simpleBox(obj);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Return true when the axis-aligned bounding boxes of a and b overlap
 * (exclusive — touching edges do not count as overlap).
 */
export function objectsOverlap(a: DisplayObject, b: DisplayObject): boolean {
  const ba = simpleBox(a);
  const bb = simpleBox(b);
  return ba.x < bb.x + bb.w && ba.x + ba.w > bb.x && ba.y < bb.y + bb.h && ba.y + ba.h > bb.y;
}

/**
 * Return true when the point (px, py) lies inside or on the boundary of
 * the display object's axis-aligned bounding box.
 */
export function objectContainsPoint(obj: DisplayObject, px: number, py: number): boolean {
  const { x, y, w, h } = simpleBox(obj);
  return px >= x && px <= x + w && py >= y && py <= y + h;
}
