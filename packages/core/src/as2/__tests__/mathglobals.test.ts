/**
 * Tests for AS2 Math class methods/properties and global functions.
 *
 * Verifies that Math method calls, Math property accesses, global function
 * calls, and the typeof operator compile without error and emit the correct
 * AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls  (Math.abs(x), etc.)
 *   - ActionGetMember  (0x4f): property reads (Math.PI, Math.E)
 *   - ActionCallFunction (0x3d): global function calls (parseInt, etc.)
 *   - ActionTypeOf (0x44): typeof operator
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
const ACTION_GET_MEMBER    = 0x4f; // ActionGetMember    — property read
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — global function call
const ACTION_TYPEOF        = 0x44; // ActionTypeOf       — typeof operator

// ---------------------------------------------------------------------------
// Math single-argument method calls
// ---------------------------------------------------------------------------

describe("Math single-argument methods compile", () => {
  it("Math.abs(-5) compiles without error", () => {
    expect(compilesOk("Math.abs(-5);")).toBe(true);
  });

  it("Math.abs(-5) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.abs(-5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "abs")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.ceil(1.5) compiles without error", () => {
    expect(compilesOk("Math.ceil(1.5);")).toBe(true);
  });

  it("Math.ceil(1.5) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.ceil(1.5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "ceil")).toBe(true);
  });

  it("Math.floor(1.5) compiles without error", () => {
    expect(compilesOk("Math.floor(1.5);")).toBe(true);
  });

  it("Math.floor(1.5) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.floor(1.5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "floor")).toBe(true);
  });

  it("Math.round(1.5) compiles without error", () => {
    expect(compilesOk("Math.round(1.5);")).toBe(true);
  });

  it("Math.round(1.5) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.round(1.5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "round")).toBe(true);
  });

  it("Math.sqrt(4) compiles without error", () => {
    expect(compilesOk("Math.sqrt(4);")).toBe(true);
  });

  it("Math.sqrt(4) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.sqrt(4);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sqrt")).toBe(true);
  });

  it("Math.sin(0) compiles without error", () => {
    expect(compilesOk("Math.sin(0);")).toBe(true);
  });

  it("Math.sin(0) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.sin(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sin")).toBe(true);
  });

  it("Math.cos(0) compiles without error", () => {
    expect(compilesOk("Math.cos(0);")).toBe(true);
  });

  it("Math.cos(0) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.cos(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "cos")).toBe(true);
  });

  it("Math.log(1) compiles without error", () => {
    expect(compilesOk("Math.log(1);")).toBe(true);
  });

  it("Math.log(1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.log(1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "log")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math two-argument method calls
// ---------------------------------------------------------------------------

describe("Math two-argument methods compile", () => {
  it("Math.pow(2, 3) compiles without error", () => {
    expect(compilesOk("Math.pow(2, 3);")).toBe(true);
  });

  it("Math.pow(2, 3) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.pow(2, 3);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "pow")).toBe(true);
  });

  it("Math.min(1, 2) compiles without error", () => {
    expect(compilesOk("Math.min(1, 2);")).toBe(true);
  });

  it("Math.min(1, 2) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.min(1, 2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "min")).toBe(true);
  });

  it("Math.max(1, 2) compiles without error", () => {
    expect(compilesOk("Math.max(1, 2);")).toBe(true);
  });

  it("Math.max(1, 2) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.max(1, 2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "max")).toBe(true);
  });

  it("Math.atan2(1, 1) compiles without error", () => {
    expect(compilesOk("Math.atan2(1, 1);")).toBe(true);
  });

  it("Math.atan2(1, 1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.atan2(1, 1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "atan2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math zero-argument methods
// ---------------------------------------------------------------------------

describe("Math zero-argument methods compile", () => {
  it("Math.random() compiles without error", () => {
    expect(compilesOk("Math.random();")).toBe(true);
  });

  it("Math.random() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.random();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "random")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math property reads (Math.PI, Math.E) — ActionGetMember (0x4f)
// ---------------------------------------------------------------------------

describe("Math property reads emit ActionGetMember (0x4f)", () => {
  it("Math.PI compiles without error", () => {
    expect(compilesOk("Math.PI;")).toBe(true);
  });

  it("Math.PI emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("Math.PI;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "PI")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.E compiles without error", () => {
    expect(compilesOk("Math.E;")).toBe(true);
  });

  it("Math.E emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("Math.E;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "E")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global function calls — ActionCallFunction (0x3d)
// ---------------------------------------------------------------------------

describe("Global function calls compile", () => {
  it('parseInt("10") compiles without error', () => {
    expect(compilesOk('parseInt("10");')).toBe(true);
  });

  it('parseInt("10") emits ActionCallFunction (0x3d)', () => {
    const bytes = compileAS2('parseInt("10");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "parseInt")).toBe(true);
  });

  it('parseFloat("3.14") compiles without error', () => {
    expect(compilesOk('parseFloat("3.14");')).toBe(true);
  });

  it('parseFloat("3.14") emits ActionCallFunction (0x3d)', () => {
    const bytes = compileAS2('parseFloat("3.14");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "parseFloat")).toBe(true);
  });

  it("isNaN(NaN) compiles without error", () => {
    expect(compilesOk("isNaN(NaN);")).toBe(true);
  });

  it("isNaN(NaN) emits ActionCallFunction (0x3d)", () => {
    const bytes = compileAS2("isNaN(NaN);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "isNaN")).toBe(true);
  });

  it("isFinite(1) compiles without error", () => {
    expect(compilesOk("isFinite(1);")).toBe(true);
  });

  it("isFinite(1) emits ActionCallFunction (0x3d)", () => {
    const bytes = compileAS2("isFinite(1);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "isFinite")).toBe(true);
  });

  it('Number("5") compiles without error', () => {
    expect(compilesOk('Number("5");')).toBe(true);
  });

  it("Boolean(0) compiles without error", () => {
    expect(compilesOk("Boolean(0);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// typeof operator — ActionTypeOf (0x44)
// ---------------------------------------------------------------------------

describe("typeof operator compiles", () => {
  it("typeof x compiles without error", () => {
    expect(compilesOk("typeof x;")).toBe(true);
  });

  it("typeof x emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof x;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("typeof x used in assignment compiles without error", () => {
    expect(compilesOk("var t = typeof x;")).toBe(true);
  });

  it("typeof x in assignment emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("var t = typeof x;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });
});
