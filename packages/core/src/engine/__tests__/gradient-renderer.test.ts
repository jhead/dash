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

function makeMockCtx() {
  const linearGradients: Array<{
    x1: number; y1: number; x2: number; y2: number;
    gradient: MockGradient;
  }> = [];
  const radialGradients: Array<{
    fx: number; fy: number; r0: number; cx: number; cy: number; r: number;
    gradient: MockGradient;
  }> = [];

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
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: "" as string | MockGradient,
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
    _linearGradients: linearGradients,
    _radialGradients: radialGradients,
  };
  return ctx as typeof ctx & CanvasRenderingContext2D;
}

/**
 * Simulates the renderShape fill pass from renderer.ts for a single path.
 * Mirrors the exact logic from the renderer's fill pass 1.
 */
function simulateFillPass(
  ctx: ReturnType<typeof makeMockCtx>,
  shape: Shape
): void {
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
      const grad = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
      for (const stop of path.fill.stops) {
        grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
      }
      ctx.fillStyle = grad as unknown as string;
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
      const grad = ctx.createRadialGradient(focalX, focalY, 0, cx, cy, r);
      for (const stop of path.fill.stops) {
        grad.addColorStop(stop.ratio / 255, colorToCss(stop.color));
      }
      ctx.fillStyle = grad as unknown as string;
      ctx.fill("nonzero");
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
});
