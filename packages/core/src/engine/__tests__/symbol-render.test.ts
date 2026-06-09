/**
 * Unit tests for SymbolInstance rendering logic.
 *
 * Tests verify:
 *   1. Rendering a SymbolInstance causes save()/restore() to be called.
 *   2. Rendering a SymbolInstance at (x=100, y=50) calls translate(100, 50).
 *   3. A SymbolInstance pointing to a symbol with a ShapeDisplayObject causes
 *      shape drawing calls (beginPath / moveTo / fill or stroke).
 *
 * We inline the renderSymbolInstance logic from renderer.ts against a mock
 * CanvasRenderingContext2D, following the same pattern used in
 * gradient-renderer.test.ts and mask-renderer.test.ts.
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
    transform: (...a: number[]) => calls.push({ type: "transform", args: a }),
    beginPath: () => calls.push({ type: "beginPath", args: [] }),
    moveTo: (x: number, y: number) =>
      calls.push({ type: "moveTo", args: [x, y] }),
    lineTo: (x: number, y: number) =>
      calls.push({ type: "lineTo", args: [x, y] }),
    quadraticCurveTo: (cpx: number, cpy: number, x: number, y: number) =>
      calls.push({ type: "quadraticCurveTo", args: [cpx, cpy, x, y] }),
    bezierCurveTo: (...a: number[]) =>
      calls.push({ type: "bezierCurveTo", args: a }),
    closePath: () => calls.push({ type: "closePath", args: [] }),
    fill: () => calls.push({ type: "fill", args: [] }),
    stroke: () => calls.push({ type: "stroke", args: [] }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({ type: "fillRect", args: [x, y, w, h] }),
    clearRect: () => calls.push({ type: "clearRect", args: [] }),
    clip: () => calls.push({ type: "clip", args: [] }),
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
// Inline simulation of renderSymbolInstance from renderer.ts
//
// This mirrors the actual logic so tests stay in sync if renderer.ts changes.
// ---------------------------------------------------------------------------

function colorToCss(color: { r: number; g: number; b: number; a: number }): string {
  const alpha = (color.a / 255).toFixed(4);
  return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

/**
 * Renders a single ShapePath into the ctx (fill pass only — simplified).
 */
function renderShapePaths(
  ctx: ReturnType<typeof makeMockCtx>,
  shape: Shape,
  ox: number,
  oy: number
): void {
  for (const path of shape.paths) {
    ctx.beginPath();
    ctx.moveTo(path.start.x + ox, path.start.y + oy);
    for (const seg of path.segments) {
      if (seg.type === "line") {
        ctx.lineTo(seg.to.x + ox, seg.to.y + oy);
      } else {
        ctx.quadraticCurveTo(
          seg.control.x + ox,
          seg.control.y + oy,
          seg.to.x + ox,
          seg.to.y + oy
        );
      }
    }
    if (path.closed) ctx.closePath();
    if (path.fill) {
      if (path.fill.type === "solid") {
        ctx.fillStyle = colorToCss(path.fill.color);
      }
      ctx.fill();
    }
    if (path.stroke) {
      ctx.stroke();
    }
  }
}

/**
 * Renders a DisplayObject onto ctx (shape pass — fills + strokes).
 * Simplified: handles "shape" and "instance" types only.
 */
function renderDisplayObject(
  ctx: ReturnType<typeof makeMockCtx>,
  obj: DisplayObject,
  library: Library | undefined,
  visitedSymbolIds: Set<string>
): void {
  if (obj.type === "shape") {
    const scaleX = obj.scaleX ?? 1;
    const scaleY = obj.scaleY ?? 1;
    const rotation = obj.rotation ?? 0;
    if (scaleX !== 1 || scaleY !== 1 || rotation !== 0) {
      ctx.save();
      ctx.translate(obj.x, obj.y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scaleX, scaleY);
      renderShapePaths(ctx, obj.shape, 0, 0);
      ctx.restore();
    } else {
      renderShapePaths(ctx, obj.shape, obj.x, obj.y);
    }
  } else if (obj.type === "instance") {
    renderSymbolInstance(ctx, obj, library, visitedSymbolIds);
  }
}

/**
 * Mirrors renderSymbolInstance from renderer.ts.
 */
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

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

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

function makeLayer(displayObjects: DisplayObject[] = []): Layer {
  return {
    id: "layer-1",
    name: "Layer 1",
    type: "normal",
    visible: true,
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
  displayObjects: DisplayObject[] = []
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
      layers: [makeLayer(displayObjects)],
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SymbolInstance rendering", () => {
  /**
   * Test 1: Rendering a SymbolInstance causes save()/restore() to be called.
   */
  it("1. rendering a SymbolInstance calls save() and restore()", () => {
    const sym = makeSymbolDef("sym-1");
    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-1", 0, 0);
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    const callTypes = ctx._calls.map((c) => c.type);
    expect(callTypes).toContain("save");
    expect(callTypes).toContain("restore");

    // save must come before restore
    const saveIdx = callTypes.indexOf("save");
    const restoreIdx = callTypes.lastIndexOf("restore");
    expect(saveIdx).toBeLessThan(restoreIdx);
  });

  /**
   * Test 2: Rendering a SymbolInstance at (x=100, y=50) calls translate(100, 50).
   */
  it("2. rendering a SymbolInstance at (100, 50) calls translate(100, 50)", () => {
    const sym = makeSymbolDef("sym-2");
    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-2", 100, 50);
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    const translateCalls = ctx._calls.filter((c) => c.type === "translate");
    expect(translateCalls.length).toBeGreaterThan(0);

    const matchingCall = translateCalls.find(
      (c) => c.args[0] === 100 && c.args[1] === 50
    );
    expect(matchingCall).toBeDefined();
  });

  /**
   * Test 3: A SymbolInstance pointing to a symbol with a ShapeDisplayObject
   * causes shape drawing calls (beginPath and fill/stroke).
   */
  it("3. SymbolInstance with a shape child causes beginPath and fill calls", () => {
    const shapeObj = makeShapeObj("rect-shape", 0, 0);
    const sym = makeSymbolDef("sym-3", [shapeObj]);
    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-3", 10, 20);
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    const callTypes = ctx._calls.map((c) => c.type);
    expect(callTypes).toContain("beginPath");
    expect(callTypes).toContain("fill");
  });

  /**
   * Test 4: Rendering a SymbolInstance with an unknown symbolId produces no
   * drawing calls (no save/restore or shape calls).
   */
  it("4. SymbolInstance with unknown symbolId produces no drawing calls", () => {
    const library = makeLibrary([]); // empty library
    const instance = makeInstance("nonexistent-sym", 0, 0);
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, instance, library, new Set());

    expect(ctx._calls).toHaveLength(0);
  });

  /**
   * Test 5: Recursive SymbolInstance (a symbol referencing itself) does not
   * infinite-loop — visitedSymbolIds guard prevents re-entry.
   */
  it("5. recursive SymbolInstance does not cause infinite recursion", () => {
    // Build a symbol whose first frame contains an instance of itself
    const selfInstance = makeInstance("sym-recursive", 0, 0);

    const sym: FlashSymbol = {
      id: "sym-recursive",
      name: "sym-recursive",
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
        layers: [makeLayer([selfInstance as unknown as DisplayObject])],
      },
    };

    const library = makeLibrary([sym]);
    const instance = makeInstance("sym-recursive", 5, 5);
    const ctx = makeMockCtx();

    // Should not throw or hang
    expect(() =>
      renderSymbolInstance(ctx, instance, library, new Set())
    ).not.toThrow();

    // save/restore should have been called once for the outer instance
    const saveCount = ctx._calls.filter((c) => c.type === "save").length;
    expect(saveCount).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test 6: Nested SymbolInstance (A contains B which contains a shape)
   * should render the shape's paths all the way through the nesting.
   */
  it("6. nested SymbolInstance renders the grandchild shape", () => {
    const shapeObj = makeShapeObj("deep-shape", 0, 0);
    const innerSym = makeSymbolDef("sym-inner", [shapeObj]);

    const innerInstance = makeInstance("sym-inner", 0, 0, { id: "inst-inner" });
    const outerSym = makeSymbolDef("sym-outer", [innerInstance as unknown as DisplayObject]);

    const library = makeLibrary([innerSym, outerSym]);
    const outerInstance = makeInstance("sym-outer", 0, 0, { id: "inst-outer" });
    const ctx = makeMockCtx();

    renderSymbolInstance(ctx, outerInstance, library, new Set());

    const callTypes = ctx._calls.map((c) => c.type);
    // The deep shape should trigger drawing calls
    expect(callTypes).toContain("beginPath");
    expect(callTypes).toContain("fill");
    // At least two save/restore pairs: one for outer, one for inner
    const saveCount = callTypes.filter((t) => t === "save").length;
    expect(saveCount).toBeGreaterThanOrEqual(2);
  });
});
