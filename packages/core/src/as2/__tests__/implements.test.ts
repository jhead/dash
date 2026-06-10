/**
 * Tests for ActionImplementsOp (0x2c) emission when a class declares an
 * `implements` clause. Verifies the opcode and stack layout per the AVM1 spec
 * (confirmed against ruffle/core/src/avm1/activation.rs action_implements_op).
 *
 * ActionImplementsOp stack layout (top-first pop order):
 *   constructor  ← class function (popped first)
 *   count        ← number of interfaces (integer)
 *   iface[n-1]   ← last interface constructor
 *   ...
 *   iface[0]     ← first interface constructor (pushed first, popped last)
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe("ActionImplementsOp emission for class implements clauses", () => {
  // -------------------------------------------------------------------------
  // Test 1: Single interface — 0x2c is present
  // -------------------------------------------------------------------------

  it("1. compiles class implements clause — ActionImplementsOp (0x2c) is emitted", () => {
    const src = `
      interface IFoo {}
      class Bar implements IFoo {}
    `;
    const buf = compileAS2(src);
    expect(Array.from(buf)).toContain(0x2c);
  });

  // -------------------------------------------------------------------------
  // Test 2: Class without implements — 0x2c is NOT emitted
  // -------------------------------------------------------------------------

  it("2. class without implements does not emit ActionImplementsOp", () => {
    const buf = compileAS2(`class Bar {}`);
    expect(Array.from(buf)).not.toContain(0x2c);
  });

  // -------------------------------------------------------------------------
  // Test 3: Interface name appears in bytecode (via ActionGetVariable)
  // -------------------------------------------------------------------------

  it("3. interface constructor name is pushed as a string in bytecode", () => {
    const buf = compileAS2(`
      interface IRunnable {}
      class Task implements IRunnable {}
    `);
    expect(containsString(buf, "IRunnable")).toBe(true);
    expect(Array.from(buf)).toContain(0x2c);
  });

  // -------------------------------------------------------------------------
  // Test 4: Multiple interfaces — all names and 0x2c appear
  // -------------------------------------------------------------------------

  it("4. multiple interfaces — all names emitted and ActionImplementsOp present", () => {
    const buf = compileAS2(`
      interface IBar {}
      interface IBaz {}
      class Foo implements IBar, IBaz {}
    `);
    expect(Array.from(buf)).toContain(0x2c);
    expect(containsString(buf, "IBar")).toBe(true);
    expect(containsString(buf, "IBaz")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: Class name appears in bytecode (constructor pushed for ImplementsOp)
  // -------------------------------------------------------------------------

  it("5. class constructor name is pushed before ActionImplementsOp", () => {
    const buf = compileAS2(`
      interface IWidget {}
      class MyWidget implements IWidget {}
    `);
    expect(containsString(buf, "MyWidget")).toBe(true);
    expect(Array.from(buf)).toContain(0x2c);
  });

  // -------------------------------------------------------------------------
  // Test 6: implements + extends both work together
  // -------------------------------------------------------------------------

  it("6. class with extends and implements emits both ActionExtends and ActionImplementsOp", () => {
    const buf = compileAS2(`
      interface ISerializable {}
      class Animal {}
      class Dog extends Animal implements ISerializable {
        function Dog() {}
      }
    `);
    // ActionImplementsOp must be present
    expect(Array.from(buf)).toContain(0x2c);
    // Interface name in bytecode
    expect(containsString(buf, "ISerializable")).toBe(true);
    // SuperClass name in bytecode
    expect(containsString(buf, "Animal")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7: Interface count — single interface pushes count of 1
  //         Verify integer 1 appears in push payload before 0x2c
  // -------------------------------------------------------------------------

  it("7. single interface — integer count 1 is pushed before ActionImplementsOp", () => {
    const buf = compileAS2(`
      interface IFoo {}
      class Bar implements IFoo {}
    `);
    const bytes = Array.from(buf);
    const implIdx = bytes.lastIndexOf(0x2c);
    expect(implIdx).toBeGreaterThan(0);

    // ActionPush (0x96) with type=7 (integer) pushes a 4-byte SI32 LE value.
    // Scan backwards from implIdx for a push of integer 1: 0x96, len_lo, len_hi=0, 0x07, 0x01, 0x00, 0x00, 0x00
    let foundCount1 = false;
    for (let i = 0; i < implIdx - 7; i++) {
      if (
        bytes[i] === 0x96 &&
        bytes[i + 3] === 0x07 && // integer type tag
        bytes[i + 4] === 0x01 && // value = 1 (LE)
        bytes[i + 5] === 0x00 &&
        bytes[i + 6] === 0x00 &&
        bytes[i + 7] === 0x00
      ) {
        foundCount1 = true;
        break;
      }
    }
    expect(foundCount1).toBe(true);
  });
});
