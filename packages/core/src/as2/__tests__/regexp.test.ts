/**
 * Tests for AS2 parser + compiler: RegExp literal support.
 *
 * Verifies that /pattern/flags regex literals are parsed and compiled
 * to ActionNew (0x4a) calls on the "RegExp" constructor.
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

const ACTION_NEW = 0x4a; // ActionNew — used for RegExp construction

// ---------------------------------------------------------------------------
// Basic regex literals
// ---------------------------------------------------------------------------

describe("RegExp literal parsing", () => {
  it("1. /hello/ compiles without error", () => {
    expect(compilesOk("/hello/;")).toBe(true);
  });

  it("2. /hello/i (with flags) compiles without error", () => {
    expect(compilesOk("/hello/i;")).toBe(true);
  });

  it("3. /hello/ emits ActionNew (0x4a) for RegExp construction", () => {
    const bytes = compileAS2("/hello/;");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });

  it('4. "RegExp" string appears in bytecode for /hello/', () => {
    const bytes = compileAS2("/hello/;");
    expect(containsString(bytes, "RegExp")).toBe(true);
  });

  it("5. Pattern string appears in bytecode for /hello/", () => {
    const bytes = compileAS2("/hello/;");
    expect(containsString(bytes, "hello")).toBe(true);
  });

  it("6. Flags string appears in bytecode for /hello/gi", () => {
    const bytes = compileAS2("/hello/gi;");
    expect(containsString(bytes, "gi")).toBe(true);
  });

  it("7. /^[a-z]+$/g (complex pattern) compiles without error", () => {
    expect(compilesOk("/^[a-z]+$/g;")).toBe(true);
  });

  it("8. /^[a-z]+$/g emits ActionNew (0x4a) and includes pattern and flags", () => {
    const bytes = compileAS2("/^[a-z]+$/g;");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "RegExp")).toBe(true);
    expect(containsString(bytes, "g")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RegExp used in variable declarations and method calls
// ---------------------------------------------------------------------------

describe("RegExp in expressions", () => {
  it("9. var re = /foo/; compiles without error", () => {
    expect(compilesOk("var re = /foo/;")).toBe(true);
  });

  it("10. var re = /foo/; re.test(str) compiles without error", () => {
    expect(compilesOk("var re = /foo/; re.test(str);")).toBe(true);
  });

  it("11. str.match(/pattern/) compiles without error", () => {
    expect(compilesOk('str.match(/pattern/);')).toBe(true);
  });

  it("12. str.replace(/foo/g, 'bar') compiles without error", () => {
    expect(compilesOk("str.replace(/foo/g, 'bar');")).toBe(true);
  });

  it("13. /foo/.test(str) compiles without error", () => {
    expect(compilesOk("/foo/.test(str);")).toBe(true);
  });

  it("14. var re = /foo/i; emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("var re = /foo/i;");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "RegExp")).toBe(true);
    expect(containsString(bytes, "foo")).toBe(true);
    expect(containsString(bytes, "i")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Division still works (/ as operator, not regex)
// ---------------------------------------------------------------------------

describe("Division operator still works after regex support", () => {
  it("15. a / b compiles without error", () => {
    expect(compilesOk("var x = a / b;")).toBe(true);
  });

  it("16. a / b does NOT emit ActionNew (no RegExp construction)", () => {
    const bytes = compileAS2("var x = a / b;");
    // Division should not create a RegExp
    expect(containsString(bytes, "RegExp")).toBe(false);
  });

  it("17. 10 / 2 compiles without error", () => {
    expect(compilesOk("var x = 10 / 2;")).toBe(true);
  });
});
