/**
 * Tests for AS2 labeled loop statements (break/continue with label).
 *
 * Verifies that labeled break and labeled continue compile without error
 * for for-loops, while-loops, and nested combinations.
 *
 * Detailed bytecode-level coverage lives in labeled.test.ts. This file
 * focuses on the compile-or-not surface for common patterns.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function compilesOk(src: string): void {
  expect(() => compileAS2(src)).not.toThrow();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 labeled loops and break/continue", () => {
  it("labeled break compiles", () => {
    compilesOk(`
      outerLoop: for (var i = 0; i < 10; i++) {
        for (var j = 0; j < 10; j++) {
          if (j === 5) break outerLoop;
        }
      }
    `);
  });

  it("labeled continue compiles", () => {
    compilesOk(`
      outer: for (var i = 0; i < 5; i++) {
        for (var j = 0; j < 5; j++) {
          if (j === 2) continue outer;
          trace(j);
        }
      }
    `);
  });

  it("plain break (no label) compiles", () => {
    compilesOk(`
      for (var i = 0; i < 10; i++) {
        if (i > 5) break;
      }
    `);
  });

  it("plain continue (no label) compiles", () => {
    compilesOk(`
      for (var i = 0; i < 10; i++) {
        if (i % 2 === 0) continue;
        trace(i);
      }
    `);
  });

  it("nested labeled loops compile", () => {
    compilesOk(`
      a: for (var i = 0; i < 3; i++) {
        b: for (var j = 0; j < 3; j++) {
          c: for (var k = 0; k < 3; k++) {
            if (k === 1) break b;
          }
        }
      }
    `);
  });

  it("labeled while loop compiles", () => {
    compilesOk(`
      search: while (true) {
        var found = doSearch();
        if (found) break search;
      }
    `);
  });

  it("compiled output is a non-empty Uint8Array for labeled break", () => {
    const bytes = compileAS2(`
      outer: for (var i = 0; i < 5; i++) {
        if (i === 3) break outer;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("compiled output is a non-empty Uint8Array for labeled continue", () => {
    const bytes = compileAS2(`
      outer: for (var i = 0; i < 5; i++) {
        for (var j = 0; j < 5; j++) {
          if (j === 1) continue outer;
        }
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("labeled do-while loop compiles", () => {
    compilesOk(`
      loop: do {
        var x = getValue();
        if (x < 0) break loop;
      } while (x < 10);
    `);
  });

  it("multiple labeled loops at same level compile", () => {
    compilesOk(`
      first: for (var i = 0; i < 3; i++) {
        if (i === 1) break first;
      }
      second: for (var j = 0; j < 3; j++) {
        if (j === 2) break second;
      }
    `);
  });
});
