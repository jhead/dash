/**
 * Tests for AS2 with-statement and _global namespace compilation.
 *
 * Verifies that with(obj) { ... } compiles to ActionWith (0x94) and that
 * _global namespace assignments compile without error.
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

function countByte(bytes: Uint8Array, byte: number): number {
  let count = 0;
  for (const b of bytes) if (b === byte) count++;
  return count;
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
// Tests
// ---------------------------------------------------------------------------

const ACTION_WITH = 0x94;

describe("AS2 with statement and _global namespace", () => {
  it("1. with(obj) { trace(x); } emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with (obj) { trace(x); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("2. with(obj) { x = 5; trace(y); } emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with (obj) { x = 5; trace(y); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("3. nested with — with(obj) { with(obj2) { trace(z); } } emits 2x ActionWith (0x94)", () => {
    const bytes = compileAS2("with (obj) { with (obj2) { trace(z); } }");
    expect(countByte(bytes, ACTION_WITH)).toBeGreaterThanOrEqual(2);
  });

  it("4. with(Math) { trace(abs(-5)); } compiles", () => {
    expect(compilesOk("with (Math) { trace(abs(-5)); }")).toBe(true);
  });

  it("5. body after ActionWith contains the inner statements", () => {
    const bytes = compileAS2("with (obj) { trace(innerVar); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
    expect(containsString(bytes, "innerVar")).toBe(true);
  });

  it("6. _global.myPackage = {} compiles (global assignment)", () => {
    expect(compilesOk("_global.myPackage = {};")).toBe(true);
  });

  it("7. _global.myPackage.MyClass = function() {} compiles", () => {
    expect(compilesOk("_global.myPackage.MyClass = function() {};")).toBe(true);
  });
});
