/**
 * Unit tests for the VideoDisplayObject canvas placeholder (task 0768).
 *
 * The authoring canvas cannot decode embedded video, so a VideoDisplayObject
 * renders as a dark placeholder rectangle with a "VIDEO" label, the library
 * item name, and the placement dimensions. We exercise the real CanvasRenderer
 * through render() with a recording mock context and assert the placeholder is
 * drawn.
 */

import { describe, it, expect } from "vitest";
import type { SceneGraph, VideoDisplayObject } from "../types.js";
import type { Library } from "../../model/types.js";
import { CanvasRenderer } from "../renderer.js";

interface DrawCall {
  type: string;
  args: unknown[];
}

function makeMockCtx() {
  const calls: DrawCall[] = [];
  const ctx = {
    save() { calls.push({ type: "save", args: [] }); },
    restore() { calls.push({ type: "restore", args: [] }); },
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
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ type: "fillRect", args: [x, y, w, h] });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ type: "strokeRect", args: [x, y, w, h] });
    },
    clearRect() {},
    clip() {},
    setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return null; },
    measureText() { return { width: 0 }; },
    fillText(text: string, x: number, y: number) {
      calls.push({ type: "fillText", args: [text, x, y] });
    },
    strokeText() {},
    drawImage() {},
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    canvas: { width: 550, height: 400 },
    _calls: calls,
  };
  return ctx as unknown as CanvasRenderingContext2D & { _calls: DrawCall[] };
}

function makeCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    getContext: (type: string) => (type === "2d" ? ctx : null),
    width: 550,
    height: 400,
  } as unknown as HTMLCanvasElement;
}

function makeSceneWithVideo(vdo: VideoDisplayObject): SceneGraph {
  return {
    layers: [
      { id: "layer1", type: "normal", objects: [vdo], visible: true, locked: false },
    ],
  };
}

const LIBRARY: Library = {
  items: [
    {
      id: "vid-1",
      name: "intro.flv",
      itemType: "video",
      dataUri: "",
      frameCount: 30,
      frameRate: 30,
      width: 320,
      height: 240,
    },
  ],
  folders: [],
};

describe("VideoDisplayObject placeholder rendering", () => {
  const vdo: VideoDisplayObject = {
    type: "video",
    id: "vdo-1",
    videoItemId: "vid-1",
    x: 40,
    y: 50,
    width: 320,
    height: 240,
  };

  it("draws a placeholder rectangle at the object's position", () => {
    const ctx = makeMockCtx();
    const renderer = new CanvasRenderer(makeCanvas(ctx));
    renderer.render(makeSceneWithVideo(vdo), { x: 0, y: 0, zoom: 1 }, LIBRARY);

    const rect = ctx._calls.find(
      (c) => c.type === "fillRect" && c.args[0] === 40 && c.args[1] === 50
    );
    expect(rect).toBeDefined();
    expect(rect!.args[2]).toBe(320);
    expect(rect!.args[3]).toBe(240);
  });

  it('draws the "VIDEO" label and the library item name', () => {
    const ctx = makeMockCtx();
    const renderer = new CanvasRenderer(makeCanvas(ctx));
    renderer.render(makeSceneWithVideo(vdo), { x: 0, y: 0, zoom: 1 }, LIBRARY);

    const texts = ctx._calls
      .filter((c) => c.type === "fillText")
      .map((c) => c.args[0]);
    expect(texts).toContain("VIDEO");
    expect(texts).toContain("intro.flv");
    expect(texts).toContain("320 × 240");
  });

  it("renders even when the library item is missing (no name label)", () => {
    const ctx = makeMockCtx();
    const renderer = new CanvasRenderer(makeCanvas(ctx));
    renderer.render(makeSceneWithVideo(vdo), { x: 0, y: 0, zoom: 1 }, {
      items: [],
      folders: [],
    });

    const texts = ctx._calls
      .filter((c) => c.type === "fillText")
      .map((c) => c.args[0]);
    expect(texts).toContain("VIDEO");
    // Still draws the placeholder box.
    expect(ctx._calls.some((c) => c.type === "fillRect")).toBe(true);
  });
});
