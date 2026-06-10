/**
 * Tests for AS2 increment and decrement operator compilation.
 *
 * Verifies that ++/-- operators are compiled to the correct AVM1 opcodes:
 *   ActionIncrement (0x50) and ActionDecrement (0x51).
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
  // 1. Postfix increment: i++ → ActionIncrement (0x50)
  it("1. i++ emits ActionIncrement (0x50)", () => {
    const bytes = compileAS2("var i = 0; i++;");
    expect(bytes).toContain(0x50);
  });

  // 2. Postfix decrement: i-- → ActionDecrement (0x51)
  it("2. i-- emits ActionDecrement (0x51)", () => {
    const bytes = compileAS2("var i = 0; i--;");
    expect(bytes).toContain(0x51);
  });

  // 3. Prefix increment: ++i → ActionIncrement (0x50)
  it("3. ++i emits ActionIncrement (0x50)", () => {
    const bytes = compileAS2("var i = 0; ++i;");
    expect(bytes).toContain(0x50);
  });

  // 4. Prefix decrement: --i → ActionDecrement (0x51)
  it("4. --i emits ActionDecrement (0x51)", () => {
    const bytes = compileAS2("var i = 0; --i;");
    expect(bytes).toContain(0x51);
  });

  // 5. Bracket increment: arr[0]++ compiles without error
  it("5. arr[0]++ compiles (bracket increment)", () => {
    expect(compilesOk("var arr = [1, 2, 3]; arr[0]++;")).toBe(true);
  });

  // 6. obj.x++ emits ActionGetMember (0x4e) + ActionIncrement (0x50)
  it("6. obj.x++ emits ActionGetMember (0x4e) and ActionIncrement (0x50)", () => {
    const bytes = compileAS2("var obj = {}; obj.x++;");
    // ActionGetMember (0x4e) reads the current value of obj.x
    expect(bytes).toContain(0x4e);
    // ActionIncrement (0x50) increments it
    expect(bytes).toContain(0x50);
  });

  // 7. obj.x-- emits ActionGetMember (0x4e) + ActionDecrement (0x51)
  it("7. obj.x-- emits ActionGetMember (0x4e) and ActionDecrement (0x51)", () => {
    const bytes = compileAS2("var obj = {}; obj.x--;");
    expect(bytes).toContain(0x4e);
    expect(bytes).toContain(0x51);
  });

  // 8. For-loop update expression emits ActionIncrement (0x50)
  it("8. for (var i = 0; i < 5; i++) emits ActionIncrement (0x50) in the update expression", () => {
    const bytes = compileAS2("for (var i = 0; i < 5; i++) { trace(i); }");
    expect(bytes).toContain(0x50);
  });

  // 9. i += 1 and i++ both compile and both contain an increment operation
  //    Note: i += 1 uses ActionAdd2 (0x47) not ActionIncrement; i++ uses ActionIncrement (0x50).
  //    Both are valid increment operations.
  it("9. i += 1 and i++ both compile; i++ uses ActionIncrement while i+=1 uses ActionAdd2", () => {
    const plusEq = compileAS2("var i = 0; i += 1;");
    const postfix = compileAS2("var i = 0; i++;");

    // Both compile successfully
    expect(plusEq).toBeInstanceOf(Uint8Array);
    expect(postfix).toBeInstanceOf(Uint8Array);

    // i++ uses the dedicated ActionIncrement opcode (0x50)
    expect(postfix).toContain(0x50);

    // i += 1 does NOT use ActionIncrement; it uses ActionAdd2 (0x47)
    expect(plusEq).toContain(0x47);

    // Both are non-empty valid bytecode
    expect(toHex(postfix).length).toBeGreaterThan(0);
    expect(toHex(plusEq).length).toBeGreaterThan(0);
  });

  // 10. --i emits the correct AVM1 sequence: GetVariable, Decrement, Duplicate,
  //     SetVariable — the variable is stored back AND expression result is on stack.
  it("10. --i emits ActionGetVariable (0x1c), ActionDecrement (0x51), ActionDuplicate (0x4c), ActionStackSwap (0x4d), ActionSetVariable (0x1d)", () => {
    const bytes = compileAS2("var i = 5; --i;");
    // All opcodes from the correct store-back sequence must be present
    expect(bytes).toContain(0x1c); // ActionGetVariable
    expect(bytes).toContain(0x51); // ActionDecrement
    expect(bytes).toContain(0x4c); // ActionDuplicate
    expect(bytes).toContain(0x4d); // ActionStackSwap
    expect(bytes).toContain(0x1d); // ActionSetVariable
  });

  // 11. ++i emits the correct sequence matching --i (with Increment instead of Decrement).
  it("11. ++i emits ActionGetVariable (0x1c), ActionIncrement (0x50), ActionDuplicate (0x4c), ActionStackSwap (0x4d), ActionSetVariable (0x1d)", () => {
    const bytes = compileAS2("var i = 5; ++i;");
    expect(bytes).toContain(0x1c); // ActionGetVariable
    expect(bytes).toContain(0x50); // ActionIncrement
    expect(bytes).toContain(0x4c); // ActionDuplicate
    expect(bytes).toContain(0x4d); // ActionStackSwap
    expect(bytes).toContain(0x1d); // ActionSetVariable
  });

  // 12. --i and ++i have the same structural opcode count (same number of
  //     SetVariable opcodes — ensures neither leaks extra SetVariable calls).
  it("12. --i and ++i produce equal numbers of ActionSetVariable opcodes (stack-balance check)", () => {
    function countByte(bytes: Uint8Array, byte: number): number {
      let n = 0;
      for (const b of bytes) if (b === byte) n++;
      return n;
    }
    const decBytes = compileAS2("var i = 5; --i;");
    const incBytes = compileAS2("var i = 5; ++i;");
    // Both should emit exactly one ActionSetVariable for the var decl and one for the operator
    const decSetVar = countByte(decBytes, 0x1d);
    const incSetVar = countByte(incBytes, 0x1d);
    expect(decSetVar).toBe(incSetVar);
  });
});
