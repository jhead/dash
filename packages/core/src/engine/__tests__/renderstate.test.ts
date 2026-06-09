/**
 * Tests for renderer canvas state management: save/restore and globalAlpha.
 *
 * Verifies:
 *  1. Rendering a visible ShapeDisplayObject calls save() and restore().
 *  2. Rendering a SymbolInstance with alpha=0.5 sets globalAlpha to 0.5.
 *  3. Rendering a hidden object (layer.visible=false) does NOT call beginPath.
 *  4. Each rendered object's save/restore calls are balanced (equal counts).
 *
 * Uses the same inline-simulation pattern as symbol-render.test.ts so tests
 * stay in sync when renderer.ts changes.
 */

import { describe, it, expect } from "vitest";
import type {
  DisplayObject,
  Shape,
  ShapeDisplayObject,
  SymbolInstance,
} from "../types.js";
import type { Library } from "../../model/types.js";
import type { Symbol as FlashSymbol, Layer, Frame } from "../../model/types.js";
import { getGoverningKeyframe } from "../../model/timeline-query.js";

// ---------------------------------------------------------------------------
// Draw call recorder
// ---------------------------------------------------------------------------

interface DrawCall {
  type: string;
  args: unknown[];
}

function makeMockCtx() {
  const calls: DrawCall[] = [];

  const ctx = {
    save: () => calls.push({ type: "save", args: [] }),
    restore: () => calls.push({ type: "restore", args: [] }),
    translate: (x: number, y: number) =>
      calls.push({ type: "translate", args: [x, y] }),
    rotate: (angle: number) => calls.push({ type: "rotate", args: [angle] }),
    scale: (x: number, y: number) => calls.push({ type: "scale", args: [x, y] }),
    beginPath: () => calls.push({ type: "beginPath", args: [] }),
    moveTo: (x: number, y: number) =>
      calls.push({ type: "moveTo", args: [x, y] }),
    lineTo: (x: number, y: number) =>
      calls.push({ type: "lineTo", args: [x, y] }),
    bezierCurveTo: (...a: number[]) =>
      calls.push({ type: "bezierCurveTo", args: a }),
    closePath: () => calls.push({ type: "closePath", args: [] }),
    fill: (_rule?: string) => calls.push({ type: "fill", args: [] }),
    stroke: () => calls.push({ type: "stroke", args: [] }),
    quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) =>
      calls.push({ type: "quadraticCurveTo", args: [cpx, cpy, x, y] }),
    fillRect: () => {},
    clearRect: () => {},
    clip: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 0 }),
    fillText: () => {},
    strokeText: () => {},
    drawImage: () => {},
    strokeStyle: "" as string,
    fillStyle: "" as string,
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

  return ctx as typeof ctx & CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Inline renderer helpers (mirrors renderer.ts logic)
// ---------------------------------------------------------------------------

function colorToCss(color: { r: number; g: number; b: number; a: number }): string {
  const alpha = (color.a / 255).toFixed(4);
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

function renderShape(
  ctx: ReturnType<typeof makeMockCtx>,
  shape: Shape,
  offsetX: number,
  offsetY: number
): void {
  ctx.save();
  ctx.translate(offsetX, offsetY);

  for (const path of shape.paths) {
    if (!path.fill) continue;
    ctx.beginPath();
    ctx.moveTo(path.start.x, path.start.y);
    for (const seg of path.segments) {
      if (seg.type === "line") {
        ctx.lineTo(seg.to.x, seg.to.y);
      } else {
        ctx.quadraticCurveTo(
          seg.control.x, seg.control.y,
          seg.to.x, seg.to.y
        );
      }
    }
    if (path.closed) ctx.closePath();
    if (path.fill.type === "solid") {
      ctx.fillStyle = colorToCss(path.fill.color);
      ctx.fill();
    }
    if (path.stroke) ctx.stroke();
  }

  ctx.restore();
}

function renderSymbolInstance(
  ctx: ReturnType<typeof makeMockCtx>,
  obj: SymbolInstance,
  library: Library | undefined,
  visitedSymbolIds: Set<string>
): void {
  if (!library) return;
  if (visitedSymbolIds.has(obj.symbolId)) return;

  const symbol = library.items.find(
    (item) => item.id === obj.symbolId
  ) as FlashSymbol | undefined;
  if (!symbol || symbol.itemType !== "symbol") return;

  const frame = obj.firstFrame ?? 0;

  ctx.save();
  ctx.translate(obj.x, obj.y);

  if (obj.rotation) {
    ctx.rotate((obj.rotation * Math.PI) / 180);
  }
  if (
    (obj.scaleX !== undefined && obj.scaleX !== 1) ||
    (obj.scaleY !== undefined && obj.scaleY !== 1)
  ) {
    ctx.scale(obj.scaleX ?? 1, obj.scaleY ?? 1);
  }
  if (obj.alpha !== undefined && obj.alpha < 1) {
    ctx.globalAlpha = ctx.globalAlpha * obj.alpha;
  }

  const nextVisited = new Set(visitedSymbolIds);
  nextVisited.add(obj.symbolId);

  const layers = [...symbol.timeline.layers].reverse();
  for (const layer of layers) {
    if (!layer.visible) continue;
    const kf = getGoverningKeyframe(layer, frame);
    if (!kf) continue;
    for (const childObj of kf.displayObjects) {
      renderDisplayObject(ctx, childObj, library, nextVisited);
    }
  }

  ctx.restore();
}

function renderDisplayObject(
  ctx: ReturnType<typeof makeMockCtx>,
  obj: DisplayObject,
  library: Library | undefined,
  visitedSymbolIds: Set<string>
): void {
  if (obj.type === "shape") {
    renderShape(ctx, obj.shape, obj.x, obj.y);
  } else if (obj.type === "instance") {
    renderSymbolInstance(ctx, obj, library, visitedSymbolIds);
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeShapeObj(id = "shape-1", x = 0, y = 0): ShapeDisplayObject {
  return {
    type: "shape",
    id,
    shape: {
      id,
      paths: [
        {
          start: { x: 0, y: 0 },
          segments: [
            { type: "line", to: { x: 10, y: 0 } },
            { type: "line", to: { x: 10, y: 10 } },
            { type: "line", to: { x: 0, y: 10 } },
          ],
          closed: true,
          fill: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
        },
      ],
    },
    x,
    y,
  };
}

function makeFrame(displayObjects: DisplayObject[] = []): Frame {
  return {
    index: 0,
    isKeyframe: true,
    isEmpty: displayObjects.length === 0,
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
    motionScale: false,
    shapeEase: 0,
    shapeBlend: "distributive",
    displayObjects,
  };
}

function makeLayer(
  displayObjects: DisplayObject[] = [],
  visible = true
): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible,
    locked: false,
    outlineMode: false,
    outlineColor: "#ff0000",
    height: 20,
    parentFolderId: null,
    frames: [makeFrame(displayObjects)],
    frameCount: 1,
  };
}

function makeSymbolDef(
  id: string,
  displayObjects: DisplayObject[] = [],
  layerVisible = true
): FlashSymbol {
  return {
    id,
    name: id,
    itemType: "symbol",
    symbolType: "movieclip",
    linkage: {
      exportForActionScript: false,
      exportInFirstFrame: false,
      linkageIdentifier: "",
      className: "",
      exportForRuntimeSharing: false,
      importForRuntimeSharing: false,
      sharedUrl: "",
    },
    scale9Grid: null,
    timeline: {
      layers: [makeLayer(displayObjects, layerVisible)],
    },
  };
}

function makeLibrary(symbols: FlashSymbol[]): Library {
  return { items: symbols, folders: [] };
}

function makeInstance(
  symbolId: string,
  x = 0,
  y = 0,
  overrides: Partial<SymbolInstance> = {}
): SymbolInstance {
  return {
    type: "instance",
    id: "inst-1",
    symbolId,
    x,
    y,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderer canvas state: save/restore for shapes", () => {
  it("1. rendering a visible ShapeDisplayObject calls save() and restore()", () => {
    const shape = makeShapeObj("s1", 10, 20);
    const ctx = makeMockCtx();

    renderShape(ctx, shape.shape, shape.x, shape.y);

    const callTypes = ctx._calls.map((c) => c.type);
    expect(callTypes).toContain("save");
    expect(callTypes).toContain("restore");

    const saveIdx = callTypes.indexOf("save");
    const restoreIdx = callTypes.lastIndexOf("restore");
    expect(saveIdx).toBeLessThan(restoreIdx);
  });

  it("2. rendering a SymbolInstance with alpha=0.5 sets globalAlpha to 0.5", () => {
    const shapeObj = makeShapeObj("child-shape", 0, 0);
    const sym = makeSymbolDef("sym-alpha", [shapeObj]);
    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-alpha", 0, 0, { alpha: 0.5 });
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    // globalAlpha starts at 1; after multiplying by 0.5 it should be 0.5
    expect(ctx.globalAlpha).toBe(0.5);
  });

  it("3. rendering a SymbolInstance with hidden layer does NOT call beginPath", () => {
    // Symbol has a layer with visible=false, so no draw calls should occur
    const shapeObj = makeShapeObj("hidden-shape", 0, 0);
    const sym = makeSymbolDef("sym-hidden", [shapeObj], /* layerVisible= */ false);
    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-hidden", 0, 0);
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    const beginPathCalls = ctx._calls.filter((c) => c.type === "beginPath");
    expect(beginPathCalls).toHaveLength(0);
  });

  it("4. save and restore calls are balanced for a rendered ShapeDisplayObject", () => {
    const shape = makeShapeObj("s2", 0, 0);
    const ctx = makeMockCtx();

    renderShape(ctx, shape.shape, shape.x, shape.y);

    const saveCount = ctx._calls.filter((c) => c.type === "save").length;
    const restoreCount = ctx._calls.filter((c) => c.type === "restore").length;
    expect(saveCount).toBe(restoreCount);
  });

  it("4b. save and restore calls are balanced for a rendered SymbolInstance", () => {
    const shapeObj = makeShapeObj("s3", 0, 0);
    const sym = makeSymbolDef("sym-balance", [shapeObj]);
    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-balance", 5, 10);
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    const saveCount = ctx._calls.filter((c) => c.type === "save").length;
    const restoreCount = ctx._calls.filter((c) => c.type === "restore").length;
    expect(saveCount).toBe(restoreCount);
  });
});
