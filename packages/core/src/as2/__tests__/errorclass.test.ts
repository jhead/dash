/**
 * Tests for AS2 parser + compiler: Error class and custom error classes.
 *
 * Verifies that:
 *  - new Error("msg") compiles and emits ActionNew (0x40)
 *  - e.message and e.name emit ActionGetMember (0x4e)
 *  - Custom classes extending Error compile without error
 *  - throw new MyError("oops") in a try/catch compiles
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

const ACTION_NEW = 0x40;        // ActionNew
const ACTION_GET_MEMBER = 0x4e; // ActionGetMember

// ---------------------------------------------------------------------------
// Basic Error construction
// ---------------------------------------------------------------------------

describe("AS2 Error class", () => {
  it("1. new Error('msg') compiles without error", () => {
    expect(compilesOk(`new Error("msg");`)).toBe(true);
  });

  it("2. new Error('msg') emits ActionNew (0x40)", () => {
    const bytes = compileAS2(`new Error("msg");`);
    expect(bytes).toContain(ACTION_NEW);
  });

  it("3. new Error('msg') includes 'Error' string in bytecode", () => {
    const bytes = compileAS2(`new Error("msg");`);
    expect(containsString(bytes, "Error")).toBe(true);
  });

  it("4. var e = new Error('oops') compiles without error", () => {
    expect(compilesOk(`var e = new Error("oops");`)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Property access on Error instances
  // ---------------------------------------------------------------------------

  it("5. e.message compiles without error", () => {
    expect(compilesOk(`var e = new Error("oops"); var m = e.message;`)).toBe(true);
  });

  it("6. e.message emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(`var e = new Error("oops"); var m = e.message;`);
    expect(bytes).toContain(ACTION_GET_MEMBER);
    expect(containsString(bytes, "message")).toBe(true);
  });

  it("7. e.name compiles without error", () => {
    expect(compilesOk(`var e = new Error("oops"); var n = e.name;`)).toBe(true);
  });

  it("8. e.name emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(`var e = new Error("oops"); var n = e.name;`);
    expect(bytes).toContain(ACTION_GET_MEMBER);
    expect(containsString(bytes, "name")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Custom error class extending Error
  // ---------------------------------------------------------------------------

  it("9. custom class extending Error compiles without error", () => {
    expect(
      compilesOk(`
        class MyError extends Error {
          function MyError(m:String) {
            super(m);
            this.name = "MyError";
          }
        }
      `)
    ).toBe(true);
  });

  it("10. custom error class includes class and parent names in bytecode", () => {
    const bytes = compileAS2(`
      class MyError extends Error {
        function MyError(m:String) {
          super(m);
          this.name = "MyError";
        }
      }
    `);
    expect(containsString(bytes, "MyError")).toBe(true);
    expect(containsString(bytes, "Error")).toBe(true);
    // extends sets up prototype chain with ActionNew
    expect(bytes).toContain(ACTION_NEW);
  });

  // ---------------------------------------------------------------------------
  // throw new MyError(...) inside try/catch
  // ---------------------------------------------------------------------------

  it("11. throw new Error('oops') inside try/catch compiles without error", () => {
    expect(
      compilesOk(`
        try {
          throw new Error("oops");
        } catch (e) {
          var msg = e.message;
        }
      `)
    ).toBe(true);
  });

  it("12. throw new Error emits ActionThrow (0x2a) and ActionNew (0x40)", () => {
    const bytes = compileAS2(`
      try {
        throw new Error("oops");
      } catch (e) { }
    `);
    expect(bytes).toContain(0x2a); // ActionThrow
    expect(bytes).toContain(ACTION_NEW);
    expect(containsString(bytes, "Error")).toBe(true);
  });

  it("13. throw new MyError('oops') with custom error class compiles without error", () => {
    expect(
      compilesOk(`
        class MyError extends Error {
          function MyError(m:String) {
            super(m);
            this.name = "MyError";
          }
        }
        try {
          throw new MyError("oops");
        } catch (e) {
          var msg = e.message;
        }
      `)
    ).toBe(true);
  });

  it("14. try/catch with custom Error subclass emits ActionTry (0x8f)", () => {
    const bytes = compileAS2(`
      class MyError extends Error {
        function MyError(m:String) {
          super(m);
          this.name = "MyError";
        }
      }
      try {
        throw new MyError("oops");
      } catch (e) {
        var msg = e.message;
      }
    `);
    expect(bytes).toContain(0x8f); // ActionTry
    expect(bytes).toContain(0x2a); // ActionThrow
    expect(containsString(bytes, "MyError")).toBe(true);
  });
});
