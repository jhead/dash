/**
 * Tests for AS2 compiler: MovieClip drawing API —
 * beginFill, beginGradientFill, endFill, moveTo, lineTo, curveTo,
 * lineStyle, lineGradientStyle, clear.
 *
 * Verifies that all these instance method calls on a MovieClip reference
 * compile without error and emit ActionCallMethod (0x52).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch

// ---------------------------------------------------------------------------
// mc.beginFill(color, alpha)
// ---------------------------------------------------------------------------

describe("MovieClip beginFill()", () => {
  it("mc.beginFill(0xFF0000, 100) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.beginFill(0xFF0000, 100);")).toBe(true);
  });

  it("mc.beginFill(0xFF0000, 100) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.beginFill(0xFF0000, 100);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "beginFill")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.beginGradientFill(fillType, colors, alphas, ratios, matrix)
// ---------------------------------------------------------------------------

describe("MovieClip beginGradientFill()", () => {
  it("mc.beginGradientFill(...) compiles without error", () => {
    expect(
      compilesOk(
        'var mc = _root.mc;' +
        'var colors = [0xFF0000, 0x0000FF];' +
        'var alphas = [100, 100];' +
        'var ratios = [0, 255];' +
        'var matrix = {matrixType: "box", x: 0, y: 0, w: 100, h: 100, r: 0};' +
        'mc.beginGradientFill("linear", colors, alphas, ratios, matrix);'
      )
    ).toBe(true);
  });

  it("mc.beginGradientFill(...) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var mc = _root.mc;' +
      'var colors = [0xFF0000, 0x0000FF];' +
      'var alphas = [100, 100];' +
      'var ratios = [0, 255];' +
      'var matrix = {matrixType: "box", x: 0, y: 0, w: 100, h: 100, r: 0};' +
      'mc.beginGradientFill("linear", colors, alphas, ratios, matrix);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "beginGradientFill")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.endFill()
// ---------------------------------------------------------------------------

describe("MovieClip endFill()", () => {
  it("mc.endFill() compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.endFill();")).toBe(true);
  });

  it("mc.endFill() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.endFill();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "endFill")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.moveTo(x, y)
// ---------------------------------------------------------------------------

describe("MovieClip moveTo()", () => {
  it("mc.moveTo(10, 20) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.moveTo(10, 20);")).toBe(true);
  });

  it("mc.moveTo(10, 20) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.moveTo(10, 20);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "moveTo")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.lineTo(x, y)
// ---------------------------------------------------------------------------

describe("MovieClip lineTo()", () => {
  it("mc.lineTo(50, 60) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.lineTo(50, 60);")).toBe(true);
  });

  it("mc.lineTo(50, 60) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.lineTo(50, 60);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "lineTo")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.curveTo(controlX, controlY, anchorX, anchorY)
// ---------------------------------------------------------------------------

describe("MovieClip curveTo()", () => {
  it("mc.curveTo(25, 10, 50, 20) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.curveTo(25, 10, 50, 20);")).toBe(true);
  });

  it("mc.curveTo(25, 10, 50, 20) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.curveTo(25, 10, 50, 20);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "curveTo")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.lineStyle(thickness, color, alpha)
// ---------------------------------------------------------------------------

describe("MovieClip lineStyle()", () => {
  it("mc.lineStyle(2, 0x000000, 100) compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.lineStyle(2, 0x000000, 100);")).toBe(true);
  });

  it("mc.lineStyle(2, 0x000000, 100) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.lineStyle(2, 0x000000, 100);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "lineStyle")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.lineGradientStyle(fillType, colors, alphas, ratios, matrix)
// ---------------------------------------------------------------------------

describe("MovieClip lineGradientStyle()", () => {
  it("mc.lineGradientStyle(...) compiles without error", () => {
    expect(
      compilesOk(
        'var mc = _root.mc;' +
        'var colors = [0xFF0000, 0x0000FF];' +
        'var alphas = [100, 100];' +
        'var ratios = [0, 255];' +
        'var matrix = {matrixType: "box", x: 0, y: 0, w: 100, h: 100, r: 0};' +
        'mc.lineGradientStyle("linear", colors, alphas, ratios, matrix);'
      )
    ).toBe(true);
  });

  it("mc.lineGradientStyle(...) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      'var mc = _root.mc;' +
      'var colors = [0xFF0000, 0x0000FF];' +
      'var alphas = [100, 100];' +
      'var ratios = [0, 255];' +
      'var matrix = {matrixType: "box", x: 0, y: 0, w: 100, h: 100, r: 0};' +
      'mc.lineGradientStyle("linear", colors, alphas, ratios, matrix);'
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "lineGradientStyle")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mc.clear()
// ---------------------------------------------------------------------------

describe("MovieClip clear()", () => {
  it("mc.clear() compiles without error", () => {
    expect(compilesOk("var mc = _root.mc; mc.clear();")).toBe(true);
  });

  it("mc.clear() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var mc = _root.mc; mc.clear();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "clear")).toBe(true);
  });
});
