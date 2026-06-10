/**
 * Tests for AS2 compiler chr(n) and ord(s) native opcode emission.
 *
 * Flash Professional emits native opcodes instead of ActionCallFunction for
 * these legacy built-in functions:
 *   chr(n)  → ActionChr  (0x33)
 *   ord(s)  → ActionOrd  (0x32)
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

const ACTION_CHR           = 0x33; // ActionChr          — code point to char string
const ACTION_ORD           = 0x32; // ActionOrd          — char string to code point
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — generic call (should NOT appear)

// ---------------------------------------------------------------------------
// chr(n) — ActionChr (0x33)
// ---------------------------------------------------------------------------

describe("chr(n)", () => {
  it("chr(65) compiles without error", () => {
    expect(() => compileAS2("var s = chr(65);")).not.toThrow();
  });

  it("chr(65) emits ActionChr (0x33)", () => {
    const bytes = compileAS2("chr(65);");
    expect(containsByte(bytes, ACTION_CHR)).toBe(true);
  });

  it("chr(65) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("chr(65);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("chr(65) does not push 'chr' as a string into the constant pool", () => {
    const bytes = compileAS2("chr(65);");
    expect(containsString(bytes, "chr")).toBe(false);
  });

  it("var s = chr(n) compiles and emits ActionChr (0x33)", () => {
    const bytes = compileAS2("var s = chr(n);");
    expect(containsByte(bytes, ACTION_CHR)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("chr(a + b) with complex expression emits ActionChr (0x33)", () => {
    const bytes = compileAS2("var s = chr(a + b);");
    expect(containsByte(bytes, ACTION_CHR)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("chr() with no args falls through to ActionCallFunction (0x3D)", () => {
    // Only exactly 1 argument is special-cased
    const bytes = compileAS2("chr();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_CHR)).toBe(false);
  });

  it("chr(a, b) with 2 args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("chr(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_CHR)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ord(s) — ActionOrd (0x32)
// ---------------------------------------------------------------------------

describe("ord(s)", () => {
  it('ord("A") compiles without error', () => {
    expect(() => compileAS2('var n = ord("A");')).not.toThrow();
  });

  it('ord("A") emits ActionOrd (0x32)', () => {
    const bytes = compileAS2('ord("A");');
    expect(containsByte(bytes, ACTION_ORD)).toBe(true);
  });

  it('ord("A") does NOT emit ActionCallFunction (0x3D)', () => {
    const bytes = compileAS2('ord("A");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it('ord("A") does not push \'ord\' as a string into the constant pool', () => {
    const bytes = compileAS2('ord("A");');
    expect(containsString(bytes, "ord")).toBe(false);
  });

  it("var n = ord(s) compiles and emits ActionOrd (0x32)", () => {
    const bytes = compileAS2("var n = ord(s);");
    expect(containsByte(bytes, ACTION_ORD)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("ord(str.charAt(0)) with complex expression emits ActionOrd (0x32)", () => {
    const bytes = compileAS2("var n = ord(str.charAt(0));");
    expect(containsByte(bytes, ACTION_ORD)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("ord() with no args falls through to ActionCallFunction (0x3D)", () => {
    // Only exactly 1 argument is special-cased
    const bytes = compileAS2("ord();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_ORD)).toBe(false);
  });

  it("ord(a, b) with 2 args falls through to ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("ord(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_ORD)).toBe(false);
  });
});
