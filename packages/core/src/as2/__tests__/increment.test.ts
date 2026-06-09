/**
 * Tests for AS2 increment and decrement operator compilation.
 *
 * Verifies that ++/-- operators are compiled to the correct AVM1 opcodes:
 *   ActionIncrement (0x47) and ActionDecrement (0x48).
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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 increment/decrement operators", () => {
  // 1. Postfix increment: i++ → ActionIncrement (0x47)
  it("1. i++ emits ActionIncrement (0x47)", () => {
    const bytes = compileAS2("var i = 0; i++;");
    expect(bytes).toContain(0x47);
  });

  // 2. Postfix decrement: i-- → ActionDecrement (0x48)
  it("2. i-- emits ActionDecrement (0x48)", () => {
    const bytes = compileAS2("var i = 0; i--;");
    expect(bytes).toContain(0x48);
  });

  // 3. Prefix increment: ++i → ActionIncrement (0x47)
  it("3. ++i emits ActionIncrement (0x47)", () => {
    const bytes = compileAS2("var i = 0; ++i;");
    expect(bytes).toContain(0x47);
  });

  // 4. Prefix decrement: --i → ActionDecrement (0x48)
  it("4. --i emits ActionDecrement (0x48)", () => {
    const bytes = compileAS2("var i = 0; --i;");
    expect(bytes).toContain(0x48);
  });

  // 5. Bracket increment: arr[0]++ compiles without error
  it("5. arr[0]++ compiles (bracket increment)", () => {
    expect(compilesOk("var arr = [1, 2, 3]; arr[0]++;")).toBe(true);
  });

  // 6. obj.x++ emits ActionGetMember (0x4f) + ActionIncrement (0x47)
  it("6. obj.x++ emits ActionGetMember (0x4f) and ActionIncrement (0x47)", () => {
    const bytes = compileAS2("var obj = {}; obj.x++;");
    // ActionGetMember (0x4f) reads the current value of obj.x
    expect(bytes).toContain(0x4f);
    // ActionIncrement (0x47) increments it
    expect(bytes).toContain(0x47);
  });

  // 7. obj.x-- emits ActionGetMember (0x4f) + ActionDecrement (0x48)
  it("7. obj.x-- emits ActionGetMember (0x4f) and ActionDecrement (0x48)", () => {
    const bytes = compileAS2("var obj = {}; obj.x--;");
    expect(bytes).toContain(0x4f);
    expect(bytes).toContain(0x48);
  });

  // 8. For-loop update expression emits ActionIncrement (0x47)
  it("8. for (var i = 0; i < 5; i++) emits ActionIncrement (0x47) in the update expression", () => {
    const bytes = compileAS2("for (var i = 0; i < 5; i++) { trace(i); }");
    expect(bytes).toContain(0x47);
  });

  // 9. i += 1 and i++ both compile and both contain an increment operation
  //    Note: i += 1 uses ActionAdd2 (0x64) not ActionIncrement; i++ uses ActionIncrement (0x47).
  //    Both are valid increment operations.
  it("9. i += 1 and i++ both compile; i++ uses ActionIncrement while i+=1 uses ActionAdd2", () => {
    const plusEq = compileAS2("var i = 0; i += 1;");
    const postfix = compileAS2("var i = 0; i++;");

    // Both compile successfully
    expect(plusEq).toBeInstanceOf(Uint8Array);
    expect(postfix).toBeInstanceOf(Uint8Array);

    // i++ uses the dedicated ActionIncrement opcode (0x47)
    expect(postfix).toContain(0x47);

    // i += 1 does NOT use ActionIncrement; it uses ActionAdd2 (0x64)
    expect(plusEq).toContain(0x64);

    // Both are non-empty valid bytecode
    expect(toHex(postfix).length).toBeGreaterThan(0);
    expect(toHex(plusEq).length).toBeGreaterThan(0);
  });
});
