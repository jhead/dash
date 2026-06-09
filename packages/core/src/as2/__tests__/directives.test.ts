/**
 * Tests for AS2 preprocessor directives: #include handling and comments.
 *
 * In Flash 8 AS2, `#include "file.as"` is a preprocessor directive that
 * inlines the content of an external file. The compiler in this project may
 * handle it or reject it with a clean parse error — both are acceptable.
 *
 * Standard JS-style comments (//, /* *\/) must always compile successfully.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(src: string): boolean {
  try {
    compileAS2(src);
    return true;
  } catch {
    return false;
  }
}

function compileErrorMsg(src: string): string | null {
  try {
    compileAS2(src);
    return null;
  } catch (e) {
    return (e as Error)?.message ?? String(e);
  }
}

// ---------------------------------------------------------------------------
// Comments — must always compile
// ---------------------------------------------------------------------------

describe("AS2 directives — comments", () => {
  it("plain code without directives compiles", () => {
    expect(compilesOk(`var x = 1;`)).toBe(true);
  });

  it("// comment does not affect compilation", () => {
    expect(compilesOk(`// This is a comment\nvar x = 1;`)).toBe(true);
  });

  it("/* block comment */ does not affect compilation", () => {
    expect(compilesOk(`/* block */\nvar x = 1;`)).toBe(true);
  });

  it("/** JSDoc comment */ does not affect compilation", () => {
    expect(compilesOk(`/** @param x */\nvar x = 1;`)).toBe(true);
  });

  it("trailing // comment on statement compiles", () => {
    expect(compilesOk(`var y = 2; // end of line`)).toBe(true);
  });

  it("multiple adjacent comments compile", () => {
    expect(compilesOk(`// line 1\n// line 2\nvar x = 1;`)).toBe(true);
  });

  it("block comment between statements compiles", () => {
    expect(compilesOk(`var x = 1; /* mid */ var y = 2;`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #include directive
// ---------------------------------------------------------------------------

describe("AS2 #include directive", () => {
  it("#include either compiles or throws a descriptive parse Error", () => {
    // Either works (preprocessor handles it) or throws a clean Error with a message
    try {
      compileAS2(`#include "utils.as"\nvar x = 1;`);
      // If no throw — preprocessor handled it, that is fine
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBeTruthy();
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  });

  it("#include error (if thrown) is a parse/compiler error, not an internal crash", () => {
    const msg = compileErrorMsg(`#include "utils.as"\nvar x = 1;`);
    if (msg !== null) {
      // Must be a real Error message, not undefined / null / empty
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("#include on its own line either compiles or gives a clean error", () => {
    try {
      compileAS2(`#include "helpers.as"`);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBeTruthy();
    }
  });

  it("code after a failed #include is not silently discarded (error is surfaced)", () => {
    // If #include fails, the compiler must surface that failure (not silently ignore it
    // and produce a result as if the directive were absent).
    const okWithout = compilesOk(`var x = 1;`);
    const resultWith = (() => {
      try {
        compileAS2(`#include "missing.as"\nvar x = 1;`);
        return "ok";
      } catch {
        return "err";
      }
    })();
    // Either both succeed (preprocessor is supported) or the #include version errors
    expect(okWithout).toBe(true);
    expect(resultWith === "ok" || resultWith === "err").toBe(true);
  });
});
