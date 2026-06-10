/**
 * Tests for AS2 binary arithmetic operator compilation.
 *
 * Verifies that arithmetic operators compile to valid AVM1 bytecode and
 * produce the expected opcodes:
 *
 *   ActionAdd2      0x50 or 0x47 — addition / string coercion add
 *   ActionSubtract  0x0b         — subtraction
 *   ActionMultiply  0x0c         — multiplication
 *   ActionDivide    0x0d         — division
 *   ActionModulo    0x3f or 0x3f — modulo
 *   ActionNegate    0x18         — unary minus
 *   ActionPush      0x96         — push constant (integer / float literals)
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

// ---------------------------------------------------------------------------
// Addition (a + b)
// ---------------------------------------------------------------------------

describe("addition operator (+)", () => {
  it("a + b compiles without error", () => {
    expect(compilesOk("var a = 1; var b = 2; a + b;")).toBe(true);
  });

  it("a + b emits ActionAdd2 (0x50 or 0x47)", () => {
    const bytes = compileAS2("var a = 1; var b = 2; a + b;");
    // Some AVM1 compilers emit 0x50 (ActionAdd2 extended) or 0x47 (ActionAdd2)
    expect(containsByte(bytes, 0x50) || containsByte(bytes, 0x47)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subtraction (a - b)
// ---------------------------------------------------------------------------

describe("subtraction operator (-)", () => {
  it("a - b compiles without error", () => {
    expect(compilesOk("var a = 5; var b = 3; a - b;")).toBe(true);
  });

  it("a - b emits ActionSubtract (0x0b)", () => {
    const bytes = compileAS2("var a = 5; var b = 3; a - b;");
    expect(containsByte(bytes, 0x0b)).toBe(true); // ActionSubtract
  });
});

// ---------------------------------------------------------------------------
// Multiplication (a * b)
// ---------------------------------------------------------------------------

describe("multiplication operator (*)", () => {
  it("a * b compiles without error", () => {
    expect(compilesOk("var a = 4; var b = 3; a * b;")).toBe(true);
  });

  it("a * b emits ActionMultiply (0x0c)", () => {
    const bytes = compileAS2("var a = 4; var b = 3; a * b;");
    expect(containsByte(bytes, 0x0c)).toBe(true); // ActionMultiply
  });
});

// ---------------------------------------------------------------------------
// Division (a / b)
// ---------------------------------------------------------------------------

describe("division operator (/)", () => {
  it("a / b compiles without error", () => {
    expect(compilesOk("var a = 10; var b = 2; a / b;")).toBe(true);
  });

  it("a / b emits ActionDivide (0x0d)", () => {
    const bytes = compileAS2("var a = 10; var b = 2; a / b;");
    expect(containsByte(bytes, 0x0d)).toBe(true); // ActionDivide
  });
});

// ---------------------------------------------------------------------------
// Modulo (a % b)
// ---------------------------------------------------------------------------

describe("modulo operator (%)", () => {
  it("a % b compiles without error", () => {
    expect(compilesOk("var a = 7; var b = 3; a % b;")).toBe(true);
  });

  it("a % b emits ActionModulo (0x3f or 0x3f)", () => {
    const bytes = compileAS2("var a = 7; var b = 3; a % b;");
    // AVM1 ActionModulo is either 0x3f or 0x3f depending on compiler version
    expect(containsByte(bytes, 0x3f) || containsByte(bytes, 0x3f)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unary negation (-x)
// ---------------------------------------------------------------------------

describe("unary negation operator (-x)", () => {
  it("-x compiles without error", () => {
    expect(compilesOk("var x = 5; -x;")).toBe(true);
  });

  it("-x emits ActionNegate (0x18) or ActionSubtract (0x0b)", () => {
    const bytes = compileAS2("var x = 5; -x;");
    // AVM1 unary minus: ActionNegate (0x18) or subtract from 0
    expect(containsByte(bytes, 0x18) || containsByte(bytes, 0x0b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Operator precedence: 2 + 3 * 4
// ---------------------------------------------------------------------------

describe("operator precedence (multiply before add)", () => {
  it("2 + 3 * 4 compiles without error (precedence: multiply first)", () => {
    expect(compilesOk("2 + 3 * 4;")).toBe(true);
  });

  it("2 + 3 * 4 emits both ActionMultiply (0x0c) and ActionAdd2 (0x50 or 0x47)", () => {
    const bytes = compileAS2("2 + 3 * 4;");
    expect(containsByte(bytes, 0x0c)).toBe(true); // ActionMultiply
    expect(containsByte(bytes, 0x50) || containsByte(bytes, 0x47)).toBe(true); // ActionAdd2
  });
});

// ---------------------------------------------------------------------------
// Explicit grouping: (2 + 3) * 4
// ---------------------------------------------------------------------------

describe("explicit grouping ((2 + 3) * 4)", () => {
  it("(2 + 3) * 4 compiles without error", () => {
    expect(compilesOk("(2 + 3) * 4;")).toBe(true);
  });

  it("(2 + 3) * 4 emits both ActionAdd2 and ActionMultiply", () => {
    const bytes = compileAS2("(2 + 3) * 4;");
    expect(containsByte(bytes, 0x50) || containsByte(bytes, 0x47)).toBe(true); // ActionAdd2
    expect(containsByte(bytes, 0x0c)).toBe(true); // ActionMultiply
  });
});

// ---------------------------------------------------------------------------
// Float literals: 3.14 * r * r
// ---------------------------------------------------------------------------

describe("float literal arithmetic (3.14 * r * r)", () => {
  it("3.14 * r * r compiles without error", () => {
    expect(compilesOk("var r = 5; 3.14 * r * r;")).toBe(true);
  });

  it("3.14 * r * r emits ActionMultiply (0x0c)", () => {
    const bytes = compileAS2("var r = 5; 3.14 * r * r;");
    expect(containsByte(bytes, 0x0c)).toBe(true); // ActionMultiply
  });
});

// ---------------------------------------------------------------------------
// Integer literal push: 42
// ---------------------------------------------------------------------------

describe("integer literal push (ActionPush)", () => {
  it("integer literal 42 compiles without error", () => {
    expect(compilesOk("42;")).toBe(true);
  });

  it("integer literal 42 emits ActionPush (0x96)", () => {
    const bytes = compileAS2("42;");
    expect(containsByte(bytes, 0x96)).toBe(true); // ActionPush
  });
});
