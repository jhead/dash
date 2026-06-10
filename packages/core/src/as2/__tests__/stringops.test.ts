/**
 * Tests for AS2 string concatenation and interpolation compilation.
 *
 * Verifies that string + operations compile to valid AVM1 bytecode and
 * produce the expected opcodes.
 *
 * Actual AVM1 opcodes used by the compiler:
 *   ActionAdd2  0x47  — generic add / string concatenation
 *   ActionPop   0x17  — pop stack value (used in void / compound ops)
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
// String literal concatenation  ("hello" + " world" → ActionAdd2 0x47)
// ---------------------------------------------------------------------------

describe("string literal concatenation", () => {
  it('var s = "hello" + " world" compiles without error', () => {
    expect(compilesOk('var s = "hello" + " world";')).toBe(true);
  });

  it('var s = "hello" + " world" emits ActionAdd2 (0x47)', () => {
    const bytes = compileAS2('var s = "hello" + " world";');
    expect(containsByte(bytes, 0x47)).toBe(true);
  });

  it("string literals appear in bytecode", () => {
    const bytes = compileAS2('var s = "hello" + " world";');
    expect(containsString(bytes, "hello")).toBe(true);
    expect(containsString(bytes, " world")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Variable string concatenation  (str1 + str2 → ActionAdd2 0x47)
// ---------------------------------------------------------------------------

describe("variable string concatenation", () => {
  it("var s = str1 + str2 compiles without error", () => {
    expect(compilesOk("var s = str1 + str2;")).toBe(true);
  });

  it("var s = str1 + str2 emits ActionAdd2 (0x47)", () => {
    const bytes = compileAS2("var s = str1 + str2;");
    expect(containsByte(bytes, 0x47)).toBe(true);
  });

  it("variable names appear in bytecode", () => {
    const bytes = compileAS2("var s = str1 + str2;");
    expect(containsString(bytes, "str1")).toBe(true);
    expect(containsString(bytes, "str2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String + number coercion  ("val=" + n → ActionAdd2 0x47)
// ---------------------------------------------------------------------------

describe("string + number coercion", () => {
  it('var s = "val=" + n compiles without error', () => {
    expect(compilesOk('var s = "val=" + n;')).toBe(true);
  });

  it('var s = "val=" + n emits ActionAdd2 (0x47)', () => {
    const bytes = compileAS2('var s = "val=" + n;');
    expect(containsByte(bytes, 0x47)).toBe(true);
  });

  it("string literal and variable name appear in bytecode", () => {
    const bytes = compileAS2('var s = "val=" + n;');
    expect(containsString(bytes, "val=")).toBe(true);
    expect(containsString(bytes, "n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple + operators  (a + b + c → two ActionAdd2 0x47)
// ---------------------------------------------------------------------------

describe("multiple + operators", () => {
  it("var s = a + b + c compiles without error", () => {
    expect(compilesOk("var s = a + b + c;")).toBe(true);
  });

  it("var s = a + b + c emits ActionAdd2 (0x47)", () => {
    const bytes = compileAS2("var s = a + b + c;");
    expect(containsByte(bytes, 0x47)).toBe(true);
  });

  it("var s = a + b + c emits at least two ActionAdd2 opcodes", () => {
    const bytes = compileAS2("var s = a + b + c;");
    let count = 0;
    for (const b of bytes) if (b === 0x47) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("all operand names appear in bytecode", () => {
    const bytes = compileAS2("var s = a + b + c;");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
    expect(containsString(bytes, "c")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Explicit String() conversion  (String(n) → compiles)
// ---------------------------------------------------------------------------

describe("explicit String() conversion", () => {
  it("var s = String(n) compiles without error", () => {
    expect(compilesOk("var s = String(n);")).toBe(true);
  });

  it("String(n) emits ActionToString (0x4B), NOT ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("var s = String(n);");
    // ActionToString opcode: native coercion, no function name in bytecode
    expect(containsByte(bytes, 0x4B)).toBe(true);
    expect(containsByte(bytes, 0x3D)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Compound string assignment  (str += " more" → compiles)
// ---------------------------------------------------------------------------

describe("compound string assignment", () => {
  it('str += " more" compiles without error', () => {
    expect(compilesOk('var str = "hello"; str += " more";')).toBe(true);
  });

  it('str += " more" emits ActionAdd2 (0x47)', () => {
    const bytes = compileAS2('var str = "hello"; str += " more";');
    expect(containsByte(bytes, 0x47)).toBe(true);
  });

  it("string literal appears in bytecode", () => {
    const bytes = compileAS2('var str = "hello"; str += " more";');
    expect(containsString(bytes, " more")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mixed concatenation pattern  ("" + x + "" + y → compiles)
// ---------------------------------------------------------------------------

describe("mixed concatenation pattern", () => {
  it('var s = "" + x + "" + y compiles without error', () => {
    expect(compilesOk('var s = "" + x + "" + y;')).toBe(true);
  });

  it('var s = "" + x + "" + y emits ActionAdd2 (0x47)', () => {
    const bytes = compileAS2('var s = "" + x + "" + y;');
    expect(containsByte(bytes, 0x47)).toBe(true);
  });

  it("variable names appear in bytecode", () => {
    const bytes = compileAS2('var s = "" + x + "" + y;');
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });

  it("emits multiple ActionAdd2 opcodes for chained concatenation", () => {
    const bytes = compileAS2('var s = "" + x + "" + y;');
    let count = 0;
    for (const b of bytes) if (b === 0x47) count++;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// AS2 string interpolation patterns and template-style operations
// ---------------------------------------------------------------------------

describe("AS2 string operations and patterns", () => {
  it("string + number concatenation compiles", () => {
    expect(compilesOk(`var s = "x=" + x;`)).toBe(true);
  });

  it("multi-part string concatenation compiles", () => {
    expect(compilesOk(`var s = "a=" + a + ", b=" + b + ", c=" + c;`)).toBe(true);
  });

  it("String() coercion compiles", () => {
    expect(compilesOk(`var s = String(42);`)).toBe(true);
  });

  it("toString() coercion compiles", () => {
    expect(compilesOk(`
      var n = 255;
      var hex = n.toString(16);
    `)).toBe(true);
  });

  it("string + object (toString implicit) compiles", () => {
    expect(compilesOk(`
      var obj = {toString: function() { return "foo"; }};
      var s = "val: " + obj;
    `)).toBe(true);
  });

  it("String.charAt compiles", () => {
    expect(compilesOk(`
      var s = "hello";
      var c = s.charAt(0);
    `)).toBe(true);
  });

  it("String.charCodeAt compiles", () => {
    expect(compilesOk(`
      var s = "hello";
      var code = s.charCodeAt(0);
    `)).toBe(true);
  });

  it("String.fromCharCode compiles", () => {
    expect(compilesOk(`var c = String.fromCharCode(65);`)).toBe(true);
  });

  it("String.indexOf compiles", () => {
    expect(compilesOk(`
      var s = "hello world";
      var i = s.indexOf("world");
    `)).toBe(true);
  });

  it("String.lastIndexOf compiles", () => {
    expect(compilesOk(`
      var s = "abcabc";
      var i = s.lastIndexOf("a");
    `)).toBe(true);
  });

  it("String.toLowerCase/toUpperCase compile", () => {
    expect(compilesOk(`
      var s = "Hello";
      var l = s.toLowerCase();
      var u = s.toUpperCase();
    `)).toBe(true);
  });

  it("String.trim compiles (or throws gracefully if not in AS2)", () => {
    // Flash 8 AS2 doesn't have trim() but the compiler should either accept or reject cleanly
    try {
      compileAS2(`var s = "  hello  ".trim();`);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("String.substr and substring compile", () => {
    expect(compilesOk(`
      var s = "hello world";
      var sub1 = s.substr(0, 5);
      var sub2 = s.substring(6, 11);
    `)).toBe(true);
  });

  it("string comparison compiles", () => {
    expect(compilesOk(`
      var s = "hello";
      var isHello = (s === "hello");
      var ltA = (s < "z");
    `)).toBe(true);
  });
});
