/**
 * Tests for AS2 compiler int(x), Number(x), and Boolean(x) native opcode emission.
 *
 * Flash Professional emits native opcodes instead of ActionCallFunction for
 * these coercions:
 *   int(x)     → ActionToInteger  (0x18)
 *   Number(x)  → ActionToNumber   (0x4A)
 *   Boolean(x) → ActionNot (0x12) × 2  (AVM1 has no ActionToBoolean; !!x is equivalent)
 *
 * All must NOT fall through to ActionCallFunction (0x3D).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_TO_INTEGER    = 0x18; // ActionToInteger — native int coercion
const ACTION_TO_NUMBER     = 0x4A; // ActionToNumber  — native numeric coercion
const ACTION_NOT           = 0x12; // ActionNot       — boolean negate (used twice for Boolean())
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — generic call (should NOT appear)

// ---------------------------------------------------------------------------
// int(x) — ActionToInteger (0x18)
// ---------------------------------------------------------------------------

describe("int(x) coercion", () => {
  it("int(x) compiles without error", () => {
    expect(() => compileAS2("var n = int(x);")).not.toThrow();
  });

  it("int(x) emits ActionToInteger (0x18)", () => {
    const bytes = compileAS2("int(x);");
    expect(containsByte(bytes, ACTION_TO_INTEGER)).toBe(true);
  });

  it("int(x) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("int(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("int(x) does not push 'int' as a string into the constant pool", () => {
    const bytes = compileAS2("int(x);");
    expect(containsString(bytes, "int")).toBe(false);
  });

  it("int(3.7) compiles and emits ActionToInteger (0x18)", () => {
    const bytes = compileAS2("var n = int(3.7);");
    expect(containsByte(bytes, ACTION_TO_INTEGER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("int(expr) with a complex expression emits ActionToInteger (0x18)", () => {
    const bytes = compileAS2("var n = int(a + b);");
    expect(containsByte(bytes, ACTION_TO_INTEGER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("int() with no args falls through to ActionCallFunction (0x3D)", () => {
    // Without exactly 1 argument, falls back to generic call path
    const bytes = compileAS2("int();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_TO_INTEGER)).toBe(false);
  });

  it("int(a, b) with 2 args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("int(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_TO_INTEGER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Number(x) — ActionToNumber (0x4A)
// ---------------------------------------------------------------------------

describe("Number(x) coercion", () => {
  it("Number(x) compiles without error", () => {
    expect(() => compileAS2("var n = Number(x);")).not.toThrow();
  });

  it("Number(x) emits ActionToNumber (0x4A)", () => {
    const bytes = compileAS2("Number(x);");
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
  });

  it("Number(x) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("Number(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Number(x) does not push 'Number' as a function-call string", () => {
    // 'Number' may still appear as part of other constructs (e.g. Number.MAX_VALUE),
    // but a standalone Number(x) call should not push it as a call target
    const bytes = compileAS2("Number(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Number('42') compiles and emits ActionToNumber (0x4A)", () => {
    const bytes = compileAS2("var n = Number('42');");
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Number(a + b) with complex expression emits ActionToNumber (0x4A)", () => {
    const bytes = compileAS2("var n = Number(a + b);");
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Number() with no args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("Number();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(false);
  });

  it("Number(a, b) with 2 args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("Number(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boolean(x) — double-not (ActionNot 0x12 × 2)
// AVM1 has no ActionToBoolean opcode; !!x achieves the same semantics.
// ---------------------------------------------------------------------------

describe("Boolean(x) coercion", () => {
  it("Boolean(x) compiles without error", () => {
    expect(() => compileAS2("var b = Boolean(x);")).not.toThrow();
  });

  it("Boolean(x) emits ActionNot (0x12)", () => {
    const bytes = compileAS2("Boolean(x);");
    expect(containsByte(bytes, ACTION_NOT)).toBe(true);
  });

  it("Boolean(x) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("Boolean(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Boolean(x) does not push 'Boolean' as a string into the constant pool", () => {
    const bytes = compileAS2("Boolean(x);");
    expect(containsString(bytes, "Boolean")).toBe(false);
  });

  it("Boolean(x) emits exactly two consecutive ActionNot (0x12) bytes", () => {
    // The double-not pattern must appear: 0x12 0x12
    const bytes = compileAS2("Boolean(x);");
    let found = false;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === ACTION_NOT && bytes[i + 1] === ACTION_NOT) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("Boolean(0) with a falsy literal emits double-not, NOT ActionCallFunction", () => {
    const bytes = compileAS2("var b = Boolean(0);");
    expect(containsByte(bytes, ACTION_NOT)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Boolean(true) with a boolean literal emits double-not, NOT ActionCallFunction", () => {
    const bytes = compileAS2("var b = Boolean(true);");
    expect(containsByte(bytes, ACTION_NOT)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Boolean(a + b) with a complex expression emits ActionNot (0x12)", () => {
    const bytes = compileAS2("var b = Boolean(a + b);");
    expect(containsByte(bytes, ACTION_NOT)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Boolean() with no args falls through to ActionCallFunction (0x3D)", () => {
    // Without exactly 1 argument, falls back to generic call path
    const bytes = compileAS2("Boolean();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
  });

  it("Boolean(a, b) with 2 args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("Boolean(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
  });
});
