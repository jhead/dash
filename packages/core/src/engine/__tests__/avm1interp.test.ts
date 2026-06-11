/**
 * AVM1 interpreter: basic expression evaluation via bytecode compilation.
 *
 * The Flash 8 AVM1 interpreter evaluates ActionScript 2 by compiling to a
 * stack-based bytecode stream.  These tests verify that the compiler emits
 * the correct AVM1 action codes for the fundamental expression forms so that
 * a downstream interpreter (or SWF runtime) can evaluate them correctly.
 *
 * Key AVM1 opcodes covered here:
 *   ActionPush          0x96 — push a typed constant onto the stack
 *   ActionGetVariable   0x1c — resolve a variable name to its value
 *   ActionSetVariable   0x1d — pop name + value, assign to variable
 *   ActionDefineLocal   0x3c — declare + initialise a local variable
 *   ActionDefineLocal2  0x41 — declare a local variable (undefined)
 *   ActionAdd2          0x47 — pop two values, push their sum
 *   ActionSubtract      0x0b — pop two values, push difference
 *   ActionMultiply      0x0c — pop two values, push product
 *   ActionDivide        0x0d — pop two values, push quotient
 *   ActionModulo        0x3f — pop two values, push remainder
 *   ActionNot           0x12 — pop value, push logical NOT
 *   ActionEquals2       0x49 — pop two values, push true if equal
 *   ActionLess2         0x48 — pop two values, push true if left < right
 *   ActionGreater       0x67 — pop two values, push true if left > right
 *   ActionIncrement     0x50 — pop value, push value + 1
 *   ActionDecrement     0x51 — pop value, push value - 1
 *   ActionPop           0x17 — discard top of stack
 *   ActionIf            0x9d — conditional branch
 *   ActionJump          0x99 — unconditional branch
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../../as2/compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile the given AS2 source and return the raw AVM1 byte array. */
function compile(source: string): Uint8Array {
  return compileAS2(source);
}

/** Return true if compilation succeeds without throwing. */
function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

/** Return true if the byte array contains the given byte value. */
function hasByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

/** Count how many times a specific byte appears in the array. */
function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
}

/**
 * Return true if the given null-terminated UTF-8 string appears inside an
 * ActionPush (0x96) payload anywhere in the byte stream.
 */
function hasString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    // String in AVM1 push payloads is null-terminated
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

/**
 * Extract all signed-32-bit integers stored inside ActionPush (0x96) records.
 * AVM1 integer push: 0x96 <length:UI16> 0x07 <value:SI32LE>
 * (SWF ActionPush type 7 = Integer/SI32)
 */
function extractPushedInts(bytes: Uint8Array): number[] {
  const result: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i < bytes.length) {
    const opcode = bytes[i];
    if (opcode === 0x96 && i + 2 < bytes.length) {
      const len = view.getUint16(i + 1, true);
      const payloadStart = i + 3;
      if (bytes[payloadStart] === 0x07 && payloadStart + 4 < bytes.length) {
        result.push(view.getInt32(payloadStart + 1, true));
      }
      i = payloadStart + len;
    } else if (opcode >= 0x80) {
      // All actions >= 0x80 have a 2-byte length field
      if (i + 2 < bytes.length) {
        const len = view.getUint16(i + 1, true);
        i += 3 + len;
      } else {
        break;
      }
    } else {
      i++;
    }
  }
  return result;
}

/**
 * Extract all 64-bit IEEE 754 doubles stored inside ActionPush (0x96) records.
 * AVM1 double push: 0x96 <length:UI16> 0x06 <value:F64LE>
 * (SWF ActionPush type 6 = Double/F64)
 */
function extractPushedDoubles(bytes: Uint8Array): number[] {
  const result: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i < bytes.length) {
    const opcode = bytes[i];
    if (opcode === 0x96 && i + 2 < bytes.length) {
      const len = view.getUint16(i + 1, true);
      const payloadStart = i + 3;
      if (bytes[payloadStart] === 0x06 && payloadStart + 8 < bytes.length) {
        result.push(view.getFloat64(payloadStart + 1, true));
      }
      i = payloadStart + len;
    } else if (opcode >= 0x80) {
      if (i + 2 < bytes.length) {
        const len = view.getUint16(i + 1, true);
        i += 3 + len;
      } else {
        break;
      }
    } else {
      i++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. ActionPush — numeric constant encoding
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: ActionPush numeric constants", () => {
  it("emits ActionPush (0x96) for any numeric literal", () => {
    expect(hasByte(compile("42;"), 0x96)).toBe(true);
  });

  it("encodes integer 42 as a signed 32-bit integer in the push payload", () => {
    const ints = extractPushedInts(compile("42;"));
    expect(ints).toContain(42);
  });

  it("encodes integer 0 in the push payload", () => {
    const ints = extractPushedInts(compile("0;"));
    expect(ints).toContain(0);
  });

  it("negation of a numeric literal folds into a direct negative push (no ActionSubtract)", () => {
    // Unary minus on a literal is folded at compile time: `-7` pushes -7 directly.
    const bytes = compile("-7;");
    const ints = extractPushedInts(bytes);
    expect(ints).toContain(-7);
    expect(hasByte(bytes, 0x0b)).toBe(false); // ActionSubtract not emitted
  });

  it("encodes floating-point 3.14 as a double in the push payload", () => {
    const doubles = extractPushedDoubles(compile("3.14;"));
    expect(doubles.some((d) => Math.abs(d - 3.14) < 1e-9)).toBe(true);
  });

  it("compiles a large integer beyond SI16 range without error", () => {
    expect(compilesOk("var n = 100000;")).toBe(true);
    const ints = extractPushedInts(compile("var n = 100000;"));
    expect(ints).toContain(100000);
  });
});

// ---------------------------------------------------------------------------
// 2. Variable declaration and ActionDefineLocal / ActionDefineLocal2
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: variable declaration", () => {
  it("var x = 5 emits ActionDefineLocal (0x3c)", () => {
    expect(hasByte(compile("var x = 5;"), 0x3c)).toBe(true);
  });

  it("var x = 5 pushes the variable name 'x' as a string before ActionDefineLocal", () => {
    expect(hasString(compile("var x = 5;"), "x")).toBe(true);
  });

  it("var x with no initialiser emits ActionDefineLocal2 (0x41)", () => {
    expect(hasByte(compile("var x;"), 0x41)).toBe(true);
  });

  it("var x = 5 pushes the integer value 5 into the bytecode", () => {
    const ints = extractPushedInts(compile("var x = 5;"));
    expect(ints).toContain(5);
  });

  it("multiple var declarations emit ActionDefineLocal (0x3c) for each initialised one", () => {
    const bytes = compile("var a = 1; var b = 2;");
    expect(countByte(bytes, 0x3c)).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Variable read — ActionGetVariable (0x1c)
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: variable reads (ActionGetVariable)", () => {
  it("reading a variable emits ActionGetVariable (0x1c)", () => {
    expect(hasByte(compile("var x = 1; x;"), 0x1c)).toBe(true);
  });

  it("the variable name appears as a pushed string before ActionGetVariable", () => {
    const bytes = compile("var myVar = 1; myVar;");
    expect(hasString(bytes, "myVar")).toBe(true);
    expect(hasByte(bytes, 0x1c)).toBe(true);
  });

  it("reading two different variables emits ActionGetVariable twice", () => {
    const bytes = compile("var a = 1; var b = 2; a; b;");
    expect(countByte(bytes, 0x1c)).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Arithmetic expressions
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: addition (ActionAdd2 0x47)", () => {
  it("a + b emits ActionAdd2 (0x47)", () => {
    expect(hasByte(compile("var a = 1; var b = 2; a + b;"), 0x47)).toBe(true);
  });

  it("1 + 2 compiles without error", () => {
    expect(compilesOk("1 + 2;")).toBe(true);
  });

  it("1 + 2 emits ActionPush for both operands", () => {
    // Two pushes for 1 and 2 means at least two 0x96 bytes
    expect(countByte(compile("1 + 2;"), 0x96)).toBeGreaterThanOrEqual(2);
  });
});

describe("AVM1 expression eval: subtraction (ActionSubtract 0x0b)", () => {
  it("a - b emits ActionSubtract (0x0b)", () => {
    expect(hasByte(compile("var a = 5; var b = 3; a - b;"), 0x0b)).toBe(true);
  });

  it("10 - 4 compiles without error", () => {
    expect(compilesOk("10 - 4;")).toBe(true);
  });
});

describe("AVM1 expression eval: multiplication (ActionMultiply 0x0c)", () => {
  it("a * b emits ActionMultiply (0x0c)", () => {
    expect(hasByte(compile("var a = 3; var b = 4; a * b;"), 0x0c)).toBe(true);
  });

  it("operator precedence: 2 + 3 * 4 emits both ActionMultiply and ActionAdd2", () => {
    const bytes = compile("2 + 3 * 4;");
    expect(hasByte(bytes, 0x0c)).toBe(true); // ActionMultiply
    expect(hasByte(bytes, 0x47)).toBe(true); // ActionAdd2
  });
});

describe("AVM1 expression eval: division (ActionDivide 0x0d)", () => {
  it("a / b emits ActionDivide (0x0d)", () => {
    expect(hasByte(compile("var a = 10; var b = 2; a / b;"), 0x0d)).toBe(true);
  });
});

describe("AVM1 expression eval: modulo (ActionModulo 0x3f)", () => {
  it("a % b emits ActionModulo (0x3f)", () => {
    expect(hasByte(compile("var a = 7; var b = 3; a % b;"), 0x3f)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Comparison expressions
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: equality (Equals2 0x49 / StrictEquals 0x66)", () => {
  it("a == b emits ActionEquals2 (0x49)", () => {
    expect(hasByte(compile("var a = 1; var b = 1; a == b;"), 0x49)).toBe(true);
  });

  it("a === b emits ActionStrictEquals (0x66)", () => {
    expect(hasByte(compile("var a = 1; var b = 1; a === b;"), 0x66)).toBe(true);
  });

  it("a != b emits ActionEquals2 (0x49) followed by ActionNot (0x12)", () => {
    const bytes = compile("var a = 1; var b = 2; a != b;");
    expect(hasByte(bytes, 0x49)).toBe(true);
    expect(hasByte(bytes, 0x12)).toBe(true);
  });
});

describe("AVM1 expression eval: less-than (ActionLess2 0x48)", () => {
  it("a < b emits ActionLess2 (0x48)", () => {
    expect(hasByte(compile("var a = 1; var b = 2; a < b;"), 0x48)).toBe(true);
  });
});

describe("AVM1 expression eval: greater-than (ActionGreater 0x67)", () => {
  it("a > b emits ActionGreater (0x67)", () => {
    expect(hasByte(compile("var a = 3; var b = 1; a > b;"), 0x67)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Logical NOT (ActionNot 0x12)
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: logical NOT (ActionNot 0x12)", () => {
  it("!x emits ActionNot (0x12)", () => {
    expect(hasByte(compile("var x = true; !x;"), 0x12)).toBe(true);
  });

  it("!!x emits ActionNot twice", () => {
    const bytes = compile("var x = true; !!x;");
    expect(countByte(bytes, 0x12)).toBeGreaterThanOrEqual(2);
  });

  it("!true emits ActionPush boolean type and ActionNot", () => {
    const bytes = compile("!true;");
    expect(hasByte(bytes, 0x96)).toBe(true); // ActionPush for boolean
    expect(hasByte(bytes, 0x12)).toBe(true); // ActionNot
  });
});

// ---------------------------------------------------------------------------
// 7. Increment / Decrement (ActionIncrement 0x50, ActionDecrement 0x51)
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: prefix increment (ActionIncrement 0x50)", () => {
  it("++x emits ActionIncrement (0x50)", () => {
    expect(hasByte(compile("var x = 0; ++x;"), 0x50)).toBe(true);
  });
});

describe("AVM1 expression eval: prefix decrement (ActionDecrement 0x51)", () => {
  it("--x emits ActionDecrement (0x51)", () => {
    expect(hasByte(compile("var x = 5; --x;"), 0x51)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Ternary expression — conditional branch opcodes
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: ternary expression (conditional bytecode)", () => {
  it("a ? b : c compiles without error", () => {
    expect(compilesOk("var a = 1; var b = 2; var c = 3; a ? b : c;")).toBe(true);
  });

  it("a ? b : c emits at least one ActionIf (0x9d) for the conditional branch", () => {
    const bytes = compile("var a = 1; var b = 2; var c = 3; a ? b : c;");
    expect(hasByte(bytes, 0x9d)).toBe(true);
  });

  it("a ? b : c emits ActionJump (0x99) to skip the alternate branch", () => {
    const bytes = compile("var a = 1; var b = 2; var c = 3; a ? b : c;");
    expect(hasByte(bytes, 0x99)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. String literal push encoding
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: string literal push", () => {
  it("\"hello\" emits ActionPush (0x96)", () => {
    expect(hasByte(compile('"hello";'), 0x96)).toBe(true);
  });

  it("the string value appears null-terminated in the bytecode", () => {
    expect(hasString(compile('"hello";'), "hello")).toBe(true);
  });

  it("var s = \"flash\" pushes both the name and the value as strings", () => {
    const bytes = compile('var s = "flash";');
    expect(hasString(bytes, "s")).toBe(true);
    expect(hasString(bytes, "flash")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Boolean push encoding
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: boolean literal push", () => {
  it("true compiles without error", () => {
    expect(compilesOk("true;")).toBe(true);
  });

  it("true emits ActionPush (0x96)", () => {
    expect(hasByte(compile("true;"), 0x96)).toBe(true);
  });

  it("false emits ActionPush (0x96)", () => {
    expect(hasByte(compile("false;"), 0x96)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Expression statement — ActionPop discards unused results
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: expression statements discard result (ActionPop 0x17)", () => {
  it("standalone expression x + y emits ActionPop (0x17) to discard the result", () => {
    expect(hasByte(compile("var x = 1; var y = 2; x + y;"), 0x17)).toBe(true);
  });

  it("multiple expression statements emit multiple ActionPop (0x17) bytes", () => {
    const bytes = compile("var x = 1; var y = 2; x + y; x - y;");
    expect(countByte(bytes, 0x17)).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 12. Short-circuit logical operators (&&, ||)
// ---------------------------------------------------------------------------

describe("AVM1 expression eval: short-circuit && (ActionIf for early exit)", () => {
  it("a && b compiles without error", () => {
    expect(compilesOk("var a = true; var b = false; a && b;")).toBe(true);
  });

  it("a && b emits ActionIf (0x9d) for the short-circuit branch", () => {
    const bytes = compile("var a = true; var b = false; a && b;");
    expect(hasByte(bytes, 0x9d)).toBe(true);
  });
});

describe("AVM1 expression eval: short-circuit || (ActionIf for early exit)", () => {
  it("a || b compiles without error", () => {
    expect(compilesOk("var a = false; var b = true; a || b;")).toBe(true);
  });

  it("a || b emits ActionIf (0x9d) for the short-circuit branch", () => {
    const bytes = compile("var a = false; var b = true; a || b;");
    expect(hasByte(bytes, 0x9d)).toBe(true);
  });
});
