/**
 * Tests for AS2 anonymous functions and closure compilation.
 *
 * Verifies that anonymous function expressions, closures, IIFEs, and callbacks
 * compile to valid AVM1 bytecode with ActionDefineFunction2 (0x8E).
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
// Anonymous function expression assigned to variable
// ---------------------------------------------------------------------------

describe("anonymous function expression", () => {
  it("var f = function(x) { return x * 2; } compiles without error", () => {
    expect(compilesOk("var f = function(x) { return x * 2; }")).toBe(true);
  });

  it("emits ActionDefineFunction2 (0x8E) for anonymous function", () => {
    const bytes = compileAS2("var f = function(x) { return x * 2; }");
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("emits parameter name in function bytecode", () => {
    const bytes = compileAS2("var f = function(x) { return x * 2; }");
    expect(containsString(bytes, "x")).toBe(true);
  });

  it("var f = function(x) { return x * 2; } emits ActionDefineLocal (0x42) for var", () => {
    const bytes = compileAS2("var f = function(x) { return x * 2; }");
    // ActionDefineLocal (0x42) used to bind f
    expect(containsByte(bytes, 0x42)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Closure capturing outer variable
// ---------------------------------------------------------------------------

describe("closure captures outer variable", () => {
  it("nested function compiles without error", () => {
    const src = `var g = function() { var x = 5; return function() { return x; }; };`;
    expect(compilesOk(src)).toBe(true);
  });

  it("outer function emits ActionDefineFunction2 (0x8E)", () => {
    const src = `var g = function() { var x = 5; return function() { return x; }; };`;
    const bytes = compileAS2(src);
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("inner function also emits ActionDefineFunction2 (0x8E) — found twice or more", () => {
    const src = `var g = function() { var x = 5; return function() { return x; }; };`;
    const bytes = compileAS2(src);
    let count = 0;
    for (const b of bytes) if (b === 0x8e) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("captured variable name appears in bytecode", () => {
    const src = `var g = function() { var x = 5; return function() { return x; }; };`;
    const bytes = compileAS2(src);
    expect(containsString(bytes, "x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Immediately-invoked function expression (IIFE)
// ---------------------------------------------------------------------------

describe("immediately invoked function expression (IIFE)", () => {
  it("(function() { trace('IIFE'); })() compiles without error", () => {
    expect(compilesOk(`(function() { trace("IIFE"); })()`)).toBe(true);
  });

  it("IIFE with arguments compiles without error", () => {
    expect(compilesOk(`(function(x) { return x * 2; })(5)`)).toBe(true);
  });

  it("IIFE assigned to variable compiles without error", () => {
    // When the IIFE result is stored, it compiles fine
    expect(compilesOk(`var result = (function() { return 42; })()`)).toBe(true);
  });

  it("nested IIFE compiles without error", () => {
    expect(compilesOk(`(function() { (function() { trace("inner"); })(); })()`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Function as callback argument
// ---------------------------------------------------------------------------

describe("function as callback argument", () => {
  it("arr.sort(function(a,b) { return a-b; }) compiles without error", () => {
    expect(compilesOk("arr.sort(function(a,b) { return a-b; })")).toBe(true);
  });

  it("callback compiles and emits ActionDefineFunction2 (0x8E)", () => {
    const bytes = compileAS2("arr.sort(function(a,b) { return a-b; })");
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("callback parameter names appear in bytecode", () => {
    const bytes = compileAS2("arr.sort(function(a,b) { return a-b; })");
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });

  it("callback emits ActionCallMethod (0x52) for arr.sort", () => {
    const bytes = compileAS2("arr.sort(function(a,b) { return a-b; })");
    expect(containsByte(bytes, 0x52)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Return function from function (factory pattern)
// ---------------------------------------------------------------------------

describe("return function from function (factory)", () => {
  it("function factory() { return function(x) { return x; }; } compiles without error", () => {
    expect(compilesOk("function factory() { return function(x) { return x; }; }")).toBe(true);
  });

  it("factory function emits ActionDefineFunction2 (0x8E)", () => {
    const bytes = compileAS2("function factory() { return function(x) { return x; }; }");
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("inner returned function also emits ActionDefineFunction2 — at least two occurrences", () => {
    const bytes = compileAS2("function factory() { return function(x) { return x; }; }");
    let count = 0;
    for (const b of bytes) if (b === 0x8e) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("factory function name appears in bytecode", () => {
    const bytes = compileAS2("function factory() { return function(x) { return x; }; }");
    expect(containsString(bytes, "factory")).toBe(true);
  });
});
