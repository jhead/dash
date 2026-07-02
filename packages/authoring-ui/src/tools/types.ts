import type { Fill } from "@flash/core";

export type ToolId =
  | "selection"
  | "subselect"
  | "free-transform"
  | "gradientTransform"
  | "line"
  | "lasso"
  | "pen"
  | "text"
  | "oval"
  | "rect"
  | "polystar"
  | "pencil"
  | "brush"
  | "fill"
  | "ink-bottle"
  | "eyedropper"
  | "eraser"
  | "hand"
  | "zoom";

export type FreeTransformMode = "rotate-scale" | "distort" | "envelope";
export type PolyStarShapeType = "polygon" | "star";

/** Brush nib shape (Flash 8 offers round + square, plus rotated variants). */
export type BrushShape = "round" | "square";
/** Eraser nib shape (Flash 8 eraser Options: 5 round + 5 square). */
export type EraserShape = "round" | "square";
/**
 * Flash 8 brush paint modes: Paint Normal / Paint Fills / Paint Behind /
 * Paint Selection / Paint Inside.
 */
export type BrushPaintMode = "normal" | "fills" | "behind" | "selection" | "inside";
/** Paint Bucket gap-closing tolerance. */
export type PaintBucketGapSize = "none" | "small" | "medium" | "large";
/** Pen tool sub-tools (Flash 8): Pen, Add Anchor, Delete Anchor, Convert Anchor. */
export type PenSubTool = "pen" | "add-anchor" | "delete-anchor" | "convert-anchor";

export interface PolyStarOptions {
  shapeType: PolyStarShapeType;
  sides: number;      // 3–32, default 5
  pointSize: number;  // 0.0–1.0, default 0.5
}

export interface ToolState {
  activeTool: ToolId;
  /** J toggle — shapes go into Object Drawing mode */
  objectDrawing: boolean;
  /** Hex string, e.g. "#000000" */
  strokeColor: string;
  /** null = No Color (hollow/transparent) */
  fill: Fill | null;
  /** Kept for backward compat: hex string derived from fill when solid */
  fillColor: string | null;
  /** Default 1 */
  strokeWidth: number;
  /** Stroke alpha 0–100 */
  strokeAlpha: number;
  /** Pencil tool mode: 'straighten' | 'smooth' | 'ink'. Default 'ink' */
  pencilMode?: "straighten" | "smooth" | "ink";
  /** Brush tool size in pixels. Default 8 */
  brushSize?: number;
  /** Brush nib shape. Default 'round' */
  brushShape?: BrushShape;
  /**
   * Brush paint mode (Flash 8): Normal / Fills / Behind / Selection / Inside.
   * Default 'normal'.
   */
  brushMode?: BrushPaintMode;
  /**
   * Lock Fill — a gradient/bitmap brush fill continues across strokes rather
   * than restarting per stroke. Default false.
   */
  brushLockFill?: boolean;
  /** Pressure sensitivity (tablet) modulates brush size. Default false. */
  brushPressure?: boolean;
  /** Tilt sensitivity (tablet) modulates brush angle. Default false. */
  brushTilt?: boolean;
  /** Eraser tool size in pixels. Default 16 */
  eraserSize?: number;
  /** Eraser nib shape — round / square (Flash 8 eraser Options). Default 'round' */
  eraserShape?: EraserShape;
  /**
   * Flash 8 eraser mode (planar path, flag ON): Normal / Erase Fills /
   * Erase Lines / Erase Selected / Erase Inside. Default 'normal'.
   */
  eraserMode?: "normal" | "fills" | "lines" | "selected" | "inside";
  /** Faucet mode: a single click deletes a whole fill or line. Default false. */
  eraserFaucet?: boolean;
  /** Paint Bucket gap size (close small outline gaps). Default 'none' */
  bucketGapSize?: PaintBucketGapSize;
  /**
   * Paint Bucket Lock Fill — continue a gradient/bitmap fill across multiple
   * shapes rather than restarting per fill. Default false.
   */
  bucketLockFill?: boolean;
  /**
   * Rectangle corner radius in pixels (0 = square corners). Applied when
   * drawing with the Rectangle tool. Default 0.
   */
  rectCornerRadius?: number;
  /** Pen tool active sub-tool. Default 'pen' */
  penSubTool?: PenSubTool;
  /** Free Transform sub-mode. Default 'rotate-scale' */
  freeTransformMode?: FreeTransformMode;
  /** Lasso polygon mode toggle. Default false (freehand) */
  lassoPolygonMode?: boolean;
  /** Lasso magic wand sub-mode. Default false */
  lassoMagicWand?: boolean;
  /** Magic wand color threshold 1–200. Default 20 */
  magicWandThreshold?: number;
  /** Magic wand smoothing mode. Default 'pixels' */
  magicWandSmoothing?: "pixels" | "rough" | "normal" | "smooth";
  /** PolyStar tool options */
  polyStarOptions?: PolyStarOptions;
}

/** Tools that support the Object Drawing toggle */
export const OBJECT_DRAWING_TOOLS: ReadonlySet<ToolId> = new Set([
  "pencil",
  "brush",
  "line",
  "oval",
  "rect",
  "polystar",
  "pen",
]);
