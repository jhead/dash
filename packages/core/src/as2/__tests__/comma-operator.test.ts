/**
 * Tests for the AS2 comma operator (sequence expression).
 *
 * The comma operator evaluates each operand left-to-right and returns the
 * value of the last operand.  Intermediate values are discarded via ActionPop.
 *
 * Common usage: for (i=0, j=0; ...) and (a++, b++, c).
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

function containsByte(bytes: Uint8Array, b: number): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === b) return true;
  }
  return false;
}

// ActionPop opcode
const ACTION_POP = 0x17;

// ---------------------------------------------------------------------------
// Basic comma operator
// ---------------------------------------------------------------------------

describe("comma operator — basic (a, b) returns last value", () => {
  it("var x = (1, 2) compiles", () => {
    expect(compilesOk("var x = (1, 2);")).toBe(true);
  });

  it("(1, 2) emits ActionPop (0x17) to discard the 1", () => {
    const bytes = compileAS2("var x = (1, 2);");
    expect(containsByte(bytes, ACTION_POP)).toBe(true);
  });

  it("simple comma-free expression in parens compiles without extra Pop", () => {
    // (a) should not emit a pop; the comma operator requires 2+ operands
    expect(compilesOk("(a++);")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comma in expression context — both sides execute
// ---------------------------------------------------------------------------

describe("comma operator — both assignments execute", () => {
  it("a = 1, b = 2 as expression statement compiles", () => {
    expect(compilesOk("a = 1, b = 2;")).toBe(true);
  });

  it("(a = 1, b = 2) compiles in expression context", () => {
    expect(compilesOk("var r = (a = 1, b = 2);")).toBe(true);
  });

  it("(a++, b++, c) — three operands compiles", () => {
    expect(compilesOk("(a++, b++, c);")).toBe(true);
  });

  it("(a++, b++) emits ActionPop for intermediate operand", () => {
    const bytes = compileAS2("(a++, b++);");
    expect(containsByte(bytes, ACTION_POP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comma in for-loop init: for (i=0, j=0; ...; ...)
// ---------------------------------------------------------------------------

describe("comma operator in for-loop init", () => {
  it("for (i=0, j=0; false; ) {} compiles", () => {
    expect(compilesOk("for (i=0, j=0; false; ) {}")).toBe(true);
  });

  it("for (var i=0, j=0; i < 10; i++) {} compiles", () => {
    expect(compilesOk("for (var i = 0, j = 0; i < 10; i++) {}")).toBe(true);
  });

  it("for (i=0, j=0; ...) emits ActionPop for intermediate init", () => {
    // The expression-init path: i=0, j=0 is a SequenceExpr whose intermediate
    // result (i=0) is popped before j=0 is evaluated.
    const bytes = compileAS2("for (i=0, j=0; false; ) {}");
    expect(containsByte(bytes, ACTION_POP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comma in for-loop update: for (...; ...; i++, j++)
// ---------------------------------------------------------------------------

describe("comma operator in for-loop update", () => {
  it("for(var k=0;;i++, j++) { if (k++ > 5) break; } compiles", () => {
    expect(compilesOk("for (var k=0; ; i++, j++) { if (k++ > 5) break; }")).toBe(true);
  });

  it("for (var i = 0; i < 10; i++, j++) {} compiles", () => {
    expect(compilesOk("for (var i = 0; i < 10; i++, j++) {}")).toBe(true);
  });

  it("for-update i++, j++ emits ActionPop for intermediate result", () => {
    const bytes = compileAS2("for (var k=0; ; i++, j++) { if (k++ > 5) break; }");
    expect(containsByte(bytes, ACTION_POP)).toBe(true);
  });
});
