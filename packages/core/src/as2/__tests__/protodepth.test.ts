/**
 * Tests for AS2 compiler handling of deep prototype chain inheritance.
 *
 * Verifies that multi-level class hierarchies compile correctly and emit
 * the expected AVM1 opcodes, and that direct prototype property assignment
 * compiles without error.
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
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property write

// ---------------------------------------------------------------------------
// Deep prototype chain (4 levels: A -> B -> C -> D)
// ---------------------------------------------------------------------------

const DEEP_CHAIN_SOURCE = `
  class A {
    function A() {}
    function greet():String { return "A"; }
  }
  class B extends A {
    function B() { super(); }
  }
  class C extends B {
    function C() { super(); }
  }
  class D extends C {
    function D() { super(); }
  }
`;

describe("Deep prototype chain (A->B->C->D)", () => {
  it("all four class declarations compile without error", () => {
    expect(compilesOk(DEEP_CHAIN_SOURCE)).toBe(true);
  });

  it("class A compiles without error", () => {
    expect(
      compilesOk("class A { function A() {} function greet():String { return \"A\"; } }")
    ).toBe(true);
  });

  it("class B extends A compiles without error", () => {
    expect(
      compilesOk("class A { function A() {} } class B extends A { function B() { super(); } }")
    ).toBe(true);
  });

  it("class C extends B compiles without error", () => {
    expect(
      compilesOk(`
        class A { function A() {} }
        class B extends A { function B() { super(); } }
        class C extends B { function C() { super(); } }
      `)
    ).toBe(true);
  });

  it("new D() compiles and emits ActionNew (0x4a)", () => {
    const source = DEEP_CHAIN_SOURCE + "\nvar d = new D();";
    expect(compilesOk(source)).toBe(true);
    const bytes = compileAS2(source);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "D")).toBe(true);
  });

  it("d.greet() (method from ancestor A) compiles and emits ActionCallMethod (0x52)", () => {
    const source = DEEP_CHAIN_SOURCE + "\nvar d = new D(); var s = d.greet();";
    expect(compilesOk(source)).toBe(true);
    const bytes = compileAS2(source);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "greet")).toBe(true);
  });

  it("bytecode contains all four class names", () => {
    const bytes = compileAS2(DEEP_CHAIN_SOURCE);
    expect(containsString(bytes, "A")).toBe(true);
    expect(containsString(bytes, "B")).toBe(true);
    expect(containsString(bytes, "C")).toBe(true);
    expect(containsString(bytes, "D")).toBe(true);
  });

  it("bytecode contains prototype string (chain setup)", () => {
    const bytes = compileAS2(DEEP_CHAIN_SOURCE);
    expect(containsString(bytes, "prototype")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Prototype property assignment
// ---------------------------------------------------------------------------

describe("Prototype property assignment", () => {
  it("MyClass.prototype.newMethod = function(){} compiles without error", () => {
    expect(
      compilesOk(`
        class MyClass { function MyClass() {} }
        MyClass.prototype.newMethod = function() {};
      `)
    ).toBe(true);
  });

  it("MyClass.prototype.newMethod assignment emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(`
      class MyClass { function MyClass() {} }
      MyClass.prototype.newMethod = function() {};
    `);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    expect(containsString(bytes, "newMethod")).toBe(true);
  });

  it("MyClass.prototype.sharedProp = 42 compiles without error", () => {
    expect(
      compilesOk(`
        class MyClass { function MyClass() {} }
        MyClass.prototype.sharedProp = 42;
      `)
    ).toBe(true);
  });

  it("MyClass.prototype.sharedProp assignment emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(`
      class MyClass { function MyClass() {} }
      MyClass.prototype.sharedProp = 42;
    `);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "sharedProp")).toBe(true);
  });

  it("prototype.newMethod function reference is present in bytecode", () => {
    const bytes = compileAS2(`
      class MyClass { function MyClass() {} }
      MyClass.prototype.newMethod = function() { return 1; };
    `);
    expect(containsString(bytes, "MyClass")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    expect(containsString(bytes, "newMethod")).toBe(true);
  });
});
