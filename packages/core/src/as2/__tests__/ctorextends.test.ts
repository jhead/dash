/**
 * Tests for AS2 class extends and multiple constructor patterns.
 *
 * Covers implicit default constructors, super() calls with and without
 * arguments, ActionNew emission, ActionDefineFunction2 emission,
 * static methods alongside constructors, and full inheritance patterns.
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

function hasOpcode(bytes: Uint8Array, opcode: number): boolean {
  return Array.from(bytes).includes(opcode);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 class extends and multiple constructors", () => {
  // -------------------------------------------------------------------------
  // 1. Class with no constructor — compiles (implicit default constructor)
  // -------------------------------------------------------------------------

  it("1. class with no constructor compiles (implicit default constructor)", () => {
    expect(compilesOk("class Animal {}")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. class B extends A { function B() { super(); } } — compiles
  // -------------------------------------------------------------------------

  it("2. class B extends A with constructor calling super() compiles", () => {
    expect(
      compilesOk(`
        class B extends A {
          function B() {
            super();
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. class B extends A { function B(x) { super(x); } } — compiles (super with arg)
  // -------------------------------------------------------------------------

  it("3. class B extends A with constructor calling super(x) compiles", () => {
    expect(
      compilesOk(`
        class B extends A {
          function B(x) {
            super(x);
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Instantiation new B() — emits ActionNew (0x40)
  // -------------------------------------------------------------------------

  it("4. class with extends emits ActionNew (0x40) for prototype chain", () => {
    const bytes = compileAS2(`
      class B extends A {
        function B() {
          super();
        }
      }
    `);
    // ActionNew (0x40) is used for `new A()` in prototype chain setup
    expect(hasOpcode(bytes, 0x40)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Constructor body emits ActionDefineFunction2 (0x8E) or ActionDefineFunction
  // -------------------------------------------------------------------------

  it("5. constructor body emits ActionDefineFunction2 (0x8e) or ActionDefineFunction (0x9b)", () => {
    const bytes = compileAS2(`
      class MyClass {
        function MyClass() {
          var x = 1;
        }
      }
    `);
    // ActionDefineFunction2 (0x8e) or ActionDefineFunction (0x9b) must appear
    const hasDF2 = hasOpcode(bytes, 0x8e);
    const hasDF = hasOpcode(bytes, 0x9b);
    expect(hasDF2 || hasDF).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Class with static method and constructor — both compile
  // -------------------------------------------------------------------------

  it("6. class with both static method and constructor compiles", () => {
    expect(
      compilesOk(`
        class Widget {
          static var defaultColor = "red";
          function Widget(color) {
            this.color = color;
          }
          static function create() {
            return new Widget("blue");
          }
        }
      `)
    ).toBe(true);
  });

  it("6b. class with static method and constructor emits both names in bytecode", () => {
    const bytes = compileAS2(`
      class Widget {
        function Widget(color) {
          this.color = color;
        }
        static function create() {
          return new Widget("blue");
        }
      }
    `);
    expect(containsString(bytes, "Widget")).toBe(true);
    expect(containsString(bytes, "create")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Full pattern: Animal + Dog with constructor setting property
  // -------------------------------------------------------------------------

  it("7. full pattern: Animal and Dog with super() and this.name = name compiles", () => {
    expect(
      compilesOk(`
        class Animal {}
        class Dog extends Animal {
          function Dog(name) {
            super();
            this.name = name;
          }
        }
      `)
    ).toBe(true);
  });

  it("7b. full pattern bytecode references both class names", () => {
    const bytes = compileAS2(`
      class Animal {}
      class Dog extends Animal {
        function Dog(name) {
          super();
          this.name = name;
        }
      }
    `);
    expect(containsString(bytes, "Animal")).toBe(true);
    expect(containsString(bytes, "Dog")).toBe(true);
    expect(containsString(bytes, "name")).toBe(true);
    // prototype chain setup
    expect(containsString(bytes, "prototype")).toBe(true);
    // ActionNew for prototype setup
    expect(hasOpcode(bytes, 0x40)).toBe(true);
  });
});
