/**
 * Tests for AS2 try/catch/finally compilation (ActionTry / 0x8F).
 *
 * Verifies that try/catch/finally constructs compile to correct AVM1 bytecode
 * with proper ActionTry (0x8F) records, flags, and catch variable names.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 try/catch/finally compilation", () => {
  it("1. try/catch with empty bodies compiles without error", () => {
    expect(compilesOk(`try { } catch(e) { }`)).toBe(true);
  });

  it("2. try/catch output contains ActionTry opcode (0x8F)", () => {
    const bytes = compileAS2(`try { } catch(e) { }`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toContain(0x8f);
  });

  it("3. try/finally (no catch) compiles without error and contains ActionTry", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } finally {
        var z = 99;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toContain(0x8f);
  });

  it("4. try/catch/finally all three compiles without error and contains ActionTry", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (err) {
        var y = 2;
      } finally {
        var z = 3;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toContain(0x8f);
  });

  it("5. catch variable name appears in output bytes as null-terminated string", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (myError) {
        var y = 2;
      }
    `);
    expect(containsString(bytes, "myError")).toBe(true);
  });

  it("6. try/throw/catch with catch variable usage compiles without error", () => {
    const bytes = compileAS2(`
      try {
        throw "err";
      } catch (e) {
        x = e;
      }
    `);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toContain(0x8f);   // ActionTry
    expect(bytes).toContain(0x2a);   // ActionThrow
    expect(containsString(bytes, "e")).toBe(true);
  });

  it("7. ActionTry flags byte is 0x01 for try/catch only", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (ex) {
        var y = 2;
      }
    `);
    const tryPos = bytes.indexOf(0x8f);
    expect(tryPos).toBeGreaterThanOrEqual(0);
    // Record layout: opcode(1) + length UI16(2) + flags UI8(1)
    const flagsByte = bytes[tryPos + 3];
    // HasCatch=1, HasFinally=0, CatchInRegister=0 → 0x01
    expect(flagsByte).toBe(0x01);
  });

  it("8. ActionTry flags byte is 0x02 for try/finally only", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } finally {
        var z = 2;
      }
    `);
    const tryPos = bytes.indexOf(0x8f);
    expect(tryPos).toBeGreaterThanOrEqual(0);
    // HasCatch=0, HasFinally=1 → 0x02
    const flagsByte = bytes[tryPos + 3];
    expect(flagsByte).toBe(0x02);
  });

  it("9. ActionTry flags byte is 0x03 for try/catch/finally", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (e) {
        var y = 2;
      } finally {
        var z = 3;
      }
    `);
    const tryPos = bytes.indexOf(0x8f);
    expect(tryPos).toBeGreaterThanOrEqual(0);
    // HasCatch=1, HasFinally=1 → 0x03
    const flagsByte = bytes[tryPos + 3];
    expect(flagsByte).toBe(0x03);
  });

  it("10. try body statements are compiled into the ActionTry record", () => {
    const bytes = compileAS2(`
      try {
        var myVar = 42;
      } catch (e) { }
    `);
    // The variable name "myVar" should appear in the try body bytes
    expect(containsString(bytes, "myVar")).toBe(true);
  });

  it("11. catch body statements are compiled into the ActionTry record", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (e) {
        var catchVar = 99;
      }
    `);
    expect(containsString(bytes, "catchVar")).toBe(true);
  });

  it("12. finally body statements are compiled into the ActionTry record", () => {
    const bytes = compileAS2(`
      try {
        var x = 1;
      } catch (e) { }
      finally {
        var finallyVar = 0;
      }
    `);
    expect(containsString(bytes, "finallyVar")).toBe(true);
  });
});
