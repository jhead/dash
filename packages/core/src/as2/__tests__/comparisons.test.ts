/**
 * Tests for AS2 comparison operator compilation.
 *
 * Verifies that comparison operators compile to valid AVM1 bytecode and
 * produce the expected opcodes.
 *
 * Actual AVM1 opcodes emitted by the compiler:
 *   ActionLess2   0x48  — a < b  (note: 0x48 in SWF6 = ActionLess2)
 *   ActionGreater 0x67  — a > b
 *   ActionGreater 0x67  + ActionNot 0x12  — a <= b  (NOT greater-than)
 *   ActionLess2   0x48  + ActionNot 0x12  — a >= b  (NOT less-than)
 *   ActionNot     0x12  — logical not
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
// 1. Less-than  (a < b → ActionLess2 0x51)
// ---------------------------------------------------------------------------

describe("less-than operator (<)", () => {
  it("1. a < b compiles without error", () => {
    expect(compilesOk("a < b;")).toBe(true);
  });

  it("1. a < b emits ActionLess2 (0x48)", () => {
    const bytes = compileAS2("a < b;");
    expect(containsByte(bytes, 0x48)).toBe(true);
  });

  it("1. operand names appear in bytecode for a < b", () => {
    const bytes = compileAS2("a < b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Greater-than  (a > b → ActionGreater 0x67)
// ---------------------------------------------------------------------------

describe("greater-than operator (>)", () => {
  it("2. a > b compiles without error", () => {
    expect(compilesOk("a > b;")).toBe(true);
  });

  it("2. a > b emits ActionGreater (0x67)", () => {
    const bytes = compileAS2("a > b;");
    expect(containsByte(bytes, 0x67)).toBe(true);
  });

  it("2. operand names appear in bytecode for a > b", () => {
    const bytes = compileAS2("a > b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Less-than-or-equal  (a <= b → ActionGreater 0x67 + ActionNot 0x12)
// ---------------------------------------------------------------------------

describe("less-than-or-equal operator (<=)", () => {
  it("3. a <= b compiles without error", () => {
    expect(compilesOk("a <= b;")).toBe(true);
  });

  it("3. a <= b emits ActionGreater (0x67)", () => {
    const bytes = compileAS2("a <= b;");
    expect(containsByte(bytes, 0x67)).toBe(true);
  });

  it("3. a <= b emits ActionNot (0x12)", () => {
    const bytes = compileAS2("a <= b;");
    expect(containsByte(bytes, 0x12)).toBe(true);
  });

  it("3. operand names appear in bytecode for a <= b", () => {
    const bytes = compileAS2("a <= b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Greater-than-or-equal  (a >= b → ActionLess2 0x51 + ActionNot 0x12)
// ---------------------------------------------------------------------------

describe("greater-than-or-equal operator (>=)", () => {
  it("4. a >= b compiles without error", () => {
    expect(compilesOk("a >= b;")).toBe(true);
  });

  it("4. a >= b emits ActionLess2 (0x48)", () => {
    const bytes = compileAS2("a >= b;");
    expect(containsByte(bytes, 0x48)).toBe(true);
  });

  it("4. a >= b emits ActionNot (0x12)", () => {
    const bytes = compileAS2("a >= b;");
    expect(containsByte(bytes, 0x12)).toBe(true);
  });

  it("4. operand names appear in bytecode for a >= b", () => {
    const bytes = compileAS2("a >= b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. String literal comparison  ("a" < "b" → ActionLess2 0x51)
// ---------------------------------------------------------------------------

describe("string comparison", () => {
  it('5. "a" < "b" compiles without error', () => {
    expect(compilesOk('"a" < "b";')).toBe(true);
  });

  it('5. "a" < "b" emits ActionLess2 (0x48)', () => {
    const bytes = compileAS2('"a" < "b";');
    expect(containsByte(bytes, 0x48)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Numeric literal comparison  (0 < x → compiles)
// ---------------------------------------------------------------------------

describe("numeric literal comparison", () => {
  it("6. 0 < x compiles without error", () => {
    expect(compilesOk("0 < x;")).toBe(true);
  });

  it("6. 0 < x emits ActionLess2 (0x48)", () => {
    const bytes = compileAS2("0 < x;");
    expect(containsByte(bytes, 0x48)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Compound comparison with &&  (x > 0 && x < 10)
// ---------------------------------------------------------------------------

describe("compound comparison with &&", () => {
  it("7. x > 0 && x < 10 compiles without error", () => {
    expect(compilesOk("x > 0 && x < 10;")).toBe(true);
  });

  it("7. x > 0 && x < 10 emits ActionGreater (0x67)", () => {
    const bytes = compileAS2("x > 0 && x < 10;");
    expect(containsByte(bytes, 0x67)).toBe(true);
  });

  it("7. x > 0 && x < 10 emits ActionLess2 (0x48)", () => {
    const bytes = compileAS2("x > 0 && x < 10;");
    expect(containsByte(bytes, 0x48)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Compound comparison with ||  (x <= 0 || x >= 100)
// ---------------------------------------------------------------------------

describe("compound comparison with ||", () => {
  it("8. x <= 0 || x >= 100 compiles without error", () => {
    expect(compilesOk("x <= 0 || x >= 100;")).toBe(true);
  });

  it("8. x <= 0 || x >= 100 emits ActionGreater (0x67) for <=", () => {
    const bytes = compileAS2("x <= 0 || x >= 100;");
    expect(containsByte(bytes, 0x67)).toBe(true);
  });

  it("8. x <= 0 || x >= 100 emits ActionLess2 (0x48) for >=", () => {
    const bytes = compileAS2("x <= 0 || x >= 100;");
    expect(containsByte(bytes, 0x48)).toBe(true);
  });

  it("8. x <= 0 || x >= 100 emits ActionNot (0x12)", () => {
    const bytes = compileAS2("x <= 0 || x >= 100;");
    expect(containsByte(bytes, 0x12)).toBe(true);
  });
});
