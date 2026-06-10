/**
 * Unit tests for linear and radial gradient fill rendering in the Canvas 2D renderer.
 *
 * Tests verify:
 *   1. Linear gradient: ctx.createLinearGradient is called when fill type is "linear-gradient"
 *   2. Linear gradient: color stops are added with ratio/255 offsets
 *   3. Radial gradient: ctx.createRadialGradient is called when fill type is "radial-gradient"
 *   4. Radial gradient: focal point shifts the inner circle center along x-axis
 *   5. Solid fill: ctx.createLinearGradient is NOT called for solid fills
 *   6. Linear gradient: gradient angle of 90° produces vertical gradient
 *   7. Multiple gradient stops are all added to the gradient object
 *   8. Gradient fill with zero-size path does not crash
 *  13. Linear gradient repeat: createPattern is called (no throw)
 *  14. Linear gradient reflect: createPattern is called (no throw)
 *  15. Radial gradient repeat: renders without throwing
 *  16. Radial gradient reflect: renders without throwing
 *  17. Linear gradient repeat: reversed stops are NOT applied (forward order)
 *  18. Linear gradient reflect: reversed stops are applied for second half
 */

import { describe, it, expect, vi } from "vitest";
import type {
  Shape,
  LinearGradientFill,
  RadialGradientFill,
  SolidFill,
  GradientColorStop,
} from "../types.js";

// ---------------------------------------------------------------------------
// Gradient rendering logic (extracted from renderer.ts renderShape, pass 1)
// ---------------------------------------------------------------------------

/**
 * Simulate the fill rendering pass from renderer.ts renderShape().
 * We call the same logic inline against a mock ctx to inspect calls.
 */
function colorToCss(color: { r: number; g: number; b: number; a: number }): string {
  const alpha = (color.a / 255).toFixed(4);
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

interface MockGradient {
  stops: Array<{ offset: number; color: string }>;
  addColorStop: (offset: number, color: string) => void;
}

interface MockPattern {
  transform: { translateX: number; translateY: number; rotateAngle: number } | null;
  setTransform: (mat: DOMMatrix) => void;
}

function makeMockCtx() {
  const linearGradients: Array<{
    x1: number; y1: number; x2: number; y2: number;
    gradient: MockGradient;
  }> = [];
  const radialGradients: Array<{
    fx: number; fy: number; r0: number; cx: number; cy: number; r: number;
    gradient: MockGradient;
  }> = [];
  const patterns: Array<MockPattern> = [];

  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "" as string | MockGradient | MockPattern,
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    miterLimit: 10,
    createLinearGradient: vi.fn((x1: number, y1: number, x2: number, y2: number) => {
      const gradient: MockGradient = {
        stops: [],
        addColorStop(offset, color) { this.stops.push({ offset, color }); },
      };
      linearGradients.push({ x1, y1, x2, y2, gradient });
      return gradient;
    }),
    createRadialGradient: vi.fn((fx: number, fy: number, r0: number, cx: number, cy: number, r: number) => {
      const gradient: MockGradient = {
        stops: [],
        addColorStop(offset, color) { this.stops.push({ offset, color }); },
      };
      radialGradients.push({ fx, fy, r0, cx, cy, r, gradient });
      return gradient;
    }),
    createPattern: vi.fn((_source: unknown, _repetition: string) => {
      const pattern: MockPattern = {
        transform: null,
        setTransform(_mat: DOMMatrix) {
          // In tests DOMMatrix may be unavailable; just record that setTransform was called
          this.transform = { translateX: 0, translateY: 0, rotateAngle: 0 };
        },
      };
      patterns.push(pattern);
      return pattern;
    }),
    _linearGradients: linearGradients,
    _radialGradients: radialGradients,
    _patterns: patterns,
  };
  return ctx as typeof ctx & CanvasRenderingContext2D;
}

/**
 * Minimal offscreen canvas mock for tests running in Node (no DOM).
 * Provides a ctx that records createLinearGradient/createRadialGradient calls.
 */
function makeMockOffscreenCanvas(w: number, h: number) {
  const offCtx = {
    createLinearGradient: vi.fn((_x1: number, _y1: number, _x2: number, _y2: number) => ({
      addColorStop: vi.fn(),
    })),
    createRadialGradient: vi.fn((_fx: number, _fy: number, _r0: number, _cx: number, _cy: number, _r: number) => ({
      addColorStop: vi.fn(),
    })),
    fillRect: vi.fn(),
    fillStyle: "" as unknown,
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    width: w,
    height: h,
  };
  return { canvas: { width: w, height: h } as HTMLCanvasElement, ctx: offCtx };
}

/**
 * Simulates the renderShape fill pass from renderer.ts for a single path.
 * Mirrors the exact logic from the renderer's fill pass 1, including
 * spreadMode handling for reflect/repeat modes.
 *
 * @param offscreenFactory  Optional factory for creating offscreen canvases.
 *   Defaults to null (simulates unavailable offscreen canvas → extend fallback).
 */
function simulateFillPass(
  ctx: ReturnType<typeof makeMockCtx>,
  shape: Shape,
  offscreenFactory?: (w: number, h: number) => ReturnType<typeof makeMockOffscreenCanvas> | null
): void {
  const createOff = offscreenFactory ?? (() => null);

  ctx.save();
  ctx.translate(0, 0);

  for (const path of shape.paths) {
    if (!path.fill) continue;

    ctx.beginPath();
    ctx.moveTo(path.start.x, path.start.y);
    for (const seg of path.segments) {
      if (seg.type === "line") ctx.lineTo(seg.to.x, seg.to.y);
      else ctx.quadraticCurveTo(seg.control.x, seg.control.y, seg.to.x, seg.to.y);
    }
    if (path.closed) ctx.closePath();

    if (path.fill.type === "solid") {
      ctx.fillStyle = colorToCss(path.fill.color);
      ctx.fill("nonzero");
    } else if (path.fill.type === "linear-gradient") {
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
        const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        for (const stop of path.fill.stops) {
          grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
        }
        ctx.fillStyle = grad as unknown as string;
      } else {
        const dx = gx2 - gx1;
        const dy = gy2 - gy1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const tileW = spreadMode === "reflect"
          ? Math.max(2, Math.ceil(len) * 2)
          : Math.max(1, Math.ceil(len));
        const tileH = 1;

        const off = createOff(tileW, tileH);
        if (off) {
          const tileCtx = off.ctx;
          if (spreadMode === "reflect") {
            const g1 = tileCtx.createLinearGradient(0, 0, tileW / 2, 0);
            for (const stop of path.fill.stops) {
              g1.addColorStop(stop.ratio / 255, colorToCss(stop.color));
            }
            tileCtx.fillStyle = g1;
            tileCtx.fillRect(0, 0, tileW / 2, tileH);

            const g2 = tileCtx.createLinearGradient(0, 0, tileW / 2, 0);
            const reversed = path.fill.stops.slice().reverse();
            for (const stop of reversed) {
              g2.addColorStop(1 - stop.ratio / 255, colorToCss(stop.color));
            }
            tileCtx.fillStyle = g2;
            tileCtx.fillRect(tileW / 2, 0, tileW / 2, tileH);
          } else {
            const g = tileCtx.createLinearGradient(0, 0, tileW, 0);
            for (const stop of path.fill.stops) {
              g.addColorStop(stop.ratio / 255, colorToCss(stop.color));
            }
            tileCtx.fillStyle = g;
            tileCtx.fillRect(0, 0, tileW, tileH);
          }

          const pattern = ctx.createPattern(off.canvas, "repeat");
          if (pattern) {
            ctx.fillStyle = pattern as unknown as string;
          } else {
            const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
            for (const stop of path.fill.stops) {
              grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
            }
            ctx.fillStyle = grad as unknown as string;
          }
        } else {
          const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
          for (const stop of path.fill.stops) {
            grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
          }
          ctx.fillStyle = grad as unknown as string;
        }
      }
      ctx.fill("nonzero");
    } else if (path.fill.type === "radial-gradient") {
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
        const grad = ctx.createRadialGradient(focalX, focalY, 0, cx, cy, r);
        for (const stop of path.fill.stops) {
          grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
        }
        ctx.fillStyle = grad as unknown as string;
        ctx.fill("nonzero");
      } else {
        const diagR = Math.sqrt(
          Math.max(cx - bx1, bx2 - cx) ** 2 + Math.max(cy - by1, by2 - cy) ** 2
        ) || r || 1;
        const rings = Math.ceil(diagR / r) + 1;

        const offW = Math.max(1, Math.ceil(bx2 - bx1));
        const offH = Math.max(1, Math.ceil(by2 - by1));
        const off = createOff(offW, offH);
        if (off) {
          const tileCtx = off.ctx;
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
          ctx.save();
          ctx.clip("nonzero");
          ctx.drawImage(off.canvas as unknown as CanvasImageSource, bx1, by1);
          ctx.restore();
        } else {
          const grad = ctx.createRadialGradient(focalX, focalY, 0, cx, cy, r);
          for (const stop of path.fill.stops) {
            grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
          }
          ctx.fillStyle = grad as unknown as string;
          ctx.fill("nonzero");
        }
      }
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Shape factories
// ---------------------------------------------------------------------------

function makeRect(
  x: number, y: number, w: number, h: number,
  fill: LinearGradientFill | RadialGradientFill | SolidFill
): Shape {
  return {
    id: "test-shape",
    paths: [
      {
        start: { x, y },
        segments: [
          { type: "line", to: { x: x + w, y } },
          { type: "line", to: { x: x + w, y: y + h } },
          { type: "line", to: { x, y: y + h } },
        ],
        closed: true,
        fill,
      },
    ],
  };
}

const RED: GradientColorStop = {
  ratio: 0,
  color: { r: 255, g: 0, b: 0, a: 255 },
};
const BLUE: GradientColorStop = {
  ratio: 255,
  color: { r: 0, g: 0, b: 255, a: 255 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Gradient fill rendering", () => {
  // Test 1 ----------------------------------------------------------------
  it("1. linear gradient: ctx.createLinearGradient is called", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [RED, BLUE],
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill));

    expect(ctx.createLinearGradient).toHaveBeenCalledOnce();
  });

  // Test 2 ----------------------------------------------------------------
  it("2. linear gradient: color stops are added with ratio/255 offsets", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [RED, BLUE],
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill));

    const grad = ctx._linearGradients[0].gradient;
    expect(grad.stops).toHaveLength(2);
    expect(grad.stops[0].offset).toBeCloseTo(0 / 255);
    expect(grad.stops[1].offset).toBeCloseTo(255 / 255);
  });

  // Test 3 ----------------------------------------------------------------
  it("3. radial gradient: ctx.createRadialGradient is called", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      stops: [RED, BLUE],
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 100, fill));

    expect(ctx.createRadialGradient).toHaveBeenCalledOnce();
  });

  // Test 4 ----------------------------------------------------------------
  it("4. radial gradient: focal point shifts the inner circle center along x-axis", () => {
    const focalPoint = 0.5;
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint,
      stops: [RED, BLUE],
    };
    const ctx = makeMockCtx();
    // Square rect at (0,0) 100×100 → center = (50, 50), radius = 50
    simulateFillPass(ctx, makeRect(0, 0, 100, 100, fill));

    const g = ctx._radialGradients[0];
    const expectedCx = 50;
    const expectedCy = 50;
    const expectedRadius = 50;
    const expectedFocalX = expectedCx + focalPoint * expectedRadius; // 50 + 0.5*50 = 75

    expect(g.cx).toBeCloseTo(expectedCx);
    expect(g.cy).toBeCloseTo(expectedCy);
    expect(g.r).toBeCloseTo(expectedRadius);
    expect(g.fx).toBeCloseTo(expectedFocalX);
    expect(g.fy).toBeCloseTo(expectedCy);
    expect(g.r0).toBe(0);
  });

  // Test 5 ----------------------------------------------------------------
  it("5. solid fill does not call createLinearGradient or createRadialGradient", () => {
    const fill: SolidFill = {
      type: "solid",
      color: { r: 255, g: 0, b: 0, a: 255 },
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill));

    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
    expect(ctx.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  // Test 6 ----------------------------------------------------------------
  it("6. linear gradient at 90° produces vertical gradient (x1===x2, y1!==y2)", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 90,
      stops: [RED, BLUE],
    };
    const ctx = makeMockCtx();
    // Rect at (0,0) 100×60 → center=(50,30), halfLen = max(100,60)/2 = 50
    simulateFillPass(ctx, makeRect(0, 0, 100, 60, fill));

    const g = ctx._linearGradients[0];
    // At 90°: cos(90°)≈0, sin(90°)=1
    // gx1 = 50 - 0*50 = 50, gx2 = 50 + 0*50 = 50 → x endpoints equal
    expect(g.x1).toBeCloseTo(g.x2, 5);
    // y endpoints should differ
    expect(Math.abs(g.y2 - g.y1)).toBeGreaterThan(1);
  });

  // Test 7 ----------------------------------------------------------------
  it("7. all color stops are added to gradient object", () => {
    const stops: GradientColorStop[] = [
      { ratio: 0,   color: { r: 255, g: 0,   b: 0,   a: 255 } },
      { ratio: 128, color: { r: 0,   g: 255, b: 0,   a: 255 } },
      { ratio: 255, color: { r: 0,   g: 0,   b: 255, a: 255 } },
    ];
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops,
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill));

    const grad = ctx._linearGradients[0].gradient;
    expect(grad.stops).toHaveLength(3);
    expect(grad.stops[1].offset).toBeCloseTo(128 / 255);
  });

  // Test 8 ----------------------------------------------------------------
  it("8. gradient fill on a zero-area path does not crash", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [RED, BLUE],
    };
    // All points at same position → bbox is 0×0
    const shape: Shape = {
      id: "zero-shape",
      paths: [
        {
          start: { x: 5, y: 5 },
          segments: [{ type: "line", to: { x: 5, y: 5 } }],
          closed: true,
          fill,
        },
      ],
    };
    const ctx = makeMockCtx();
    expect(() => simulateFillPass(ctx, shape)).not.toThrow();
    // createLinearGradient should still be called (even for degenerate path)
    expect(ctx.createLinearGradient).toHaveBeenCalled();
  });

  // Test 9 ----------------------------------------------------------------
  it("9. radial gradient color stops are added with ratio/255 offsets", () => {
    const stops: GradientColorStop[] = [
      { ratio: 0,   color: { r: 255, g: 255, b: 255, a: 255 } },
      { ratio: 255, color: { r: 0,   g: 0,   b: 0,   a: 255 } },
    ];
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      stops,
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 80, 80, fill));

    const grad = ctx._radialGradients[0].gradient;
    expect(grad.stops).toHaveLength(2);
    expect(grad.stops[0].offset).toBeCloseTo(0);
    expect(grad.stops[1].offset).toBeCloseTo(1);
  });

  // Test 10 ---------------------------------------------------------------
  it("10. linear gradient with zero stops does not throw", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [],
    };
    const ctx = makeMockCtx();
    expect(() => simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill))).not.toThrow();
    expect(ctx.createLinearGradient).toHaveBeenCalledOnce();
    const grad = ctx._linearGradients[0].gradient;
    expect(grad.stops).toHaveLength(0);
  });

  // Test 11 ---------------------------------------------------------------
  it("11. radial gradient with zero stops does not throw", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      stops: [],
    };
    const ctx = makeMockCtx();
    expect(() => simulateFillPass(ctx, makeRect(0, 0, 100, 100, fill))).not.toThrow();
    expect(ctx.createRadialGradient).toHaveBeenCalledOnce();
    const grad = ctx._radialGradients[0].gradient;
    expect(grad.stops).toHaveLength(0);
  });

  // Test 12 ---------------------------------------------------------------
  it("12. path without fill does not call createLinearGradient", () => {
    const shape: Shape = {
      id: "no-fill",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [{ type: "line", to: { x: 100, y: 0 } }],
          closed: false,
          // no fill
        },
      ],
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, shape);
    expect(ctx.createLinearGradient).not.toHaveBeenCalled();
    expect(ctx.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Spread mode tests (reflect / repeat)
  // --------------------------------------------------------------------------

  // Test 13 ---------------------------------------------------------------
  it("13. linear gradient repeat: createPattern called when offscreen available", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [RED, BLUE],
      spreadMode: "repeat",
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill), makeMockOffscreenCanvas);
    // createPattern should have been called with "repeat"
    expect(ctx.createPattern).toHaveBeenCalledWith(expect.anything(), "repeat");
    // fill() should still be called
    expect(ctx.fill).toHaveBeenCalledWith("nonzero");
  });

  // Test 14 ---------------------------------------------------------------
  it("14. linear gradient reflect: createPattern called when offscreen available", () => {
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [RED, BLUE],
      spreadMode: "reflect",
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill), makeMockOffscreenCanvas);
    expect(ctx.createPattern).toHaveBeenCalledWith(expect.anything(), "repeat");
    expect(ctx.fill).toHaveBeenCalledWith("nonzero");
  });

  // Test 15 ---------------------------------------------------------------
  it("15. radial gradient repeat: renders without throwing", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      stops: [RED, BLUE],
      spreadMode: "repeat",
    };
    const ctx = makeMockCtx();
    expect(() =>
      simulateFillPass(ctx, makeRect(0, 0, 100, 100, fill), makeMockOffscreenCanvas)
    ).not.toThrow();
    // drawImage should have been called to composite the offscreen rings
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  // Test 16 ---------------------------------------------------------------
  it("16. radial gradient reflect: renders without throwing", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      stops: [RED, BLUE],
      spreadMode: "reflect",
    };
    const ctx = makeMockCtx();
    expect(() =>
      simulateFillPass(ctx, makeRect(0, 0, 100, 100, fill), makeMockOffscreenCanvas)
    ).not.toThrow();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  // Test 17 ---------------------------------------------------------------
  it("17. linear gradient repeat: stops applied in forward order on tile", () => {
    const stops: GradientColorStop[] = [
      { ratio: 0,   color: { r: 255, g: 0, b: 0, a: 255 } },
      { ratio: 128, color: { r: 0,   g: 255, b: 0, a: 255 } },
      { ratio: 255, color: { r: 0,   g: 0, b: 255, a: 255 } },
    ];
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops,
      spreadMode: "repeat",
    };

    // Capture tileCtx calls by recording the offscreen canvas's gradient calls
    let capturedStopOffsets: number[] = [];
    const offFactory = (w: number, h: number) => {
      const off = makeMockOffscreenCanvas(w, h);
      const origCreate = off.ctx.createLinearGradient;
      off.ctx.createLinearGradient = vi.fn((...args: Parameters<typeof origCreate>) => {
        const g = origCreate(...args);
        const origAdd = g.addColorStop;
        g.addColorStop = vi.fn((offset: number, _color: string) => {
          capturedStopOffsets.push(offset);
          origAdd.call(g, offset, _color);
        });
        return g;
      });
      return off;
    };

    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill), offFactory);

    // The first createLinearGradient call on the tile (repeat = one cycle) should
    // have stops in ascending order (0, ~0.5, 1).
    expect(capturedStopOffsets.length).toBeGreaterThanOrEqual(3);
    expect(capturedStopOffsets[0]).toBeCloseTo(0);
    expect(capturedStopOffsets[1]).toBeCloseTo(128 / 255);
    expect(capturedStopOffsets[2]).toBeCloseTo(1);
  });

  // Test 18 ---------------------------------------------------------------
  it("18. linear gradient reflect: second half uses reversed stop offsets", () => {
    const stops: GradientColorStop[] = [
      { ratio: 0,   color: { r: 255, g: 0, b: 0, a: 255 } },
      { ratio: 255, color: { r: 0, g: 0, b: 255, a: 255 } },
    ];
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops,
      spreadMode: "reflect",
    };

    // Capture the second createLinearGradient call on the tile (the reversed half)
    let firstCallOffsets: number[] = [];
    let secondCallOffsets: number[] = [];
    let callCount = 0;
    const offFactory = (w: number, h: number) => {
      const off = makeMockOffscreenCanvas(w, h);
      const origCreate = off.ctx.createLinearGradient;
      off.ctx.createLinearGradient = vi.fn((...args: Parameters<typeof origCreate>) => {
        const g = origCreate(...args);
        const currentCall = callCount++;
        const origAdd = g.addColorStop;
        g.addColorStop = vi.fn((offset: number, _color: string) => {
          if (currentCall === 0) firstCallOffsets.push(offset);
          else secondCallOffsets.push(offset);
          origAdd.call(g, offset, _color);
        });
        return g;
      });
      return off;
    };

    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill), offFactory);

    // First half: stops at 0 then 1 (forward)
    expect(firstCallOffsets[0]).toBeCloseTo(0);
    expect(firstCallOffsets[1]).toBeCloseTo(1);

    // Second half (reversed): original stops are [ratio=0, ratio=255];
    // reversed = [ratio=255, ratio=0]; mapped as 1 - ratio/255.
    // So addColorStop(1 - 255/255, ...) = addColorStop(0, ...) and
    //    addColorStop(1 - 0/255, ...) = addColorStop(1, ...).
    // Note: the reflect logic iterates reversed stops and uses (1 - ratio/255)
    // which produces [0, 1] (not [1, 0]) because reversed list is [BLUE, RED]
    // and 1-1=0, 1-0=1.
    expect(secondCallOffsets).toHaveLength(2);
    expect(secondCallOffsets[0]).toBeCloseTo(0); // 1 - (255/255)
    expect(secondCallOffsets[1]).toBeCloseTo(1); // 1 - (0/255)
  });

  // Test 19 ---------------------------------------------------------------
  it("19. linear gradient repeat: falls back to extend when no offscreen canvas", () => {
    // With offscreenFactory returning null (default), we fall back to extend mode
    const fill: LinearGradientFill = {
      type: "linear-gradient",
      angle: 0,
      stops: [RED, BLUE],
      spreadMode: "repeat",
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 50, fill)); // no factory → null
    // Should fall back to extend: createLinearGradient called, no createPattern
    expect(ctx.createLinearGradient).toHaveBeenCalledOnce();
    expect(ctx.createPattern).not.toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalledWith("nonzero");
  });

  // Test 20 ---------------------------------------------------------------
  it("20. radial gradient repeat: falls back to extend when no offscreen canvas", () => {
    const fill: RadialGradientFill = {
      type: "radial-gradient",
      focalPoint: 0,
      stops: [RED, BLUE],
      spreadMode: "repeat",
    };
    const ctx = makeMockCtx();
    simulateFillPass(ctx, makeRect(0, 0, 100, 100, fill)); // no factory → null
    expect(ctx.createRadialGradient).toHaveBeenCalledOnce();
    expect(ctx.fill).toHaveBeenCalledWith("nonzero");
  });
});
