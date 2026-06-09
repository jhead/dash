/**
 * Tests for AS2 class declaration compilation.
 *
 * Verifies that class syntax is compiled to AVM1 bytecode representing
 * prototype-based OOP patterns equivalent to Flash 8 ActionScript 2.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";
import { parse } from "../parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to compile AS2 source and return true if it succeeded without throwing.
 */
function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the compiled bytecode as a hex string (for pattern matching).
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

/**
 * Scan compiled bytes for an occurrence of a UTF-8 C-string.
 * Returns true if the null-terminated string exists anywhere in the buffer.
 */
function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    // Check null terminator after the string
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test 1: Empty class compiles without error
// ---------------------------------------------------------------------------

describe("AS2 class declarations", () => {
  it("1. empty class compiles without error", () => {
    expect(compilesOk("class Foo {}")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: Class with constructor creates a function assignment
  // -------------------------------------------------------------------------

  it("2. class with constructor creates function assignment", () => {
    const bytes = compileAS2(`
      class Animal {
        function Animal() {}
      }
    `);

    // Should contain the class name as a string in the bytecode
    expect(containsString(bytes, "Animal")).toBe(true);

    // Should contain ActionSetVariable (0x1d) to assign the constructor
    expect(bytes).toContain(0x1d);

    // Should contain ActionDefineFunction2 opcode (0x8e)
    expect(bytes).toContain(0x8e);
  });

  // -------------------------------------------------------------------------
  // Test 3: Class with instance method creates Foo.prototype.method assignment
  // -------------------------------------------------------------------------

  it("3. class with instance method sets up Foo.prototype.method", () => {
    const bytes = compileAS2(`
      class Greeter {
        function greet() {
          trace("hi");
        }
      }
    `);

    // Bytecode must contain "prototype" string (for Greeter.prototype.greet)
    expect(containsString(bytes, "prototype")).toBe(true);

    // Must contain "greet" and "Greeter" strings
    expect(containsString(bytes, "greet")).toBe(true);
    expect(containsString(bytes, "Greeter")).toBe(true);

    // ActionGetMember (0x4f) to access .prototype
    expect(bytes).toContain(0x4f);

    // ActionSetMember (0x4e) to assign the method
    expect(bytes).toContain(0x4e);
  });

  // -------------------------------------------------------------------------
  // Test 4: Class with static method creates Foo.method assignment
  // -------------------------------------------------------------------------

  it("4. class with static method sets up Foo.staticMethod", () => {
    const bytes = compileAS2(`
      class MathUtils {
        static function square(x) {
          return x * x;
        }
      }
    `);

    expect(containsString(bytes, "MathUtils")).toBe(true);
    expect(containsString(bytes, "square")).toBe(true);

    // Static methods do NOT need "prototype" access
    // ActionGetVariable (0x1c) to get MathUtils, then ActionSetMember (0x4e)
    expect(bytes).toContain(0x1c);
    expect(bytes).toContain(0x4e);

    // ActionGetMember (0x4f) should NOT appear for a class with only static members
    // (no prototype access needed for static methods)
    // Note: this is an optional structural check, not a hard requirement.
    const hex = toHex(bytes);
    expect(hex).not.toContain(" 4f "); // no ActionGetMember in the bytecode
  });

  // -------------------------------------------------------------------------
  // Test 5: Class with extends sets up prototype chain
  // -------------------------------------------------------------------------

  it("5. class with extends sets up prototype chain", () => {
    const bytes = compileAS2(`
      class Dog extends Animal {
        function Dog() {}
      }
    `);

    // Both class names must appear
    expect(containsString(bytes, "Dog")).toBe(true);
    expect(containsString(bytes, "Animal")).toBe(true);

    // "prototype" must appear (for Dog.prototype = new Animal())
    expect(containsString(bytes, "prototype")).toBe(true);

    // ActionNew (0x4a) to create new Animal()
    expect(bytes).toContain(0x4a);

    // ActionSetMember (0x4e) to assign prototype
    expect(bytes).toContain(0x4e);
  });

  // -------------------------------------------------------------------------
  // Test 6: Instance property with initializer
  // -------------------------------------------------------------------------

  it("6. instance property with initializer is assigned on prototype", () => {
    const bytes = compileAS2(`
      class Counter {
        var count = 0;
      }
    `);

    expect(containsString(bytes, "Counter")).toBe(true);
    expect(containsString(bytes, "count")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);

    // ActionSetMember to assign the property
    expect(bytes).toContain(0x4e);
  });

  // -------------------------------------------------------------------------
  // Test 7: Static property with initializer
  // -------------------------------------------------------------------------

  it("7. static property with initializer is assigned directly on class", () => {
    const bytes = compileAS2(`
      class Config {
        static var version = 1;
      }
    `);

    expect(containsString(bytes, "Config")).toBe(true);
    expect(containsString(bytes, "version")).toBe(true);

    // ActionSetMember to assign Config.version
    expect(bytes).toContain(0x4e);
  });

  // -------------------------------------------------------------------------
  // Test 8: Compiled bytecode is a valid non-empty Uint8Array
  // -------------------------------------------------------------------------

  it("8. compiled bytecode is a valid non-empty Uint8Array", () => {
    const bytes = compileAS2(`
      class Point {
        var x = 0;
        var y = 0;
        function Point(x, y) {
          this.x = x;
          this.y = y;
        }
      }
    `);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 9: Multiple classes in same script
  // -------------------------------------------------------------------------

  it("9. multiple classes in the same script compile without error", () => {
    expect(
      compilesOk(`
        class Foo {}
        class Bar extends Foo {}
        class Baz {
          function Baz() {}
          function doSomething() { trace("baz"); }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 10: public/private keywords are accepted with no compile error
  // -------------------------------------------------------------------------

  it("10. public and private access modifiers are accepted", () => {
    expect(
      compilesOk(`
        class MyClass {
          public var name;
          private var _secret = 42;
          public function MyClass() {}
          public function greet() { trace("hello"); }
          private function helper() { return 1; }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Bonus: super() call in constructor body
  // -------------------------------------------------------------------------

  it("11. super() call in constructor compiles to SuperClass.call(this)", () => {
    const bytes = compileAS2(`
      class Cat extends Animal {
        function Cat() {
          super();
        }
      }
    `);

    expect(containsString(bytes, "Cat")).toBe(true);
    expect(containsString(bytes, "Animal")).toBe(true);

    // "call" should appear since super() → Animal.call(this)
    expect(containsString(bytes, "call")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Bonus: parse result for class declaration
  // -------------------------------------------------------------------------

  it("12. parser produces ClassDecl AST with correct shape", () => {
    const ast = parse(`
      class Widget extends Base {
        public var color = "red";
        public function Widget() {}
        public function draw() {}
        static function create() {}
      }
    `);

    expect(ast.body.length).toBe(1);
    const cls = ast.body[0]!;
    expect(cls.type).toBe("ClassDecl");

    if (cls.type === "ClassDecl") {
      expect(cls.name).toBe("Widget");
      expect(cls.superClass).toBe("Base");
      expect(cls.body.length).toBe(4);

      // Check constructor
      const ctor = cls.body.find(
        (m) => m.type === "FunctionDecl" && m.name === "Widget"
      );
      expect(ctor).toBeDefined();

      // Check instance method
      const draw = cls.body.find(
        (m) => m.type === "FunctionDecl" && m.name === "draw"
      );
      expect(draw).toBeDefined();
      if (draw?.type === "FunctionDecl") {
        expect(draw.isStatic).toBe(false);
      }

      // Check static method
      const create = cls.body.find(
        (m) => m.type === "FunctionDecl" && m.name === "create"
      );
      expect(create).toBeDefined();
      if (create?.type === "FunctionDecl") {
        expect(create.isStatic).toBe(true);
      }

      // Check property
      const color = cls.body.find(
        (m) => m.type === "VarDecl" && m.name === "color"
      );
      expect(color).toBeDefined();
    }
  });
});
