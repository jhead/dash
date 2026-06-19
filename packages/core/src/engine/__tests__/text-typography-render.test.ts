/**
 * Task 1209 — stage-render tests for text typography controls:
 *   - tracking (letterSpacing): adds a per-glyph horizontal advance delta
 *   - baseline shift: raises/lowers the run vertically
 *   - orientation: horizontal vs vertical (left-to-right / right-to-left) glyph
 *     layout
 *
 * Drives the real CanvasRenderer with a recording mock 2D context so the actual
 * renderTextObject code path runs.
 */
import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../renderer.js";
import type {
  SceneGraph,
  TextDisplayObject,
  Viewport,
} from "../types.js";

interface FillTextCall {
  text: string;
  x: number;
  y: number;
}

function makeRecordingRenderer() {
  const fillTexts: FillTextCall[] = [];
  // A minimal recording 2D context. measureText returns a fixed per-char width
  // so the letter-spacing layout math is deterministic.
  const ctx = {
    save() {},
    restore() {},
    clearRect() {},
    scale() {},
    translate() {},
    fillText(text: string, x: number, y: number) {
      fillTexts.push({ text, x, y });
    },
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillStyle: "",
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "top" as CanvasTextBaseline,
    globalAlpha: 1,
    canvas: { width: 550, height: 400 },
  };
  const canvas = {
    width: 550,
    height: 400,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas);
  return { renderer, fillTexts };
}

const VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function makeText(overrides: Partial<TextDisplayObject>): TextDisplayObject {
  return {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 400,
    height: 100,
    text: "AB",
    textType: "static",
    fontFamily: "Arial",
    fontSize: 20,
    bold: false,
    italic: false,
    color: { r: 0, g: 0, b: 0, a: 255 },
    align: "left",
    multiline: false,
    wordWrap: false,
    ...overrides,
  };
}

function renderText(obj: TextDisplayObject): FillTextCall[] {
  const { renderer, fillTexts } = makeRecordingRenderer();
  const scene: SceneGraph = {
    layers: [
      { id: "l1", name: "L1", visible: true, locked: false, objects: [obj] },
    ],
  };
  renderer.render(scene, VIEWPORT);
  return fillTexts;
}

describe("text render — tracking (letterSpacing)", () => {
  it("letterSpacing 0: one fillText call for the whole line", () => {
    const calls = renderText(makeText({ text: "AB", letterSpacing: 0 }));
    expect(calls.length).toBe(1);
    expect(calls[0].text).toBe("AB");
  });

  it("non-zero letterSpacing: per-glyph fillText with spacing added to pen X", () => {
    const calls = renderText(makeText({ text: "AB", letterSpacing: 5, align: "left", x: 0 }));
    expect(calls.map((c) => c.text)).toEqual(["A", "B"]);
    // First glyph at x=0; second at glyphWidth(10) + letterSpacing(5) = 15.
    expect(calls[0].x).toBe(0);
    expect(calls[1].x).toBe(15);
  });

  it("negative letterSpacing tightens the per-glyph advance", () => {
    const calls = renderText(makeText({ text: "AB", letterSpacing: -3, x: 0 }));
    expect(calls[1].x).toBe(10 - 3); // glyphWidth 10 + (-3)
  });
});

describe("text render — baseline shift", () => {
  it("positive baseline shift raises the line (smaller y)", () => {
    const base = renderText(makeText({ text: "AB", baselineShift: 0, y: 50 }));
    const up = renderText(makeText({ text: "AB", baselineShift: 8, y: 50 }));
    expect(base[0].y - up[0].y).toBe(8);
  });

  it("negative baseline shift lowers the line (larger y)", () => {
    const base = renderText(makeText({ text: "AB", baselineShift: 0, y: 50 }));
    const down = renderText(makeText({ text: "AB", baselineShift: -6, y: 50 }));
    expect(down[0].y - base[0].y).toBe(6);
  });

  it("baseline shift applies in the per-glyph (letterSpacing) path too", () => {
    const base = renderText(makeText({ text: "AB", baselineShift: 0, letterSpacing: 4, y: 30 }));
    const up = renderText(makeText({ text: "AB", baselineShift: 10, letterSpacing: 4, y: 30 }));
    expect(base[0].y - up[0].y).toBe(10);
  });
});

describe("text render — orientation", () => {
  it("vertical-ltr: glyphs stack top-to-bottom (increasing y), one fillText each", () => {
    const calls = renderText(
      makeText({ text: "ABC", orientation: "vertical-ltr", fontSize: 20, x: 0 })
    );
    expect(calls.map((c) => c.text)).toEqual(["A", "B", "C"]);
    expect(calls[1].y).toBeGreaterThan(calls[0].y);
    expect(calls[2].y).toBeGreaterThan(calls[1].y);
    // All in the same column (same x).
    expect(calls[0].x).toBe(calls[1].x);
  });

  it("vertical-ltr vs vertical-rtl: first column starts on opposite sides", () => {
    const ltr = renderText(
      makeText({ text: "X", orientation: "vertical-ltr", x: 0, width: 100 })
    );
    const rtl = renderText(
      makeText({ text: "X", orientation: "vertical-rtl", x: 0, width: 100 })
    );
    // RTL starts near the right edge of the box; LTR near the left.
    expect(rtl[0].x).toBeGreaterThan(ltr[0].x);
  });

  it("vertical: letterSpacing widens the vertical step between glyphs", () => {
    const tight = renderText(
      makeText({ text: "AB", orientation: "vertical-ltr", fontSize: 20, letterSpacing: 0 })
    );
    const loose = renderText(
      makeText({ text: "AB", orientation: "vertical-ltr", fontSize: 20, letterSpacing: 5 })
    );
    const tightStep = tight[1].y - tight[0].y;
    const looseStep = loose[1].y - loose[0].y;
    expect(looseStep - tightStep).toBe(5);
  });
});
