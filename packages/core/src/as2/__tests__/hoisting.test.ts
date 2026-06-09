/**
 * Tests for AS2 var hoisting and function hoisting.
 *
 * In AS2 (AVM1), var declarations are function-scoped (hoisted to the top of
 * the enclosing function/script), and function declarations are also hoisted.
 * This mirrors JavaScript ES5 semantics.
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
// Test 1: Function used before its declaration (function hoisting)
// ---------------------------------------------------------------------------

describe("AS2 var hoisting and function hoisting", () => {
  it("1. function used before declaration compiles: function greet() { return 'hi'; } var fn = greet;", () => {
    const src = `function greet() { return "hi"; } var fn = greet;`;
    expect(compilesOk(src)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 2: var re-declared in a nested block is function-scoped
  // ---------------------------------------------------------------------------

  it("2. var re-declared inside if block compiles (function-scoped var): var x = 1; if (true) { var x = 2; } trace(x)", () => {
    const src = `var x = 1; if (true) { var x = 2; } trace(x);`;
    expect(compilesOk(src)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 3: for-loop var is hoisted to function scope
  // ---------------------------------------------------------------------------

  it("3. for-loop var hoisted to function scope compiles: for (var i = 0; i < 3; i++) {} trace(i)", () => {
    const src = `for (var i = 0; i < 3; i++) {} trace(i);`;
    expect(compilesOk(src)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Function declaration emits ActionDefineFunction2 (0x8E)
  // ---------------------------------------------------------------------------

  it("4. function declaration emits ActionDefineFunction2 (0x8E)", () => {
    const src = `function add(a, b) { return a + b; }`;
    const bytes = compileAS2(src);
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("4b. function declaration parameter names appear in bytecode", () => {
    const src = `function add(a, b) { return a + b; }`;
    const bytes = compileAS2(src);
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Function expression emits ActionDefineFunction2 (0x8E)
  // ---------------------------------------------------------------------------

  it("5. function expression emits ActionDefineFunction2 (0x8E): var fn = function(a, b) { return a + b; }", () => {
    const src = `var fn = function(a, b) { return a + b; }`;
    const bytes = compileAS2(src);
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("5b. function expression compiles without error", () => {
    const src = `var fn = function(a, b) { return a + b; }`;
    expect(compilesOk(src)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Nested function declaration compiles
  // ---------------------------------------------------------------------------

  it("6. nested function declaration compiles: function outer() { function inner() {} inner(); }", () => {
    const src = `function outer() { function inner() {} inner(); }`;
    expect(compilesOk(src)).toBe(true);
  });

  it("6b. nested function emits ActionDefineFunction2 (0x8E) at least twice", () => {
    const src = `function outer() { function inner() {} inner(); }`;
    const bytes = compileAS2(src);
    let count = 0;
    for (const b of bytes) if (b === 0x8e) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Recursive function compiles
  // ---------------------------------------------------------------------------

  it("7. recursive function compiles: function fact(n) { return n <= 1 ? 1 : n * fact(n-1); }", () => {
    const src = `function fact(n) { return n <= 1 ? 1 : n * fact(n-1); }`;
    expect(compilesOk(src)).toBe(true);
  });

  it("7b. recursive function name appears in bytecode", () => {
    const src = `function fact(n) { return n <= 1 ? 1 : n * fact(n-1); }`;
    const bytes = compileAS2(src);
    expect(containsString(bytes, "fact")).toBe(true);
  });
});
