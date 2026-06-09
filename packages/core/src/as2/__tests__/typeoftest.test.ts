/**
 * Tests for AS2 typeof operator with all value types.
 *
 * Verifies that `typeof <expr>` compiles correctly to AVM1 bytecode
 * emitting ActionTypeOf (0x44) for all standard JS/AS2 value types.
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

const ACTION_TYPEOF = 0x44; // ActionTypeOf

// ---------------------------------------------------------------------------
// typeof with all types
// ---------------------------------------------------------------------------

describe("typeof with all types", () => {
  it("1. typeof undefined emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof undefined;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("2. typeof null emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof null;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("3. typeof 42 emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof 42;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it('4. typeof "string" emits ActionTypeOf (0x44)', () => {
    const bytes = compileAS2('typeof "string";');
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("5. typeof true emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof true;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("6. typeof {} emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof {};");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("7. typeof function(){} emits ActionTypeOf (0x44)", () => {
    const bytes = compileAS2("typeof function(){};");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("8. typeof undeclaredVar compiles (emits ActionTypeOf)", () => {
    expect(compilesOk("typeof undeclaredVar;")).toBe(true);
    const bytes = compileAS2("typeof undeclaredVar;");
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it('9. if (typeof x == "undefined") {} compiles and emits ActionTypeOf', () => {
    const source = 'if (typeof x == "undefined") {}';
    expect(compilesOk(source)).toBe(true);
    const bytes = compileAS2(source);
    expect(containsByte(bytes, ACTION_TYPEOF)).toBe(true);
  });

  it("10. var t = typeof x compiles", () => {
    expect(compilesOk("var t = typeof x;")).toBe(true);
  });
});
