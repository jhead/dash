/**
 * Tests for AS2 compiler handling of advanced Array method calls (ES5/AS3-style).
 *
 * These methods (forEach, map, filter, every, some) are not native AS2/AVM1
 * built-ins, but the compiler treats them as regular method calls via
 * ActionCallMethod (0x52). Also tests Array.isArray() static call.
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

// ---------------------------------------------------------------------------
// forEach
// ---------------------------------------------------------------------------

describe("Array forEach", () => {
  it("a.forEach(function(x){}) compiles without error", () => {
    expect(compilesOk("var a = [1,2,3]; a.forEach(function(x){});")).toBe(true);
  });

  it("a.forEach bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var a = [1,2,3]; a.forEach(function(x){});");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "forEach")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

describe("Array map", () => {
  it("a.map(function(x){ return x*2; }) compiles without error", () => {
    expect(
      compilesOk("var a = [1,2,3]; var b = a.map(function(x){ return x*2; });")
    ).toBe(true);
  });

  it("a.map bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var a = [1,2,3]; var b = a.map(function(x){ return x*2; });"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "map")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filter
// ---------------------------------------------------------------------------

describe("Array filter", () => {
  it("a.filter(function(x){ return x > 0; }) compiles without error", () => {
    expect(
      compilesOk(
        "var a = [-1,0,1,2]; var b = a.filter(function(x){ return x > 0; });"
      )
    ).toBe(true);
  });

  it("a.filter bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var a = [-1,0,1,2]; var b = a.filter(function(x){ return x > 0; });"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "filter")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// every
// ---------------------------------------------------------------------------

describe("Array every", () => {
  it("a.every(function(x){ return x > 0; }) compiles without error", () => {
    expect(
      compilesOk(
        "var a = [1,2,3]; var ok = a.every(function(x){ return x > 0; });"
      )
    ).toBe(true);
  });

  it("a.every bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var a = [1,2,3]; var ok = a.every(function(x){ return x > 0; });"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "every")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// some
// ---------------------------------------------------------------------------

describe("Array some", () => {
  it("a.some(function(x){ return x > 0; }) compiles without error", () => {
    expect(
      compilesOk(
        "var a = [-1,0,1]; var found = a.some(function(x){ return x > 0; });"
      )
    ).toBe(true);
  });

  it("a.some bytecode contains ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(
      "var a = [-1,0,1]; var found = a.some(function(x){ return x > 0; });"
    );
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "some")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array.isArray static call
// ---------------------------------------------------------------------------

describe("Array.isArray static call", () => {
  it("Array.isArray(x) compiles without error", () => {
    expect(compilesOk("var x = []; var result = Array.isArray(x);")).toBe(true);
  });

  it("Array.isArray bytecode references Array and isArray", () => {
    const bytes = compileAS2("var x = []; var result = Array.isArray(x);");
    expect(containsString(bytes, "Array")).toBe(true);
    expect(containsString(bytes, "isArray")).toBe(true);
  });
});
