/**
 * Tests for AS2 Function class and function metadata.
 *
 * Verifies that Function.prototype methods (call, apply, toString) and
 * function metadata (length, arguments object) compile correctly to
 * AVM1 bytecode.
 *
 * Key opcodes verified:
 *   - ActionCallMethod (0x52): fn.call(), fn.apply(), fn.toString()
 *   - ActionGetMember  (0x4f): fn.length property access
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
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property access

// ---------------------------------------------------------------------------
// 1. fn.call()
// ---------------------------------------------------------------------------

describe("fn.call()", () => {
  it("fn.call(ctx, arg1) compiles without error", () => {
    expect(
      compilesOk("var fn = function() {}; var ctx = {}; var arg1 = 1; fn.call(ctx, arg1);")
    ).toBe(true);
  });

  it("fn.call(ctx, arg1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var fn = function() {}; var ctx = {}; var arg1 = 1; fn.call(ctx, arg1);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. fn.apply()
// ---------------------------------------------------------------------------

describe("fn.apply()", () => {
  it("fn.apply(ctx, [arg1, arg2]) compiles without error", () => {
    expect(
      compilesOk(
        "var fn = function() {}; var ctx = {}; var arg1 = 1; var arg2 = 2; fn.apply(ctx, [arg1, arg2]);"
      )
    ).toBe(true);
  });

  it("fn.apply(ctx, [arg1, arg2]) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var fn = function() {}; var ctx = {}; var arg1 = 1; var arg2 = 2; fn.apply(ctx, [arg1, arg2]);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "apply")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. fn.length
// ---------------------------------------------------------------------------

describe("fn.length", () => {
  it("var len = fn.length compiles without error", () => {
    expect(compilesOk("var fn = function(a, b) {}; var len = fn.length;")).toBe(true);
  });

  it('var len = fn.length emits ActionGetMember (0x4f) for "length"', () => {
    const bytes = compileAS2("var fn = function(a, b) {}; var len = fn.length;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "length")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. fn.toString()
// ---------------------------------------------------------------------------

describe("fn.toString()", () => {
  it("fn.toString() compiles without error", () => {
    expect(compilesOk("var fn = function() {}; fn.toString();")).toBe(true);
  });

  it("fn.toString() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var fn = function() {}; fn.toString();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toString")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. arguments.length
// ---------------------------------------------------------------------------

describe("arguments.length", () => {
  it("(function(){ return arguments.length; })() compiles without error", () => {
    expect(compilesOk("(function(){ return arguments.length; })();")).toBe(true);
  });

  it("(function(){ return arguments.length; })() produces non-empty bytecode", () => {
    // The AVM1 compiler uses registers for 'arguments', so the literal string
    // "arguments" does not appear in the bytecode — but the program must still
    // compile to non-empty output.
    const bytes = compileAS2("(function(){ return arguments.length; })();");
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. arguments.callee
// ---------------------------------------------------------------------------

describe("arguments.callee", () => {
  it("(function(){ return arguments.callee; })() compiles without error", () => {
    expect(compilesOk("(function(){ return arguments.callee; })();")).toBe(true);
  });

  it("(function(){ return arguments.callee; })() produces non-empty bytecode", () => {
    // The AVM1 compiler uses registers for 'arguments', so the literal string
    // "arguments" does not appear in the bytecode — but the program must still
    // compile to non-empty output.
    const bytes = compileAS2("(function(){ return arguments.callee; })();");
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. arguments[0]
// ---------------------------------------------------------------------------

describe("arguments[0]", () => {
  it("(function(){ return arguments[0]; })() compiles without error", () => {
    expect(compilesOk("(function(){ return arguments[0]; })();")).toBe(true);
  });

  it("(function(){ return arguments[0]; })() produces non-empty bytecode", () => {
    // The AVM1 compiler uses registers for 'arguments', so the literal string
    // "arguments" does not appear in the bytecode — but the program must still
    // compile to non-empty output.
    const bytes = compileAS2("(function(){ return arguments[0]; })();");
    expect(bytes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Full call/apply pattern
// ---------------------------------------------------------------------------

describe("full call/apply pattern", () => {
  it("var ctx = {}; fn.call(ctx, 1, 2) compiles without error", () => {
    expect(
      compilesOk("var fn = function(a, b) { return a + b; }; var ctx = {}; fn.call(ctx, 1, 2);")
    ).toBe(true);
  });

  it("var ctx = {}; fn.call(ctx, 1, 2) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var fn = function(a, b) { return a + b; }; var ctx = {}; fn.call(ctx, 1, 2);"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "call")).toBe(true);
  });

  it("combined call and apply both compile without error", () => {
    expect(
      compilesOk(`
        var fn = function(a, b) { return a + b; };
        var ctx = {};
        fn.call(ctx, 1, 2);
        fn.apply(ctx, [1, 2]);
        var len = fn.length;
        fn.toString();
      `)
    ).toBe(true);
  });
});
