/**
 * Tests for AS2 _global object access patterns.
 *
 * Verifies that:
 * - _global.MyClass, _global.Array, _global.Object, _global.trace etc. compile
 *   and emit ActionGetMember (0x4f) or ActionGetVariable (0x1c) for member reads
 * - _global.someVar = 5 compiles (assignment to global namespace)
 * - Global registration patterns (_global.myListener = new Object(); etc.) compile
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
const ACTION_GET_MEMBER   = 0x4f; // ActionGetMember
const ACTION_GET_VARIABLE = 0x1c; // ActionGetVariable
const ACTION_SET_MEMBER   = 0x4e; // ActionSetMember

// ---------------------------------------------------------------------------
// _global member reads
// ---------------------------------------------------------------------------

describe("_global member access reads", () => {
  it("_global.MyClass — compiles without error", () => {
    expect(compilesOk("_global.MyClass;")).toBe(true);
  });

  it("_global.MyClass — emits ActionGetMember (0x4f) or ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("_global.MyClass;");
    const hasGetMember   = containsByte(bytes, ACTION_GET_MEMBER);
    const hasGetVariable = containsByte(bytes, ACTION_GET_VARIABLE);
    expect(hasGetMember || hasGetVariable).toBe(true);
    expect(containsString(bytes, "_global")).toBe(true);
  });

  it("_global.Array — compiles without error", () => {
    expect(compilesOk("_global.Array;")).toBe(true);
  });

  it("_global.Array — emits ActionGetMember (0x4f) or ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("_global.Array;");
    const hasGetMember   = containsByte(bytes, ACTION_GET_MEMBER);
    const hasGetVariable = containsByte(bytes, ACTION_GET_VARIABLE);
    expect(hasGetMember || hasGetVariable).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("_global.Object — compiles without error", () => {
    expect(compilesOk("_global.Object;")).toBe(true);
  });

  it("_global.Object — emits ActionGetMember (0x4f) or ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("_global.Object;");
    const hasGetMember   = containsByte(bytes, ACTION_GET_MEMBER);
    const hasGetVariable = containsByte(bytes, ACTION_GET_VARIABLE);
    expect(hasGetMember || hasGetVariable).toBe(true);
    expect(containsString(bytes, "Object")).toBe(true);
  });

  it("_global.trace — compiles without error", () => {
    expect(compilesOk("_global.trace;")).toBe(true);
  });

  it("_global.trace — emits ActionGetMember (0x4f) or ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("_global.trace;");
    const hasGetMember   = containsByte(bytes, ACTION_GET_MEMBER);
    const hasGetVariable = containsByte(bytes, ACTION_GET_VARIABLE);
    expect(hasGetMember || hasGetVariable).toBe(true);
    expect(containsString(bytes, "trace")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _global assignment
// ---------------------------------------------------------------------------

describe("_global member assignment", () => {
  it("_global.someVar = 5 — compiles without error (assignment to global namespace)", () => {
    expect(compilesOk("_global.someVar = 5;")).toBe(true);
  });

  it("_global.someVar = 5 — emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("_global.someVar = 5;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_global")).toBe(true);
    expect(containsString(bytes, "someVar")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global registration pattern
// ---------------------------------------------------------------------------

describe("global registration pattern", () => {
  it("_global.myListener = new Object() — compiles without error", () => {
    expect(compilesOk("_global.myListener = new Object();")).toBe(true);
  });

  it("_global.myListener.onStatus = function(info) {} — compiles without error", () => {
    const src = `
      _global.myListener = new Object();
      _global.myListener.onStatus = function(info) {};
    `;
    expect(compilesOk(src)).toBe(true);
  });

  it("full global registration pattern — compiles without error", () => {
    const src = `
      _global.myListener = new Object();
      _global.myListener.onStatus = function(info) {};
    `;
    expect(compilesOk(src)).toBe(true);
  });

  it("full global registration pattern — emits ActionSetMember (0x4e) for assignments", () => {
    const src = `
      _global.myListener = new Object();
      _global.myListener.onStatus = function(info) {};
    `;
    const bytes = compileAS2(src);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_global")).toBe(true);
    expect(containsString(bytes, "myListener")).toBe(true);
    expect(containsString(bytes, "onStatus")).toBe(true);
  });
});
