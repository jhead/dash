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
  ColorEffect,
  DisplayObject,
  SceneGraph,
  SceneLayer,
  Shape,
  ShapePath,
  Stroke,
  StrokeStyle,
  SymbolInstance,
  TextDisplayObject,
  VideoDisplayObject,
  Viewport,
} from "./types.js";
import type {
  FlashFilter,
  BevelFilter,
  GradientGlowFilter,
  GradientBevelFilter,
  AdjustColorFilter,
} from "./filters.js";
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
  ctx.lineWidth = stroke.strokeType === "hairline" ? 1 : stroke.width;

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

      const spreadMode = path.fill.spreadMode ?? "extend";
      if (spreadMode === "extend") {
        // Native Canvas 2D gradient = pad/extend mode
        const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        for (const stop of path.fill.stops) {
          grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
        }
        ctx.fillStyle = grad;
      } else {
        // reflect / repeat: tile a small offscreen canvas as a pattern.
        // The tile runs along the x-axis; we then rotate+translate the pattern
        // to align with the gradient's angle and start position.
        const dx = gx2 - gx1;
        const dy = gy2 - gy1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;

        // For reflect mode we need a 2-cycle tile (forward then reversed) so
        // that adjacent tiles mirror each other. For repeat just one cycle.
        const tileW = spreadMode === "reflect"
          ? Math.max(2, Math.ceil(len) * 2)
          : Math.max(1, Math.ceil(len));
        const tileH = 1;

        const off = createOffscreenCanvas(tileW, tileH);
        if (off) {
          const tileCtx = off.ctx;

          if (spreadMode === "reflect") {
            // First half: forward gradient
            const g1 = tileCtx.createLinearGradient(0, 0, tileW / 2, 0);
            for (const stop of path.fill.stops) {
              g1.addColorStop(stop.ratio / 255, colorToCss(stop.color));
            }
            tileCtx.fillStyle = g1;
            tileCtx.fillRect(0, 0, tileW / 2, tileH);

            // Second half: reversed gradient (mirror)
            const g2 = tileCtx.createLinearGradient(0, 0, tileW / 2, 0);
            const reversed = path.fill.stops.slice().reverse();
            for (const stop of reversed) {
              g2.addColorStop(1 - stop.ratio / 255, colorToCss(stop.color));
            }
            tileCtx.fillStyle = g2;
            tileCtx.fillRect(tileW / 2, 0, tileW / 2, tileH);
          } else {
            // repeat: single cycle
            const g = tileCtx.createLinearGradient(0, 0, tileW, 0);
            for (const stop of path.fill.stops) {
              g.addColorStop(stop.ratio / 255, colorToCss(stop.color));
            }
            tileCtx.fillStyle = g;
            tileCtx.fillRect(0, 0, tileW, tileH);
          }

          const pattern = ctx.createPattern(off.canvas as CanvasImageSource, "repeat");
          if (pattern) {
            // Rotate and translate to align the tile with the gradient direction.
            // DOMMatrix may not be available in all environments (e.g. older Node /
            // test harnesses); fall back to the unrotated pattern in that case.
            try {
              const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
              const mat = new DOMMatrix()
                .translateSelf(gx1, gy1)
                .rotateSelf(angleDeg);
              pattern.setTransform(mat);
            } catch (_) {
              // DOMMatrix unavailable — pattern renders without rotation transform
            }
            ctx.fillStyle = pattern;
          } else {
            // Fallback: extend mode
            const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
            for (const stop of path.fill.stops) {
              grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
            }
            ctx.fillStyle = grad;
          }
        } else {
          // No offscreen canvas available — fall back to extend mode
          const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
          for (const stop of path.fill.stops) {
            grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
          }
          ctx.fillStyle = grad;
        }
      }
      // Note: interpolation "linearRGB" requires CSS Color Level 4
      // `colorInterpolation` or `interpolateColorSpace` API, which is not yet
      // widely supported. Currently renders in sRGB for both modes.
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

      const radialSpreadMode = path.fill.spreadMode ?? "extend";
      if (radialSpreadMode === "extend") {
        // Native Canvas 2D radialGradient = pad/extend mode
        const grad = ctx.createRadialGradient(focalX, focalY, 0, cx, cy, r);
        for (const stop of path.fill.stops) {
          grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
        }
        ctx.fillStyle = grad;
        // Note: interpolation "linearRGB" requires CSS interpolateColorSpace.
        ctx.fill("nonzero");
      } else {
        // reflect / repeat for radial gradients:
        // Approximate using multiple concentric radial gradient rings drawn on an
        // offscreen canvas, clipped to the path, then composited with drawImage.
        // We render N rings out to the bounding-box diagonal from the centre.
        const diagR = Math.sqrt(
          Math.max(cx - bx1, bx2 - cx) ** 2 + Math.max(cy - by1, by2 - cy) ** 2
        ) || r || 1;
        const rings = Math.ceil(diagR / r) + 1; // gradient cycles needed

        const offW = Math.max(1, Math.ceil(bx2 - bx1));
        const offH = Math.max(1, Math.ceil(by2 - by1));
        const off = createOffscreenCanvas(offW, offH);
        if (off) {
          const tileCtx = off.ctx;
          // Draw from outermost ring inward so inner rings paint over outer ones.
          for (let ring = rings; ring >= 0; ring--) {
            const outerR = (ring + 1) * r;
            const innerR = ring * r;
            const isReversed = radialSpreadMode === "reflect" && ring % 2 === 1;

            const rg = tileCtx.createRadialGradient(
              cx - bx1 + path.fill.focalPoint * r, cy - by1, innerR,
              cx - bx1, cy - by1, outerR
            );
            if (isReversed) {
              const rev = path.fill.stops.slice().reverse();
              for (const stop of rev) {
                rg.addColorStop(1 - stop.ratio / 255, colorToCss(stop.color));
              }
            } else {
              for (const stop of path.fill.stops) {
                rg.addColorStop(stop.ratio / 255, colorToCss(stop.color));
              }
            }
            tileCtx.fillStyle = rg;
            tileCtx.beginPath();
            tileCtx.arc(cx - bx1, cy - by1, outerR, 0, Math.PI * 2);
            tileCtx.fill();
          }
          // Clip to the shape path and draw the offscreen buffer.
          ctx.save();
          ctx.clip("nonzero");
          ctx.drawImage(off.canvas as CanvasImageSource, bx1, by1);
          ctx.restore();
        } else {
          // Fallback: extend mode when no offscreen canvas available
          const grad = ctx.createRadialGradient(focalX, focalY, 0, cx, cy, r);
          for (const stop of path.fill.stops) {
            grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
          }
          ctx.fillStyle = grad;
          ctx.fill("nonzero");
        }
      }
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
 * Applies blendMode, colorEffect (alpha/brightness), and filters when set.
 */
function renderBitmapObject(
  ctx: CanvasRenderingContext2D,
  obj: BitmapDisplayObject,
  img: HTMLImageElement
): void {
  const filters = obj.filters ?? [];
  const drawBitmap = () => {
    ctx.save();
    // Apply blend mode
    if (obj.blendMode && obj.blendMode !== 'normal') {
      ctx.globalCompositeOperation = BLEND_MAP[obj.blendMode] ?? 'source-over';
    }
    // Apply alpha (respecting visible=false)
    const effectiveAlpha = obj.visible === false ? 0 : (obj.alpha ?? 1);
    ctx.globalAlpha = effectiveAlpha;
    // Apply colorEffect (alpha/brightness only; tint/advanced are not supported for bitmaps in authoring view)
    const colorEffect = obj.colorEffect;
    if (colorEffect && colorEffect.type !== 'none') {
      applyColorEffectPre(ctx, colorEffect);
    }
    if (obj.rotation) {
      const cx = obj.x + obj.width / 2;
      const cy = obj.y + obj.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((obj.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(img, obj.x, obj.y, obj.width, obj.height);
    ctx.restore();
  };
  if (filters.length > 0) {
    applyFilters(ctx, filters, drawBitmap);
  } else {
    drawBitmap();
  }
}

// ---------------------------------------------------------------------------
// Video placeholder rendering
// ---------------------------------------------------------------------------

/**
 * Renders a VideoDisplayObject placeholder: a dark rectangle with a "VIDEO"
 * label, the library item name, and the placement dimensions. Embedded video
 * cannot be decoded in the authoring canvas, so we draw a stand-in box.
 */
function renderVideoObject(
  ctx: CanvasRenderingContext2D,
  obj: VideoDisplayObject,
  itemName?: string
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

  // Dark placeholder rectangle with a light border.
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(obj.x, obj.y, obj.width, obj.height);
  ctx.strokeStyle = "#666666";
  ctx.lineWidth = 1;
  ctx.strokeRect(obj.x + 0.5, obj.y + 0.5, obj.width - 1, obj.height - 1);

  const cx = obj.x + obj.width / 2;
  const cy = obj.y + obj.height / 2;
  ctx.fillStyle = "#cccccc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // "VIDEO" label centred in the box.
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("VIDEO", cx, cy - 8);

  // Library item name (if known) and the placement dimensions below it.
  ctx.font = "10px sans-serif";
  if (itemName) {
    ctx.fillText(itemName, cx, cy + 8);
  }
  ctx.fillStyle = "#999999";
  ctx.fillText(
    `${Math.round(obj.width)} × ${Math.round(obj.height)}`,
    cx,
    cy + 22
  );

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/**
 * Builds a CSS filter string for an AdjustColorFilter.
 *
 * Maps the -100..+100 (and -180..+180 for hue) Flash ranges to CSS filter
 * equivalents.  Values at their zero-point produce no-op CSS tokens so they
 * never break an otherwise-non-trivial filter string.
 */
function adjustColorToCSSFilter(f: AdjustColorFilter): string {
  const parts: string[] = [];
  // brightness: -100 → 0, 0 → 1, +100 → 2
  if (f.brightness !== 0) {
    const b = 1 + f.brightness / 100;
    parts.push(`brightness(${b.toFixed(4)})`);
  }
  // contrast: -100 → 0, 0 → 1, +100 → 2
  if (f.contrast !== 0) {
    const c = 1 + f.contrast / 100;
    parts.push(`contrast(${c.toFixed(4)})`);
  }
  // saturation: -100 → 0 (greyscale), 0 → 1, +100 → 2
  if (f.saturation !== 0) {
    const s = 1 + f.saturation / 100;
    parts.push(`saturate(${s.toFixed(4)})`);
  }
  // hue: degrees, -180..+180
  if (f.hue !== 0) {
    parts.push(`hue-rotate(${f.hue}deg)`);
  }
  return parts.join(" ");
}

/**
 * Picks the most visually prominent (highest-alpha) stop from a gradient array
 * and returns its color as a CSS rgba() string.  Falls back to opaque red if
 * the gradient is empty.
 */
function gradientPrimaryColor(
  gradient: ReadonlyArray<{ color: string; alpha: number; ratio: number }>
): string {
  if (gradient.length === 0) return "rgba(255,0,0,1)";
  // Pick the stop with the highest alpha value.
  const best = gradient.reduce((a, b) => (b.alpha > a.alpha ? b : a));
  // best.color is a CSS hex string like "#rrggbb"; append alpha.
  const hex = best.color.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${best.alpha.toFixed(4)})`;
}

/**
 * Draws a single bevel pass: sets shadow state and calls drawFn, then clears
 * the shadow so subsequent draws are not affected.
 */
function drawBevelPass(
  ctx: CanvasRenderingContext2D,
  color: string,
  blurPx: number,
  offsetX: number,
  offsetY: number,
  drawFn: () => void
): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blurPx;
  ctx.shadowOffsetX = offsetX;
  ctx.shadowOffsetY = offsetY;
  drawFn();
  ctx.restore();
}

/**
 * Applies enabled Flash filters to the canvas context, executes the draw
 * function, then resets filter state.
 *
 * Canvas 2D only supports a subset of Flash filters natively; this is an
 * approximate preview implementation:
 *  - BlurFilter           → ctx.filter = blur()
 *  - DropShadowFilter     → ctx.shadow* properties
 *  - GlowFilter           → ctx.shadow* properties with zero offset
 *  - BevelFilter          → two shadow passes (highlight + shadow side)
 *  - GradientGlowFilter   → glow approximation using the brightest gradient stop
 *  - GradientBevelFilter  → bevel approximation using first/last gradient stops
 *  - AdjustColorFilter    → CSS filter: brightness/contrast/saturate/hue-rotate
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

  // Separate bevel/gradientBevel filters (require multi-pass draws) from the
  // rest (single-pass state mutations).
  const bevelFilters: Array<BevelFilter | GradientBevelFilter> = [];
  const singlePassFilters: FlashFilter[] = [];

  for (const filter of active) {
    if (filter.type === "bevel" || filter.type === "gradientBevel") {
      bevelFilters.push(filter);
    } else {
      singlePassFilters.push(filter);
    }
  }

  // ---------- single-pass filters ----------
  // Collect all CSS filter parts so they can be composed into one string.
  const cssFilterParts: string[] = [];

  ctx.save();

  for (const filter of singlePassFilters) {
    if (filter.type === "blur") {
      const blurPx = (filter.blurX + filter.blurY) / 2;
      cssFilterParts.push(`blur(${blurPx}px)`);
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
    } else if (filter.type === "gradientGlow") {
      // Approximate: use the highest-alpha gradient stop as the glow color.
      const f = filter as GradientGlowFilter;
      ctx.shadowColor = gradientPrimaryColor(f.gradient);
      ctx.shadowBlur = (f.blurX + f.blurY) / 2;
      const dx = Math.cos((f.angle * Math.PI) / 180) * f.distance;
      const dy = Math.sin((f.angle * Math.PI) / 180) * f.distance;
      ctx.shadowOffsetX = dx;
      ctx.shadowOffsetY = dy;
    } else if (filter.type === "adjustColor") {
      const cssFilter = adjustColorToCSSFilter(filter as AdjustColorFilter);
      if (cssFilter) cssFilterParts.push(cssFilter);
    }
    // gradientBevel is handled in the bevel pass below.
  }

  if (cssFilterParts.length > 0) {
    ctx.filter = cssFilterParts.join(" ");
  }

  // Draw the bevel shadow passes BEFORE the main draw so they appear behind the
  // object.  Each bevel filter contributes a highlight pass (opposite side) and
  // a shadow pass (on the light side).
  for (const filter of bevelFilters) {
    const blurPx = (filter.blurX + filter.blurY) / 2;
    const angleRad = (filter.angle * Math.PI) / 180;
    const dx = Math.cos(angleRad) * filter.distance;
    const dy = Math.sin(angleRad) * filter.distance;

    let highlightColor: string;
    let shadowColor: string;

    if (filter.type === "bevel") {
      const f = filter as BevelFilter;
      highlightColor = colorToCSSWithAlpha(f.highlightColor, f.highlightAlpha);
      shadowColor = colorToCSSWithAlpha(f.shadowColor, f.shadowAlpha);
    } else {
      // gradientBevel: first stop = shadow side, last stop = highlight side
      // (conventional gradient bevel layout).
      const f = filter as GradientBevelFilter;
      const g = f.gradient;
      if (g.length === 0) continue;
      // Use last stop as highlight, first stop as shadow.
      const hlStop = g[g.length - 1];
      const shStop = g[0];
      const hlHex = hlStop.color.replace("#", "");
      const shHex = shStop.color.replace("#", "");
      highlightColor = `rgba(${parseInt(hlHex.substring(0, 2), 16)},${parseInt(hlHex.substring(2, 4), 16)},${parseInt(hlHex.substring(4, 6), 16)},${hlStop.alpha.toFixed(4)})`;
      shadowColor = `rgba(${parseInt(shHex.substring(0, 2), 16)},${parseInt(shHex.substring(2, 4), 16)},${parseInt(shHex.substring(4, 6), 16)},${shStop.alpha.toFixed(4)})`;
    }

    // Highlight: offset at the opposite (light-source) side.
    drawBevelPass(ctx, highlightColor, blurPx, -dx, -dy, drawFn);
    // Shadow: offset at the shadow side.
    drawBevelPass(ctx, shadowColor, blurPx, dx, dy, drawFn);
  }

  // Main draw (the actual object, on top of bevel shadows).
  drawFn();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Blend mode
// ---------------------------------------------------------------------------

/**
 * Maps Flash 8 blend mode names to Canvas 2D globalCompositeOperation values.
 * Used when rendering SymbolInstance objects with a blendMode property.
 *
 * NOTE: 'subtract' and 'invert' have no Canvas 2D native equivalent.
 * They are listed here for completeness (BLEND_MAP lookup) but are handled
 * via pixel-level compositing in renderSymbolInstance; the 'source-over'
 * values here are never actually used for those two modes.
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
  'subtract':   'source-over',   // handled by pixel compositing
  'invert':     'source-over',   // handled by pixel compositing
  'alpha':      'source-atop',
  'erase':      'destination-out',
  'overlay':    'overlay',
  'hardlight':  'hard-light',
};

/**
 * Set of Flash 8 blend modes that require pixel-level compositing because
 * Canvas 2D has no native equivalent.
 */
export const PIXEL_BLEND_MODES = new Set(['subtract', 'invert']);

/**
 * Applies Flash 8 "subtract" blend:
 *   dst.rgb = clamp(dst.rgb - src.rgb * src.a, 0, 255)
 *
 * @param dst  Destination (main canvas) pixel data — mutated in place.
 * @param src  Source (offscreen render) pixel data — read only.
 * @param i    Byte offset of the current pixel (must be a multiple of 4).
 */
export function applySubtractBlend(
  dst: Uint8ClampedArray,
  src: Uint8ClampedArray,
  i: number
): void {
  const a = src[i + 3] / 255;
  dst[i]     = Math.max(0, dst[i]     - src[i]     * a);
  dst[i + 1] = Math.max(0, dst[i + 1] - src[i + 1] * a);
  dst[i + 2] = Math.max(0, dst[i + 2] - src[i + 2] * a);
  // alpha channel is left unchanged
}

/**
 * Applies Flash 8 "invert" blend:
 *   dst.rgb = (255 - dst.rgb) * src.a/255 + dst.rgb * (1 - src.a/255)
 *
 * @param dst  Destination (main canvas) pixel data — mutated in place.
 * @param src  Source (offscreen render) pixel data — read only.
 * @param i    Byte offset of the current pixel (must be a multiple of 4).
 */
export function applyInvertBlend(
  dst: Uint8ClampedArray,
  src: Uint8ClampedArray,
  i: number
): void {
  const a = src[i + 3] / 255;
  dst[i]     = Math.round((255 - dst[i])     * a + dst[i]     * (1 - a));
  dst[i + 1] = Math.round((255 - dst[i + 1]) * a + dst[i + 1] * (1 - a));
  dst[i + 2] = Math.round((255 - dst[i + 2]) * a + dst[i + 2] * (1 - a));
  // alpha channel is left unchanged
}

/**
 * Renders content to an offscreen canvas, then composites the result onto
 * `ctx` using a pixel-level blend function.
 *
 * This is used for Flash 8 blend modes that Canvas 2D does not support
 * natively (currently: subtract and invert).
 *
 * @param ctx          Main canvas rendering context.
 * @param bounds       Bounding rectangle of the region to composite (canvas coords).
 * @param blendFn      Pixel blend function: (dst, src, byteOffset) => void.
 * @param renderContent Function that draws the object onto the supplied offscreen context.
 */
function renderWithPixelBlend(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  blendFn: (dst: Uint8ClampedArray, src: Uint8ClampedArray, i: number) => void,
  renderContent: (offscreen: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void
): void {
  const { x, y, w, h } = bounds;
  const iw = Math.max(1, Math.ceil(w));
  const ih = Math.max(1, Math.ceil(h));

  // Render the object to an offscreen canvas (transparent background)
  const off = createOffscreenCanvas(iw, ih);
  if (!off) {
    // No offscreen canvas available — cannot do pixel compositing, skip silently.
    return;
  }
  const octx = off.ctx;
  // Translate so that the object's canvas-space origin maps to (0,0) in offscreen space.
  octx.translate(-x, -y);
  renderContent(octx);

  // Read pixels from both canvases.
  let dstData: ImageData;
  let srcData: ImageData;
  try {
    dstData = ctx.getImageData(x, y, iw, ih);
    srcData = (octx as CanvasRenderingContext2D).getImageData(0, 0, iw, ih);
  } catch (_) {
    // getImageData throws in cross-origin or tainted-canvas contexts — skip.
    return;
  }

  // Apply blend function pixel by pixel.
  for (let i = 0; i < dstData.data.length; i += 4) {
    blendFn(dstData.data, srcData.data, i);
  }

  ctx.putImageData(dstData, x, y);
}

// ---------------------------------------------------------------------------
// Symbol instance rendering
// ---------------------------------------------------------------------------

/**
 * Creates a small offscreen canvas for intermediate rendering.
 * Falls back to document.createElement('canvas') in environments where
 * OffscreenCanvas is not available (e.g. jsdom in tests).
 */
function createOffscreenCanvas(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const offCtx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      if (offCtx) return { canvas, ctx: offCtx };
    }
  } catch (_) {
    // OffscreenCanvas not supported — fall through
  }
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const offCtx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
      if (offCtx) return { canvas, ctx: offCtx };
    }
  } catch (_) {
    // No DOM available
  }
  return null;
}

/**
 * Renders the content layers of a symbol onto the given context at 1:1 scale
 * (no instance transform applied — callers position via translate before calling).
 */
function renderSymbolLayers(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  symbol: import('../model/types.js').Symbol,
  frame: number,
  imageCache: Map<string, HTMLImageElement>,
  library: Library,
  visitedSymbolIds: Set<string>
): void {
  const layers = [...symbol.timeline.layers].reverse(); // bottom-to-top
  for (const layer of layers) {
    if (!layer.visible) continue;
    const kf = getGoverningKeyframe(layer, frame);
    if (!kf) continue;
    for (const childObj of kf.displayObjects) {
      renderDisplayObject(ctx as CanvasRenderingContext2D, childObj, imageCache, library, visitedSymbolIds);
    }
  }
}

/**
 * Performs full 9-slice (scale9Grid) rendering of a SymbolInstance.
 *
 * Algorithm:
 *   1. Estimate the symbol's natural size from the grid definition.
 *   2. Render the symbol at 1:1 scale onto an offscreen canvas.
 *   3. Divide both the source (natural) and destination (scaled) into 9 sectors
 *      using the 4 grid lines: left=x, right=x+w, top=y, bottom=y+h.
 *   4. Blit each sector with ctx.drawImage(offscreen, sx,sy,sw,sh, dx,dy,dw,dh):
 *      - Corners: rendered at natural size (no scaling).
 *      - Horizontal edges (top/bottom center): stretched horizontally only.
 *      - Vertical edges (left/right center): stretched vertically only.
 *      - Center: stretched in both axes.
 *
 * The instance position transform (translate + rotation) is applied before
 * calling this function via ctx.save()/translate/rotate. The scale is NOT
 * applied via ctx.scale() — instead the 9-slice drawImage calls provide the
 * scaling for each sector individually.
 */
function renderSymbolWith9Slice(
  ctx: CanvasRenderingContext2D,
  symbol: import('../model/types.js').Symbol,
  obj: SymbolInstance,
  imageCache: Map<string, HTMLImageElement>,
  library: Library,
  visitedSymbolIds: Set<string>
): void {
  const grid = symbol.scale9Grid!; // caller ensures this is non-null
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;

  // Estimate natural symbol size from the grid.
  // The grid's right/bottom edges (grid.x + grid.width, grid.y + grid.height) must
  // lie within the symbol bounds. We assume the right border equals the left border
  // and the bottom border equals the top border (symmetric design — the common case).
  // Minimum natural size is the grid itself plus a 1-pixel border so sectors are valid.
  const rightBorder = Math.max(1, grid.x);
  const bottomBorder = Math.max(1, grid.y);
  const naturalW = grid.x + grid.width + rightBorder;
  const naturalH = grid.y + grid.height + bottomBorder;

  // Destination (scaled) dimensions
  const destW = naturalW * scaleX;
  const destH = naturalH * scaleY;

  // Grid column/row boundaries in source space
  const srcLeft = grid.x;
  const srcRight = grid.x + grid.width;
  const srcTop = grid.y;
  const srcBottom = grid.y + grid.height;

  // Widths and heights of the 3 columns / 3 rows in source space
  const srcColW = [srcLeft, grid.width, naturalW - srcRight] as const;
  const srcRowH = [srcTop, grid.height, naturalH - srcBottom] as const;

  // Widths and heights of the 3 columns / 3 rows in destination space
  // Corners keep natural size; edges and center are scaled to fill remaining space
  const dstMidW = destW - srcColW[0] - srcColW[2];
  const dstMidH = destH - srcRowH[0] - srcRowH[2];
  const dstColW = [srcColW[0], Math.max(0, dstMidW), srcColW[2]] as const;
  const dstRowH = [srcRowH[0], Math.max(0, dstMidH), srcRowH[2]] as const;

  // Render the symbol at natural size onto an offscreen canvas
  const off = createOffscreenCanvas(naturalW, naturalH);
  if (!off) {
    // Fallback: render normally (no 9-slice)
    renderSymbolLayers(ctx, symbol, obj.firstFrame ?? 0, imageCache, library, visitedSymbolIds);
    return;
  }

  const offCtx = off.ctx;
  renderSymbolLayers(offCtx, symbol, obj.firstFrame ?? 0, imageCache, library, visitedSymbolIds);

  // Source X offsets for each column
  const srcX = [0, srcLeft, srcRight] as const;
  // Source Y offsets for each row
  const srcY = [0, srcTop, srcBottom] as const;

  // Destination X offsets for each column
  const dstX = [0, dstColW[0], dstColW[0] + dstColW[1]] as const;
  // Destination Y offsets for each row
  const dstY = [0, dstRowH[0], dstRowH[0] + dstRowH[1]] as const;

  // Draw 9 slices
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const sw = srcColW[col];
      const sh = srcRowH[row];
      const dw = dstColW[col];
      const dh = dstRowH[row];
      // Skip zero-size sectors
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
      ctx.drawImage(
        off.canvas as CanvasImageSource,
        srcX[col], srcY[row], sw, sh,
        dstX[col], dstY[row], dw, dh
      );
    }
  }
}

/**
 * Renders a SymbolInstance by looking up the symbol in the library and
 * recursively rendering its timeline layers at the appropriate frame.
 * Guards against infinite recursion by tracking visited symbol IDs.
 *
 * When the symbol has a scale9Grid defined and the instance is scaled,
 * renders using 9-slice drawImage to preserve corner proportions.
 */
/**
 * Modifies ctx state before drawing to implement alpha and brightness color effects.
 * Tint and advanced effects are handled by renderSymbolWithColorEffect instead.
 */
function applyColorEffectPre(
  ctx: CanvasRenderingContext2D,
  effect: ColorEffect
): void {
  if (effect.type === 'alpha') {
    const a = (effect.alpha ?? 100) / 100;
    ctx.globalAlpha = ctx.globalAlpha * Math.max(0, Math.min(1, a));
  } else if (effect.type === 'brightness') {
    const b = effect.brightness ?? 0;
    // Flash -100..100 maps to CSS brightness 0..2 (1 = no change)
    const cssB = 1 + b / 100;
    ctx.filter = (ctx.filter && ctx.filter !== 'none')
      ? `${ctx.filter} brightness(${cssB})`
      : `brightness(${cssB})`;
  }
  // tint and advanced handled separately via renderSymbolWithColorEffect
}

/**
 * Applies tint color effect compositing after symbol content has been drawn.
 * Overlays a solid fill of the tint color at the given alpha (amount) using
 * source-atop compositing so only pixels already drawn are tinted.
 */
function applyTintOverlay(
  ctx: CanvasRenderingContext2D,
  tintColor: string,
  amount: number,
  naturalW: number,
  naturalH: number
): void {
  const savedGlobalAlpha = ctx.globalAlpha;
  const savedComposite = ctx.globalCompositeOperation;

  // source-atop: paint tint only over existing pixels
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = savedGlobalAlpha * amount;
  ctx.fillStyle = tintColor;
  // The ctx already has translate(obj.x, obj.y) applied; fill around that origin.
  const halfW = naturalW / 2;
  const halfH = naturalH / 2;
  ctx.fillRect(-halfW, -halfH, halfW * 2, halfH * 2);

  ctx.globalAlpha = savedGlobalAlpha;
  ctx.globalCompositeOperation = savedComposite;
}

function renderSymbolWithColorEffect(
  ctx: CanvasRenderingContext2D,
  obj: SymbolInstance,
  effect: ColorEffect,
  renderContent: () => void
): void {
  if (effect.type === 'tint') {
    const tintColor = effect.tintColor ?? '#000000';
    const amount = (effect.tintAmount ?? 100) / 100;
    const naturalW = obj.naturalWidth ?? 200;
    const naturalH = obj.naturalHeight ?? 200;

    renderContent();
    applyTintOverlay(ctx, tintColor, amount, naturalW, naturalH);
    return;
  }

  if (effect.type === 'advanced') {
    // Apply a brightness approximation from the channel multipliers, then render normally.
    // A pixel-accurate CXForm would require reading back canvas pixels (expensive);
    // this provides a visible authoring preview approximation.
    const rMult = (effect.redMult ?? 100) / 100;
    const gMult = (effect.greenMult ?? 100) / 100;
    const bMult = (effect.blueMult ?? 100) / 100;
    const avgMult = (rMult + gMult + bMult) / 3;
    ctx.filter = (ctx.filter && ctx.filter !== 'none')
      ? `${ctx.filter} brightness(${avgMult})`
      : `brightness(${avgMult})`;
    renderContent();
    return;
  }

  // Fallback (shouldn't be reached for the types this function is called with)
  renderContent();
}

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
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;

  // --- Pixel-blend modes (subtract / invert) ---
  // Canvas 2D has no native equivalent for these; use per-pixel compositing.
  if (obj.blendMode && PIXEL_BLEND_MODES.has(obj.blendMode)) {
    const blendFn = obj.blendMode === 'subtract' ? applySubtractBlend : applyInvertBlend;

    // Determine the bounding rectangle in canvas space.
    // We use naturalWidth/naturalHeight scaled by scaleX/scaleY; fall back to
    // the full canvas extent when those properties are absent (correctness over perf).
    const naturalW = (obj.naturalWidth ?? 0) * (obj.scaleX ?? 1);
    const naturalH = (obj.naturalHeight ?? 0) * (obj.scaleY ?? 1);
    const bounds = (naturalW > 0 && naturalH > 0)
      ? { x: obj.x, y: obj.y, w: naturalW, h: naturalH }
      : {
          x: 0, y: 0,
          w: (ctx.canvas && ctx.canvas.width) ? ctx.canvas.width : 550,
          h: (ctx.canvas && ctx.canvas.height) ? ctx.canvas.height : 400,
        };

    const nextVisited = new Set(visitedSymbolIds);
    nextVisited.add(obj.symbolId);

    renderWithPixelBlend(ctx, bounds, blendFn, (octx) => {
      // The offscreen ctx already has translate(-bounds.x, -bounds.y) applied
      // by renderWithPixelBlend; we add the object's own translate on top.
      octx.translate(obj.x, obj.y);
      if (obj.rotation) {
        octx.rotate((obj.rotation * Math.PI) / 180);
      }
      if (scaleX !== 1 || scaleY !== 1) {
        octx.scale(scaleX, scaleY);
      }
      renderSymbolLayers(
        octx as CanvasRenderingContext2D,
        symbol, frame, imageCache, library, nextVisited
      );
    });
    return; // pixel blend path is complete; skip the normal ctx.save/restore path
  }

  // --- Normal blend mode path ---
  ctx.save();

  // Apply blend mode if set (and not the default 'normal')
  if (obj.blendMode && obj.blendMode !== 'normal') {
    ctx.globalCompositeOperation = BLEND_MAP[obj.blendMode] ?? 'source-over';
  }

  // Apply position and rotation (not scale — 9-slice handles scaling itself)
  ctx.translate(obj.x, obj.y);
  if (obj.rotation) {
    ctx.rotate((obj.rotation * Math.PI) / 180);
  }
  if (obj.alpha !== undefined && obj.alpha < 1) {
    ctx.globalAlpha = ctx.globalAlpha * obj.alpha;
  }

  // Apply color effect (alpha and brightness modify ctx state; tint/advanced use compositing)
  const colorEffect = obj.colorEffect;
  if (colorEffect && colorEffect.type !== 'none') {
    applyColorEffectPre(ctx, colorEffect);
  }

  const nextVisited = new Set(visitedSymbolIds);
  nextVisited.add(obj.symbolId);

  const renderContent = () => {
    // 9-slice rendering when scale9Grid is set and the instance is actually scaled
    if (symbol.scale9Grid != null && (scaleX !== 1 || scaleY !== 1)) {
      renderSymbolWith9Slice(ctx, symbol, obj, imageCache, library, nextVisited);
    } else {
      // Normal rendering path: apply scale uniformly and recurse into layers
      if (scaleX !== 1 || scaleY !== 1) {
        ctx.scale(scaleX, scaleY);
      }
      renderSymbolLayers(ctx, symbol, frame, imageCache, library, nextVisited);
    }
  };

  if (colorEffect && (colorEffect.type === 'tint' || colorEffect.type === 'advanced')) {
    renderSymbolWithColorEffect(ctx, obj, colorEffect, renderContent);
  } else {
    renderContent();
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

    case "video": {
      const item = library?.items.find(
        (it) => it.id === obj.videoItemId && it.itemType === "video"
      );
      renderVideoObject(ctx, obj, item?.name);
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
    case "video":
    case "instance": {
      ctx.save();
      ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.4;
      // No image cache or library needed here — we intentionally do not pass
      // them so instances render at reduced opacity without full recursion.
      ctx.restore();
      break;
    }

    // Groups: translate to the group origin and recursively outline each child.
    case "group": {
      ctx.save();
      ctx.translate(obj.x, obj.y);
      for (const child of obj.children) {
        renderDisplayObjectOutline(ctx, child, color);
      }
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
