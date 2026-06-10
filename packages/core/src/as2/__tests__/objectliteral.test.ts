/**
 * Tests for AS2 object literal and initialization compilation.
 *
 * Verifies that object literals and property access compile to the correct
 * AVM1 bytecode opcodes:
 *   - ActionInitObject (0x43): object literal syntax {}
 *   - ActionGetMember  (0x4e): property read (o.x)
 *   - ActionSetMember  (0x4f): property write (o.x = 5)
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

function countByte(bytes: Uint8Array, byte: number): number {
  let count = 0;
  for (const b of bytes) {
    if (b === byte) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_INIT_OBJECT = 0x43; // ActionInitObject — object literal
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_SET_MEMBER  = 0x4f; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Test 1: var o = {} — empty object literal
// ---------------------------------------------------------------------------

describe("AS2 object literal and initialization", () => {
  it("1. var o = {} emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2("var o = {};");
    expect(containsByte(bytes, ACTION_INIT_OBJECT)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: var o = {x: 1, y: 2} — object literal with numeric properties
  // -------------------------------------------------------------------------

  it("2. var o = {x: 1, y: 2} emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2("var o = {x: 1, y: 2};");
    expect(containsByte(bytes, ACTION_INIT_OBJECT)).toBe(true);
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: object literal with method value
  // -------------------------------------------------------------------------

  it("3. var o = {name: 'test', getValue: function() { return 1; }} emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2(`
      var o = {name: "test", getValue: function() { return 1; }};
    `);
    expect(containsByte(bytes, ACTION_INIT_OBJECT)).toBe(true);
    expect(containsString(bytes, "name")).toBe(true);
    expect(containsString(bytes, "getValue")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: var o = {a: {b: 1}} — nested object literals
  // -------------------------------------------------------------------------

  it("4. var o = {a: {b: 1}} emits ActionInitObject (0x43) twice for nested objects", () => {
    const bytes = compileAS2("var o = {a: {b: 1}};");
    // Two object literals means at least two ActionInitObject opcodes
    expect(countByte(bytes, ACTION_INIT_OBJECT)).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Test 5: o.x — property read
  // -------------------------------------------------------------------------

  it("5. o.x emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(`
      var o = {x: 1};
      var n = o.x;
    `);
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "x")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: o.x = 5 — property write
  // -------------------------------------------------------------------------

  it("6. o.x = 5 emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(`
      var o = {};
      o.x = 5;
    `);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7: property key string appears in bytecode
  // -------------------------------------------------------------------------

  it("7. string 'x' appears in bytecode for object literal with property 'x'", () => {
    const bytes = compileAS2("var o = {x: 42};");
    expect(containsString(bytes, "x")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 8: Object.keys(o).length — compiles without error
  // -------------------------------------------------------------------------

  it("8. var count = Object.keys(o).length compiles without error", () => {
    expect(
      compilesOk(`
        var o = {a: 1, b: 2};
        var count = Object.keys(o).length;
      `)
    ).toBe(true);
  });
});
