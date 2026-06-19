/**
 * Tests for AS2 class inheritance: `extends` and `super()`.
 *
 * Verifies that `class Foo extends Bar` compiles to the correct AVM1 prototype
 * chain setup, and that `super(...)` in a constructor emits the expected parent
 * constructor call.
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

describe("AS2 class inheritance: extends and super()", () => {
  // -------------------------------------------------------------------------
  // 1. Basic extends compiles without error
  // -------------------------------------------------------------------------

  it("1. class with empty extends compiles without error", () => {
    expect(compilesOk("class Foo extends Bar {}")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. extends emits ActionExtends (0x69) for prototype chain setup
  // -------------------------------------------------------------------------

  it("2. extends emits ActionExtends (0x69) for prototype chain setup", () => {
    const bytes = compileAS2("class Foo extends Bar {}");

    // ActionExtends (0x69) must appear: the correct opcode for prototype chain setup
    expect(hasOpcode(bytes, 0x69)).toBe(true);

    // ActionNewObject (0x40) must NOT appear for prototype chain (ActionExtends replaces it)
    expect(hasOpcode(bytes, 0x40)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. extends emits ActionExtends (0x69) with both class names on stack
  // -------------------------------------------------------------------------

  it("3. extends emits ActionExtends (0x69) with subclass and superclass on stack", () => {
    const bytes = compileAS2("class Foo extends Bar {}");

    // ActionExtends (0x69) must appear
    expect(hasOpcode(bytes, 0x69)).toBe(true);

    // Both class names must be present as strings (pushed onto stack for ActionExtends)
    expect(containsString(bytes, "Foo")).toBe(true);
    expect(containsString(bytes, "Bar")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. extends restores Foo.prototype.constructor = Foo
  // -------------------------------------------------------------------------

  it("4. extends restores the constructor property on the prototype", () => {
    const bytes = compileAS2("class Foo extends Bar {}");

    // "constructor" string must appear to restore Foo.prototype.constructor = Foo
    expect(containsString(bytes, "constructor")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. super() in constructor compiles without error
  // -------------------------------------------------------------------------

  it("5. super() call in constructor compiles without error", () => {
    expect(
      compilesOk(`
        class Foo extends Bar {
          function Foo() {
            super();
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. super() emits a call to the parent constructor (ActionCallMethod 0x52)
  // -------------------------------------------------------------------------

  it("6. super() emits ActionCallMethod to invoke parent constructor", () => {
    const bytes = compileAS2(`
      class Foo extends Bar {
        function Foo() {
          super();
        }
      }
    `);

    // ActionCallMethod (0x52) must appear for SuperClass.call(this)
    expect(hasOpcode(bytes, 0x52)).toBe(true);

    // "call" string must appear since super() → Bar.call(this)
    expect(containsString(bytes, "call")).toBe(true);

    // Parent class name must appear in bytecode
    expect(containsString(bytes, "Bar")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. super(arg1, arg2) passes arguments to parent constructor
  // -------------------------------------------------------------------------

  it("7. super() with arguments compiles without error", () => {
    expect(
      compilesOk(`
        class Cat extends Animal {
          function Cat(name, age) {
            super(name, age);
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. Subclass with an inherited method compiles correctly
  // -------------------------------------------------------------------------

  it("8. subclass with inherited method body compiles without error", () => {
    expect(
      compilesOk(`
        class Dog extends Animal {
          function Dog(name) {
            super(name);
          }
          function speak() {
            return "woof";
          }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 9. Multiple levels of inheritance compile without error
  // -------------------------------------------------------------------------

  it("9. multi-level inheritance compiles without error", () => {
    expect(
      compilesOk(`
        class Animal {}
        class Dog extends Animal {}
        class GoldenRetriever extends Dog {}
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 10. Subclass bytecode includes superclass name
  // -------------------------------------------------------------------------

  it("10. bytecode references the superclass by name", () => {
    const bytes = compileAS2(`
      class Cat extends Animal {
        function Cat() {
          super();
        }
      }
    `);

    expect(containsString(bytes, "Cat")).toBe(true);
    expect(containsString(bytes, "Animal")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 11. super.methodName() call in a method body compiles without error
  // -------------------------------------------------------------------------

  it("11. super.methodName() call in method body compiles without error", () => {
    expect(
      compilesOk(`
        class Dog extends Animal {
          function Dog(name) {
            super(name);
          }
          function speak() {
            return super.speak() + " woof";
          }
        }
      `)
    ).toBe(true);
  });

  it("11b. super.methodName() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`
      class Dog extends Animal {
        function Dog(name) {
          super(name);
        }
        function speak() {
          return super.speak();
        }
      }
    `);
    // ActionCallMethod (0x52) must appear for super.speak()
    expect(hasOpcode(bytes, 0x52)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 11c. super.method() dispatches via Animal.prototype.speak.call(this)
  //      NOT via Animal.speak (which doesn't exist on the constructor)
  // -------------------------------------------------------------------------

  it("11c. super.method() emits Animal→prototype→method→call pattern (not Animal.method)", () => {
    const bytes = compileAS2(`
      class Dog extends Animal {
        function Dog() { super(); }
        function speak() { super.speak(); }
      }
    `);

    // Must reference "Animal" (superclass constructor name)
    expect(containsString(bytes, "Animal")).toBe(true);
    // Must reference "prototype" (to traverse Animal.prototype)
    expect(containsString(bytes, "prototype")).toBe(true);
    // Must reference the method name "speak"
    expect(containsString(bytes, "speak")).toBe(true);
    // Must reference "call" (to invoke as Function.prototype.call)
    expect(containsString(bytes, "call")).toBe(true);
    // ActionGetMember (0x4e) must appear twice — once for .prototype, once for .speak
    const getMembers = Array.from(bytes).filter(b => b === 0x4e).length;
    expect(getMembers).toBeGreaterThanOrEqual(2);
    // ActionCallMethod (0x52) must appear
    expect(hasOpcode(bytes, 0x52)).toBe(true);
  });

  it("11d. super.method(arg) passes args correctly — nArgs+1 includes implicit this", () => {
    // super.speak("hello") should push: "hello", this, numArgs=2, Animal.prototype.speak, "call"
    // Verify it compiles without error and contains "call" string (function.call pattern).
    const bytes = compileAS2(`
      class Dog extends Animal {
        function Dog() { super(); }
        function speak(msg) { super.speak(msg); }
      }
    `);
    expect(containsString(bytes, "call")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 12. Interface declaration is silently ignored (compiles without error)
  // -------------------------------------------------------------------------

  it("12. interface declaration is silently ignored — compiles without error", () => {
    expect(
      compilesOk(`
        interface IAnimal { function speak():String; }
        class Dog implements IAnimal { function speak():String { return "woof"; } }
      `)
    ).toBe(true);
  });

  it("12b. interface-only source emits its constructor (task 1299)", () => {
    // An interface registers as a global constructor so `implements` can resolve
    // it via ActionImplementsOp; it is no longer a no-op.
    const bytes = compileAS2("interface IAnimal { function speak():String; }");
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).toContain(0x8e); // ActionDefineFunction2 (empty ctor)
  });

  // -------------------------------------------------------------------------
  // 13. Static class members compile
  // -------------------------------------------------------------------------

  it("13. static class members compile without error", () => {
    expect(
      compilesOk(`
        class Counter {
          static var count:Number = 0;
          static function increment():Void { Counter.count++; }
        }
      `)
    ).toBe(true);
  });

  it("13b. static members appear in bytecode and do not use prototype", () => {
    const bytes = compileAS2(`
      class Counter {
        static var count:Number = 0;
        static function increment():Void { Counter.count++; }
      }
    `);
    // Class name and static member names appear
    expect(containsString(bytes, "Counter")).toBe(true);
    expect(containsString(bytes, "count")).toBe(true);
    expect(containsString(bytes, "increment")).toBe(true);
    // Static members are assigned directly on the constructor — no prototype
    expect(containsString(bytes, "prototype")).toBe(false);
  });
});
