/**
 * Tests for AS2 compiler getTimer() and random(n) native opcode emission.
 *
 * Flash Professional emits native opcodes instead of ActionCallFunction for
 * these built-in functions:
 *   getTimer()  → ActionGetTime       (0x34)
 *   random(n)   → ActionRandomNumber  (0x30)
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

const ACTION_GET_TIME       = 0x34; // ActionGetTime        — elapsed ms since SWF start
const ACTION_RANDOM_NUMBER  = 0x30; // ActionRandomNumber   — random(n) → 0..n-1
const ACTION_CALL_FUNCTION  = 0x3d; // ActionCallFunction   — generic call (should NOT appear)

// ---------------------------------------------------------------------------
// getTimer() — ActionGetTime (0x34)
// ---------------------------------------------------------------------------

describe("getTimer()", () => {
  it("getTimer() compiles without error", () => {
    expect(() => compileAS2("var t = getTimer();")).not.toThrow();
  });

  it("getTimer() emits ActionGetTime (0x34)", () => {
    const bytes = compileAS2("getTimer();");
    expect(containsByte(bytes, ACTION_GET_TIME)).toBe(true);
  });

  it("getTimer() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("getTimer();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("getTimer() does not push 'getTimer' as a string into the constant pool", () => {
    const bytes = compileAS2("getTimer();");
    expect(containsString(bytes, "getTimer")).toBe(false);
  });

  it("var t = getTimer() compiles and emits ActionGetTime (0x34)", () => {
    const bytes = compileAS2("var t = getTimer();");
    expect(containsByte(bytes, ACTION_GET_TIME)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("getTimer() with 1 arg falls through to ActionCallFunction (0x3D)", () => {
    // Only exactly 0 args is special-cased
    const bytes = compileAS2("getTimer(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_GET_TIME)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// random(n) — ActionRandomNumber (0x30)
// ---------------------------------------------------------------------------

describe("random(n)", () => {
  it("random(5) compiles without error", () => {
    expect(() => compileAS2("var r = random(5);")).not.toThrow();
  });

  it("random(5) emits ActionRandomNumber (0x30)", () => {
    const bytes = compileAS2("random(5);");
    expect(containsByte(bytes, ACTION_RANDOM_NUMBER)).toBe(true);
  });

  it("random(5) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("random(5);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("random(5) does not push 'random' as a string into the constant pool", () => {
    const bytes = compileAS2("random(5);");
    expect(containsString(bytes, "random")).toBe(false);
  });

  it("random(n) with variable argument emits ActionRandomNumber (0x30)", () => {
    const bytes = compileAS2("var r = random(n);");
    expect(containsByte(bytes, ACTION_RANDOM_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("random(a + b) with complex expression emits ActionRandomNumber (0x30)", () => {
    const bytes = compileAS2("var r = random(a + b);");
    expect(containsByte(bytes, ACTION_RANDOM_NUMBER)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("random() with no args falls through to ActionCallFunction (0x3D)", () => {
    // Only exactly 1 argument is special-cased
    const bytes = compileAS2("random();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_RANDOM_NUMBER)).toBe(false);
  });

  it("random(a, b) with 2 args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("random(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_RANDOM_NUMBER)).toBe(false);
  });
});
