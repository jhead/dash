/**
 * Tests for AS2 compiler substring(), length(), and newline built-ins.
 *
 * Flash Professional emits native opcodes / pushes for these built-ins:
 *   substring(s, start, length)  → ActionMBSubString (0x35)
 *   length(s)                    → ActionMBLength    (0x31)
 *   newline                      → ActionPush "\r"   (0x0D in the string bytes)
 *
 * All three must NOT fall through to ActionCallFunction (0x3D) or
 * ActionGetVariable (0x1C).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

/**
 * Returns true when the compiled bytes contain the NUL-terminated UTF-8
 * string `s` as part of an ActionPush payload.
 */
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

const ACTION_MB_LENGTH    = 0x31; // ActionMBLength    — multibyte string length
const ACTION_MB_SUBSTRING = 0x35; // ActionMBSubString — multibyte substring
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — generic call (should NOT appear)
const ACTION_GET_VARIABLE  = 0x1c; // ActionGetVariable — variable lookup (should NOT appear for newline)

// ---------------------------------------------------------------------------
// substring(s, start, length) — ActionMBSubString (0x35)
// ---------------------------------------------------------------------------

describe("substring(s, start, length)", () => {
  it('substring("hello", 1, 3) compiles without error', () => {
    expect(() => compileAS2('var s = substring("hello", 1, 3);')).not.toThrow();
  });

  it('substring("hello", 1, 3) emits ActionMBSubString (0x35)', () => {
    const bytes = compileAS2('substring("hello", 1, 3);');
    expect(containsByte(bytes, ACTION_MB_SUBSTRING)).toBe(true);
  });

  it('substring("hello", 1, 3) does NOT emit ActionCallFunction (0x3D)', () => {
    const bytes = compileAS2('substring("hello", 1, 3);');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it('"substring" is NOT in constant pool when used as a call', () => {
    const bytes = compileAS2('substring("hello", 1, 3);');
    expect(containsString(bytes, "substring")).toBe(false);
  });

  it("var s = substring(str, i, n) compiles and emits 0x35", () => {
    const bytes = compileAS2("var s = substring(str, i, n);");
    expect(containsByte(bytes, ACTION_MB_SUBSTRING)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("substring with variable args emits ActionMBSubString (0x35)", () => {
    const bytes = compileAS2("var s = substring(src, start, len);");
    expect(containsByte(bytes, ACTION_MB_SUBSTRING)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("substring() with wrong arg count falls through to ActionCallFunction", () => {
    // Only exactly 3 arguments are special-cased
    const bytes = compileAS2('substring("hello", 1);');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_MB_SUBSTRING)).toBe(false);
  });

  it("substring() with 0 args falls through to ActionCallFunction", () => {
    const bytes = compileAS2("substring();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_MB_SUBSTRING)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// length(s) — ActionMBLength (0x31)
// ---------------------------------------------------------------------------

describe("length(s)", () => {
  it('length("hello") compiles without error', () => {
    expect(() => compileAS2('var n = length("hello");')).not.toThrow();
  });

  it('length("hello") emits ActionMBLength (0x31)', () => {
    const bytes = compileAS2('length("hello");');
    expect(containsByte(bytes, ACTION_MB_LENGTH)).toBe(true);
  });

  it('length("hello") does NOT emit ActionCallFunction (0x3D)', () => {
    const bytes = compileAS2('length("hello");');
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it('"length" is NOT in constant pool when used as a call', () => {
    const bytes = compileAS2('length("hello");');
    expect(containsString(bytes, "length")).toBe(false);
  });

  it("var n = length(s) compiles and emits ActionMBLength (0x31)", () => {
    const bytes = compileAS2("var n = length(s);");
    expect(containsByte(bytes, ACTION_MB_LENGTH)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("length() with no args falls through to ActionCallFunction", () => {
    // Only exactly 1 argument is special-cased
    const bytes = compileAS2("length();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_MB_LENGTH)).toBe(false);
  });

  it("length(a, b) with 2 args falls through to ActionCallFunction", () => {
    const bytes = compileAS2("length(a, b);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsByte(bytes, ACTION_MB_LENGTH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// newline identifier — pushes "\r" (0x0D)
// ---------------------------------------------------------------------------

describe("newline identifier", () => {
  it("var x = newline compiles without error", () => {
    expect(() => compileAS2("var x = newline;")).not.toThrow();
  });

  it("var x = newline includes the \\r byte (0x0D) in the output", () => {
    const bytes = compileAS2("var x = newline;");
    // The ActionPush payload contains the string "\r" — its single byte is 0x0D
    expect(containsByte(bytes, 0x0d)).toBe(true);
  });

  it('"newline" is NOT in the constant pool (no GetVariable lookup)', () => {
    const bytes = compileAS2("var x = newline;");
    // "newline" as a NUL-terminated string should not appear in the bytes
    expect(containsString(bytes, "newline")).toBe(false);
  });

  it("newline in expression does NOT emit ActionGetVariable (0x1C) for it", () => {
    // A standalone `newline` should push "\r" directly — no variable lookup
    const bytes = compileAS2("var x = newline;");
    // The only GetVariable calls would be for variable lookups, not for newline.
    // We test indirectly: if "newline" string is absent, there is no GetVariable for it.
    expect(containsString(bytes, "newline")).toBe(false);
  });

  it("newline concatenation emits \\r byte", () => {
    const bytes = compileAS2('var s = "hello" + newline + "world";');
    expect(containsByte(bytes, 0x0d)).toBe(true);
    expect(containsString(bytes, "newline")).toBe(false);
  });
});
