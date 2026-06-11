/**
 * Tests for AS2 `protected` access modifier.
 *
 * `protected` is a valid AS2 keyword that must be tokenized and parsed
 * correctly. AVM1 ignores it at runtime (no access enforcement), so a
 * `protected` member should compile identically to a `public` member and
 * end up on the prototype (for instance members) or on the constructor
 * object (for static members).
 *
 * Bug: before this fix, `protected` was not in AS2_KEYWORDS so it was
 * tokenized as an `identifier` and then consumed as the member name by the
 * class body parser, silently dropping the real member name.
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

describe("AS2 protected access modifier", () => {
  // 1. Class with protected var compiles without error
  it("1. class with protected var compiles without error", () => {
    expect(
      compilesOk(`
        class Foo {
          protected var x:Number = 5;
        }
      `)
    ).toBe(true);
  });

  // 2. Class with protected function compiles without error
  it("2. class with protected function compiles without error", () => {
    expect(
      compilesOk(`
        class Foo {
          protected function bar():Void {}
        }
      `)
    ).toBe(true);
  });

  // 3. Class with both protected var and protected function compiles without error
  it("3. class with protected var and protected function compiles without error", () => {
    expect(
      compilesOk(`
        class Foo {
          protected var x:Number = 5;
          protected function foo():Number { return x; }
        }
      `)
    ).toBe(true);
  });

  // 4. protected function name appears in prototype assignments
  //    (protected members behave like public — they go on the prototype)
  it("4. protected function name appears in bytecode (assigned on prototype)", () => {
    const bytes = compileAS2(`
      class Foo {
        protected var x:Number = 5;
        protected function foo():Number { return x; }
      }
    `);
    expect(containsString(bytes, "foo")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
  });

  // 5. protected static var compiles without error
  it("5. protected static var compiles without error", () => {
    expect(
      compilesOk(`
        class Foo {
          protected static var count:Number = 0;
        }
      `)
    ).toBe(true);
  });

  // 6. protected static function compiles without error
  it("6. protected static function compiles without error", () => {
    expect(
      compilesOk(`
        class Foo {
          protected static function helper():Void {}
        }
      `)
    ).toBe(true);
  });

  // 7. Mix of public, private, and protected in one class
  it("7. class mixing public, private, and protected members compiles without error", () => {
    expect(
      compilesOk(`
        class Animal {
          public var name:String;
          private var _age:Number;
          protected var species:String = "unknown";
          public function getName():String { return name; }
          private function _getAge():Number { return _age; }
          protected function getSpecies():String { return species; }
        }
      `)
    ).toBe(true);
  });
});
