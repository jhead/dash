/**
 * Tests for AS2 unary operator compilation: !, ~, -, +, typeof, void.
 *
 * Verifies that unary operators compile to valid AVM1 bytecode and
 * produce the expected opcodes.
 *
 * Relevant AVM1 opcodes:
 *   ActionNot      0x12  — logical NOT (!)
 *   ActionBitXor   0x62  — bitwise NOT (~x compiled as x ^ -1)
 *   ActionNegate   0x18  — unary minus (-)
 *   ActionTypeOf   0x44  — typeof
 *   ActionPop      0x17  — pop (used to discard result in void)
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

function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Logical NOT (!)
// ---------------------------------------------------------------------------

describe("logical NOT operator (!)", () => {
  it("!x compiles without error", () => {
    expect(compilesOk("!x;")).toBe(true);
  });

  it("!x emits ActionNot (0x12)", () => {
    const bytes = compileAS2("!x;");
    expect(containsByte(bytes, 0x12)).toBe(true); // ActionNot
  });

  it("!!x emits ActionNot twice (0x12, 0x12)", () => {
    const bytes = compileAS2("!!x;");
    expect(countByte(bytes, 0x12)).toBeGreaterThanOrEqual(2);
  });

  it("!true compiles without error", () => {
    expect(compilesOk("!true;")).toBe(true);
  });

  it("!true emits ActionNot (0x12)", () => {
    const bytes = compileAS2("!true;");
    expect(containsByte(bytes, 0x12)).toBe(true); // ActionNot
  });
});

// ---------------------------------------------------------------------------
// Bitwise NOT (~) — compiled as x ^ -1 using ActionBitXor (0x62)
// ---------------------------------------------------------------------------

describe("bitwise NOT operator (~)", () => {
  it("~x compiles without error", () => {
    expect(compilesOk("~x;")).toBe(true);
  });

  it("~x emits ActionBitXor (0x62) — implemented as x ^ -1", () => {
    // AVM1 has no dedicated BitNot; the compiler emits XOR with -1
    const bytes = compileAS2("~x;");
    expect(containsByte(bytes, 0x62)).toBe(true); // ActionBitXor
  });
});

// ---------------------------------------------------------------------------
// Unary minus (-)
// ---------------------------------------------------------------------------

describe("unary minus operator (-)", () => {
  it("-x compiles without error", () => {
    expect(compilesOk("-x;")).toBe(true);
  });

  it("-x emits ActionNegate (0x18) or ActionSubtract (0x0b)", () => {
    const bytes = compileAS2("-x;");
    // AVM1 unary minus uses ActionNegate (0x18); some compilers use subtract from 0
    const hasNegate = containsByte(bytes, 0x18);
    const hasSubtract = containsByte(bytes, 0x0b);
    expect(hasNegate || hasSubtract).toBe(true);
  });

  it("-(5 + 3) compiles without error", () => {
    expect(compilesOk("-(5 + 3);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unary plus (+)
// ---------------------------------------------------------------------------

describe("unary plus operator (+)", () => {
  it("+x compiles without error", () => {
    expect(compilesOk("+x;")).toBe(true);
  });

  it("+x produces bytecode", () => {
    const bytes = compileAS2("+x;");
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('+"3" emits ActionToNumber (0x4A) to coerce to number', () => {
    const bytes = compileAS2('+"3";');
    expect(containsByte(bytes, 0x4a)).toBe(true); // ActionToNumber
  });

  it("+x emits ActionToNumber (0x4A) after evaluating operand", () => {
    const bytes = compileAS2("+x;");
    expect(containsByte(bytes, 0x4a)).toBe(true); // ActionToNumber
  });
});

// ---------------------------------------------------------------------------
// typeof operator
// ---------------------------------------------------------------------------

describe("typeof operator (unary)", () => {
  it("typeof x compiles without error", () => {
    expect(compilesOk("typeof x;")).toBe(true);
  });

  it("typeof x emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof x;");
    expect(containsByte(bytes, 0x44)).toBe(true); // ActionTypeOf
  });

  it('typeof "string" compiles without error', () => {
    expect(compilesOk('"hello"; typeof "hello";')).toBe(true);
  });

  it('typeof "string" emits ActionTypeOf (0x44)', () => {
    const bytes = compileAS2('"hello"; typeof "hello";');
    expect(containsByte(bytes, 0x44)).toBe(true); // ActionTypeOf
  });
});

// ---------------------------------------------------------------------------
// void operator
// ---------------------------------------------------------------------------

describe("void operator", () => {
  it("void 0 compiles without error", () => {
    expect(compilesOk("void 0;")).toBe(true);
  });

  it("void 0 emits ActionPop (0x17) to discard value", () => {
    const bytes = compileAS2("void 0;");
    expect(containsByte(bytes, 0x17)).toBe(true); // ActionPop
  });

  it("void fn() compiles without error", () => {
    expect(compilesOk("void fn();")).toBe(true);
  });

  it("void fn() emits ActionPop (0x17)", () => {
    const bytes = compileAS2("void fn();");
    expect(containsByte(bytes, 0x17)).toBe(true); // ActionPop
  });
});
