/**
 * Tests for AS2 instanceof operator with built-in types.
 *
 * Verifies that `x instanceof BuiltIn` compiles correctly to AVM1 bytecode
 * emitting ActionInstanceOf (0x54) for all standard built-in constructors.
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

const ACTION_INSTANCE_OF = 0x54; // ActionInstanceOf
const ACTION_NEW = 0x40; // ActionNew

// ---------------------------------------------------------------------------
// instanceof with built-in types
// ---------------------------------------------------------------------------

describe("instanceof with built-in types", () => {
  it("1. x instanceof Array emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof Array;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("2. x instanceof Object emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof Object;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("3. x instanceof String emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof String;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("4. x instanceof Number emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof Number;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("5. x instanceof Boolean emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof Boolean;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("6. x instanceof Function emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof Function;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("7. x instanceof Error emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof Error;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("8. x instanceof RegExp emits ActionInstanceOf (0x54)", () => {
    const bytes = compileAS2("var x; x instanceof RegExp;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
  });

  it("9. null instanceof Array compiles", () => {
    expect(compilesOk("null instanceof Array;")).toBe(true);
  });

  it("10. (new Array()) instanceof Array compiles and emits ActionInstanceOf (0x54) and ActionNew (0x40)", () => {
    const bytes = compileAS2("(new Array()) instanceof Array;");
    expect(containsByte(bytes, ACTION_INSTANCE_OF)).toBe(true);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });
});
