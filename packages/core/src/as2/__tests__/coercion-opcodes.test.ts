/**
 * Tests for AS2 compiler int(x) and Number(x) native opcode emission.
 *
 * Flash Professional emits native opcodes instead of ActionCallFunction for
 * these coercions:
 *   int(x)    → ActionToInteger  (0x18)
 *   Number(x) → ActionToNumber   (0x30)
 *
 * Both must NOT fall through to ActionCallFunction (0x3D).
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

const ACTION_TO_INTEGER   = 0x18; // ActionToInteger — native int coercion
const ACTION_TO_NUMBER    = 0x30; // ActionToNumber  — native numeric coercion
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
// Number(x) — ActionToNumber (0x30)
// ---------------------------------------------------------------------------

describe("Number(x) coercion", () => {
  it("Number(x) compiles without error", () => {
    expect(() => compileAS2("var n = Number(x);")).not.toThrow();
  });

  it("Number(x) emits ActionToNumber (0x30)", () => {
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

  it("Number('42') compiles and emits ActionToNumber (0x30)", () => {
    const bytes = compileAS2("var n = Number('42');");
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("Number(a + b) with complex expression emits ActionToNumber (0x30)", () => {
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
