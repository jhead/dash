/**
 * Tests for AS2 compiler handling of Number formatting methods and related
 * global functions.
 *
 * Verifies that method calls on Number values and global number-related
 * function calls compile to the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (n.toFixed(2), n.toString(16), etc.)
 *   - ActionCallFunction (0x3D): global calls (parseInt, parseFloat, isNaN, isFinite)
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

const ACTION_CALL_METHOD   = 0x52; // ActionCallMethod   — method dispatch
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — global function call

// ---------------------------------------------------------------------------
// Number method calls
// ---------------------------------------------------------------------------

describe("Number method calls", () => {
  it("1. x.toFixed(2) compiles without error", () => {
    expect(compilesOk("var x = 3.14159; x.toFixed(2);")).toBe(true);
  });

  it("2. x.toFixed(2) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var x = 3.14159; x.toFixed(2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toFixed")).toBe(true);
  });

  it("3. x.toString(16) compiles without error", () => {
    expect(compilesOk("var x = 255; x.toString(16);")).toBe(true);
  });

  it("4. x.toString(16) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var x = 255; x.toString(16);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toString")).toBe(true);
  });

  it("5. x.toPrecision(4) compiles without error", () => {
    expect(compilesOk("var x = 3.14159; x.toPrecision(4);")).toBe(true);
  });

  it("6. x.toPrecision(4) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var x = 3.14159; x.toPrecision(4);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toPrecision")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Type conversion function call
// ---------------------------------------------------------------------------

describe("Type conversion: String(x)", () => {
  it("7. String(x) compiles without error", () => {
    expect(compilesOk("var x = 42; String(x);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global number utility functions
// ---------------------------------------------------------------------------

describe("Global number utility functions", () => {
  it("8. parseInt('42', 16) compiles without error", () => {
    expect(compilesOk('parseInt("42", 16);')).toBe(true);
  });

  it("9. parseInt('42', 16) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2('parseInt("42", 16);');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "parseInt")).toBe(true);
  });

  it("10. parseFloat('3.14') compiles without error", () => {
    expect(compilesOk('parseFloat("3.14");')).toBe(true);
  });

  it("11. parseFloat('3.14') emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2('parseFloat("3.14");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "parseFloat")).toBe(true);
  });

  it("12. isNaN(x) compiles without error", () => {
    expect(compilesOk("var x = 3.14159; isNaN(x);")).toBe(true);
  });

  it("13. isNaN(x) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("var x = 3.14159; isNaN(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "isNaN")).toBe(true);
  });

  it("14. isFinite(x) compiles without error", () => {
    expect(compilesOk("var x = 3.14159; isFinite(x);")).toBe(true);
  });

  it("15. isFinite(x) emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("var x = 3.14159; isFinite(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "isFinite")).toBe(true);
  });
});
