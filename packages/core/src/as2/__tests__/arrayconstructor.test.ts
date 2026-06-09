/**
 * Tests for AS2 Array constructor and initialization compilation.
 *
 * Verifies that array construction and initialization compile to the correct
 * AVM1 bytecode opcodes:
 *   - ActionNew       (0x4a): new Array() constructor calls
 *   - ActionInitArray (0x36): array literal syntax []
 *   - ActionGetMember (0x4f): array element read and .length access
 *   - ActionSetMember (0x4e): array element assignment
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

const ACTION_NEW        = 0x4a; // ActionNew        — constructor call
const ACTION_INIT_ARRAY = 0x36; // ActionInitArray  — array literal
const ACTION_GET_MEMBER = 0x4f; // ActionGetMember  — property/element read
const ACTION_SET_MEMBER = 0x4e; // ActionSetMember  — property/element write

// ---------------------------------------------------------------------------
// Test 1: new Array() — no-arg constructor
// ---------------------------------------------------------------------------

describe("AS2 Array constructor and initialization", () => {
  it("1. new Array() emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new Array();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: new Array(5) — single numeric argument
  // -------------------------------------------------------------------------

  it("2. new Array(5) emits ActionNew (0x4a) with arg", () => {
    const bytes = compileAS2("new Array(5);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: new Array('a','b','c') — multiple arguments
  // -------------------------------------------------------------------------

  it("3. new Array('a','b','c') emits ActionNew (0x4a)", () => {
    const bytes = compileAS2("new Array('a', 'b', 'c');");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: var arr = [] — empty array literal
  // -------------------------------------------------------------------------

  it("4. var arr = [] emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var arr = [];");
    expect(containsByte(bytes, ACTION_INIT_ARRAY)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: var arr = [1, 2, 3] — array literal with elements
  // -------------------------------------------------------------------------

  it("5. var arr = [1, 2, 3] emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var arr = [1, 2, 3];");
    expect(containsByte(bytes, ACTION_INIT_ARRAY)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: var arr = [[1,2],[3,4]] — nested array literals
  // -------------------------------------------------------------------------

  it("6. var arr = [[1,2],[3,4]] emits ActionInitArray (0x36) for nested arrays", () => {
    const bytes = compileAS2("var arr = [[1, 2], [3, 4]];");
    expect(containsByte(bytes, ACTION_INIT_ARRAY)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7: arr[0] — bracket read access
  // -------------------------------------------------------------------------

  it("7. arr[0] emits ActionGetMember (0x4f) or ActionGetVariable for bracket access", () => {
    const bytes = compileAS2(`
      var arr = [1, 2, 3];
      var x = arr[0];
    `);
    // Bracket access compiles to ActionGetMember (0x4f)
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: arr[0] = 5 — bracket write access
  // -------------------------------------------------------------------------

  it("8. arr[0] = 5 emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(`
      var arr = [1, 2, 3];
      arr[0] = 5;
    `);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 9: arr.length — property access
  // -------------------------------------------------------------------------

  it("9. arr.length emits ActionGetMember (0x4f) for 'length'", () => {
    const bytes = compileAS2(`
      var arr = [1, 2, 3];
      var n = arr.length;
    `);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "length")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 10: arr[arr.length - 1] — complex index expression
  // -------------------------------------------------------------------------

  it("10. arr[arr.length - 1] compiles without error", () => {
    expect(
      compilesOk(`
        var arr = [1, 2, 3];
        var last = arr[arr.length - 1];
      `)
    ).toBe(true);
  });
});
