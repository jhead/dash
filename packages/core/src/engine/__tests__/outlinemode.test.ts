/**
 * Tests for Layer outline mode properties and renderer outline-mode behavior.
 *
 * outlineMode is defined on the model Layer type (model/types.ts).
 * The Canvas 2D renderer (engine/renderer.ts) implements outline-mode rendering
 * via renderLayer → renderDisplayObjectOutline → renderShapeOutline.
 *
 * Passing tests (property access):
 *   1. Layer with outlineMode: true  → outlineMode === true
 *   2. Layer with outlineMode: false → outlineMode === false (default)
 *   3. Layer with outlineColor: '#FF0000' → outlineColor accessible
 */

import { describe, it, expect } from "vitest";
import { createLayer } from "../../model/timeline.js";
import { CanvasRenderer } from "../renderer.js";
import type { SceneGraph, SceneLayer, ShapeDisplayObject } from "../types.js";

// ---------------------------------------------------------------------------
// Property access — always-passing tests
// ---------------------------------------------------------------------------

describe("Layer outlineMode property", () => {
  it("layer created with outlineMode: true has outlineMode === true", () => {
    const layer = createLayer("Test", "normal", { outlineMode: true });
    expect(layer.outlineMode).toBe(true);
  });

  it("layer created with default outlineMode has outlineMode === false", () => {
    const layer = createLayer("Test");
    expect(layer.outlineMode).toBe(false);
  });

  it("layer created with outlineMode: false explicitly has outlineMode === false", () => {
    const layer = createLayer("Test", "normal", { outlineMode: false });
    expect(layer.outlineMode).toBe(false);
  });
});

describe("Layer outlineColor property", () => {
  it("layer created with outlineColor: '#FF0000' has that outlineColor accessible", () => {
    const layer = createLayer("Test", "normal", { outlineColor: "#FF0000" });
    expect(layer.outlineColor).toBe("#FF0000");
  });

  it("layer has a default outlineColor string value", () => {
    const layer = createLayer("Test");
    // Default color is defined in createLayer — a non-empty CSS hex string
    expect(typeof layer.outlineColor).toBe("string");
    expect(layer.outlineColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("outlineColor is independent from outlineMode", () => {
    const layerOn = createLayer("A", "normal", {
      outlineMode: true,
      outlineColor: "#00FF00",
    });
    const layerOff = createLayer("B", "normal", {
      outlineMode: false,
      outlineColor: "#0000FF",
    });
    expect(layerOn.outlineMode).toBe(true);
    expect(layerOn.outlineColor).toBe("#00FF00");
    expect(layerOff.outlineMode).toBe(false);
    expect(layerOff.outlineColor).toBe("#0000FF");
  });
});

// ---------------------------------------------------------------------------
// Helpers for renderer outline-mode tests
// ---------------------------------------------------------------------------

interface DrawCall {
  type: string;
  args: unknown[];
}

/**
 * Builds a mock CanvasRenderingContext2D that records draw calls and tracks
 * the most recently assigned strokeStyle/fillStyle so tests can inspect them.
 */
function makeMockCtx() {
  const calls: DrawCall[] = [];
  // Mutable state that the renderer assigns via property writes
  let strokeStyle = "";
  let fillStyle = "";

  const ctx: Record<string, unknown> = {
    save: () => calls.push({ type: "save", args: [] }),
    restore: () => calls.push({ type: "restore", args: [] }),
    translate: (x: number, y: number) =>
      calls.push({ type: "translate", args: [x, y] }),
    rotate: (a: number) => calls.push({ type: "rotate", args: [a] }),
    scale: (x: number, y: number) => calls.push({ type: "scale", args: [x, y] }),
    beginPath: () => calls.push({ type: "beginPath", args: [] }),
    closePath: () => calls.push({ type: "closePath", args: [] }),
    moveTo: (x: number, y: number) =>
      calls.push({ type: "moveTo", args: [x, y] }),
    lineTo: (x: number, y: number) =>
      calls.push({ type: "lineTo", args: [x, y] }),
    quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) =>
      calls.push({ type: "quadraticCurveTo", args: [cpx, cpy, x, y] }),
    fill: (...args: unknown[]) => calls.push({ type: "fill", args }),
    stroke: () => calls.push({ type: "stroke", args: [] }),
    clip: () => calls.push({ type: "clip", args: [] }),
    rect: () => {},
    clearRect: () => {},
    fillRect: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    drawImage: () => {},
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    filter: "",
    shadowColor: "",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    canvas: { width: 550, height: 400 },
    _calls: calls,
  };

  // Use property descriptors so strokeStyle / fillStyle assignments are recorded
  Object.defineProperty(ctx, "strokeStyle", {
    get: () => strokeStyle,
    set: (v: string) => {
      strokeStyle = v;
      calls.push({ type: "strokeStyleSet", args: [v] });
    },
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(ctx, "fillStyle", {
    get: () => fillStyle,
    set: (v: string) => {
      fillStyle = v;
      calls.push({ type: "fillStyleSet", args: [v] });
    },
    enumerable: true,
    configurable: true,
  });

  return ctx as typeof ctx & CanvasRenderingContext2D & { _calls: DrawCall[] };
}

/**
 * Creates a CanvasRenderer backed by the given mock context.
 */
function makeRenderer(ctx: CanvasRenderingContext2D): CanvasRenderer {
  const fakeCanvas = {
    width: 550,
    height: 400,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return new CanvasRenderer(fakeCanvas);
}

/**
 * Builds a minimal SceneLayer with one ShapeDisplayObject that has both a fill
 * and a stroke path, so we can distinguish fill vs stroke rendering.
 */
function makeOutlineLayer(
  overrides: Partial<SceneLayer> = {}
): SceneLayer {
  const shape: ShapeDisplayObject = {
    type: "shape",
    id: "s1",
    shape: {
      id: "s1",
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 10, y: 0 } },
            { type: "line", to: { x: 10, y: 10 } },
            { type: "line", to: { x: 0, y: 10 } },
          ],
          closed: true,
          // Both fill AND stroke present so we can assert fill is suppressed
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
          stroke: {
            color: { r: 0, g: 255, b: 0, a: 255 },
            width: 2,
            caps: "round",
            joints: "round",
            miterLimit: 3,
            noHScaleFlag: false,
            noVScaleFlag: false,
            pixelHintingFlag: false,
            style: { type: "solid" },
          },
        },
      ],
    },
    x: 0,
    y: 0,
  };

  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
    locked: false,
    objects: [shape],
    outlineMode: false,
    outlineColor: "#ff0000",
    ...overrides,
  };
}

function makeScene(layer: SceneLayer): SceneGraph {
  return { layers: [layer] };
}

// ---------------------------------------------------------------------------
// Renderer outline-mode behavior
// ---------------------------------------------------------------------------

describe("Renderer outline-mode rendering", () => {
  it("when outlineMode is true, fill calls are suppressed and only strokes are emitted", () => {
    const ctx = makeMockCtx();
    const renderer = makeRenderer(ctx);
    const layer = makeOutlineLayer({ outlineMode: true, outlineColor: "#0000ff" });

    renderer.render(makeScene(layer), { x: 0, y: 0, zoom: 1 });

    const callTypes = ctx._calls.map((c) => c.type);
    // fill() must NOT be emitted when outlineMode is active
    expect(callTypes).not.toContain("fill");
    // stroke() MUST be emitted (the outline pass calls ctx.stroke() for every path)
    expect(callTypes).toContain("stroke");
  });

  it("when outlineMode is true, strokes are drawn using outlineColor instead of the shape's own stroke color", () => {
    const ctx = makeMockCtx();
    const renderer = makeRenderer(ctx);
    const outlineColor = "#ab1234";
    const layer = makeOutlineLayer({ outlineMode: true, outlineColor });

    renderer.render(makeScene(layer), { x: 0, y: 0, zoom: 1 });

    // The shape's own stroke color is rgba(0,255,0,...) — that must NOT appear.
    // The outlineColor must appear as a strokeStyle assignment.
    const strokeStyleSets = ctx._calls
      .filter((c) => c.type === "strokeStyleSet")
      .map((c) => c.args[0] as string);

    expect(strokeStyleSets).toContain(outlineColor);
    // None of the strokeStyle assignments should be the shape's green stroke color
    expect(strokeStyleSets.some((s) => s.includes("0,255,0"))).toBe(false);
  });

  it("when outlineMode is false (default), shapes are rendered normally with fills and strokes", () => {
    const ctx = makeMockCtx();
    const renderer = makeRenderer(ctx);
    // Default layer: outlineMode: false — both fill and stroke paths are present
    const layer = makeOutlineLayer({ outlineMode: false });

    renderer.render(makeScene(layer), { x: 0, y: 0, zoom: 1 });

    const callTypes = ctx._calls.map((c) => c.type);
    // Normal rendering emits both fill() and stroke()
    expect(callTypes).toContain("fill");
    expect(callTypes).toContain("stroke");
  });

  it("outlineColor is passed through to the canvas strokeStyle when outlineMode is active", () => {
    const ctx = makeMockCtx();
    const renderer = makeRenderer(ctx);
    const specificColor = "#deadbe";
    const layer = makeOutlineLayer({ outlineMode: true, outlineColor: specificColor });

    renderer.render(makeScene(layer), { x: 0, y: 0, zoom: 1 });

    const strokeStyleSets = ctx._calls
      .filter((c) => c.type === "strokeStyleSet")
      .map((c) => c.args[0] as string);

    // The exact outlineColor string must be assigned to strokeStyle
    expect(strokeStyleSets).toContain(specificColor);
  });
});
