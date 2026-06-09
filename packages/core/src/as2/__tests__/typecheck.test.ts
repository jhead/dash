/**
 * Tests for AS2 instanceof and type checking (typeof comparisons).
 *
 * Verifies that:
 * - `instanceof` compiles to ActionInstanceOf (0x54)
 * - `typeof x === 'type'` compiles, emitting ActionTypeOf (0x44) and
 *   ActionStrictEquals (0x66)
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

// AVM1 opcodes
const ACTION_INSTANCEOF    = 0x54; // ActionInstanceOf
const ACTION_TYPEOF        = 0x44; // ActionTypeOf
const ACTION_STRICT_EQUALS = 0x66; // ActionStrictEquals (===)

// ---------------------------------------------------------------------------
// instanceof operator
// ---------------------------------------------------------------------------

describe("instanceof type checking", () => {
  it("x instanceof Array — compiles without error", () => {
    expect(compilesOk("x instanceof Array;")).toBe(true);
  });

  it("x instanceof Array — emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("x instanceof Array;");
    expect(containsByte(bytes, ACTION_INSTANCEOF)).toBe(true);
  });

  it("x instanceof MovieClip — compiles without error", () => {
    expect(compilesOk("x instanceof MovieClip;")).toBe(true);
  });

  it("x instanceof MovieClip — emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("x instanceof MovieClip;");
    expect(containsByte(bytes, ACTION_INSTANCEOF)).toBe(true);
    expect(containsString(bytes, "MovieClip")).toBe(true);
  });

  it("x instanceof MyClass (user-defined class) — compiles without error", () => {
    const src = `
      class MyClass {}
      var x = new MyClass();
      x instanceof MyClass;
    `;
    expect(compilesOk(src)).toBe(true);
  });

  it("x instanceof MyClass (user-defined class) — emits ActionInstanceOf (0x54)", () => {
    const src = `
      class MyClass {}
      var x = new MyClass();
      x instanceof MyClass;
    `;
    const bytes = compileAS2(src);
    expect(containsByte(bytes, ACTION_INSTANCEOF)).toBe(true);
    expect(containsString(bytes, "MyClass")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// typeof comparisons
// ---------------------------------------------------------------------------

describe("typeof equality checks", () => {
  it("typeof x === 'object' — compiles without error", () => {
    expect(compilesOk("typeof x === 'object';")).toBe(true);
  });

  it("typeof x === 'object' — emits ActionTypeOf (0x44) and ActionStrictEquals (0x66)", () => {
    const bytes = compileAS2("typeof x === 'object';");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
    expect(containsByte(bytes, ACTION_STRICT_EQUALS)).toBe(true);
  });

  it("typeof x === 'function' — compiles without error", () => {
    expect(compilesOk("typeof x === 'function';")).toBe(true);
  });

  it("typeof x === 'function' — emits ActionTypeOf (0x44) and ActionStrictEquals (0x66)", () => {
    const bytes = compileAS2("typeof x === 'function';");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
    expect(containsByte(bytes, ACTION_STRICT_EQUALS)).toBe(true);
  });

  it("typeof x === 'string' — compiles without error", () => {
    expect(compilesOk("typeof x === 'string';")).toBe(true);
  });

  it("typeof x === 'string' — emits ActionTypeOf (0x44) and ActionStrictEquals (0x66)", () => {
    const bytes = compileAS2("typeof x === 'string';");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
    expect(containsByte(bytes, ACTION_STRICT_EQUALS)).toBe(true);
  });

  it("typeof x === 'number' — compiles without error", () => {
    expect(compilesOk("typeof x === 'number';")).toBe(true);
  });

  it("typeof x === 'number' — emits ActionTypeOf (0x44) and ActionStrictEquals (0x66)", () => {
    const bytes = compileAS2("typeof x === 'number';");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
    expect(containsByte(bytes, ACTION_STRICT_EQUALS)).toBe(true);
  });

  it("typeof x === 'undefined' — compiles without error", () => {
    expect(compilesOk("typeof x === 'undefined';")).toBe(true);
  });

  it("typeof x === 'undefined' — emits ActionTypeOf (0x44) and ActionStrictEquals (0x66)", () => {
    const bytes = compileAS2("typeof x === 'undefined';");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
    expect(containsByte(bytes, ACTION_STRICT_EQUALS)).toBe(true);
  });
});
