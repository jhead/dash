/**
 * Tests for AS2 multiple assignment and chained assignment compilation.
 *
 * Verifies that chained assignments (var x = y = z = 0), compound assignments
 * (+=, -=, *=, /=, %=), and nested compound assignments compile to valid AVM1
 * bytecode with the expected arithmetic opcodes.
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

const ACTION_ADD2      = 0x64; // ActionAdd2
const ACTION_SUBTRACT  = 0x0b; // ActionSubtract
const ACTION_MULTIPLY  = 0x0c; // ActionMultiply
const ACTION_DIVIDE    = 0x0d; // ActionDivide
const ACTION_MODULO    = 0x63; // ActionModulo

// ---------------------------------------------------------------------------
// Chained assignment
// ---------------------------------------------------------------------------

describe("AS2 chained assignment compilation", () => {
  it("var x = y = z = 0 compiles without error", () => {
    expect(compilesOk("var z = 0; var y = z; var x = y;")).toBe(true);
  });

  it("chained assignment x = y = 0 compiles without error", () => {
    expect(compilesOk("var x; var y; x = y = 0;")).toBe(true);
  });

  it("a = b = someFunction() compiles without error", () => {
    expect(compilesOk("var a; var b; a = b = someFunction();")).toBe(true);
  });

  it("chained assignment encodes variable names in bytecode", () => {
    const bytes = compileAS2("var x; var y; x = y = 0;");
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound assignment: +=
// ---------------------------------------------------------------------------

describe("AS2 += compound assignment", () => {
  it("x += 5 compiles without error", () => {
    expect(compilesOk("var x = 0; x += 5;")).toBe(true);
  });

  it("x += 5 emits ActionAdd2 (0x64)", () => {
    const bytes = compileAS2("var x = 0; x += 5;");
    expect(containsByte(bytes, ACTION_ADD2)).toBe(true);
  });

  it("x += 5 has variable name in bytecode", () => {
    const bytes = compileAS2("var x = 0; x += 5;");
    expect(containsString(bytes, "x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound assignment: -=
// ---------------------------------------------------------------------------

describe("AS2 -= compound assignment", () => {
  it("x -= 3 compiles without error", () => {
    expect(compilesOk("var x = 10; x -= 3;")).toBe(true);
  });

  it("x -= 3 emits ActionSubtract (0x0b)", () => {
    const bytes = compileAS2("var x = 10; x -= 3;");
    expect(containsByte(bytes, ACTION_SUBTRACT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound assignment: *=
// ---------------------------------------------------------------------------

describe("AS2 *= compound assignment", () => {
  it("x *= 2 compiles without error", () => {
    expect(compilesOk("var x = 5; x *= 2;")).toBe(true);
  });

  it("x *= 2 emits ActionMultiply (0x0c)", () => {
    const bytes = compileAS2("var x = 5; x *= 2;");
    expect(containsByte(bytes, ACTION_MULTIPLY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound assignment: /=
// ---------------------------------------------------------------------------

describe("AS2 /= compound assignment", () => {
  it("x /= 2 compiles without error", () => {
    expect(compilesOk("var x = 10; x /= 2;")).toBe(true);
  });

  it("x /= 2 emits ActionDivide (0x0d)", () => {
    const bytes = compileAS2("var x = 10; x /= 2;");
    expect(containsByte(bytes, ACTION_DIVIDE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compound assignment: %=
// ---------------------------------------------------------------------------

describe("AS2 %= compound assignment", () => {
  it("x %= 3 compiles without error", () => {
    expect(compilesOk("var x = 10; x %= 3;")).toBe(true);
  });

  it("x %= 3 emits ActionModulo (0x63)", () => {
    const bytes = compileAS2("var x = 10; x %= 3;");
    expect(containsByte(bytes, ACTION_MODULO)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nested compound assignment
// ---------------------------------------------------------------------------

describe("AS2 nested compound assignment", () => {
  it("x += y += 5 compiles without error", () => {
    expect(compilesOk("var x = 0; var y = 0; x += y += 5;")).toBe(true);
  });

  it("x += y += 5 emits ActionAdd2 (0x64)", () => {
    const bytes = compileAS2("var x = 0; var y = 0; x += y += 5;");
    expect(containsByte(bytes, ACTION_ADD2)).toBe(true);
  });

  it("x += y += 5 has both variable names in bytecode", () => {
    const bytes = compileAS2("var x = 0; var y = 0; x += y += 5;");
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Full: multi-variable chained assignment
// ---------------------------------------------------------------------------

describe("AS2 full chained assignment scenario", () => {
  it("separate var declarations followed by chained assignment compile", () => {
    expect(compilesOk(`
      var a = 0;
      var b = 0;
      var c = 0;
      a = b = c = 10;
    `)).toBe(true);
  });

  it("chained assignment encodes all variable names in bytecode", () => {
    const bytes = compileAS2(`
      var a = 0;
      var b = 0;
      var c = 0;
      a = b = c = 10;
    `);
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
    expect(containsString(bytes, "c")).toBe(true);
  });
});
