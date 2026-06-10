/**
 * Tests for AS2 type-casting functions and the `as` type-assertion operator.
 *
 * Verifies:
 *   - Number(x) compiles to ActionToNumber (0x30), NOT ActionCallFunction (0x3D)
 *     (Flash Professional emits the native opcode for single-arg coercions).
 *   - String(x), Boolean(x) compile to ActionCallFunction (0x3D) — still generic calls.
 *   - `x as Type` (compile-time type assertion) compiles without error and
 *     evaluates the operand, discarding the type annotation.
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
// AVM1 opcodes
// ---------------------------------------------------------------------------

const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — global function dispatch
const ACTION_CALL_METHOD   = 0x52; // ActionCallMethod   — method dispatch (obj.method())
const ACTION_TO_NUMBER     = 0x30; // ActionToNumber     — native numeric coercion

// ---------------------------------------------------------------------------
// Type casting global functions
// ---------------------------------------------------------------------------

describe("Type casting global functions", () => {
  it("1. Number(x) emits ActionToNumber (0x30), NOT ActionCallFunction (0x3D)", () => {
    // Flash Professional emits ActionToNumber for single-arg Number() coercions
    const bytes = compileAS2("Number(x);");
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("2. String(x) compiles to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("String(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "String")).toBe(true);
  });

  it("3. Boolean(x) compiles to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("Boolean(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "Boolean")).toBe(true);
  });

  it("4. Number(x) does NOT use ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Number(x);");
    // Native opcode path must never emit ActionCallMethod
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it("5. Number(\"42\") with a string literal compiles to ActionToNumber (0x30)", () => {
    const bytes = compileAS2('Number("42");');
    expect(containsByte(bytes, ACTION_TO_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
    expect(containsString(bytes, "42")).toBe(true);
  });

  it("5b. String(42) with a number literal compiles correctly", () => {
    const bytes = compileAS2("String(42);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "String")).toBe(true);
  });

  it("5c. Boolean(0) with a number literal compiles correctly", () => {
    const bytes = compileAS2("Boolean(0);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "Boolean")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `as` type-assertion operator (compile-time only — no runtime effect)
// ---------------------------------------------------------------------------

describe("as type assertion operator", () => {
  it("6. `x as Number` compiles without error", () => {
    expect(compilesOk("var n = x as Number;")).toBe(true);
  });

  it("6b. `x as String` compiles without error", () => {
    expect(compilesOk("var s = x as String;")).toBe(true);
  });

  it("6c. `x as MyClass` compiles without error", () => {
    expect(compilesOk("var obj = x as MyClass;")).toBe(true);
  });

  it("6d. `x as Number` does not emit ActionCallFunction — it is a no-op cast", () => {
    // The `as` operator simply evaluates x and discards the type; it must NOT
    // introduce a Number() function call.
    const bytes = compileAS2("x as Number;");
    // Should not contain a call to "Number" as a function
    // (the identifier "Number" appears as a string to be discarded, but no ActionCallFunction)
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("6e. `myObj as MovieClip` compiles without error in an expression context", () => {
    expect(compilesOk("var mc = myObj as MovieClip;")).toBe(true);
  });
});
