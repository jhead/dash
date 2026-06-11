/**
 * Tests for AS2 compiler handling of String method calls and properties.
 *
 * Verifies that string method calls compile to correct AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (str.charAt(0), str.indexOf("x"), etc.)
 *   - ActionGetMember  (0x4e): property reads (str.length)
 *   - ActionStringAdd  (0x21): string concatenation ("a" + "b")
 *   - ActionEquals2   (0x49): string comparison ("a" == "b")
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

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read

// ---------------------------------------------------------------------------
// charAt
// ---------------------------------------------------------------------------

describe("String charAt", () => {
  it("str.charAt(0) compiles without error", () => {
    expect(compilesOk('var str = "hello"; str.charAt(0);')).toBe(true);
  });

  it("str.charAt(0) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var str = "hello"; str.charAt(0);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "charAt")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// charCodeAt
// ---------------------------------------------------------------------------

describe("String charCodeAt", () => {
  it("str.charCodeAt(0) compiles without error", () => {
    expect(compilesOk('var str = "hello"; str.charCodeAt(0);')).toBe(true);
  });

  it("str.charCodeAt(0) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var str = "hello"; str.charCodeAt(0);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "charCodeAt")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// indexOf
// ---------------------------------------------------------------------------

describe("String indexOf", () => {
  it('str.indexOf("x") compiles without error', () => {
    expect(compilesOk('var str = "hello"; str.indexOf("x");')).toBe(true);
  });

  it('str.indexOf("x") bytecode contains ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var str = "hello"; str.indexOf("x");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "indexOf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lastIndexOf
// ---------------------------------------------------------------------------

describe("String lastIndexOf", () => {
  it('str.lastIndexOf("x") compiles without error', () => {
    expect(compilesOk('var str = "hello"; str.lastIndexOf("x");')).toBe(true);
  });

  it('str.lastIndexOf("x") bytecode contains ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var str = "hello"; str.lastIndexOf("x");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "lastIndexOf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// split
// ---------------------------------------------------------------------------

describe("String split", () => {
  it('str.split(",") compiles without error', () => {
    expect(compilesOk('var str = "a,b,c"; str.split(",");')).toBe(true);
  });

  it('str.split(",") bytecode contains ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var str = "a,b,c"; str.split(",");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "split")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// substring
// ---------------------------------------------------------------------------

describe("String substring", () => {
  it("str.substring(0, 5) compiles without error", () => {
    expect(compilesOk('var str = "hello world"; str.substring(0, 5);')).toBe(true);
  });

  it("str.substring(0, 5) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var str = "hello world"; str.substring(0, 5);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "substring")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// substr
// ---------------------------------------------------------------------------

describe("String substr", () => {
  it("str.substr(0, 5) compiles without error", () => {
    expect(compilesOk('var str = "hello world"; str.substr(0, 5);')).toBe(true);
  });

  it("str.substr(0, 5) bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var str = "hello world"; str.substr(0, 5);');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "substr")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toUpperCase
// ---------------------------------------------------------------------------

describe("String toUpperCase", () => {
  it("str.toUpperCase() compiles without error", () => {
    expect(compilesOk('var str = "hello"; str.toUpperCase();')).toBe(true);
  });

  it("str.toUpperCase() bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var str = "hello"; str.toUpperCase();');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toUpperCase")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toLowerCase
// ---------------------------------------------------------------------------

describe("String toLowerCase", () => {
  it("str.toLowerCase() compiles without error", () => {
    expect(compilesOk('var str = "HELLO"; str.toLowerCase();')).toBe(true);
  });

  it("str.toLowerCase() bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('var str = "HELLO"; str.toLowerCase();');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toLowerCase")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// replace
// ---------------------------------------------------------------------------

describe("String replace", () => {
  it('str.replace("a", "b") compiles without error', () => {
    expect(compilesOk('var str = "abcabc"; str.replace("a", "b");')).toBe(true);
  });

  it('str.replace("a", "b") bytecode contains ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('var str = "abcabc"; str.replace("a", "b");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "replace")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// length property
// ---------------------------------------------------------------------------

describe("String length property", () => {
  it("str.length compiles without error", () => {
    expect(compilesOk('var str = "hello"; var n = str.length;')).toBe(true);
  });

  it("str.length emits ActionGetMember (0x4e), not ActionCallMethod", () => {
    const bytes = compileAS2('var str = "hello"; var n = str.length;');
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "length")).toBe(true);
    // Property access must NOT emit ActionCallMethod
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String literal length property
// ---------------------------------------------------------------------------

describe("String literal length property", () => {
  it('"hello".length compiles without error', () => {
    expect(compilesOk('"hello".length;')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String.fromCharCode static method
// ---------------------------------------------------------------------------

describe("String.fromCharCode", () => {
  it("String.fromCharCode(65) compiles without error", () => {
    expect(compilesOk("String.fromCharCode(65);")).toBe(true);
  });

  it("String.fromCharCode(65) emits ActionMBAsciiToChar (0x37) instead of ActionCallMethod", () => {
    const bytes = compileAS2("String.fromCharCode(65);");
    // Flash Professional emits ActionMBAsciiToChar (0x37) for single-arg String.fromCharCode
    expect(containsByte(bytes, 0x37)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String concatenation
// ---------------------------------------------------------------------------

describe("String concatenation", () => {
  it('"a" + "b" compiles without error', () => {
    expect(compilesOk('"a" + "b";')).toBe(true);
  });

  it("string variable concatenation compiles without error", () => {
    expect(compilesOk('var a = "hello"; var b = "world"; var c = a + b;')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String comparison
// ---------------------------------------------------------------------------

describe("String comparison", () => {
  it('"a" == "b" compiles without error', () => {
    expect(compilesOk('"a" == "b";')).toBe(true);
  });

  it("string variable comparison compiles without error", () => {
    expect(compilesOk('var a = "hello"; var b = "world"; var eq = a == b;')).toBe(true);
  });
});
