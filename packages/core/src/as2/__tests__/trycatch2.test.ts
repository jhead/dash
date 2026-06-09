/**
 * Tests for AS2 exception handling — throw, try/catch/finally compilation.
 *
 * Verifies that throw, try/catch, and try/finally compile to the correct
 * AVM1 opcodes: ActionTry (0x8F) and ActionThrow (0x2A).
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ACTION_TRY   = 0x8f;
const ACTION_THROW = 0x2a;

describe("AS2 exception handling (throw / try-catch-finally)", () => {
  it("1. try { trace(1); } catch(e:Error) { trace(e.message); } emits ActionTry (0x8F)", () => {
    const bytes = compileAS2(`try { trace(1); } catch(e:Error) { trace(e.message); }`);
    expect(containsByte(bytes, ACTION_TRY)).toBe(true);
  });

  it("2. try { } finally { trace('done'); } emits ActionTry (0x8F)", () => {
    const bytes = compileAS2(`try { } finally { trace("done"); }`);
    expect(containsByte(bytes, ACTION_TRY)).toBe(true);
  });

  it("3. try { } catch(e) { } finally { } compiles", () => {
    expect(compilesOk(`try { } catch(e) { } finally { }`)).toBe(true);
  });

  it("4. throw new Error('msg') emits ActionThrow (0x2A)", () => {
    const bytes = compileAS2(`throw new Error("msg");`);
    expect(containsByte(bytes, ACTION_THROW)).toBe(true);
  });

  it("5. throw 'string' emits ActionThrow (0x2A)", () => {
    const bytes = compileAS2(`throw "string";`);
    expect(containsByte(bytes, ACTION_THROW)).toBe(true);
  });

  it("6. throw 42 emits ActionThrow (0x2A)", () => {
    const bytes = compileAS2(`throw 42;`);
    expect(containsByte(bytes, ACTION_THROW)).toBe(true);
  });

  it("7. nested try-catch: try { try { } catch(e) { } } catch(e2) { } compiles", () => {
    expect(compilesOk(`try { try { } catch(e) { } } catch(e2) { }`)).toBe(true);
  });

  it("8. re-throw: catch(e) { throw e; } emits ActionThrow (0x2A)", () => {
    const bytes = compileAS2(`try { } catch(e) { throw e; }`);
    expect(containsByte(bytes, ACTION_THROW)).toBe(true);
  });

  it("9. custom error class: class MyError extends Error {} throw new MyError() compiles", () => {
    expect(compilesOk(`class MyError extends Error {} throw new MyError();`)).toBe(true);
  });
});
