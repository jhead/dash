/**
 * Tests for AS2 Number and Boolean class conversions.
 *
 * Verifies that Number(), Boolean(), String(), parseInt(), parseFloat(),
 * isNaN(), isFinite(), and Number.* static properties all compile to valid
 * AVM1 bytecode.
 *
 * Key opcodes:
 *   - ActionToNumber     (0x4A): Number(x) single-arg coercion (native opcode)
 *   - ActionCallFunction (0x3D): global function calls e.g. parseInt(…)
 *   - ActionGetMember    (0x4e): member access e.g. Number.MAX_VALUE
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

const ACTION_TO_NUMBER     = 0x4A; // ActionToNumber     — native numeric coercion
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — global function call
const ACTION_GET_MEMBER    = 0x4e; // ActionGetMember    — property / member read

// ---------------------------------------------------------------------------
// Number() conversion
// ---------------------------------------------------------------------------

describe("Number() conversion", () => {
  it("1. Number(x) compiles", () => {
    expect(compilesOk("var x; var n = Number(x);")).toBe(true);
  });

  it("2. Number(x) emits ActionToNumber (0x4A), not ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("var x; Number(x);");
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it('3. Number("123") compiles', () => {
    expect(compilesOk('var n = Number("123");')).toBe(true);
  });

  it('4. Number("123") emits ActionToNumber (0x4A), not ActionCallFunction (0x3D)', () => {
    const bytes = compileAS2('Number("123");');
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String() conversion
// ---------------------------------------------------------------------------

describe("String() conversion", () => {
  it("5. String(n) compiles", () => {
    expect(compilesOk("var n = 42; var s = String(n);")).toBe(true);
  });

  it("6. String(true) compiles", () => {
    expect(compilesOk("var s = String(true);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Boolean() conversion
// ---------------------------------------------------------------------------

describe("Boolean() conversion", () => {
  it("7. Boolean(0) compiles", () => {
    expect(compilesOk("var b = Boolean(0);")).toBe(true);
  });

  it("8. Boolean(null) compiles", () => {
    expect(compilesOk("var b = Boolean(null);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global utility functions
// ---------------------------------------------------------------------------

describe("Global utility functions", () => {
  it('9. parseInt("0xFF", 16) compiles', () => {
    expect(compilesOk('var n = parseInt("0xFF", 16);')).toBe(true);
  });

  it('10. parseFloat("3.14") compiles', () => {
    expect(compilesOk('var n = parseFloat("3.14");')).toBe(true);
  });

  it("11. isNaN(x) compiles", () => {
    expect(compilesOk("var x; var b = isNaN(x);")).toBe(true);
  });

  it("12. isFinite(x) compiles", () => {
    expect(compilesOk("var x; var b = isFinite(x);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Number static properties
// ---------------------------------------------------------------------------

describe("Number static properties", () => {
  it("13. Number.MAX_VALUE compiles", () => {
    expect(compilesOk("var n = Number.MAX_VALUE;")).toBe(true);
  });

  it("14. Number.MAX_VALUE emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("var n = Number.MAX_VALUE;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  it("15. Number.NaN compiles", () => {
    expect(compilesOk("var n = Number.NaN;")).toBe(true);
  });

  it("16. Number.POSITIVE_INFINITY compiles", () => {
    expect(compilesOk("var n = Number.POSITIVE_INFINITY;")).toBe(true);
  });

  it("17. Number.NEGATIVE_INFINITY compiles", () => {
    expect(compilesOk("var n = Number.NEGATIVE_INFINITY;")).toBe(true);
  });
});
