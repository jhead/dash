/**
 * Tests for AS2 comma operator and sequence expression support.
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

function containsByte(bytes: Uint8Array, b: number): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === b) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Multi-variable declarations
// ---------------------------------------------------------------------------

describe("multi-variable declaration (var x = 1, y = 2)", () => {
  it("var x = 1, y = 2, z = 3 — parser supports multi-var declarations", () => {
    expect(compilesOk("var x = 1, y = 2, z = 3;")).toBe(true);
  });

  it("single var declaration still compiles fine", () => {
    expect(compilesOk("var x = 1;")).toBe(true);
  });

  it("sequential single var declarations compile fine", () => {
    expect(compilesOk("var x = 1; var y = 2; var z = 3;")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// for loop — multi-init (var i = 0, j = 0)
// ---------------------------------------------------------------------------

describe("for loop multi-init (for (var i = 0, j = 0; ...))", () => {
  it("for (var i = 0, j = 0; i < 10; i++) compiles", () => {
    expect(compilesOk("for (var i = 0, j = 0; i < 10; i++) {}")).toBe(true);
  });

  it("for loop with single init var still compiles", () => {
    expect(compilesOk("for (var i = 0; i < 10; i++) {}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// for loop — multi-update (i++, j++)
// ---------------------------------------------------------------------------

describe("for loop comma in update (for (...; ...; i++, j++))", () => {
  it("for (var i = 0; i < 10; i++, j++) compiles", () => {
    expect(compilesOk("for (var i = 0; i < 10; i++, j++) {}")).toBe(true);
  });

  it("for loop with single update expression compiles fine", () => {
    expect(compilesOk("for (var i = 0; i < 10; i++) {}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// void expression
// ---------------------------------------------------------------------------

describe("void expression", () => {
  it("void fn() compiles — void discards return value", () => {
    expect(compilesOk("void fn();")).toBe(true);
  });

  it("void 0 compiles — common undefined literal pattern", () => {
    expect(compilesOk("void 0;")).toBe(true);
  });

  it("void with complex expression compiles", () => {
    expect(compilesOk("void (x + 1);")).toBe(true);
  });

  it("void result can be assigned", () => {
    expect(compilesOk("var u = void 0;")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comma operator as expression (a++, b++, c)
// ---------------------------------------------------------------------------

describe("comma operator as sequence expression", () => {
  it("(a++, b++, c) compiles", () => {
    expect(compilesOk("(a++, b++, c);")).toBe(true);
  });

  it("(a++, b++) emits ActionPop (0x17) to discard intermediate results", () => {
    const bytes = compileAS2("(a++, b++);");
    expect(containsByte(bytes, 0x17)).toBe(true);
  });

  it("simple comma-free expressions in parens compile fine", () => {
    expect(compilesOk("(a++);")).toBe(true);
  });
});
