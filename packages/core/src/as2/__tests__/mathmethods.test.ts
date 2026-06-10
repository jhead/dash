/**
 * Tests for AS2 compiler: Math object methods and properties.
 *
 * Verifies that Math method calls and property accesses compile without error
 * and emit the correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (Math.abs(x), Math.floor(x), etc.)
 *   - ActionGetMember  (0x4e): property reads (Math.PI, Math.E)
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
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read

// ---------------------------------------------------------------------------
// Math single-argument methods
// ---------------------------------------------------------------------------

describe("Math single-argument methods", () => {
  it("Math.abs(x) compiles without error", () => {
    expect(compilesOk("Math.abs(x);")).toBe(true);
  });

  it("Math.abs(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.abs(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "abs")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.floor(x) compiles without error", () => {
    expect(compilesOk("Math.floor(x);")).toBe(true);
  });

  it("Math.floor(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.floor(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "floor")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.ceil(x) compiles without error", () => {
    expect(compilesOk("Math.ceil(x);")).toBe(true);
  });

  it("Math.ceil(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.ceil(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "ceil")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.round(x) compiles without error", () => {
    expect(compilesOk("Math.round(x);")).toBe(true);
  });

  it("Math.round(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.round(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "round")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.sqrt(x) compiles without error", () => {
    expect(compilesOk("Math.sqrt(x);")).toBe(true);
  });

  it("Math.sqrt(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.sqrt(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sqrt")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.sin(x) compiles without error", () => {
    expect(compilesOk("Math.sin(x);")).toBe(true);
  });

  it("Math.sin(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.sin(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sin")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.cos(x) compiles without error", () => {
    expect(compilesOk("Math.cos(x);")).toBe(true);
  });

  it("Math.cos(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.cos(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "cos")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.log(x) compiles without error", () => {
    expect(compilesOk("Math.log(x);")).toBe(true);
  });

  it("Math.log(x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.log(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "log")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math two-argument methods
// ---------------------------------------------------------------------------

describe("Math two-argument methods", () => {
  it("Math.pow(x, y) compiles without error", () => {
    expect(compilesOk("Math.pow(x, y);")).toBe(true);
  });

  it("Math.pow(x, y) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.pow(x, y);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "pow")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.min(a, b) compiles without error", () => {
    expect(compilesOk("Math.min(a, b);")).toBe(true);
  });

  it("Math.min(a, b) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.min(a, b);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "min")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.max(a, b) compiles without error", () => {
    expect(compilesOk("Math.max(a, b);")).toBe(true);
  });

  it("Math.max(a, b) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.max(a, b);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "max")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.atan2(y, x) compiles without error", () => {
    expect(compilesOk("Math.atan2(y, x);")).toBe(true);
  });

  it("Math.atan2(y, x) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.atan2(y, x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "atan2")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math zero-argument methods
// ---------------------------------------------------------------------------

describe("Math zero-argument methods", () => {
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
// Math properties (Math.PI, Math.E)
// ---------------------------------------------------------------------------

describe("Math properties", () => {
  it("Math.PI compiles without error", () => {
    expect(compilesOk("Math.PI;")).toBe(true);
  });

  it("Math.PI emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Math.PI;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "PI")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("Math.E compiles without error", () => {
    expect(compilesOk("Math.E;")).toBe(true);
  });

  it("Math.E emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2("Math.E;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "E")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined / compound expressions
// ---------------------------------------------------------------------------

describe("Combined Math expressions", () => {
  it("Math.sqrt(Math.pow(dx,2) + Math.pow(dy,2)) compiles without error", () => {
    expect(compilesOk("Math.sqrt(Math.pow(dx,2) + Math.pow(dy,2));")).toBe(true);
  });

  it("Math.sqrt(Math.pow(dx,2) + Math.pow(dy,2)) emits ActionCallMethod (0x52) multiple times", () => {
    const bytes = compileAS2("Math.sqrt(Math.pow(dx,2) + Math.pow(dy,2));");
    // sqrt + pow + pow = at least 3 calls to ActionCallMethod
    let count = 0;
    for (const b of bytes) if (b === ACTION_CALL_METHOD) count++;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(containsString(bytes, "sqrt")).toBe(true);
    expect(containsString(bytes, "pow")).toBe(true);
  });

  it("var r = Math.floor(Math.random() * 10) compiles without error", () => {
    expect(compilesOk("var r = Math.floor(Math.random() * 10);")).toBe(true);
  });

  it("Math.max(Math.abs(a), Math.abs(b)) compiles without error", () => {
    expect(compilesOk("Math.max(Math.abs(a), Math.abs(b));")).toBe(true);
  });
});
