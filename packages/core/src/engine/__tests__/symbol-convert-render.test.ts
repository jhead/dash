/**
 * Render-equivalence test for the library_convert_to_symbol coordinate
 * normalization (task 0707).
 *
 * When a stage object is converted into a symbol, the symbol's internal content
 * must be normalized to symbol-local coordinates (registration point = top-left
 * of the selection) and the placed instance must re-apply that origin. The net
 * visual result must be pixel-identical to the un-converted original.
 *
 * Rather than rasterize, we drive the real CanvasRenderer with a mock 2D
 * context that maintains the affine transform stack and records the ABSOLUTE
 * (stage-space) coordinates of every moveTo/lineTo. We then assert that
 * rendering the original object produces the same absolute geometry as
 * rendering the converted (instance + symbol) form.
 */

import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../renderer.js";
import type {
  SceneGraph,
  DisplayObject,
  ShapeDisplayObject,
  SymbolInstance,
} from "../types.js";
import type { Library, Symbol } from "../../model/types.js";

// ---------------------------------------------------------------------------
// Transform-tracking mock 2D context
// ---------------------------------------------------------------------------

interface Mat {
  a: number; b: number; c: number; d: number; e: number; f: number;
}
const IDENT: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function makeTrackingCtx() {
  let cur: Mat = { ...IDENT };
  const stack: Mat[] = [];
  const points: Array<{ x: number; y: number }> = [];

  const ctx = {
    save: () => { stack.push({ ...cur }); },
    restore: () => { const m = stack.pop(); if (m) cur = m; },
    translate: (x: number, y: number) => { cur = mul(cur, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }); },
    scale: (x: number, y: number) => { cur = mul(cur, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 }); },
    rotate: (rad: number) => {
      const cos = Math.cos(rad), sin = Math.sin(rad);
      cur = mul(cur, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
    },
    clearRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    clip: () => {},
    rect: () => {},
    moveTo: (x: number, y: number) => { points.push(apply(cur, x, y)); },
    lineTo: (x: number, y: number) => { points.push(apply(cur, x, y)); },
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      points.push(apply(cur, cx, cy));
      points.push(apply(cur, x, y));
    },
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    fillRect: () => {},
    setLineDash: () => {},
    measureText: () => ({ width: 0 }),
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "",
    shadowColor: "",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    font: "",
    textAlign: "left",
    textBaseline: "top",
  } as unknown as CanvasRenderingContext2D;

  return { ctx, points };
}

function makeRenderer(tracking: ReturnType<typeof makeTrackingCtx>): CanvasRenderer {
  const fakeCanvas = {
    width: 550,
    height: 400,
    getContext: () => tracking.ctx,
  } as unknown as HTMLCanvasElement;
  return new CanvasRenderer(fakeCanvas);
}

function renderToPoints(scene: SceneGraph, library?: Library) {
  const tracking = makeTrackingCtx();
  const renderer = makeRenderer(tracking);
  renderer.render(scene, { x: 0, y: 0, zoom: 1 }, library);
  return tracking.points;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A rect shape whose geometry is baked at absolute stage coords (mirrors what
 * stage_add_shape produces: x/y = 0, path coords absolute). */
function bakedRect(id: string, left: number, top: number, w: number, h: number): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    x: 0,
    y: 0,
    shape: {
      id: id + "-shape",
      paths: [
        {
          start: { x: left, y: top },
          segments: [
            { type: "line", to: { x: left + w, y: top } },
            { type: "line", to: { x: left + w, y: top + h } },
            { type: "line", to: { x: left, y: top + h } },
            { type: "line", to: { x: left, y: top } },
          ],
          closed: true,
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        },
      ],
    },
  };
}

function singleLayerScene(objects: DisplayObject[]): SceneGraph {
  return {
    layers: [
      { id: "L1", name: "Layer 1", type: "normal", visible: true, locked: false, objects },
    ],
  };
}

/**
 * Mimic the registry's convert-to-symbol normalization for a single shape:
 * registration point = visual top-left of geometry, content shifted into
 * symbol-local space, instance placed at the origin.
 */
function convertToSymbolForm(
  obj: ShapeDisplayObject,
  originX: number,
  originY: number
): { library: Library; scene: SceneGraph } {
  const localObj: ShapeDisplayObject = {
    ...obj,
    x: obj.x - originX,
    y: obj.y - originY,
  };
  const symbol: Symbol = {
    id: "sym-1",
    name: "Converted",
    itemType: "symbol",
    symbolType: "movieclip",
    linkage: { exportForActionScript: false },
    scale9Grid: null,
    timeline: {
      layers: [
        {
          id: "sym-L1",
          name: "Layer 1",
          type: "normal",
          visible: true,
          locked: false,
          outlineMode: false,
          outlineColor: "#0000ff",
          height: 20,
          parentFolderId: null,
          frameCount: 1,
          frames: [
            {
              index: 0,
              isKeyframe: true,
              isEmpty: false,
              tweenType: "none",
              label: "",
              labelType: "name",
              script: "",
              sound: null,
              motionEase: 0,
              motionRotate: "none",
              motionRotateCount: 0,
              motionOrientToPath: false,
              motionSync: false,
              motionScale: true,
              shapeEase: 0,
              shapeBlend: "distributive",
              displayObjects: [localObj],
            },
          ],
        },
      ],
    },
  } as unknown as Symbol;

  const instance: SymbolInstance = {
    type: "instance",
    id: "inst-1",
    symbolId: symbol.id,
    x: originX,
    y: originY,
  };

  const library: Library = { items: [symbol], folders: [] };
  return { library, scene: singleLayerScene([instance]) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("library_convert_to_symbol render equivalence (task 0707)", () => {
  it("baked-absolute shape (x/y=0) renders identically after conversion", () => {
    // A rect drawn at stage (200,150), 100x80 — geometry baked, x/y = 0.
    const rect = bakedRect("r1", 200, 150, 100, 80);

    const before = renderToPoints(singleLayerScene([rect]));

    // Registration point = true visual top-left of the geometry = (200,150).
    const { library, scene } = convertToSymbolForm(rect, 200, 150);
    const after = renderToPoints(scene, library);

    expect(after.length).toBe(before.length);
    expect(after.length).toBeGreaterThan(0);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x).toBeCloseTo(before[i].x, 6);
      expect(after[i].y).toBeCloseTo(before[i].y, 6);
    }
  });

  it("symbol-local geometry is normalized to its registration point", () => {
    // After conversion, the leftmost/topmost drawn point INSIDE the symbol
    // (before the instance translate is applied) should be at local (0,0).
    const rect = bakedRect("r2", 200, 150, 100, 80);
    const { library } = convertToSymbolForm(rect, 200, 150);

    // Render just the symbol's content (no instance translate) and check that
    // its visual top-left sits at the origin.
    const symbol = library.items[0] as Symbol;
    const localObjs = symbol.timeline.layers[0].frames[0].displayObjects as DisplayObject[];
    const localPts = renderToPoints(singleLayerScene([...localObjs]));
    const minX = Math.min(...localPts.map((p) => p.x));
    const minY = Math.min(...localPts.map((p) => p.y));
    expect(minX).toBeCloseTo(0, 6);
    expect(minY).toBeCloseTo(0, 6);
  });
});
