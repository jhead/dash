/**
 * Tests for AS2 do-while loop compilation.
 *
 * Verifies that do-while loops (including break, continue, and nesting)
 * compile to valid AVM1 bytecode with the expected jump opcodes.
 *
 * Relevant AVM1 opcodes:
 *   ActionJump  0x99  — unconditional branch (back-edge of do-while)
 *   ActionIf    0x9D  — conditional branch (loop condition check)
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
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_JUMP = 0x99; // ActionJump — unconditional branch
const ACTION_IF   = 0x9d; // ActionIf   — conditional branch

// ---------------------------------------------------------------------------
// Basic do-while
// ---------------------------------------------------------------------------

describe("AS2 do-while loop compilation", () => {
  it("do { trace(i); i++; } while (i < 10) compiles without error", () => {
    expect(
      compilesOk("var i = 0; do { trace(i); i++; } while (i < 10);")
    ).toBe(true);
  });

  it("do-while emits ActionIf (0x9d) for the loop-back conditional", () => {
    const bytes = compileAS2("var i = 0; do { trace(i); i++; } while (i < 10);");
    // The compiler uses ActionIf (0x9d) to branch back to loop start when test is truthy
    expect(containsByte(bytes, ACTION_IF)).toBe(true);
  });

  it("do { } while (false) compiles without error (empty body)", () => {
    expect(compilesOk("do { } while (false);")).toBe(true);
  });

  it("do { } while (false) contains a jump opcode", () => {
    const bytes = compileAS2("do { } while (false);");
    const hasJump = containsByte(bytes, ACTION_JUMP) || containsByte(bytes, ACTION_IF);
    expect(hasJump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// break inside do-while
// ---------------------------------------------------------------------------

describe("break inside do-while", () => {
  it("do { if (i > 5) break; i++; } while (true) compiles without error", () => {
    expect(
      compilesOk("var i = 0; do { if (i > 5) break; i++; } while (true);")
    ).toBe(true);
  });

  it("break inside do-while emits ActionJump (0x99)", () => {
    const bytes = compileAS2("var i = 0; do { if (i > 5) break; i++; } while (true);");
    expect(containsByte(bytes, ACTION_JUMP)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// continue inside do-while
// ---------------------------------------------------------------------------

describe("continue inside do-while", () => {
  it("do { if (i % 2 == 0) continue; trace(i); i++; } while (i < 10) compiles without error", () => {
    expect(
      compilesOk(
        "var i = 0; do { if (i % 2 == 0) continue; trace(i); i++; } while (i < 10);"
      )
    ).toBe(true);
  });

  it("continue inside do-while produces bytecode with a jump opcode", () => {
    const bytes = compileAS2(
      "var i = 0; do { if (i % 2 == 0) continue; trace(i); i++; } while (i < 10);"
    );
    const hasJump = containsByte(bytes, ACTION_JUMP) || containsByte(bytes, ACTION_IF);
    expect(hasJump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nested do-while
// ---------------------------------------------------------------------------

describe("nested do-while loops", () => {
  it("do { do { } while (false); } while (false) compiles without error", () => {
    expect(compilesOk("do { do { } while (false); } while (false);")).toBe(true);
  });

  it("nested do-while bytecode contains at least one jump opcode", () => {
    const bytes = compileAS2("do { do { } while (false); } while (false);");
    const hasJump = containsByte(bytes, ACTION_JUMP) || containsByte(bytes, ACTION_IF);
    expect(hasJump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Jump opcode presence (general)
// ---------------------------------------------------------------------------

describe("do-while bytecode structure", () => {
  it("bytecode contains at least one ActionJump (0x99) or ActionIf (0x9D)", () => {
    const bytes = compileAS2("var i = 0; do { i++; } while (i < 10);");
    const hasJump = containsByte(bytes, ACTION_JUMP) || containsByte(bytes, ACTION_IF);
    expect(hasJump).toBe(true);
  });
});
