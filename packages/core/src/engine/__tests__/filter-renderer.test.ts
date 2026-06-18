/**
 * Unit tests for the canvas preview approximations added for filter types that
 * were previously silently skipped: BevelFilter, GradientGlowFilter,
 * GradientBevelFilter, and AdjustColorFilter.
 *
 * We exercise the renderer's applyFilters path by constructing a minimal
 * ShapeDisplayObject with filters and calling renderDisplayObject indirectly
 * via renderScene, recording ctx property mutations and draw calls.
 */

import { describe, it, expect } from "vitest";
import type { SceneGraph, DisplayObject } from "../types.js";
import type {
  BevelFilter,
  GradientGlowFilter,
  GradientBevelFilter,
  AdjustColorFilter,
} from "../filters.js";

// ---------------------------------------------------------------------------
// Mock CanvasRenderingContext2D
// ---------------------------------------------------------------------------

interface FilterTrace {
  /** Ordered list of (shadowColor, shadowBlurX, shadowOffsetX, shadowOffsetY) snapshots
   *  captured each time drawFn is invoked via the "draw" marker. */
  shadowSnapshots: Array<{
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    filter: string;
  }>;
  drawCount: number;
}

function makeMockCtx(): {
  ctx: CanvasRenderingContext2D;
  trace: FilterTrace;
  drawMarker: () => void;
} {
  const trace: FilterTrace = { shadowSnapshots: [], drawCount: 0 };

  // Mutable state so property assignments are captured.
  const state = {
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: "none",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
  };

  // Save/restore stack for nested saves.
  const stack: typeof state[] = [];

  const ctx = {
    get shadowColor() { return state.shadowColor; },
    set shadowColor(v: string) { state.shadowColor = v; },
    get shadowBlur() { return state.shadowBlur; },
    set shadowBlur(v: number) { state.shadowBlur = v; },
    get shadowOffsetX() { return state.shadowOffsetX; },
    set shadowOffsetX(v: number) { state.shadowOffsetX = v; },
    get shadowOffsetY() { return state.shadowOffsetY; },
    set shadowOffsetY(v: number) { state.shadowOffsetY = v; },
    get filter() { return state.filter; },
    set filter(v: string) { state.filter = v; },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: string) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v: string) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v: number) { state.lineWidth = v; },
    get lineCap() { return state.lineCap; },
    set lineCap(v: CanvasLineCap) { state.lineCap = v; },
    get lineJoin() { return state.lineJoin; },
    set lineJoin(v: CanvasLineJoin) { state.lineJoin = v; },
    get miterLimit() { return state.miterLimit; },
    set miterLimit(v: number) { state.miterLimit = v; },
    get globalAlpha() { return state.globalAlpha; },
    set globalAlpha(v: number) { state.globalAlpha = v; },
    get globalCompositeOperation() { return state.globalCompositeOperation; },
    set globalCompositeOperation(v: GlobalCompositeOperation) { state.globalCompositeOperation = v; },

    save() {
      stack.push({ ...state });
    },
    restore() {
      const prev = stack.pop();
      if (prev) Object.assign(state, prev);
    },
    translate() {},
    rotate() {},
    scale() {},
    transform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    clearRect() {},
    clip() {},
    setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return null; },
    measureText() { return { width: 0 }; },
    fillText() {},
    strokeText() {},
    drawImage() {},
  } as unknown as CanvasRenderingContext2D;

  // Called from the shape draw fn to record a snapshot of the current shadow state.
  function drawMarker() {
    trace.drawCount++;
    trace.shadowSnapshots.push({
      shadowColor: state.shadowColor,
      shadowBlur: state.shadowBlur,
      shadowOffsetX: state.shadowOffsetX,
      shadowOffsetY: state.shadowOffsetY,
      filter: state.filter,
    });
  }

  return { ctx, trace, drawMarker };
}

// ---------------------------------------------------------------------------
// Inline applyFilters-equivalent entry: we import the actual renderer and call
// renderScene() with a controlled SceneGraph, then inspect ctx state mutations
// by substituting a spy drawFn.  But since applyFilters is not exported, we
// must test through renderScene().
//
// Alternative: re-test the helper functions that ARE exported (adjustColorToCSSFilter
// isn't exported either).  Instead we test observable behaviour by rendering a
// shape with specific filters and checking the ctx property values at draw-time.
// ---------------------------------------------------------------------------

// Import the CanvasRenderer to trigger the renderScene code path.
import { CanvasRenderer } from "../renderer.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal canvas that delegates to our mock ctx.
// ---------------------------------------------------------------------------

function makeTestCanvas(mockCtx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    getContext: (type: string) => (type === "2d" ? mockCtx : null),
    width: 550,
    height: 400,
  } as unknown as HTMLCanvasElement;
}

// ---------------------------------------------------------------------------
// Helper: build a minimal SceneGraph with a shape that has given filters.
// ---------------------------------------------------------------------------

function makeSceneWithFilters(filters: BevelFilter | GradientGlowFilter | GradientBevelFilter | AdjustColorFilter | (BevelFilter | GradientGlowFilter | GradientBevelFilter | AdjustColorFilter)[]): SceneGraph {
  const filterList = Array.isArray(filters) ? filters : [filters];
  const shape: DisplayObject = {
    type: "shape",
    id: "s1",
    x: 0,
    y: 0,
    shape: {
      id: "s1",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [{ type: "line", to: { x: 10, y: 10 } }],
          closed: true,
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        },
      ],
    },
    filters: filterList,
  };

  return {
    layers: [
      {
        id: "layer1",
        type: "normal",
        objects: [shape],
        visible: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// AdjustColorFilter tests
// ---------------------------------------------------------------------------

describe("AdjustColorFilter canvas approximation", () => {
  it("sets ctx.filter with brightness() when brightness != 0", () => {
    const filter: AdjustColorFilter = {
      type: "adjustColor",
      brightness: 50,
      contrast: 0,
      saturation: 0,
      hue: 0,
      enabled: true,
    };

    const { ctx, trace } = makeMockCtx();
    // We track the filter value at the time of a fill() call.
    let capturedFilter = "";
    const origFill = (ctx as unknown as { fill: () => void }).fill;
    (ctx as unknown as { fill: () => void }).fill = () => {
      capturedFilter = (ctx as unknown as { filter: string }).filter;
      origFill?.();
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // brightness(1.5000) because 1 + 50/100 = 1.5
    expect(capturedFilter).toContain("brightness(1.5000)");
    void trace; // suppress unused warning
  });

  it("sets ctx.filter with contrast() when contrast != 0", () => {
    const filter: AdjustColorFilter = {
      type: "adjustColor",
      brightness: 0,
      contrast: -50,
      saturation: 0,
      hue: 0,
      enabled: true,
    };

    let capturedFilter = "";
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      capturedFilter = (ctx as unknown as { filter: string }).filter;
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // contrast(0.5000) because 1 + (-50)/100 = 0.5
    expect(capturedFilter).toContain("contrast(0.5000)");
  });

  it("sets ctx.filter with saturate() and hue-rotate() for saturation+hue", () => {
    const filter: AdjustColorFilter = {
      type: "adjustColor",
      brightness: 0,
      contrast: 0,
      saturation: 100,
      hue: 90,
      enabled: true,
    };

    let capturedFilter = "";
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      capturedFilter = (ctx as unknown as { filter: string }).filter;
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    expect(capturedFilter).toContain("saturate(2.0000)");
    expect(capturedFilter).toContain("hue-rotate(90deg)");
  });

  it("does not set ctx.filter when all adjustColor values are 0", () => {
    const filter: AdjustColorFilter = {
      type: "adjustColor",
      brightness: 0,
      contrast: 0,
      saturation: 0,
      hue: 0,
      enabled: true,
    };

    let capturedFilter = "none";
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      capturedFilter = (ctx as unknown as { filter: string }).filter;
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // No filter parts → ctx.filter should not have been set to a non-empty value
    expect(capturedFilter).not.toContain("brightness");
    expect(capturedFilter).not.toContain("contrast");
    expect(capturedFilter).not.toContain("saturate");
    expect(capturedFilter).not.toContain("hue-rotate");
  });
});

// ---------------------------------------------------------------------------
// GradientGlowFilter tests
// ---------------------------------------------------------------------------

describe("GradientGlowFilter canvas approximation", () => {
  it("draws one glow shadow pass per gradient stop, blending across ALL stops", () => {
    const filter: GradientGlowFilter = {
      type: "gradientGlow",
      distance: 0,
      angle: 0,
      gradient: [
        { color: "#ff0000", alpha: 0.2, ratio: 0 },
        { color: "#00ff00", alpha: 0.9, ratio: 128 },
        { color: "#0000ff", alpha: 0.5, ratio: 255 },
      ],
      blurX: 8,
      blurY: 8,
      strength: 1,
      quality: 1,
      inner: false,
      knockout: false,
      compositeSource: true,
      enabled: true,
    };

    const snapshots: Array<{ shadowColor: string; shadowBlur: number }> = [];
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      snapshots.push({
        shadowColor: (ctx as unknown as { shadowColor: string }).shadowColor,
        shadowBlur: (ctx as unknown as { shadowBlur: number }).shadowBlur,
      });
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // 3 stop passes + 1 main draw = 4 fill() calls.
    expect(snapshots.length).toBe(4);
    const stopColors = snapshots.map((s) => s.shadowColor);
    // ALL three stop colors must appear — proving the blend spans every stop,
    // not just the brightest one.
    expect(stopColors.some((c) => c.includes("rgba(255,0,0"))).toBe(true);
    expect(stopColors.some((c) => c.includes("rgba(0,255,0"))).toBe(true);
    expect(stopColors.some((c) => c.includes("rgba(0,0,255"))).toBe(true);
    // The widest (ratio=255) stop is drawn first with the largest blur; the
    // tightest (ratio=0) stop with the smallest blur.
    const blurs = snapshots.slice(0, 3).map((s) => s.shadowBlur);
    expect(blurs[0]).toBeGreaterThan(blurs[2]);
    // Final draw is the object itself with shadow cleared (ctx.restore).
    expect(snapshots[3].shadowColor).toBe("");
  });
});

// ---------------------------------------------------------------------------
// BevelFilter tests
// ---------------------------------------------------------------------------

describe("BevelFilter canvas approximation", () => {
  it("calls drawFn at least 3 times (2 bevel shadow passes + 1 main draw)", () => {
    const filter: BevelFilter = {
      type: "bevel",
      distance: 4,
      angle: 45,
      highlightColor: { r: 255, g: 255, b: 255, a: 255 },
      highlightAlpha: 1,
      shadowColor: { r: 0, g: 0, b: 0, a: 255 },
      shadowAlpha: 1,
      blurX: 4,
      blurY: 4,
      strength: 1,
      quality: 1,
      bevelType: "inner",
      knockout: false,
      enabled: true,
    };

    let fillCount = 0;
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => { fillCount++; };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // Bevel emits 2 shadow passes + 1 main draw = 3 fill() calls
    expect(fillCount).toBeGreaterThanOrEqual(3);
  });

  it("uses highlightColor for one pass and shadowColor for another", () => {
    const filter: BevelFilter = {
      type: "bevel",
      distance: 4,
      angle: 45,
      highlightColor: { r: 255, g: 255, b: 255, a: 255 },
      highlightAlpha: 1,
      shadowColor: { r: 0, g: 0, b: 0, a: 255 },
      shadowAlpha: 0.8,
      blurX: 6,
      blurY: 6,
      strength: 1,
      quality: 1,
      bevelType: "outer",
      knockout: false,
      enabled: true,
    };

    const shadowColorAtFill: string[] = [];
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      shadowColorAtFill.push((ctx as unknown as { shadowColor: string }).shadowColor);
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // First fill should have a non-empty shadow color (bevel highlight pass)
    expect(shadowColorAtFill[0]).toMatch(/rgba\(255,255,255/);
    // Second fill should use shadow color
    expect(shadowColorAtFill[1]).toMatch(/rgba\(0,0,0/);
    // Third fill (main draw) should have had shadow cleared (ctx.restore)
    expect(shadowColorAtFill[2]).toBe("");
  });
});

// ---------------------------------------------------------------------------
// GradientBevelFilter tests
// ---------------------------------------------------------------------------

describe("GradientBevelFilter canvas approximation", () => {
  it("calls drawFn at least 3 times (2 shadow passes + 1 main)", () => {
    const filter: GradientBevelFilter = {
      type: "gradientBevel",
      distance: 4,
      angle: 45,
      gradient: [
        { color: "#000000", alpha: 1, ratio: 0 },
        { color: "#ffffff", alpha: 1, ratio: 255 },
      ],
      blurX: 4,
      blurY: 4,
      strength: 1,
      quality: 1,
      inner: false,
      knockout: false,
      compositeSource: true,
      enabled: true,
    };

    let fillCount = 0;
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => { fillCount++; };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    expect(fillCount).toBeGreaterThanOrEqual(3);
  });

  it("blends ACROSS all gradient stops (one pass per stop, not just first/last)", () => {
    // 4 stops: 2 on the shadow side (t<0.5), 2 on the highlight side (t>=0.5).
    const filter: GradientBevelFilter = {
      type: "gradientBevel",
      distance: 4,
      angle: 45,
      gradient: [
        { color: "#110000", alpha: 1, ratio: 0 },
        { color: "#220000", alpha: 1, ratio: 100 },
        { color: "#003300", alpha: 1, ratio: 160 },
        { color: "#004400", alpha: 1, ratio: 255 },
      ],
      blurX: 4,
      blurY: 4,
      strength: 1,
      quality: 1,
      inner: false,
      knockout: false,
      compositeSource: true,
      enabled: true,
    };

    const shadowColors: string[] = [];
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      shadowColors.push((ctx as unknown as { shadowColor: string }).shadowColor);
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // 4 stop passes + 1 main draw = 5 fill() calls.
    expect(shadowColors.length).toBe(5);
    // Every stop color must show up, proving the across-stop blend.
    expect(shadowColors.some((c) => c.includes("rgba(17,0,0"))).toBe(true);
    expect(shadowColors.some((c) => c.includes("rgba(34,0,0"))).toBe(true);
    expect(shadowColors.some((c) => c.includes("rgba(0,51,0"))).toBe(true);
    expect(shadowColors.some((c) => c.includes("rgba(0,68,0"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Disabled filters are skipped
// ---------------------------------------------------------------------------

describe("disabled filters are skipped", () => {
  it("adjustColor with enabled=false does not mutate ctx.filter", () => {
    const filter: AdjustColorFilter = {
      type: "adjustColor",
      brightness: 100,
      contrast: 100,
      saturation: 100,
      hue: 180,
      enabled: false, // disabled!
    };

    let capturedFilter = "none";
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => {
      capturedFilter = (ctx as unknown as { filter: string }).filter;
    };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // Disabled filter → no CSS filter applied
    expect(capturedFilter).not.toContain("brightness");
  });

  it("bevel with enabled=false produces exactly 1 fill call (no bevel passes)", () => {
    const filter: BevelFilter = {
      type: "bevel",
      distance: 4,
      angle: 45,
      highlightColor: { r: 255, g: 255, b: 255, a: 255 },
      highlightAlpha: 1,
      shadowColor: { r: 0, g: 0, b: 0, a: 255 },
      shadowAlpha: 1,
      blurX: 4,
      blurY: 4,
      strength: 1,
      quality: 1,
      bevelType: "inner",
      knockout: false,
      enabled: false, // disabled!
    };

    let fillCount = 0;
    const { ctx } = makeMockCtx();
    (ctx as unknown as { fill: () => void }).fill = () => { fillCount++; };

    const canvas = makeTestCanvas(ctx);
    const renderer = new CanvasRenderer(canvas);
    renderer.render(makeSceneWithFilters(filter), { x: 0, y: 0, width: 550, height: 400 });

    // Only 1 fill call — no bevel passes
    expect(fillCount).toBe(1);
  });
});
