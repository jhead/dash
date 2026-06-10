/**
 * Tests for AS2 comma operator and sequence expression support.
 *
 * Documents the current parser behavior for comma-separated constructs:
 * multi-variable declarations, for-loop multi-init/update, void expressions,
 * and the comma operator as a sequence expression.
 *
 * NOTE: Multi-variable var declarations ARE supported (var x = 1, y = 2).
 * The comma operator as a standalone expression is NOT supported.
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

function compileError(source: string): string | null {
  try {
    compileAS2(source);
    return null;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------------
// Multi-variable declarations
// ---------------------------------------------------------------------------

describe("multi-variable declaration (var x = 1, y = 2)", () => {
  it("var x = 1, y = 2, z = 3 — parser supports multi-var declarations", () => {
    // The AS2 parser supports multiple comma-separated declarators per var statement.
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
  it("for (var i = 0, j = 0; i < 10; i++) — parser does not support multi-init; throws parse error", () => {
    const err = compileError("for (var i = 0, j = 0; i < 10; i++) {}");
    expect(err).not.toBeNull();
    expect(err).toMatch(/unexpected token.*,|expected.*got.*,/i);
  });

  it("for loop with single init var still compiles", () => {
    expect(compilesOk("for (var i = 0; i < 10; i++) {}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// for loop — multi-update (i++, j++)
// ---------------------------------------------------------------------------

describe("for loop comma in update (for (...; ...; i++, j++))", () => {
  it("for (var i = 0; i < 10; i++, j++) — parser does not support comma in update; throws parse error", () => {
    const err = compileError("for (var i = 0; i < 10; i++, j++) {}");
    expect(err).not.toBeNull();
    expect(err).toMatch(/expected.*\).*got.*,|unexpected.*,/i);
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
  it("(a++, b++, c) — parser does not support comma operator; throws parse error", () => {
    // The comma operator is not supported in the AS2 parser expression grammar.
    const err = compileError("(a++, b++, c);");
    expect(err).not.toBeNull();
    expect(err).toMatch(/expected.*\).*got.*,|unexpected.*,/i);
  });

  it("simple comma-free expressions in parens compile fine", () => {
    expect(compilesOk("(a++);")).toBe(true);
  });
});
