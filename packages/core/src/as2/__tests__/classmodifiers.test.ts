/**
 * Tests for AS2 class access modifiers: public and private (task 0405).
 *
 * Verifies that public/private keywords on class members are accepted by
 * the compiler and produce correct AVM1 bytecode.
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
// Access modifier compilation tests
// ---------------------------------------------------------------------------

describe("AS2 class access modifiers (public / private)", () => {
  // Test 1: public var member compiles
  it("1. class Foo { public var x:Number; } compiles without error", () => {
    expect(compilesOk(`class Foo { public var x:Number; }`)).toBe(true);
  });

  // Test 2: private var member compiles
  it("2. class Foo { private var _y:Number; } compiles without error", () => {
    expect(compilesOk(`class Foo { private var _y:Number; }`)).toBe(true);
  });

  // Test 3: public function with return type compiles
  it("3. class Foo { public function getY():Number { return _y; } } compiles without error", () => {
    expect(
      compilesOk(`
        class Foo {
          private var _y:Number;
          public function getY():Number { return _y; }
        }
      `)
    ).toBe(true);
  });

  // Test 4: private function method compiles
  it("4. class Foo { private function _helper() {} } compiles without error", () => {
    expect(
      compilesOk(`class Foo { private function _helper() {} }`)
    ).toBe(true);
  });

  // Test 5: public static var compiles
  it("5. class Foo { public static var count:Number = 0; } compiles without error", () => {
    expect(
      compilesOk(`class Foo { public static var count:Number = 0; }`)
    ).toBe(true);
  });

  // Test 6: private static function compiles
  it("6. class Foo { private static function _init() {} } compiles without error", () => {
    expect(
      compilesOk(`class Foo { private static function _init() {} }`)
    ).toBe(true);
  });

  // Test 7: class name appears in bytecode
  it("7. class name appears as a string in compiled bytecode", () => {
    const bytes = compileAS2(`
      class Widget {
        public var x:Number;
        private var _id:Number;
      }
    `);
    expect(containsString(bytes, "Widget")).toBe(true);
  });

  // Test 8: full class with mixed public/private members compiles
  it("8. full class with mixed public/private members compiles without error", () => {
    expect(
      compilesOk(`
        class Person {
          private var _name:String;
          public function Person(name:String) { _name = name; }
          public function getName():String { return _name; }
          private function _format():String { return "[" + _name + "]"; }
        }
      `)
    ).toBe(true);
  });

  it("8b. full Person class bytecode contains class name and member names", () => {
    const bytes = compileAS2(`
      class Person {
        private var _name:String;
        public function Person(name:String) { _name = name; }
        public function getName():String { return _name; }
        private function _format():String { return "[" + _name + "]"; }
      }
    `);
    expect(containsString(bytes, "Person")).toBe(true);
    expect(containsString(bytes, "getName")).toBe(true);
    // ActionDefineFunction2 (0x8e) for method definitions
    expect(bytes).toContain(0x8e);
    // ActionSetMember (0x4f) for prototype assignments
    expect(bytes).toContain(0x4f);
  });
});
