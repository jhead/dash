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
  /** Eraser tool size in pixels. Default 16 */
  eraserSize?: number;
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
