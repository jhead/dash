/**
 * Tests for AS2 static class member compilation.
 *
 * Verifies that static var declarations and static function declarations
 * inside a class body are compiled to AVM1 bytecode that assigns them
 * directly on the constructor function object (not on the prototype).
 *
 * Relevant AVM1 opcodes:
 *   0x4e  ActionGetMember   — reads a property from an object
 *   0x4f  ActionSetMember   — writes a property to an object
 *   0x1c  ActionGetVariable — pushes a named variable onto the stack
 *   0x52  ActionCallMethod  — calls a method on an object
 *   0x8e  ActionDefineFunction2 — defines a function with register optimisation
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
// Full Counter class fixture
// ---------------------------------------------------------------------------

const COUNTER_SOURCE = `
  class Counter {
    static var count:Number = 0;
    static function increment():Void { Counter.count++; }
    static function getCount():Number { return Counter.count; }
  }
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 static class members", () => {
  // 1. class with static var compiles without error
  it("1. class with static var compiles without error", () => {
    expect(
      compilesOk(`
        class Counter { static var count:Number = 0; }
      `)
    ).toBe(true);
  });

  // 2. Counter.count access emits ActionGetMember (0x4e)
  it("2. Counter.count access emits ActionGetMember (0x4e)", () => {
    const bytes = compileAS2(`
      class Counter {
        static var count:Number = 0;
        static function fetchCount():Number { return Counter.count; }
      }
    `);
    // ActionGetMember (0x4e) is used to read a property from an object
    expect(bytes).toContain(0x4e);
    expect(containsString(bytes, "count")).toBe(true);
  });

  // 3. Counter.count = 5 assignment emits ActionSetMember (0x4f)
  it("3. Counter.count = 5 assignment emits ActionSetMember (0x4f)", () => {
    const bytes = compileAS2(`
      class Counter { static var count:Number = 0; }
    `);
    // ActionSetMember (0x4f) assigns a property on an object
    expect(bytes).toContain(0x4f);
    expect(containsString(bytes, "count")).toBe(true);
    expect(containsString(bytes, "Counter")).toBe(true);
  });

  // 4. class with static function compiles without error
  it("4. class with static function increment compiles without error", () => {
    expect(
      compilesOk(`
        class Counter {
          static var count:Number = 0;
          static function increment():Void { Counter.count++; }
        }
      `)
    ).toBe(true);
  });

  // 5. Counter.increment() call compiles (ActionCallMethod 0x52)
  it("5. Counter.increment() call compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`
      class Counter {
        static var count:Number = 0;
        static function increment():Void { Counter.count++; }
      }
      Counter.increment();
    `);
    // ActionCallMethod (0x52) is used to invoke a method on an object
    expect(bytes).toContain(0x52);
    expect(containsString(bytes, "increment")).toBe(true);
  });

  // 6. Static method accessing other static member compiles
  it("6. static method accessing static var (return count) compiles without error", () => {
    expect(
      compilesOk(`
        class Counter {
          static var count:Number = 0;
          static function fetchCount():Number { return Counter.count; }
        }
      `)
    ).toBe(true);
  });

  // 7. Full Counter pattern compiles without error
  it("7. full Counter class pattern compiles without error", () => {
    expect(compilesOk(COUNTER_SOURCE)).toBe(true);
  });

  // 7b. Full Counter class plus usage compiles without error
  it("7b. Counter.increment() + trace(Counter.getCount()) compiles without error", () => {
    expect(
      compilesOk(`
        class Counter {
          static var count:Number = 0;
          static function increment():Void { Counter.count++; }
          static function getCount():Number { return Counter.count; }
        }
        Counter.increment();
        trace(Counter.getCount());
      `)
    ).toBe(true);
  });

  // Static var bytecode contains the class name and member name
  it("static var bytecode contains class name and member name as strings", () => {
    const bytes = compileAS2(`
      class Counter { static var count:Number = 0; }
    `);
    expect(containsString(bytes, "Counter")).toBe(true);
    expect(containsString(bytes, "count")).toBe(true);
  });

  // Static method is not assigned on prototype
  it("purely static class does not emit prototype assignments", () => {
    const bytes = compileAS2(`
      class MathHelper {
        static var PI:Number = 3.14159;
        static function square(x:Number):Number { return x * x; }
      }
    `);
    // No "prototype" string should appear in purely-static class bytecode
    expect(containsString(bytes, "prototype")).toBe(false);
  });
});
