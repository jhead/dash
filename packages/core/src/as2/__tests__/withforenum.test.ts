/**
 * Tests for AS2 with-statement, for..in enumeration, and delete operator.
 *
 * Verifies that these language features compile without error and emit the
 * correct AVM1 opcodes:
 *   - ActionWith       (0x94): with(obj) { ... } statement
 *   - ActionEnumerate2 (0x55): for (var key in obj) { ... } loop
 *   - ActionDelete     (0x3a): delete obj.prop (member expression)
 *   - ActionDelete2    (0x3b): delete localVar (simple identifier)
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

const ACTION_WITH        = 0x94; // ActionWith        — scope chain push
const ACTION_ENUMERATE2  = 0x55; // ActionEnumerate2  — for..in enumeration
const ACTION_DELETE      = 0x3a; // ActionDelete      — delete obj.prop
const ACTION_DELETE2     = 0x3b; // ActionDelete2     — delete localVar

// ---------------------------------------------------------------------------
// with statement — ActionWith (0x94)
// ---------------------------------------------------------------------------

describe("AS2 with statement compilation", () => {
  it("with(obj) { x = 1; y = 2; } compiles without error", () => {
    expect(compilesOk("with(obj) { x = 1; y = 2; }")).toBe(true);
  });

  it("with(obj) { x = 1; } emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with(obj) { x = 1; }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("with(obj) { x = 1; y = 2; } emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with(obj) { x = 1; y = 2; }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("with(obj) bytecode contains the object name", () => {
    const bytes = compileAS2("with(obj) { x = 1; }");
    expect(containsString(bytes, "obj")).toBe(true);
  });

  it("with(obj) bytecode contains body assignment variable names", () => {
    const bytes = compileAS2("with(obj) { x = 1; y = 2; }");
    expect(containsString(bytes, "x")).toBe(true);
    expect(containsString(bytes, "y")).toBe(true);
  });

  it("nested with statements compile without error", () => {
    expect(compilesOk("with(a) { with(b) { z = 1; } }")).toBe(true);
  });

  it("nested with statements each emit ActionWith (0x94)", () => {
    const bytes = compileAS2("with(a) { with(b) { z = 1; } }");
    let count = 0;
    for (const b of bytes) if (b === ACTION_WITH) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("with statement calling a method compiles without error", () => {
    expect(compilesOk("with(mc) { gotoAndPlay(2); }")).toBe(true);
  });

  it("with statement calling a method emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with(mc) { gotoAndPlay(2); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// for..in enumeration — ActionEnumerate2 (0x55)
// ---------------------------------------------------------------------------

describe("AS2 for..in enumeration compilation", () => {
  it("for (var key in obj) { trace(key); } compiles without error", () => {
    expect(compilesOk("for (var key in obj) { trace(key); }")).toBe(true);
  });

  it("for (var key in obj) { trace(key); } emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2("for (var key in obj) { trace(key); }");
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(true);
  });

  it("for..in bytecode contains the key variable name", () => {
    const bytes = compileAS2("for (var key in obj) { trace(key); }");
    expect(containsString(bytes, "key")).toBe(true);
  });

  it("for..in bytecode contains the object variable name", () => {
    const bytes = compileAS2("for (var key in obj) { trace(key); }");
    expect(containsString(bytes, "obj")).toBe(true);
  });

  it("for (var key in obj) {} (empty body) compiles without error", () => {
    expect(compilesOk("for (var key in obj) {}")).toBe(true);
  });

  it("for (var key in obj) {} (empty body) emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2("for (var key in obj) {}");
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(true);
  });

  it("for..in without var compiles without error", () => {
    expect(compilesOk("for (key in obj) {}")).toBe(true);
  });

  it("for..in without var emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2("for (key in obj) {}");
    expect(containsByte(bytes, ACTION_ENUMERATE2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// delete operator
// ---------------------------------------------------------------------------

describe("AS2 delete operator compilation", () => {
  it("delete obj.prop compiles without error", () => {
    expect(compilesOk("delete obj.prop;")).toBe(true);
  });

  it("delete obj.prop emits ActionDelete (0x3a) for member expression", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(containsByte(bytes, ACTION_DELETE)).toBe(true);
  });

  it("delete obj.prop bytecode contains the object and property names", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(containsString(bytes, "obj")).toBe(true);
    expect(containsString(bytes, "prop")).toBe(true);
  });

  it("delete localVar compiles without error", () => {
    expect(compilesOk("delete localVar;")).toBe(true);
  });

  it("delete localVar emits ActionDelete2 (0x3b) for simple identifier", () => {
    const bytes = compileAS2("delete localVar;");
    expect(containsByte(bytes, ACTION_DELETE2)).toBe(true);
    expect(containsString(bytes, "localVar")).toBe(true);
  });
});
