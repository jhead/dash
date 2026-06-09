/**
 * Tests for AS2 for loop and while loop compilation.
 *
 * Verifies that for, while, do-while loops with break/continue compile to
 * valid AVM1 bytecode with the expected opcodes (ActionIf 0x9D, ActionJump 0x99).
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

const ACTION_IF   = 0x9d; // ActionIf — conditional branch
const ACTION_JUMP = 0x99; // ActionJump — unconditional branch

// ---------------------------------------------------------------------------
// for loop
// ---------------------------------------------------------------------------

describe("AS2 for loop compilation", () => {
  it("for (var i = 0; i < 10; i++) {} compiles without error", () => {
    expect(compilesOk("for (var i = 0; i < 10; i++) {}")).toBe(true);
  });

  it("for loop emits ActionIf (0x9d)", () => {
    const bytes = compileAS2("for (var i = 0; i < 10; i++) {}");
    expect(containsByte(bytes, ACTION_IF)).toBe(true);
  });

  it("for loop emits ActionJump (0x99)", () => {
    const bytes = compileAS2("for (var i = 0; i < 10; i++) {}");
    expect(containsByte(bytes, ACTION_JUMP)).toBe(true);
  });

  it("for loop variable name appears in bytecode", () => {
    const bytes = compileAS2("for (var i = 0; i < 10; i++) {}");
    expect(containsString(bytes, "i")).toBe(true);
  });

  it("for loop with body compiles without error", () => {
    expect(compilesOk(`
      for (var i = 0; i < 10; i++) {
        var x = i * 2;
      }
    `)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// while loop
// ---------------------------------------------------------------------------

describe("AS2 while loop compilation", () => {
  it("while (x > 0) { x--; } compiles without error", () => {
    expect(compilesOk("var x = 5; while (x > 0) { x--; }")).toBe(true);
  });

  it("while loop emits ActionIf (0x9d)", () => {
    const bytes = compileAS2("var x = 5; while (x > 0) { x--; }");
    expect(containsByte(bytes, ACTION_IF)).toBe(true);
  });

  it("while loop variable name appears in bytecode", () => {
    const bytes = compileAS2("var x = 5; while (x > 0) { x--; }");
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("while (true) {} compiles without error", () => {
    expect(compilesOk("while (true) { break; }")).toBe(true);
  });

  it("while (true) {} emits ActionJump (0x99) for back-edge", () => {
    const bytes = compileAS2("while (true) { break; }");
    expect(containsByte(bytes, ACTION_JUMP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// do-while loop
// ---------------------------------------------------------------------------

describe("AS2 do-while loop compilation", () => {
  it("do { x++; } while (x < 10) compiles without error", () => {
    expect(compilesOk("var x = 0; do { x++; } while (x < 10);")).toBe(true);
  });

  it("do-while loop emits ActionIf (0x9d)", () => {
    const bytes = compileAS2("var x = 0; do { x++; } while (x < 10);");
    expect(containsByte(bytes, ACTION_IF)).toBe(true);
  });

  it("do-while loop variable name appears in bytecode", () => {
    const bytes = compileAS2("var x = 0; do { x++; } while (x < 10);");
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("do-while loop body executes at least once — body content in bytecode", () => {
    const bytes = compileAS2("var result = 0; do { result++; } while (false);");
    expect(containsString(bytes, "result")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// for loop with break
// ---------------------------------------------------------------------------

describe("AS2 for loop with break", () => {
  it("for loop with break inside if compiles without error", () => {
    expect(compilesOk(`
      var arr = [];
      for (var i = 0; i < arr.length; i++) {
        if (i == 5) break;
      }
    `)).toBe(true);
  });

  it("for loop with break emits ActionIf (0x9d)", () => {
    const bytes = compileAS2(`
      var arr = [];
      for (var i = 0; i < arr.length; i++) {
        if (i == 5) break;
      }
    `);
    expect(containsByte(bytes, ACTION_IF)).toBe(true);
  });

  it("for loop with break emits ActionJump (0x99) for break and back-edge", () => {
    const bytes = compileAS2(`
      var arr = [];
      for (var i = 0; i < arr.length; i++) {
        if (i == 5) break;
      }
    `);
    expect(containsByte(bytes, ACTION_JUMP)).toBe(true);
  });

  it("for loop with break has 'arr' and 'i' in bytecode", () => {
    const bytes = compileAS2(`
      var arr = [];
      for (var i = 0; i < arr.length; i++) {
        if (i == 5) break;
      }
    `);
    expect(containsString(bytes, "arr")).toBe(true);
    expect(containsString(bytes, "i")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// for loop with continue
// ---------------------------------------------------------------------------

describe("AS2 for loop with continue", () => {
  it("for loop with continue inside if compiles without error", () => {
    expect(compilesOk(`
      for (var i = 0; i < 10; i++) {
        if (i == 3) continue;
      }
    `)).toBe(true);
  });

  it("for loop with continue emits ActionIf (0x9d)", () => {
    const bytes = compileAS2(`
      for (var i = 0; i < 10; i++) {
        if (i == 3) continue;
      }
    `);
    expect(containsByte(bytes, ACTION_IF)).toBe(true);
  });

  it("for loop with continue emits ActionJump (0x99)", () => {
    const bytes = compileAS2(`
      for (var i = 0; i < 10; i++) {
        if (i == 3) continue;
      }
    `);
    expect(containsByte(bytes, ACTION_JUMP)).toBe(true);
  });

  it("for loop with continue has loop variable in bytecode", () => {
    const bytes = compileAS2(`
      for (var i = 0; i < 10; i++) {
        if (i == 3) continue;
      }
    `);
    expect(containsString(bytes, "i")).toBe(true);
  });
});
