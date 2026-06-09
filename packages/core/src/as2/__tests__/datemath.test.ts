/**
 * Tests for AS2 compiler: Date and Math class usage, global type-conversion
 * functions, and the built-in Array constructor.
 *
 * Each test passes its snippet through compileAS2() and asserts that no
 * exception is thrown (i.e. the snippet compiles without error).
 *
 * Notes on known gaps:
 *   - `Date.now()` — AS2/AVM1 does not define a static `Date.now` method.
 *     The compiler emits ActionCallMethod which is syntactically valid, so it
 *     *compiles* without error even though it has no runtime equivalent.
 *     The test is marked with a comment rather than skipped.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Date constructor
// ---------------------------------------------------------------------------

describe("Date constructor", () => {
  it("new Date() compiles without error", () => {
    expect(compilesOk("new Date()")).toBe(true);
  });

  it("new Date(2024, 1, 1) compiles without error", () => {
    expect(compilesOk("new Date(2024, 1, 1)")).toBe(true);
  });

  it("var d = new Date(); d.getTime() compiles without error", () => {
    expect(compilesOk("var d = new Date(); d.getTime()")).toBe(true);
  });

  // Date.now() is not a standard AS2/AVM1 method, but the compiler emits
  // ActionCallMethod which is syntactically valid — compiles without error.
  it("Date.now() compiles without error (may have no runtime effect in AVM1)", () => {
    expect(compilesOk("Date.now()")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Math static methods and properties
// ---------------------------------------------------------------------------

describe("Math static methods", () => {
  it("Math.round(x) compiles without error", () => {
    expect(compilesOk("Math.round(x)")).toBe(true);
  });

  it("Math.floor(x) compiles without error", () => {
    expect(compilesOk("Math.floor(x)")).toBe(true);
  });

  it("Math.ceil(x) compiles without error", () => {
    expect(compilesOk("Math.ceil(x)")).toBe(true);
  });

  it("Math.random() compiles without error", () => {
    expect(compilesOk("Math.random()")).toBe(true);
  });

  it("Math.sqrt(x) compiles without error", () => {
    expect(compilesOk("Math.sqrt(x)")).toBe(true);
  });

  it("Math.max(a, b) compiles without error", () => {
    expect(compilesOk("Math.max(a, b)")).toBe(true);
  });

  it("Math.min(a, b) compiles without error", () => {
    expect(compilesOk("Math.min(a, b)")).toBe(true);
  });

  it("Math.abs(-1) compiles without error", () => {
    expect(compilesOk("Math.abs(-1)")).toBe(true);
  });

  it("Math.pow(2, 10) compiles without error", () => {
    expect(compilesOk("Math.pow(2, 10)")).toBe(true);
  });
});

describe("Math properties", () => {
  it("Math.PI compiles without error", () => {
    expect(compilesOk("Math.PI")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global conversion functions
// ---------------------------------------------------------------------------

describe("Global conversion functions", () => {
  it('parseInt("42") compiles without error', () => {
    expect(compilesOk('parseInt("42")')).toBe(true);
  });

  it('parseFloat("3.14") compiles without error', () => {
    expect(compilesOk('parseFloat("3.14")')).toBe(true);
  });

  it("isNaN(x) compiles without error", () => {
    expect(compilesOk("isNaN(x)")).toBe(true);
  });

  it("isFinite(x) compiles without error", () => {
    expect(compilesOk("isFinite(x)")).toBe(true);
  });

  it("String(x) compiles without error", () => {
    expect(compilesOk("String(x)")).toBe(true);
  });

  it("Number(x) compiles without error", () => {
    expect(compilesOk("Number(x)")).toBe(true);
  });

  it("Boolean(x) compiles without error", () => {
    expect(compilesOk("Boolean(x)")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Array constructor
// ---------------------------------------------------------------------------

describe("Array constructor", () => {
  it("Array(5) compiles without error", () => {
    expect(compilesOk("Array(5)")).toBe(true);
  });

  it("new Array(5) compiles without error", () => {
    expect(compilesOk("new Array(5)")).toBe(true);
  });
});
