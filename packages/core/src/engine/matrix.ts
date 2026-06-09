import type { Point, Rect } from "./types.js";

/**
 * 2D affine transform matrix:
 * [ a  c  tx ]
 * [ b  d  ty ]
 * [ 0  0   1 ]
 *
 * Maps (x,y) → (a*x + c*y + tx, b*x + d*y + ty)
 * Matches Flash's MATRIX SWF struct and Canvas 2D setTransform(a,b,c,d,e,f).
 */
export interface Matrix2D {
  readonly a: number;   // x scale component
  readonly b: number;   // y shear component
  readonly c: number;   // x shear component
  readonly d: number;   // y scale component
  readonly tx: number;  // x translation
  readonly ty: number;  // y translation
}

export interface MatrixDecomposition {
  readonly tx: number;
  readonly ty: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;  // degrees
  readonly skewX: number;     // degrees
  readonly skewY: number;     // degrees
}

// ---- Constructors ----

/** Identity matrix: no transform. */
export function identity(): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

/** Translation matrix. */
export function translation(tx: number, ty: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

/** Uniform or non-uniform scale (around origin). */
export function scaling(sx: number, sy: number): Matrix2D {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
}

/** Rotation matrix (angle in degrees, CCW positive). */
export function rotation(degrees: number): Matrix2D {
  const rad = degrees * Math.PI / 180;
  return {
    a: Math.cos(rad),
    b: Math.sin(rad),
    c: -Math.sin(rad),
    d: Math.cos(rad),
    tx: 0,
    ty: 0,
  };
}

/** Skew matrix (angles in degrees). */
export function skewing(skewX: number, skewY: number): Matrix2D {
  const radX = skewX * Math.PI / 180;
  const radY = skewY * Math.PI / 180;
  return {
    a: 1,
    b: Math.tan(radY),
    c: Math.tan(radX),
    d: 1,
    tx: 0,
    ty: 0,
  };
}

// ---- Operations ----

/** Matrix multiplication: applies A then B (B * A in column-major form). */
export function multiply(a: Matrix2D, b: Matrix2D): Matrix2D {
  return {
    a:  a.a * b.a + a.c * b.b,
    b:  a.b * b.a + a.d * b.b,
    c:  a.a * b.c + a.c * b.d,
    d:  a.b * b.c + a.d * b.d,
    tx: a.a * b.tx + a.c * b.ty + a.tx,
    ty: a.b * b.tx + a.d * b.ty + a.ty,
  };
}

/** Matrix inverse. Returns identity if matrix is singular. */
export function inverse(m: Matrix2D): Matrix2D {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-10) return identity();
  const invDet = 1 / det;
  return {
    a:   m.d * invDet,
    b:  -m.b * invDet,
    c:  -m.c * invDet,
    d:   m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

/**
 * Concatenate transforms: first translate, then rotate, then scale (TRS order).
 * Optionally includes skew applied between rotation and scale.
 */
export function compose(params: {
  tx?: number;
  ty?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;  // degrees
  skewX?: number;     // degrees
  skewY?: number;     // degrees
}): Matrix2D {
  const {
    tx: ptx = 0,
    ty: pty = 0,
    scaleX = 1,
    scaleY = 1,
    rotation: rot = 0,
    skewX = 0,
    skewY = 0,
  } = params;

  const T = translation(ptx, pty);
  const R = rotation(rot);
  const Sk = skewing(skewX, skewY);
  const S = scaling(scaleX, scaleY);

  // TRS order: T * R * Sk * S
  return multiply(multiply(multiply(T, R), Sk), S);
}

// ---- Application ----

/** Transform a point. */
export function applyToPoint(m: Matrix2D, p: Point): Point {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

/** Transform all four corners of a rect, return bounding rect of result. */
export function applyToRect(m: Matrix2D, r: Rect): Rect {
  const corners: Point[] = [
    { x: r.x,            y: r.y },
    { x: r.x + r.width,  y: r.y },
    { x: r.x,            y: r.y + r.height },
    { x: r.x + r.width,  y: r.y + r.height },
  ];

  const transformed = corners.map((p) => applyToPoint(m, p));

  const xs = transformed.map((p) => p.x);
  const ys = transformed.map((p) => p.y);

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

// ---- Decomposition ----

/**
 * Decompose a matrix into translation, scale, rotation, and skew.
 * Note: decomposition is not unique for all matrices; this uses the
 * standard QR-like decomposition.
 */
export function decompose(m: Matrix2D): MatrixDecomposition {
  const scaleX = Math.sqrt(m.a * m.a + m.b * m.b);
  const scaleY = Math.sqrt(m.c * m.c + m.d * m.d);
  const rot = Math.atan2(m.b, m.a) * 180 / Math.PI;
  const skewY = Math.atan2(m.b, m.a) * 180 / Math.PI;
  const skewX = Math.atan2(-m.c, m.d) * 180 / Math.PI - skewY;

  return {
    tx: m.tx,
    ty: m.ty,
    scaleX,
    scaleY,
    rotation: rot,
    skewX,
    skewY,
  };
}

// ---- Convenience aliases for symbol instance transform creation ----

/**
 * Alias for identity(): returns the identity matrix.
 */
export function makeIdentityMatrix(): Matrix2D {
  return identity();
}

/**
 * Create an affine transform matrix for a symbol instance placement.
 * Matches Flash's display-object MATRIX:
 *   a = cos(r) * scaleX    c = -sin(r) * scaleY
 *   b = sin(r) * scaleX    d =  cos(r) * scaleY
 */
export function createInstanceMatrix(
  x: number, y: number,
  scaleX: number, scaleY: number,
  rotationDeg: number
): Matrix2D {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    a: cos * scaleX,
    b: sin * scaleX,
    c: -sin * scaleY,
    d: cos * scaleY,
    tx: x,
    ty: y,
  };
}

/**
 * Decompose a matrix into { x, y, scaleX, scaleY, rotation }.
 * Simpler signature than the full `decompose()` for common symbol use.
 */
export function decomposeMatrix(m: Matrix2D): {
  x: number; y: number;
  scaleX: number; scaleY: number;
  rotation: number;
} {
  const scaleX = Math.sqrt(m.a * m.a + m.b * m.b);
  const scaleY = Math.sqrt(m.c * m.c + m.d * m.d);
  const rotation = Math.atan2(m.b, m.a) * 180 / Math.PI;
  return { x: m.tx, y: m.ty, scaleX, scaleY, rotation };
}

/**
 * Alias for multiply(): multiply two matrices.
 */
export function multiplyMatrix(a: Matrix2D, b: Matrix2D): Matrix2D {
  return multiply(a, b);
}

// ---- SWF MATRIX encoding helpers ----

/**
 * Convert Matrix2D to SWF MATRIX fixed-point values.
 * SWF MATRIX stores: HasScale (a,d as Fixed 16.16), HasRotate (b,c as Fixed 16.16),
 * TranslateX/Y (in twips = px * 20).
 * Returns components ready to pass to the BitWriter.
 */
export function toSWFMatrix(m: Matrix2D): {
  hasScale: boolean;
  scaleX: number;       // 16.16 fixed point integer (multiply by 65536)
  scaleY: number;
  hasRotate: boolean;
  rotateSkew0: number;  // b component * 65536
  rotateSkew1: number;  // c component * 65536
  translateX: number;   // tx * 20 (twips), integer
  translateY: number;
} {
  const hasScale = m.a !== 1 || m.d !== 1;
  const hasRotate = m.b !== 0 || m.c !== 0;
  return {
    hasScale,
    scaleX: Math.round(m.a * 65536),
    scaleY: Math.round(m.d * 65536),
    hasRotate,
    rotateSkew0: Math.round(m.b * 65536),
    rotateSkew1: Math.round(m.c * 65536),
    translateX: Math.round(m.tx * 20),
    translateY: Math.round(m.ty * 20),
  };
}
