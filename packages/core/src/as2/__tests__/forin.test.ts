/**
 * Tests for AS2 for..in statement compilation.
 *
 * Verifies correct AVM1 bytecode generation for:
 *   - Basic for (var k in obj) {} loop
 *   - ActionEnumerate2 (0x55) emission
 *   - Loop variable name in bytecode
 *   - break inside for..in
 *   - Nested for..in loops
 *   - for..in with expression (not just variable identifier) on the left
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

function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
}

// ---------------------------------------------------------------------------
// for..in compilation tests
// ---------------------------------------------------------------------------

describe("AS2 for..in statement compilation", () => {
  // Test 1: basic for (var k in obj) {} compiles without error
  it("1. for (var k in obj) {} compiles without error", () => {
    expect(compilesOk(`
      var obj = {};
      for (var k in obj) {}
    `)).toBe(true);
  });

  // Test 2: compiled output contains ActionEnumerate2 (0x55)
  it("2. compiled output contains ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2(`
      var obj = {};
      for (var k in obj) {}
    `);
    expect(bytes).toContain(0x55);
  });

  // Test 3: loop variable name appears in bytecode
  it("3. loop variable name appears in bytecode", () => {
    const bytes = compileAS2(`
      var obj = {};
      for (var myKey in obj) {}
    `);
    expect(containsString(bytes, "myKey")).toBe(true);
  });

  // Test 4: for..in loop body executes — body variable name appears
  it("4. for..in body is compiled and body variable names appear", () => {
    const bytes = compileAS2(`
      var obj = {};
      var result = 0;
      for (var k in obj) {
        result = result + 1;
      }
    `);
    expect(bytes).toContain(0x55); // ActionEnumerate2
    expect(containsString(bytes, "result")).toBe(true);
    expect(containsString(bytes, "k")).toBe(true);
  });

  // Test 5: break inside for..in compiles without error
  it("5. break inside for..in compiles without error", () => {
    expect(compilesOk(`
      var obj = {};
      for (var k in obj) {
        break;
      }
    `)).toBe(true);
  });

  // Test 6: break inside for..in emits ActionJump (0x99)
  it("6. break inside for..in emits ActionJump (0x99)", () => {
    const bytes = compileAS2(`
      var obj = {};
      for (var k in obj) {
        break;
      }
    `);
    expect(bytes).toContain(0x99);
  });

  // Test 7: nested for..in loops compile without error
  it("7. nested for..in loops compile without error", () => {
    expect(compilesOk(`
      var outer = {};
      var inner = {};
      for (var k in outer) {
        for (var j in inner) {}
      }
    `)).toBe(true);
  });

  // Test 8: nested for..in loops each emit ActionEnumerate2
  it("8. nested for..in loops each emit ActionEnumerate2 (0x55 appears twice)", () => {
    const bytes = compileAS2(`
      var outer = {};
      var inner = {};
      for (var k in outer) {
        for (var j in inner) {}
      }
    `);
    expect(countByte(bytes, 0x55)).toBeGreaterThanOrEqual(2);
  });

  // Test 9: for..in with non-var identifier on the left compiles without error
  it("9. for (k in obj) with existing identifier on left compiles without error", () => {
    expect(compilesOk(`
      var obj = {};
      var k;
      for (k in obj) {}
    `)).toBe(true);
  });

  // Test 10: for..in with identifier on left still emits ActionEnumerate2
  it("10. for (k in obj) still emits ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2(`
      var obj = {};
      var k;
      for (k in obj) {}
    `);
    expect(bytes).toContain(0x55);
  });

  // Test 11: for..in emits ActionDuplicate (0x4c) for sentinel check
  it("11. compiled output contains ActionDuplicate (0x4c) for sentinel check", () => {
    const bytes = compileAS2(`
      var obj = {};
      for (var k in obj) {}
    `);
    expect(bytes).toContain(0x4c); // ActionDuplicate
  });

  // Test 12: for..in emits ActionEquals2 (0x49) for undefined sentinel comparison
  it("12. compiled output contains ActionEquals2 (0x49) for undefined sentinel comparison", () => {
    const bytes = compileAS2(`
      var obj = {};
      for (var k in obj) {}
    `);
    expect(bytes).toContain(0x49); // ActionEquals2
  });

  // Test 13: for..in with body referencing the loop variable
  it("13. for..in body uses loop variable — both obj name and var name in bytecode", () => {
    const bytes = compileAS2(`
      var myObj = {};
      for (var propName in myObj) {
        var val = myObj[propName];
      }
    `);
    expect(bytes).toContain(0x55);
    expect(containsString(bytes, "propName")).toBe(true);
    expect(containsString(bytes, "myObj")).toBe(true);
    expect(containsString(bytes, "val")).toBe(true);
  });

  // Test 14: continue inside for..in compiles without error
  it("14. continue inside for..in compiles without error", () => {
    expect(compilesOk(`
      var obj = {};
      for (var k in obj) {
        continue;
      }
    `)).toBe(true);
  });

  // Test 15: labeled for..in with labeled break compiles without error
  it("15. labeled for..in with labeled break compiles without error", () => {
    expect(compilesOk(`
      var obj = {};
      outer: for (var k in obj) {
        break outer;
      }
    `)).toBe(true);
  });

  // Test 16: for (var k in obj) { trace(k); } compiles without error
  it("16. for (var k in obj) { trace(k); } compiles without error", () => {
    expect(compilesOk(`
      for (var k in obj) { trace(k); }
    `)).toBe(true);
  });

  // Test 17: bytecode contains ActionEnumerate2 (0x55) for for..in with trace body
  it("17. for..in with trace body contains ActionEnumerate2 (0x55)", () => {
    const bytes = compileAS2(`for (var k in obj) { trace(k); }`);
    expect(bytes).toContain(0x55); // ActionEnumerate2
  });
});

// ---------------------------------------------------------------------------
// delete operator tests
// ---------------------------------------------------------------------------

describe("AS2 delete operator compilation", () => {
  // Test 1: delete obj.prop compiles without error
  it("1. delete obj.prop; compiles without error", () => {
    expect(compilesOk("delete obj.prop;")).toBe(true);
  });

  // Test 2: delete obj.prop bytecode contains ActionDelete (0x3A)
  it("2. delete obj.prop bytecode contains ActionDelete (0x3A)", () => {
    const bytes = compileAS2("delete obj.prop;");
    expect(bytes).toContain(0x3a); // ActionDelete
  });

  // Test 3: delete localVar compiles without error
  it("3. delete localVar; compiles without error", () => {
    expect(compilesOk("delete localVar;")).toBe(true);
  });

  // Test 4: delete localVar bytecode contains ActionDelete2 (0x3B)
  it("4. delete localVar bytecode contains ActionDelete2 (0x3B)", () => {
    const bytes = compileAS2("delete localVar;");
    expect(bytes).toContain(0x3b); // ActionDelete2
  });
});
