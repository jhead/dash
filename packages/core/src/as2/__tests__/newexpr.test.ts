/**
 * Tests for AS2 compiler: new Array() / new Object() emit ActionNewObject (0x40).
 *
 * Flash 8's `new Array(...)` and `new Object()` are generic constructor calls
 * handled via ActionNewObject (0x40) in AVM1. The compiler pushes args
 * right-to-left, then arg count, then the class name string, then emits 0x40.
 *
 * None of these should emit ActionCallFunction (0x3D).
 *
 * Task 0924: verify new Array()/new Object() emit ActionNewObject (0x40).
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
}

/** Returns true if the exact null-terminated UTF-8 string s appears in bytes. */
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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_NEW_OBJECT    = 0x40; // ActionNewObject   — constructor call
const ACTION_CALL_FUNCTION = 0x3d; // ActionCallFunction — must NOT appear

// ---------------------------------------------------------------------------
// new Array()
// ---------------------------------------------------------------------------

describe("new Array() — no-arg constructor", () => {
  it("new Array() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new Array();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new Array() pushes 'Array' as class name string", () => {
    const bytes = compileAS2("new Array();");
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("new Array() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new Array();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// new Array(1, 2, 3)
// ---------------------------------------------------------------------------

describe("new Array(1,2,3) — three-arg constructor", () => {
  it("new Array(1,2,3) emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new Array(1, 2, 3);");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new Array(1,2,3) pushes 'Array' as class name string", () => {
    const bytes = compileAS2("new Array(1, 2, 3);");
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("new Array(1,2,3) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new Array(1, 2, 3);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// new Object()
// ---------------------------------------------------------------------------

describe("new Object() — no-arg constructor", () => {
  it("new Object() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new Object();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new Object() pushes 'Object' as class name string", () => {
    const bytes = compileAS2("new Object();");
    expect(containsString(bytes, "Object")).toBe(true);
  });

  it("new Object() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new Object();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// new MyClass(arg) — generic single-arg constructor (regression guard)
// ---------------------------------------------------------------------------

describe("new MyClass(arg) — generic single-arg constructor", () => {
  it("new MyClass(arg) emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("new MyClass(arg);");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("new MyClass(arg) pushes 'MyClass' as class name string", () => {
    const bytes = compileAS2("new MyClass(arg);");
    expect(containsString(bytes, "MyClass")).toBe(true);
  });

  it("new MyClass(arg) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("new MyClass(arg);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});
