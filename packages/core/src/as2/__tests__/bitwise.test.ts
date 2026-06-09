/**
 * Tests for AS2 bitwise and shift operator compilation.
 *
 * Verifies that bitwise/shift operators compile to valid AVM1 bytecode
 * and produce the expected opcodes.
 *
 * Actual AVM1 opcodes used by the compiler:
 *   ActionBitAnd      0x60  — a & b
 *   ActionBitOr       0x61  — a | b
 *   ActionBitXor      0x62  — a ^ b
 *   ActionBitNot      ~a compiled as a ^ -1 (XOR with -1) → 0x62
 *   ActionBitLShift   0x69  — a << b
 *   ActionBitRShift   0x6A  — a >> b
 *   ActionBitURShift  0x6B  — a >>> b
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
// Bitwise AND  (a & b → ActionBitAnd 0x60)
// ---------------------------------------------------------------------------

describe("bitwise AND operator", () => {
  it("a & b compiles without error", () => {
    expect(compilesOk("a & b;")).toBe(true);
  });

  it("a & b emits ActionBitAnd (0x60)", () => {
    const bytes = compileAS2("a & b;");
    expect(containsByte(bytes, 0x60)).toBe(true);
  });

  it("operand names appear in bytecode", () => {
    const bytes = compileAS2("a & b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bitwise OR  (a | b → ActionBitOr 0x61)
// ---------------------------------------------------------------------------

describe("bitwise OR operator", () => {
  it("a | b compiles without error", () => {
    expect(compilesOk("a | b;")).toBe(true);
  });

  it("a | b emits ActionBitOr (0x61)", () => {
    const bytes = compileAS2("a | b;");
    expect(containsByte(bytes, 0x61)).toBe(true);
  });

  it("operand names appear in bytecode", () => {
    const bytes = compileAS2("a | b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bitwise XOR  (a ^ b → ActionBitXor 0x62)
// ---------------------------------------------------------------------------

describe("bitwise XOR operator", () => {
  it("a ^ b compiles without error", () => {
    expect(compilesOk("a ^ b;")).toBe(true);
  });

  it("a ^ b emits ActionBitXor (0x62)", () => {
    const bytes = compileAS2("a ^ b;");
    expect(containsByte(bytes, 0x62)).toBe(true);
  });

  it("operand names appear in bytecode", () => {
    const bytes = compileAS2("a ^ b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bitwise NOT  (~a → compiled as a ^ -1 using ActionBitXor 0x62)
// ---------------------------------------------------------------------------

describe("bitwise NOT operator", () => {
  it("~a compiles without error", () => {
    expect(compilesOk("~a;")).toBe(true);
  });

  it("~a emits ActionBitXor (0x62) — implemented as a ^ -1", () => {
    // AVM1 has no dedicated BitNot; the compiler emits a XOR -1 (0x62)
    const bytes = compileAS2("~a;");
    expect(containsByte(bytes, 0x62)).toBe(true);
  });

  it("operand name appears in bytecode for ~a", () => {
    const bytes = compileAS2("~a;");
    expect(containsString(bytes, "a")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Left shift  (a << b → ActionBitLShift 0x69)
// ---------------------------------------------------------------------------

describe("left shift operator", () => {
  it("a << b compiles without error", () => {
    expect(compilesOk("a << b;")).toBe(true);
  });

  it("a << b emits ActionBitLShift (0x69)", () => {
    const bytes = compileAS2("a << b;");
    expect(containsByte(bytes, 0x69)).toBe(true);
  });

  it("operand names appear in bytecode", () => {
    const bytes = compileAS2("a << b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signed right shift  (a >> b → ActionBitRShift 0x6A)
// ---------------------------------------------------------------------------

describe("signed right shift operator", () => {
  it("a >> b compiles without error", () => {
    expect(compilesOk("a >> b;")).toBe(true);
  });

  it("a >> b emits ActionBitRShift (0x6A)", () => {
    const bytes = compileAS2("a >> b;");
    expect(containsByte(bytes, 0x6a)).toBe(true);
  });

  it("operand names appear in bytecode", () => {
    const bytes = compileAS2("a >> b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unsigned right shift  (a >>> b → ActionBitURShift 0x6B)
// ---------------------------------------------------------------------------

describe("unsigned right shift operator", () => {
  it("a >>> b compiles without error", () => {
    expect(compilesOk("a >>> b;")).toBe(true);
  });

  it("a >>> b emits ActionBitURShift (0x6B)", () => {
    const bytes = compileAS2("a >>> b;");
    expect(containsByte(bytes, 0x6b)).toBe(true);
  });

  it("operand names appear in bytecode", () => {
    const bytes = compileAS2("a >>> b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Complex bitwise expression
// ---------------------------------------------------------------------------

describe("complex bitwise expression", () => {
  it("(x & 0xFF) | (y << 8) compiles without error", () => {
    expect(compilesOk("(x & 0xFF) | (y << 8);")).toBe(true);
  });

  it("(x & 0xFF) | (y << 8) emits ActionBitAnd (0x60)", () => {
    const bytes = compileAS2("(x & 0xFF) | (y << 8);");
    expect(containsByte(bytes, 0x60)).toBe(true);
  });

  it("(x & 0xFF) | (y << 8) emits ActionBitOr (0x61)", () => {
    const bytes = compileAS2("(x & 0xFF) | (y << 8);");
    expect(containsByte(bytes, 0x61)).toBe(true);
  });

  it("(x & 0xFF) | (y << 8) emits ActionBitLShift (0x69)", () => {
    const bytes = compileAS2("(x & 0xFF) | (y << 8);");
    expect(containsByte(bytes, 0x69)).toBe(true);
  });

  it("variable names x and y appear in bytecode", () => {
    const bytes = compileAS2("(x & 0xFF) | (y << 8);");
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });

  it("compound assignment with bitwise op compiles", () => {
    expect(compilesOk("var flags = 0; flags |= 0x01; flags &= 0xFF;")).toBe(true);
  });
});
