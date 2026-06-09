/**
 * Tests for AS2 object and array literal compilation.
 *
 * Verifies that object and array literals compile to valid AVM1 bytecode
 * and produce the expected opcodes.
 *
 * Actual AVM1 opcodes:
 *   ActionInitObject  0x43  — { key: value, ... }
 *   ActionInitArray   0x36  — [ el0, el1, ... ]
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
// Object literal
// ---------------------------------------------------------------------------

describe("object literal", () => {
  it("var o = {x: 1, y: 2} compiles without error", () => {
    expect(compilesOk("var o = {x: 1, y: 2};")).toBe(true);
  });

  it("var o = {x: 1, y: 2} emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2("var o = {x: 1, y: 2};");
    expect(containsByte(bytes, 0x43)).toBe(true);
  });

  it("property keys appear as strings in bytecode", () => {
    const bytes = compileAS2("var o = {x: 1, y: 2};");
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });

  it("var o = {} (empty object) compiles without error", () => {
    expect(compilesOk("var o = {};")).toBe(true);
  });

  it("empty object emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2("var o = {};");
    expect(containsByte(bytes, 0x43)).toBe(true);
  });

  it("object with string property values compiles", () => {
    expect(compilesOk('var o = {name: "flash", version: 8};')).toBe(true);
  });

  it("object with string values emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2('var o = {name: "flash", version: 8};');
    expect(containsByte(bytes, 0x43)).toBe(true);
    expect(containsString(bytes, "name")).toBe(true);
    expect(containsString(bytes, "flash")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array literal
// ---------------------------------------------------------------------------

describe("array literal", () => {
  it("var a = [1, 2, 3] compiles without error", () => {
    expect(compilesOk("var a = [1, 2, 3];")).toBe(true);
  });

  it("var a = [1, 2, 3] emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var a = [1, 2, 3];");
    expect(containsByte(bytes, 0x36)).toBe(true);
  });

  it("var a = [] (empty array) compiles without error", () => {
    expect(compilesOk("var a = [];")).toBe(true);
  });

  it("empty array emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var a = [];");
    expect(containsByte(bytes, 0x36)).toBe(true);
  });

  it("array with string elements compiles", () => {
    expect(compilesOk('var a = ["hello", "world"];')).toBe(true);
  });

  it("array with string elements emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2('var a = ["hello", "world"];');
    expect(containsByte(bytes, 0x36)).toBe(true);
    expect(containsString(bytes, "hello")).toBe(true);
    expect(containsString(bytes, "world")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Nested object literal
// ---------------------------------------------------------------------------

describe("nested object literal", () => {
  it("var n = {nested: {deep: true}} compiles without error", () => {
    expect(compilesOk("var n = {nested: {deep: true}};")).toBe(true);
  });

  it("nested object emits ActionInitObject (0x43) at least twice", () => {
    const bytes = compileAS2("var n = {nested: {deep: true}};");
    let count = 0;
    for (const b of bytes) if (b === 0x43) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("nested key names appear in bytecode", () => {
    const bytes = compileAS2("var n = {nested: {deep: true}};");
    expect(containsString(bytes, "nested")).toBe(true);
    expect(containsString(bytes, "deep")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mixed array of objects
// ---------------------------------------------------------------------------

describe("mixed array of objects", () => {
  it("var m = [{x:1}, {x:2}] compiles without error", () => {
    expect(compilesOk("var m = [{x:1}, {x:2}];")).toBe(true);
  });

  it("mixed array emits ActionInitArray (0x36)", () => {
    const bytes = compileAS2("var m = [{x:1}, {x:2}];");
    expect(containsByte(bytes, 0x36)).toBe(true);
  });

  it("mixed array emits ActionInitObject (0x43) for each element object", () => {
    const bytes = compileAS2("var m = [{x:1}, {x:2}];");
    let count = 0;
    for (const b of bytes) if (b === 0x43) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("property key 'x' appears in bytecode for mixed array", () => {
    const bytes = compileAS2("var m = [{x:1}, {x:2}];");
    expect(containsString(bytes, "x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Object with function value
// ---------------------------------------------------------------------------

describe("object with function value", () => {
  it("var o = {fn: function() {}} compiles without error", () => {
    expect(compilesOk("var o = {fn: function() {}};")).toBe(true);
  });

  it("object with function emits ActionInitObject (0x43)", () => {
    const bytes = compileAS2("var o = {fn: function() {}};");
    expect(containsByte(bytes, 0x43)).toBe(true);
  });

  it("object with function emits ActionDefineFunction2 (0x8E) for the value", () => {
    const bytes = compileAS2("var o = {fn: function() {}};");
    expect(containsByte(bytes, 0x8e)).toBe(true);
  });

  it("property key 'fn' appears in bytecode", () => {
    const bytes = compileAS2("var o = {fn: function() {}};");
    expect(containsString(bytes, "fn")).toBe(true);
  });
});
