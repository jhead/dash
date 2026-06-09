import { describe, it, expect, vi } from "vitest";
import { initCanvas } from "../renderer.js";

describe("initCanvas — HiDPI canvas scaling", () => {
  function makeCanvas() {
    return { width: 0, height: 0 };
  }

  function makeCtx() {
    return { scale: vi.fn() };
  }

  it("dpr=1: sets canvas dimensions to logical size and calls scale(1,1)", () => {
    const canvas = makeCanvas();
    const ctx = makeCtx();
    initCanvas(canvas, ctx, 550, 400, 1);
    expect(canvas.width).toBe(550);
    expect(canvas.height).toBe(400);
    expect(ctx.scale).toHaveBeenCalledOnce();
    expect(ctx.scale).toHaveBeenCalledWith(1, 1);
  });

  it("dpr=2: doubles backing-store dimensions and calls scale(2,2)", () => {
    const canvas = makeCanvas();
    const ctx = makeCtx();
    initCanvas(canvas, ctx, 550, 400, 2);
    expect(canvas.width).toBe(1100);
    expect(canvas.height).toBe(800);
    expect(ctx.scale).toHaveBeenCalledOnce();
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it("dpr=3: triples backing-store dimensions", () => {
    const canvas = makeCanvas();
    const ctx = makeCtx();
    initCanvas(canvas, ctx, 300, 200, 3);
    expect(canvas.width).toBe(900);
    expect(canvas.height).toBe(600);
    expect(ctx.scale).toHaveBeenCalledWith(3, 3);
  });
});
