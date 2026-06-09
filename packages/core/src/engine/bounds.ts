import type { DisplayObject } from './types.js';

export interface Bounds {
  x: number;       // left edge
  y: number;       // top edge
  width: number;
  height: number;
}

/**
 * Compute the axis-aligned bounding box for a display object,
 * accounting for rotation and scale transforms.
 * Returns bounds in parent coordinate space.
 */
export function getTransformedBounds(obj: DisplayObject): Bounds {
  const x = ('x' in obj ? (obj as any).x : 0) ?? 0;
  const y = ('y' in obj ? (obj as any).y : 0) ?? 0;
  const w = ('width' in obj ? (obj as any).width : 0) ?? 0;
  const h = ('height' in obj ? (obj as any).height : 0) ?? 0;
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
