/**
 * Canvas 2D renderer for the Flash 8 vector engine (MVP).
 *
 * Renders a SceneGraph onto an HTMLCanvasElement using the Canvas 2D API.
 * WebGPU / WebGL acceleration is a stretch goal deferred beyond the MVP.
 *
 * Rendering order:
 *   - Layers are rendered bottom-to-top (index 0 first).
 *   - Within each layer, display objects are rendered in array order.
 *   - For each shape: first all fills, then all strokes (Flash convention).
 *
 * Flash uses quadratic Bézier curves; mapped directly to
 * `CanvasRenderingContext2D.quadraticCurveTo`.
 */

import type {
  BitmapDisplayObject,
  Color,
  DisplayObject,
  SceneGraph,
  SceneLayer,
  Shape,
  ShapePath,
  Stroke,
  StrokeStyle,
  SymbolInstance,
  TextDisplayObject,
  Viewport,
} from "./types.js";
import type { FlashFilter } from "./filters.js";
import type { Library } from "../model/types.js";
import { getGoverningKeyframe } from "../model/timeline-query.js";

// ---------------------------------------------------------------------------
// Color conversion
// ---------------------------------------------------------------------------

/** Converts a Color (0–255 channels) to a CSS rgba() string. */
function colorToCss(color: Color): string {
  const alpha = (color.a / 255).toFixed(4);
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

/**
 * Converts a Color + an explicit alpha override (0–1) to a CSS rgba() string.
 * Used for filter shadow/glow colors where alpha is stored separately.
 */
function colorToCSSWithAlpha(color: Color, alpha: number): string {
  return `rgba(${color.r},${color.g},${color.b},${alpha.toFixed(4)})`;
}

// ---------------------------------------------------------------------------
// Stroke style helpers
// ---------------------------------------------------------------------------

/**
 * Applies the Flash 8 stroke dash pattern (style) to the canvas context.
 * Call before ctx.stroke(), then reset with ctx.setLineDash([]) after.
 */
function applyStrokeDashStyle(
  ctx: CanvasRenderingContext2D,
  style: StrokeStyle | undefined,
  strokeWidth: number
): void {
  if (!style || style.type === "solid") {
    ctx.setLineDash([]);
    return;
  }

  switch (style.type) {
    case "dashed":
      ctx.setLineDash([style.dashLength, style.gapLength]);
      break;

    case "dotted":
      ctx.setLineDash([strokeWidth, style.dotSpacing]);
      ctx.lineCap = "round";
      break;

    case "ragged": {
      // Approximate ragged with an irregular dash pattern based on roughness
      const patterns: Record<typeof style.roughness, number[]> = {
        coarse: [8, 3, 2, 3, 5, 3],
        normal: [6, 2, 2, 2, 4, 2],
        fine: [4, 1, 1, 1, 3, 1],
      };
      ctx.setLineDash(patterns[style.roughness]);
      break;
    }

    case "stippled": {
      const spacing: Record<typeof style.dotSize, number> = {
        tiny: 2,
        small: 4,
        medium: 6,
        large: 8,
      };
      const densityGap: Record<typeof style.density, number> = {
        veryDense: spacing[style.dotSize],
        dense: spacing[style.dotSize] * 2,
        sparse: spacing[style.dotSize] * 3,
        verySparse: spacing[style.dotSize] * 5,
      };
      ctx.setLineDash([1, densityGap[style.density]]);
      ctx.lineCap = "round";
      break;
    }

    case "hatched": {
      const gap: Record<typeof style.space, number> = {
        veryClose: 2,
        close: 4,
        distant: 8,
        veryDistant: 12,
      };
      const thickness: Record<typeof style.hatchThickness, number> = {
        thin: strokeWidth,
        medium: strokeWidth * 1.5,
        thick: strokeWidth * 2,
        varied: strokeWidth * 1.75,
      };
      ctx.setLineDash([thickness[style.hatchThickness] * 2, gap[style.space]]);
      break;
    }
  }
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.strokeStyle = colorToCss(stroke.color);
  ctx.lineWidth = stroke.width;

  // Line caps
  switch (stroke.caps) {
    case "none":
      ctx.lineCap = "butt";
      break;
    case "round":
      ctx.lineCap = "round";
      break;
    case "square":
      ctx.lineCap = "square";
      break;
  }

  // Line joins
  switch (stroke.joints) {
    case "miter":
      ctx.lineJoin = "miter";
      ctx.miterLimit = stroke.miterLimit;
      break;
    case "round":
      ctx.lineJoin = "round";
      break;
    case "bevel":
      ctx.lineJoin = "bevel";
      break;
  }
}

// ---------------------------------------------------------------------------
// Path building
// ---------------------------------------------------------------------------

/** Writes a ShapePath's geometry into the current canvas path (no fill/stroke). */
function buildCanvasPath(ctx: CanvasRenderingContext2D, path: ShapePath): void {
  ctx.moveTo(path.start.x, path.start.y);

  for (const seg of path.segments) {
    if (seg.type === "line") {
      ctx.lineTo(seg.to.x, seg.to.y);
    } else {
      // Quadratic Bézier: Flash's native curve type
      ctx.quadraticCurveTo(seg.control.x, seg.control.y, seg.to.x, seg.to.y);
    }
  }

  if (path.closed) {
    ctx.closePath();
  }
}

/**
 * Traces the paths of a DisplayObject into the current canvas path for use as
 * a clipping region.  Does NOT call fill() or stroke() — only builds the path.
 * Used to construct the clip path for a mask layer.
 */
function traceShapePath(
  ctx: CanvasRenderingContext2D,
  obj: DisplayObject
): void {
  if (obj.type === "shape" || obj.type === "drawing-object") {
    ctx.save();
    const scaleX = obj.type === "shape" ? (obj.scaleX ?? 1) : 1;
    const scaleY = obj.type === "shape" ? (obj.scaleY ?? 1) : 1;
    const rotation = obj.type === "shape" ? (obj.rotation ?? 0) : 0;
    if (scaleX !== 1 || scaleY !== 1 || rotation !== 0) {
      ctx.translate(obj.x, obj.y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scaleX, scaleY);
      for (const path of obj.shape.paths) {
        buildCanvasPath(ctx, path);
      }
    } else {
      ctx.translate(obj.x, obj.y);
      for (const path of obj.shape.paths) {
        buildCanvasPath(ctx, path);
      }
    }
    ctx.restore();
  } else if (obj.type === "instance") {
    // Use bounding box as clip rect for symbol instances (simplified)
    ctx.rect(obj.x, obj.y, (obj.scaleX ?? 1) * 100, (obj.scaleY ?? 1) * 100);
  }
  // text/bitmap: no clip path contribution
}

// ---------------------------------------------------------------------------
// Shape rendering
// ---------------------------------------------------------------------------

/**
 * Renders a Shape's paths.  Fills are drawn first (all paths), then strokes
 * (all paths), following Flash's compositing convention.
 *
 * @param offsetX    X translation for the shape's display-object position.
 * @param offsetY    Y translation for the shape's display-object position.
 * @param imageCache Optional cache for resolving BitmapFill images by library item id.
 */
function renderShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  offsetX: number,
  offsetY: number,
  imageCache?: Map<string, HTMLImageElement>
): void {
  ctx.save();
  ctx.translate(offsetX, offsetY);

  // --- Pass 1: fills ---
  for (const path of shape.paths) {
    if (!path.fill) continue;

    ctx.beginPath();
    buildCanvasPath(ctx, path);

    if (path.fill.type === "solid") {
      ctx.fillStyle = colorToCss(path.fill.color);
      // Use "nonzero" winding rule so that overlapping same-colour paths
      // rendered in merge-drawing mode unite naturally.
      ctx.fill("nonzero");
    } else if (path.fill.type === "bitmap") {
      // Bitmap fill — look up the image in the cache and use createPattern
      const img = imageCache?.get(path.fill.bitmapId);
      if (img && img.complete && img.naturalWidth > 0) {
        const repeatMode = path.fill.repeat ? "repeat" : "no-repeat";
        const pattern = ctx.createPattern(img, repeatMode);
        if (pattern) {
          if (path.fill.smooth) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
          } else {
            ctx.imageSmoothingEnabled = false;
          }
          ctx.fillStyle = pattern;
          ctx.fill("nonzero");
          ctx.imageSmoothingEnabled = true; // restore default
        }
      } else {
        // Image not loaded yet — fill with a checkerboard placeholder
        ctx.fillStyle = "rgba(128,128,128,0.4)";
        ctx.fill("nonzero");
      }
    } else if (path.fill.type === "linear-gradient") {
      // Compute bounding box for gradient coordinates
      const pts = [path.start, ...path.segments.map((s) => s.to)];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const bx1 = Math.min(...xs), by1 = Math.min(...ys);
      const bx2 = Math.max(...xs), by2 = Math.max(...ys);
      const cx = (bx1 + bx2) / 2;
      const cy = (by1 + by2) / 2;
      const halfLen = Math.max((bx2 - bx1), (by2 - by1)) / 2;
      const rad = (path.fill.angle * Math.PI) / 180;
      const gx1 = cx - Math.cos(rad) * halfLen;
      const gy1 = cy - Math.sin(rad) * halfLen;
      const gx2 = cx + Math.cos(rad) * halfLen;
      const gy2 = cy + Math.sin(rad) * halfLen;
      const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
      for (const stop of path.fill.stops) {
        grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
      }
      ctx.fillStyle = grad;
      ctx.fill("nonzero");
    } else if (path.fill.type === "radial-gradient") {
      // Compute bounding box center + radius
      const pts = [path.start, ...path.segments.map((s) => s.to)];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const bx1 = Math.min(...xs), by1 = Math.min(...ys);
      const bx2 = Math.max(...xs), by2 = Math.max(...ys);
      const cx = (bx1 + bx2) / 2;
      const cy = (by1 + by2) / 2;
      const r = Math.max((bx2 - bx1), (by2 - by1)) / 2;
      const focalX = cx + path.fill.focalPoint * r;
      const focalY = cy;
      const grad = ctx.createRadialGradient(focalX, focalY, 0, cx, cy, r);
      for (const stop of path.fill.stops) {
        grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
      }
      ctx.fillStyle = grad;
      ctx.fill("nonzero");
    }
  }

  // --- Pass 2: strokes ---
  for (const path of shape.paths) {
    if (!path.stroke) continue;

    ctx.beginPath();
    buildCanvasPath(ctx, path);
    applyStrokeStyle(ctx, path.stroke);
    applyStrokeDashStyle(ctx, path.stroke.style, path.stroke.width);
    ctx.stroke();
    // Reset dash pattern so subsequent strokes are unaffected.
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Text rendering helpers
// ---------------------------------------------------------------------------

/**
 * Wraps a single paragraph (no embedded newlines) to fit within maxWidth,
 * appending each wrapped line to the `lines` array.
 */
function wrapParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  lines: string[]
): void {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (line !== "" && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  lines.push(line);
}

/**
 * Renders a TextDisplayObject using the Canvas 2D text API.
 *
 * Alignment X anchor:
 *   left    → obj.x
 *   center  → obj.x + obj.width / 2
 *   right   → obj.x + obj.width
 *
 * Respects obj.wordWrap (wrap on spaces) and obj.multiline (allow multiple lines).
 * Explicit \n characters in obj.text are always split when multiline is true.
 */
function renderTextObject(
  ctx: CanvasRenderingContext2D,
  obj: TextDisplayObject
): void {
  ctx.save();
  const fontStyle = obj.italic ? "italic " : "";
  const fontWeight = obj.bold ? "bold " : "";
  ctx.font = `${fontStyle}${fontWeight}${obj.fontSize}px ${obj.fontFamily}`;
  ctx.fillStyle = colorToCss(obj.color);

  const canvasAlign = obj.align === "justify" ? "left" : obj.align;
  ctx.textAlign = canvasAlign;
  ctx.textBaseline = "top";

  // Compute the X anchor for the chosen alignment.
  let drawX: number;
  switch (obj.align) {
    case "center":
      drawX = obj.x + obj.width / 2;
      break;
    case "right":
      drawX = obj.x + obj.width;
      break;
    default: // left or justify
      drawX = obj.x;
      break;
  }

  const lineHeight = obj.fontSize * 1.2;

  // Build the list of visual lines to render.
  let lines: string[];
  if (!obj.multiline) {
    // Single-line mode: no wrapping, no newline splitting.
    lines = [obj.text];
  } else {
    // Split on explicit newlines first, then word-wrap each paragraph if enabled.
    const paragraphs = obj.text.split("\n");
    lines = [];
    for (const para of paragraphs) {
      if (obj.wordWrap) {
        wrapParagraph(ctx, para, obj.width, lines);
      } else {
        lines.push(para);
      }
    }
  }

  // Render each line.
  let lineY = obj.y;
  for (const line of lines) {
    ctx.fillText(line, drawX, lineY);
    lineY += lineHeight;
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Bitmap rendering
// ---------------------------------------------------------------------------

/**
 * Renders a BitmapDisplayObject using ctx.drawImage.
 * Requires a pre-loaded HTMLImageElement from the image cache.
 */
function renderBitmapObject(
  ctx: CanvasRenderingContext2D,
  obj: BitmapDisplayObject,
  img: HTMLImageElement
): void {
  ctx.save();
  ctx.globalAlpha = obj.alpha ?? 1;
  if (obj.rotation) {
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((obj.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(img, obj.x, obj.y, obj.width, obj.height);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/**
 * Applies enabled Flash filters to the canvas context, executes the draw
 * function, then resets filter state.
 *
 * Canvas 2D only supports a subset of Flash filters natively; this is an
 * approximate MVP implementation:
 *  - BlurFilter      → ctx.filter = blur()
 *  - DropShadowFilter → ctx.shadow* properties
 *  - GlowFilter      → ctx.shadow* properties with zero offset
 *  - BevelFilter     → not yet rendered (skipped silently)
 *
 * Exact Flash fidelity requires off-screen render-to-texture passes (stretch goal).
 */
function applyFilters(
  ctx: CanvasRenderingContext2D,
  filters: readonly FlashFilter[],
  drawFn: () => void
): void {
  const active = filters.filter((f) => f.enabled);
  if (active.length === 0) {
    drawFn();
    return;
  }

  ctx.save();

  for (const filter of active) {
    if (filter.type === "blur") {
      const blurPx = (filter.blurX + filter.blurY) / 2;
      ctx.filter = `blur(${blurPx}px)`;
    } else if (filter.type === "drop-shadow") {
      const dx = Math.cos((filter.angle * Math.PI) / 180) * filter.distance;
      const dy = Math.sin((filter.angle * Math.PI) / 180) * filter.distance;
      ctx.shadowColor = colorToCSSWithAlpha(filter.color, filter.alpha);
      ctx.shadowOffsetX = dx;
      ctx.shadowOffsetY = dy;
      ctx.shadowBlur = (filter.blurX + filter.blurY) / 2;
    } else if (filter.type === "glow") {
      ctx.shadowColor = colorToCSSWithAlpha(filter.color, filter.alpha);
      ctx.shadowBlur = (filter.blurX + filter.blurY) / 2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
    // BevelFilter: not approximated with Canvas 2D primitives; skip silently.
  }

  drawFn();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Blend mode
// ---------------------------------------------------------------------------

/**
 * Maps Flash 8 blend mode names to Canvas 2D globalCompositeOperation values.
 * Used when rendering SymbolInstance objects with a blendMode property.
 */
export const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  'normal':     'source-over',
  'layer':      'source-over',   // approximation
  'multiply':   'multiply',
  'screen':     'screen',
  'lighten':    'lighten',
  'darken':     'darken',
  'difference': 'difference',
  'add':        'lighter',       // closest canvas equivalent
  'subtract':   'source-over',   // no direct equivalent, fallback
  'invert':     'source-over',   // approximation
  'alpha':      'source-atop',
  'erase':      'destination-out',
  'overlay':    'overlay',
  'hardlight':  'hard-light',
};

// ---------------------------------------------------------------------------
// Symbol instance rendering
// ---------------------------------------------------------------------------

/**
 * Renders a SymbolInstance by looking up the symbol in the library and
 * recursively rendering its timeline layers at the appropriate frame.
 * Guards against infinite recursion by tracking visited symbol IDs.
 *
 * When the symbol has a scale9Grid defined, the instance is rendered using
 * standard scaling for now — full 9-slice canvas rendering is deferred.
 * TODO: implement full 9-slice drawImage-based rendering when scale9Grid is set.
 */
function renderSymbolInstance(
  ctx: CanvasRenderingContext2D,
  obj: SymbolInstance,
  imageCache: Map<string, HTMLImageElement>,
  library: Library | undefined,
  visitedSymbolIds: Set<string>
): void {
  if (!library) return;
  if (visitedSymbolIds.has(obj.symbolId)) return; // prevent infinite recursion

  const symbol = library.items.find((item) => item.id === obj.symbolId);
  if (!symbol || symbol.itemType !== "symbol") return;

  const frame = obj.firstFrame ?? 0;

  // Detect 9-slice grid on the symbol definition.
  // Full 9-slice rendering (ctx.drawImage per slice) is a future stretch goal.
  // For now we render normally so the common case (no scale9Grid) is correct
  // and instances with scale9Grid do not crash.
  // TODO: when scale9Grid is set, render via 9-slice drawImage slices instead of
  //       a uniform ctx.scale(), to avoid distorting the corners of the symbol.
  const has9Slice = symbol.scale9Grid != null;
  void has9Slice; // acknowledged — full implementation deferred

  ctx.save();

  // Apply blend mode if set (and not the default 'normal')
  if (obj.blendMode && obj.blendMode !== 'normal') {
    ctx.globalCompositeOperation = BLEND_MAP[obj.blendMode] ?? 'source-over';
  }

  // Apply instance transform
  ctx.translate(obj.x, obj.y);
  if (obj.rotation) {
    ctx.rotate((obj.rotation * Math.PI) / 180);
  }
  if ((obj.scaleX !== undefined && obj.scaleX !== 1) || (obj.scaleY !== undefined && obj.scaleY !== 1)) {
    ctx.scale(obj.scaleX ?? 1, obj.scaleY ?? 1);
  }
  if (obj.alpha !== undefined && obj.alpha < 1) {
    ctx.globalAlpha = ctx.globalAlpha * obj.alpha;
  }

  // Recurse into the symbol's layers (bottom-to-top like the scene renderer)
  const nextVisited = new Set(visitedSymbolIds);
  nextVisited.add(obj.symbolId);

  const layers = [...symbol.timeline.layers].reverse(); // bottom-to-top
  for (const layer of layers) {
    if (!layer.visible) continue;
    const kf = getGoverningKeyframe(layer, frame);
    if (!kf) continue;
    for (const childObj of kf.displayObjects) {
      renderDisplayObject(ctx, childObj, imageCache, library, nextVisited);
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Display object dispatch
// ---------------------------------------------------------------------------

function renderDisplayObject(
  ctx: CanvasRenderingContext2D,
  obj: DisplayObject,
  imageCache: Map<string, HTMLImageElement>,
  library?: Library,
  visitedSymbolIds?: Set<string>
): void {
  switch (obj.type) {
    case "shape": {
      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;
      const rotation = obj.rotation ?? 0;
      const filters = obj.filters ?? [];
      const drawShape = () => {
        if (scaleX !== 1 || scaleY !== 1 || rotation !== 0) {
          ctx.save();
          ctx.translate(obj.x, obj.y);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.scale(scaleX, scaleY);
          renderShape(ctx, obj.shape, 0, 0, imageCache);
          ctx.restore();
        } else {
          renderShape(ctx, obj.shape, obj.x, obj.y, imageCache);
        }
      };
      if (filters.length > 0) {
        applyFilters(ctx, filters, drawShape);
      } else {
        drawShape();
      }
      break;
    }

    case "drawing-object": {
      const filters = obj.filters ?? [];
      const drawShape = () => renderShape(ctx, obj.shape, obj.x, obj.y, imageCache);
      if (filters.length > 0) {
        applyFilters(ctx, filters, drawShape);
      } else {
        drawShape();
      }
      break;
    }

    case "instance":
      renderSymbolInstance(ctx, obj, imageCache, library, visitedSymbolIds ?? new Set());
      break;

    case "text": {
      const filters = obj.filters ?? [];
      const drawText = () => renderTextObject(ctx, obj);
      if (filters.length > 0) {
        applyFilters(ctx, filters, drawText);
      } else {
        drawText();
      }
      break;
    }

    case "bitmap": {
      const img = imageCache.get(obj.libraryItemId);
      if (img && img.complete && img.naturalWidth > 0) {
        renderBitmapObject(ctx, obj, img);
      }
      break;
    }

    case "group": {
      ctx.save();
      ctx.translate(obj.x, obj.y);
      for (const child of obj.children) {
        renderDisplayObject(ctx, child, imageCache, library, visitedSymbolIds);
      }
      ctx.restore();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Outline mode rendering
// ---------------------------------------------------------------------------

/**
 * Renders a shape's paths as outlines only (no fills), using the given color.
 * Used when a layer's outlineMode is true.
 */
function renderShapeOutline(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  offsetX: number,
  offsetY: number,
  color: string
): void {
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  for (const path of shape.paths) {
    // Render closed fill paths as outlined strokes; render stroke paths normally in the outline color
    if (path.fill || path.stroke) {
      ctx.beginPath();
      buildCanvasPath(ctx, path);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Renders a DisplayObject as an outline (no fills). Shapes are stroked in the
 * given outline color. Non-shape objects (text, bitmap, instance) are rendered
 * normally since they don't have meaningful outline-only representations.
 */
function renderDisplayObjectOutline(
  ctx: CanvasRenderingContext2D,
  obj: DisplayObject,
  color: string
): void {
  switch (obj.type) {
    case "shape": {
      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;
      const rotation = obj.rotation ?? 0;
      if (scaleX !== 1 || scaleY !== 1 || rotation !== 0) {
        ctx.save();
        ctx.translate(obj.x, obj.y);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.scale(scaleX, scaleY);
        renderShapeOutline(ctx, obj.shape, 0, 0, color);
        ctx.restore();
      } else {
        renderShapeOutline(ctx, obj.shape, obj.x, obj.y, color);
      }
      break;
    }

    case "drawing-object":
      renderShapeOutline(ctx, obj.shape, obj.x, obj.y, color);
      break;

    // Non-shape objects: render at reduced opacity so the layer is visually
    // distinguishable as being in outline mode while still showing content.
    case "text":
    case "bitmap":
    case "instance":
    case "group": {
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.4;
      // No image cache or library needed here — we intentionally do not pass
      // them so instances render at reduced opacity without full recursion.
      ctx.restore();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// HiDPI canvas initialisation
// ---------------------------------------------------------------------------

/**
 * Initialises a canvas element for HiDPI / Retina rendering.
 *
 * Sets the canvas backing-store dimensions to `logicalWidth * dpr` ×
 * `logicalHeight * dpr`, then calls `ctx.scale(dpr, dpr)` so that all
 * subsequent drawing commands use logical (CSS) pixel coordinates.
 *
 * @param canvas        Object with writable `width` and `height` properties
 *                      (typically an HTMLCanvasElement).
 * @param ctx           Rendering context — only `scale` is required.
 * @param logicalWidth  Desired width in CSS pixels.
 * @param logicalHeight Desired height in CSS pixels.
 * @param dpr           Device pixel ratio (e.g. `window.devicePixelRatio`).
 *                      Pass `1` for standard-density displays.
 */
export function initCanvas(
  canvas: { width: number; height: number },
  ctx: { scale: (x: number, y: number) => void },
  logicalWidth: number,
  logicalHeight: number,
  dpr: number
): void {
  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;
  ctx.scale(dpr, dpr);
}

// ---------------------------------------------------------------------------
// CanvasRenderer
// ---------------------------------------------------------------------------

/**
 * Renders a `SceneGraph` onto an `HTMLCanvasElement` using the Canvas 2D API.
 *
 * @example
 * ```ts
 * const renderer = new CanvasRenderer(canvas);
 * renderer.render(sceneGraph, { x: 0, y: 0, zoom: 1 });
 * ```
 */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageCache = new Map<string, HTMLImageElement>();
  /** Logical (CSS) width in pixels — equals canvas.width / dpr. */
  private logicalWidth = 0;
  /** Logical (CSS) height in pixels — equals canvas.height / dpr. */
  private logicalHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("CanvasRenderer: unable to obtain 2D rendering context.");
    }
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /**
   * Pre-load and cache an image from a data URI for use during rendering.
   * If the image is already cached, this is a no-op.
   *
   * @param libraryItemId  The BitmapItem id from the library.
   * @param dataUri        The data URI (e.g. "data:image/png;base64,...").
   */
  loadImage(libraryItemId: string, dataUri: string): void {
    if (this.imageCache.has(libraryItemId)) return;
    const img = new Image();
    img.src = dataUri;
    this.imageCache.set(libraryItemId, img);
  }

  /**
   * Renders a single layer's display objects.
   * When outlineMode is true, shapes are drawn as outlines in outlineColor only.
   */
  private renderLayer(
    ctx: CanvasRenderingContext2D,
    layer: SceneLayer,
    library?: Library
  ): void {
    if (layer.outlineMode) {
      const color = layer.outlineColor ?? "#0000ff";
      for (const obj of layer.objects) {
        renderDisplayObjectOutline(ctx, obj, color);
      }
    } else {
      for (const obj of layer.objects) {
        renderDisplayObject(ctx, obj, this.imageCache, library);
      }
    }
  }

  /**
   * Renders the full scene graph.
   *
   * Mask layer behavior:
   *   - 'guide' layers are skipped (authoring-only, not rendered).
   *   - 'mask' layers clip the rendering of all immediately following 'masked'
   *     layers using ctx.save() / ctx.clip() / ctx.restore().
   *   - 'masked' layers render normally but within the clip set by the mask.
   *   - 'guided', 'normal', 'folder' layers render without clipping.
   *
   * @param sceneGraph  The scene to render.
   * @param viewport    Pan (x/y) and zoom applied before drawing.
   * @param library     Optional library for resolving symbol instances.
   */
  render(sceneGraph: SceneGraph, viewport: Viewport, library?: Library): void {
    const { ctx } = this;
    // Use logical dimensions for clearRect so it works correctly with DPR scaling.
    const clearW = this.logicalWidth || this.canvas.width;
    const clearH = this.logicalHeight || this.canvas.height;

    // Clear the canvas.
    ctx.clearRect(0, 0, clearW, clearH);

    // Apply viewport transform: zoom then pan.
    ctx.save();
    ctx.scale(viewport.zoom, viewport.zoom);
    ctx.translate(-viewport.x, -viewport.y);

    // Render layers bottom-to-top.
    // Convention: index 0 = topmost layer (Flash UI), last index = bottommost.
    // So we iterate in reverse to draw bottom layers first (painter's algorithm).
    const layers = [...sceneGraph.layers].reverse();

    let i = 0;
    while (i < layers.length) {
      const layer = layers[i];

      // Skip invisible layers regardless of type
      if (!layer.visible) {
        i++;
        continue;
      }

      const layerType = layer.type ?? "normal";

      // Guide layers are authoring-only — never rendered in output
      if (layerType === "guide") {
        i++;
        continue;
      }

      // Mask layer: set up clip path and render all consecutive masked layers
      if (layerType === "mask") {
        // Collect the mask layer and all directly following masked layers
        const maskedLayers: SceneLayer[] = [];
        let j = i + 1;
        while (j < layers.length && (layers[j].type ?? "normal") === "masked") {
          maskedLayers.push(layers[j]);
          j++;
        }

        // Build clip path from mask layer shapes
        ctx.save();
        ctx.beginPath();
        for (const obj of layer.objects) {
          traceShapePath(ctx, obj);
        }
        ctx.clip();

        // Render each masked layer within the clip region
        for (const maskedLayer of maskedLayers) {
          if (!maskedLayer.visible) continue;
          this.renderLayer(ctx, maskedLayer, library);
        }

        ctx.restore(); // removes clip

        i = j; // skip past mask + all masked layers
        continue;
      }

      // Normal / guided / folder layers render without clipping
      this.renderLayer(ctx, layer, library);
      i++;
    }

    ctx.restore();
  }

  /**
   * Resize the backing canvas buffer to match the desired logical (CSS) dimensions,
   * scaling physical pixels by the device pixel ratio for crisp HiDPI rendering.
   *
   * @param width   Logical width in CSS pixels.
   * @param height  Logical height in CSS pixels.
   * @param dpr     Device pixel ratio (defaults to 1).  Pass `window.devicePixelRatio`
   *                from the calling component to enable HiDPI/Retina support.
   */
  resize(width: number, height: number, dpr = 1): void {
    const safeD = Math.max(1, dpr);
    this.logicalWidth = width;
    this.logicalHeight = height;
    this.canvas.width = Math.round(width * safeD);
    this.canvas.height = Math.round(height * safeD);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    // Reset the transform to identity then apply the DPR scale so that
    // repeated calls to resize() do not accumulate the scale factor.
    this.ctx.setTransform(safeD, 0, 0, safeD, 0, 0);
  }
}
