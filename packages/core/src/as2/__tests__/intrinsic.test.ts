/**
 * Tests for AS2 `intrinsic` keyword behavior.
 *
 * In Flash 8 AS2, `intrinsic` declares built-in type stubs (e.g. Array, String).
 * These classes have method stubs with no body and are not compiled to bytecode —
 * they exist only for the type-checker / IDE tooling.
 *
 * Current parser status: `intrinsic` IS recognized as a keyword token by the
 * tokenizer but the parser does not handle it in any grammar production.
 * Attempting to use it produces a clean parse error:
 *   "Parse error at line N: unexpected token \"intrinsic\" (keyword)"
 *
 * This is the documented behavior. If intrinsic support is added later, these
 * tests should be updated to assert compilesOk() instead.
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
// intrinsic class declarations
// ---------------------------------------------------------------------------

describe("intrinsic class declarations", () => {
  it("intrinsic class Array {} — throws a specific parse error, not a crash", () => {
    const err = compileError("intrinsic class Array {}");
    expect(err).not.toBeNull();
    // Must be a meaningful parse error, not an uncaught internal error
    expect(err).toMatch(/intrinsic|unexpected|parse error/i);
  });

  it("intrinsic class Array {} — error message names the unexpected token", () => {
    const err = compileError("intrinsic class Array {}");
    // The tokenizer recognizes 'intrinsic' as a keyword, so the error
    // should identify it as "intrinsic" (keyword), not as a garbled token.
    expect(err).toMatch(/intrinsic/);
  });

  it("intrinsic class Object {} — throws parse error", () => {
    const err = compileError("intrinsic class Object {}");
    expect(err).not.toBeNull();
    expect(err).toMatch(/intrinsic|unexpected|parse error/i);
  });

  it("intrinsic class String with method stub — throws parse error", () => {
    const src = "intrinsic class String { function charAt(n:Number):String; }";
    const err = compileError(src);
    expect(err).not.toBeNull();
    expect(err).toMatch(/intrinsic|unexpected|parse error/i);
  });
});

// ---------------------------------------------------------------------------
// Regular class still compiles after an intrinsic definition attempt
// ---------------------------------------------------------------------------

describe("regular class compiles independently of intrinsic", () => {
  it("class Foo {} compiles fine on its own", () => {
    expect(compilesOk("class Foo {}")).toBe(true);
  });

  it("class Foo {} compiles fine even after an intrinsic parse attempt", () => {
    // Verify the compiler is stateless between calls — a failed intrinsic
    // parse on one call must not poison subsequent compilations.
    compileError("intrinsic class Array {}"); // intentionally fails
    expect(compilesOk("class Foo {}")).toBe(true);
  });

  it("class with method compiles fine", () => {
    expect(compilesOk("class Foo { function bar():Void {} }")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exact error message contract
// ---------------------------------------------------------------------------

describe("intrinsic parse error message contract", () => {
  it("error message includes the line number", () => {
    const err = compileError("intrinsic class Array {}");
    expect(err).toMatch(/line \d+/i);
  });

  it("error is a Parse error, not an internal TypeError or RangeError", () => {
    // compileAS2 should throw a descriptive Error, not crash the runtime
    let threw = false;
    let errorKind = "";
    try {
      compileAS2("intrinsic class Array {}");
    } catch (e: unknown) {
      threw = true;
      if (e instanceof Error) errorKind = e.constructor.name;
    }
    expect(threw).toBe(true);
    // Should be a plain Error (parse error), not a TypeError / RangeError
    expect(errorKind).not.toBe("TypeError");
    expect(errorKind).not.toBe("RangeError");
  });
});
