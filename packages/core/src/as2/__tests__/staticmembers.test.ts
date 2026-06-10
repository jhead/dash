/**
 * Tests for AS2 static member and static method compilation.
 *
 * In AVM1, static members are assigned directly on the constructor function:
 *   Counter.count = 0;
 *   Counter.increment = function() { ... };
 * rather than on Counter.prototype.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";
import { parse } from "../parser.js";

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Counter class fixture used across multiple tests
// ---------------------------------------------------------------------------

const COUNTER_SOURCE = `
  class Counter {
    static var count:Number = 0;
    static function increment():Void { Counter.count++; }
    static function getCount():Number { return Counter.count; }
    function Counter() { Counter.count++; }
  }
`;

// ---------------------------------------------------------------------------

describe("AS2 static members and methods", () => {
  // -------------------------------------------------------------------------
  // Test 1: Counter class compiles without error
  // -------------------------------------------------------------------------

  it("1. Counter class with static members compiles without error", () => {
    expect(compilesOk(COUNTER_SOURCE)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: Static method is defined on constructor, not prototype
  // -------------------------------------------------------------------------

  it("2. static method does not use prototype assignment", () => {
    const bytes = compileAS2(COUNTER_SOURCE);

    // "increment" and "getCount" must appear in bytecode (they are assigned)
    expect(containsString(bytes, "increment")).toBe(true);
    expect(containsString(bytes, "getCount")).toBe(true);

    // Static methods must NOT go through prototype — the bytecode for
    // a prototype assignment contains the string "prototype" with ActionGetMember (0x4e).
    // A class with ONLY static members (no instance methods, no instance props)
    // should produce no "prototype" string at all.
    // Note: the Counter constructor is an instance constructor (adds to count),
    // but the static members themselves should not use prototype.
    // We verify "prototype" does NOT appear for a purely-static class:
    const staticOnlySource = `
      class MathHelper {
        static function square(x:Number):Number { return x * x; }
        static var PI:Number = 3.14159;
      }
    `;
    const staticOnlyBytes = compileAS2(staticOnlySource);
    expect(containsString(staticOnlyBytes, "prototype")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: Static method is assigned directly on the constructor object
  // -------------------------------------------------------------------------

  it("3. static method uses ActionGetVariable + ActionSetMember pattern", () => {
    const bytes = compileAS2(`
      class Util {
        static function helper():Void {}
      }
    `);

    // ActionGetVariable (0x1c) fetches Util, ActionSetMember (0x4f) assigns helper
    expect(bytes).toContain(0x1c);
    expect(bytes).toContain(0x4f);

    // No ActionGetMember (0x4e) needed for a purely-static class (no prototype access)
    const hex = toHex(bytes);
    expect(hex).not.toContain(" 4f ");
  });

  // -------------------------------------------------------------------------
  // Test 4: Static property initializer compiles
  // -------------------------------------------------------------------------

  it("4. static property with initializer compiles and appears in bytecode", () => {
    const bytes = compileAS2(`
      class Counter {
        static var count:Number = 0;
      }
    `);

    expect(containsString(bytes, "Counter")).toBe(true);
    expect(containsString(bytes, "count")).toBe(true);

    // ActionSetMember to assign Counter.count
    expect(bytes).toContain(0x4f);
  });

  // -------------------------------------------------------------------------
  // Test 5: Counter.getCount() call compiles without error
  // -------------------------------------------------------------------------

  it("5. Counter.getCount() call compiles without error", () => {
    expect(
      compilesOk(`
        class Counter {
          static var count:Number = 0;
          static function getCount():Number { return Counter.count; }
          function Counter() {}
        }
        var n:Number = Counter.getCount();
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Counter.increment() call compiles without error
  // -------------------------------------------------------------------------

  it("6. Counter.increment() call compiles without error", () => {
    expect(
      compilesOk(`
        class Counter {
          static var count:Number = 0;
          static function increment():Void { Counter.count++; }
          function Counter() {}
        }
        Counter.increment();
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 7: Mixed static and instance members compile correctly
  // -------------------------------------------------------------------------

  it("7. class with both static and instance members compiles correctly", () => {
    const bytes = compileAS2(COUNTER_SOURCE);

    // Class name and both static method names must be present
    expect(containsString(bytes, "Counter")).toBe(true);
    expect(containsString(bytes, "increment")).toBe(true);
    expect(containsString(bytes, "getCount")).toBe(true);
    expect(containsString(bytes, "count")).toBe(true);

    // ActionDefineFunction2 (0x8e) for the constructor + static methods
    expect(bytes).toContain(0x8e);

    // ActionSetMember (0x4f) for static assignments
    expect(bytes).toContain(0x4f);
  });

  // -------------------------------------------------------------------------
  // Test 8: Parser marks static members with isStatic = true
  // -------------------------------------------------------------------------

  it("8. parser marks static members with isStatic = true", () => {
    const ast = parse(`
      class Counter {
        static var count:Number = 0;
        static function increment():Void {}
        function Counter() {}
      }
    `);

    expect(ast.body.length).toBe(1);
    const cls = ast.body[0]!;
    expect(cls.type).toBe("ClassDecl");

    if (cls.type === "ClassDecl") {
      const countProp = cls.body.find(
        (m) => m.type === "VarDecl" && m.name === "count"
      );
      expect(countProp).toBeDefined();
      if (countProp?.type === "VarDecl") {
        expect(countProp.isStatic).toBe(true);
      }

      const incrementMethod = cls.body.find(
        (m) => m.type === "FunctionDecl" && m.name === "increment"
      );
      expect(incrementMethod).toBeDefined();
      if (incrementMethod?.type === "FunctionDecl") {
        expect(incrementMethod.isStatic).toBe(true);
      }

      const ctor = cls.body.find(
        (m) => m.type === "FunctionDecl" && m.name === "Counter"
      );
      expect(ctor).toBeDefined();
      if (ctor?.type === "FunctionDecl") {
        // Constructor is NOT static
        expect(ctor.isStatic).toBe(false);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 9: Purely static class produces no prototype string
  // -------------------------------------------------------------------------

  it("9. purely static class does not emit prototype assignments", () => {
    const bytes = compileAS2(`
      class Config {
        static var version:Number = 2;
        static var debug:Boolean = false;
        static function getVersion():Number { return Config.version; }
      }
    `);

    // Class name appears
    expect(containsString(bytes, "Config")).toBe(true);

    // No prototype string in bytecode
    expect(containsString(bytes, "prototype")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 10: Multiple static methods all compile
  // -------------------------------------------------------------------------

  it("10. multiple static methods all compile and appear in bytecode", () => {
    const bytes = compileAS2(`
      class MathUtils {
        static function add(a:Number, b:Number):Number { return a + b; }
        static function subtract(a:Number, b:Number):Number { return a - b; }
        static function multiply(a:Number, b:Number):Number { return a * b; }
      }
    `);

    expect(containsString(bytes, "MathUtils")).toBe(true);
    expect(containsString(bytes, "add")).toBe(true);
    expect(containsString(bytes, "subtract")).toBe(true);
    expect(containsString(bytes, "multiply")).toBe(true);
  });
});
