/**
 * Tests for AS2 compiler: Color object construction and method calls.
 *
 * Verifies that Color constructor calls and instance method calls compile
 * without error and emit the correct AVM1 opcodes:
 *   - ActionNew        (0x4a): constructor calls (new Color(target))
 *   - ActionCallMethod (0x52): method calls (c.setRGB(), c.getRGB(), etc.)
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

const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch

// ---------------------------------------------------------------------------
// Color constructor
// ---------------------------------------------------------------------------

describe("Color constructor", () => {
  it("new Color(target) compiles without error", () => {
    expect(compilesOk("new Color(target);")).toBe(true);
  });

  it("new Color(target) emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new Color(target);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Color")).toBe(true);
  });

  it("var c = new Color(target) compiles without error", () => {
    expect(compilesOk("var c = new Color(target);")).toBe(true);
  });

  it("var c = new Color(target) emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var c = new Color(target);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Color")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// c.setRGB()
// ---------------------------------------------------------------------------

describe("Color setRGB()", () => {
  it("c.setRGB(0xff0000) compiles without error", () => {
    expect(
      compilesOk("var c = new Color(target); c.setRGB(0xff0000);")
    ).toBe(true);
  });

  it("c.setRGB(0xff0000) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var c = new Color(target); c.setRGB(0xff0000);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setRGB")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// c.getRGB()
// ---------------------------------------------------------------------------

describe("Color getRGB()", () => {
  it("c.getRGB() compiles without error", () => {
    expect(
      compilesOk("var c = new Color(target); c.getRGB();")
    ).toBe(true);
  });

  it("c.getRGB() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var c = new Color(target); c.getRGB();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getRGB")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// c.setTransform()
// ---------------------------------------------------------------------------

describe("Color setTransform()", () => {
  it("c.setTransform({ra, rb, ga, gb, ba, bb, aa, ab}) compiles without error", () => {
    expect(
      compilesOk(
        "var c = new Color(target); c.setTransform({ra: 100, rb: 0, ga: 100, gb: 0, ba: 100, bb: 0, aa: 100, ab: 0});"
      )
    ).toBe(true);
  });

  it("c.setTransform({ra, rb, ga, gb, ba, bb, aa, ab}) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var c = new Color(target); c.setTransform({ra: 100, rb: 0, ga: 100, gb: 0, ba: 100, bb: 0, aa: 100, ab: 0});"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setTransform")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// c.getTransform()
// ---------------------------------------------------------------------------

describe("Color getTransform()", () => {
  it("c.getTransform() compiles without error", () => {
    expect(
      compilesOk("var c = new Color(target); c.getTransform();")
    ).toBe(true);
  });

  it("c.getTransform() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var c = new Color(target); c.getTransform();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getTransform")).toBe(true);
  });
});
