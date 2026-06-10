/**
 * Tests for AS2 compiler: Date class construction and method calls.
 *
 * Verifies that Date constructor calls, instance method calls, and static
 * method calls compile without error and emit the correct AVM1 opcodes:
 *   - ActionNew        (0x40): constructor calls (new Date(...))
 *   - ActionCallMethod (0x52): method calls (d.getTime(), d.setTime(), etc.)
 *
 * Covers: new Date(), new Date(year, month, day), d.getTime(), d.setTime(),
 * d.getFullYear(), d.getMonth(), d.getDate(), d.getDay(), d.getHours(),
 * d.getMinutes(), d.getSeconds(), d.toString(), Date.UTC().
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

const ACTION_NEW         = 0x40; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch

// ---------------------------------------------------------------------------
// Date constructor
// ---------------------------------------------------------------------------

describe("Date constructor", () => {
  it("new Date() compiles without error", () => {
    expect(compilesOk("new Date();")).toBe(true);
  });

  it("new Date() emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new Date();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Date")).toBe(true);
  });

  it("new Date(2006, 0, 1) compiles without error", () => {
    expect(compilesOk("new Date(2006, 0, 1);")).toBe(true);
  });

  it("new Date(2006, 0, 1) emits ActionNew (0x40)", () => {
    const bytes = compileAS2("new Date(2006, 0, 1);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Date")).toBe(true);
  });

  it("var d = new Date() compiles without error", () => {
    expect(compilesOk("var d = new Date();")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// d.getTime() and d.setTime()
// ---------------------------------------------------------------------------

describe("Date getTime() and setTime()", () => {
  it("d.getTime() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getTime();")).toBe(true);
  });

  it("d.getTime() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getTime();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getTime")).toBe(true);
  });

  it("d.setTime(ms) compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.setTime(1000);")).toBe(true);
  });

  it("d.setTime(ms) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.setTime(1000);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "setTime")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Date getter methods
// ---------------------------------------------------------------------------

describe("Date getter methods", () => {
  it("d.getFullYear() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getFullYear();")).toBe(true);
  });

  it("d.getFullYear() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getFullYear();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getFullYear")).toBe(true);
  });

  it("d.getMonth() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getMonth();")).toBe(true);
  });

  it("d.getMonth() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getMonth();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getMonth")).toBe(true);
  });

  it("d.getDate() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getDate();")).toBe(true);
  });

  it("d.getDate() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getDate();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getDate")).toBe(true);
  });

  it("d.getDay() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getDay();")).toBe(true);
  });

  it("d.getDay() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getDay();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getDay")).toBe(true);
  });

  it("d.getHours() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getHours();")).toBe(true);
  });

  it("d.getHours() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getHours();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getHours")).toBe(true);
  });

  it("d.getMinutes() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getMinutes();")).toBe(true);
  });

  it("d.getMinutes() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getMinutes();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getMinutes")).toBe(true);
  });

  it("d.getSeconds() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getSeconds();")).toBe(true);
  });

  it("d.getSeconds() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.getSeconds();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "getSeconds")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// d.toString()
// ---------------------------------------------------------------------------

describe("Date toString()", () => {
  it("d.toString() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.toString();")).toBe(true);
  });

  it("d.toString() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("var d = new Date(); d.toString();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toString")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Date.UTC() static method
// ---------------------------------------------------------------------------

describe("Date.UTC() static method", () => {
  it("Date.UTC(2006, 0, 1) compiles without error", () => {
    expect(compilesOk("Date.UTC(2006, 0, 1);")).toBe(true);
  });

  it("Date.UTC(2006, 0, 1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Date.UTC(2006, 0, 1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "UTC")).toBe(true);
    expect(containsString(bytes, "Date")).toBe(true);
  });
});
