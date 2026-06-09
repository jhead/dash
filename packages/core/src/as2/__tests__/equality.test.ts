/**
 * Tests for AS2 equality operator compilation.
 *
 * Verifies that equality operators compile to valid AVM1 bytecode and
 * produce the expected opcodes.
 *
 * Actual AVM1 opcodes used by the compiler:
 *   ActionEquals2  0x66  — a == b (abstract equality) and a === b (strict equality)
 *   ActionNot      0x14  — logical not (used for != and !==)
 *
 * Note: The AS2 compiler maps both == and === to ActionEquals2 (0x66).
 * AVM1 has no separate strict-equality opcode in SWF6 mode; both equality
 * operators are lowered to the same bytecode instruction.
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
// Abstract equality  (a == b → ActionEquals2 0x66)
// ---------------------------------------------------------------------------

describe("abstract equality operator ==", () => {
  it("a == b compiles without error", () => {
    expect(compilesOk("a == b;")).toBe(true);
  });

  it("a == b emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("a == b;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });

  it("operand names appear in bytecode for a == b", () => {
    const bytes = compileAS2("a == b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Abstract inequality  (a != b → ActionEquals2 0x66 + ActionNot 0x14)
// ---------------------------------------------------------------------------

describe("abstract inequality operator !=", () => {
  it("a != b compiles without error", () => {
    expect(compilesOk("a != b;")).toBe(true);
  });

  it("a != b emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("a != b;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });

  it("a != b emits ActionNot (0x14) to negate result", () => {
    const bytes = compileAS2("a != b;");
    expect(containsByte(bytes, 0x14)).toBe(true);
  });

  it("operand names appear in bytecode for a != b", () => {
    const bytes = compileAS2("a != b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Strict equality  (a === b → ActionEquals2 0x66)
// ---------------------------------------------------------------------------

describe("strict equality operator ===", () => {
  it("a === b compiles without error", () => {
    expect(compilesOk("a === b;")).toBe(true);
  });

  it("a === b emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("a === b;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });

  it("operand names appear in bytecode for a === b", () => {
    const bytes = compileAS2("a === b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Strict inequality  (a !== b → ActionEquals2 0x66 + ActionNot 0x14)
// ---------------------------------------------------------------------------

describe("strict inequality operator !==", () => {
  it("a !== b compiles without error", () => {
    expect(compilesOk("a !== b;")).toBe(true);
  });

  it("a !== b emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("a !== b;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });

  it("a !== b emits ActionNot (0x14) to negate result", () => {
    const bytes = compileAS2("a !== b;");
    expect(containsByte(bytes, 0x14)).toBe(true);
  });

  it("operand names appear in bytecode for a !== b", () => {
    const bytes = compileAS2("a !== b;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// null == undefined  (abstract equality with null/undefined)
// ---------------------------------------------------------------------------

describe("null == undefined abstract equality", () => {
  it("null == undefined compiles without error", () => {
    expect(compilesOk("null == undefined;")).toBe(true);
  });

  it("null == undefined emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("null == undefined;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// null === undefined  (strict equality with null/undefined)
// ---------------------------------------------------------------------------

describe("null === undefined strict equality", () => {
  it("null === undefined compiles without error", () => {
    expect(compilesOk("null === undefined;")).toBe(true);
  });

  it("null === undefined emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("null === undefined;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 0 == false  (number vs boolean abstract equality)
// ---------------------------------------------------------------------------

describe("0 == false abstract equality", () => {
  it("0 == false compiles without error", () => {
    expect(compilesOk("0 == false;")).toBe(true);
  });

  it("0 == false emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("0 == false;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 0 === false  (number vs boolean strict equality)
// ---------------------------------------------------------------------------

describe("0 === false strict equality", () => {
  it("0 === false compiles without error", () => {
    expect(compilesOk("0 === false;")).toBe(true);
  });

  it("0 === false emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("0 === false;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// "" == false  (empty string vs boolean abstract equality)
// ---------------------------------------------------------------------------

describe('"" == false abstract equality', () => {
  it('"" == false compiles without error', () => {
    expect(compilesOk('"" == false;')).toBe(true);
  });

  it('"" == false emits ActionEquals2 (0x66)', () => {
    const bytes = compileAS2('"" == false;');
    expect(containsByte(bytes, 0x66)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// null == null  (null self-equality)
// ---------------------------------------------------------------------------

describe("null == null self-equality", () => {
  it("null == null compiles without error", () => {
    expect(compilesOk("null == null;")).toBe(true);
  });

  it("null == null emits ActionEquals2 (0x66)", () => {
    const bytes = compileAS2("null == null;");
    expect(containsByte(bytes, 0x66)).toBe(true);
  });
});
