/**
 * Tests for AS2 `addProperty` method call compilation.
 *
 * Verifies that explicit `this.addProperty(name, getter, setter)` calls — as
 * opposed to the `function get/set` class-body sugar — are compiled to AVM1
 * ActionCallMethod (0x52) with the "addProperty" method name string in the
 * bytecode stream.
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
    // Check null terminator after the string
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 addProperty via method call", () => {
  // -------------------------------------------------------------------------
  // Test 1: this.addProperty with getter and setter emits ActionCallMethod 0x52
  // -------------------------------------------------------------------------

  it("1. this.addProperty(name, getter, setter) emits ActionCallMethod (0x52) and addProperty string", () => {
    const bytes = compileAS2(`
      var getterFn = function() { return 42; };
      var setterFn = function(v) {};
      this.addProperty("name", getterFn, setterFn);
    `);

    // ActionCallMethod (0x52) must appear
    expect(bytes).toContain(0x52);
    // "addProperty" method name string must appear in the byte stream
    expect(containsString(bytes, "addProperty")).toBe(true);
    // "name" as the property name string
    expect(containsString(bytes, "name")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: MyClass.prototype.addProperty compiles (ActionCallMethod)
  // -------------------------------------------------------------------------

  it("2. MyClass.prototype.addProperty(name, getter, setter) compiles", () => {
    expect(
      compilesOk(`
        class MyClass {}
        var getX = function() { return 0; };
        var setX = function(v) {};
        MyClass.prototype.addProperty("x", getX, setX);
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: Object.addProperty(obj, prop, getter, setter) compiles
  // -------------------------------------------------------------------------

  it("3. Object.addProperty(obj, prop, getter, setter) compiles", () => {
    expect(
      compilesOk(`
        var obj = {};
        var getter = function() { return obj._prop; };
        var setter = function(v) { obj._prop = v; };
        Object.addProperty(obj, "prop", getter, setter);
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: Null setter — this.addProperty("readOnly", getter, null) compiles
  // -------------------------------------------------------------------------

  it("4. this.addProperty with null setter compiles", () => {
    expect(
      compilesOk(`
        var getter = function() { return 99; };
        this.addProperty("readOnly", getter, null);
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: Full Circle class with get/set radius compiles
  // -------------------------------------------------------------------------

  it("5. Circle class with get/set radius compiles", () => {
    expect(
      compilesOk(`
        class Circle {
          private var _radius:Number;
          function Circle(r:Number) { _radius = r; }
          function get radius():Number { return _radius; }
          function set radius(v:Number) { _radius = v; }
        }
      `)
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5b: Circle class compiled output contains addProperty string
  // -------------------------------------------------------------------------

  it("5b. Circle class compiled output contains addProperty and radius strings", () => {
    const bytes = compileAS2(`
      class Circle {
        private var _radius:Number;
        function Circle(r:Number) { _radius = r; }
        function get radius():Number { return _radius; }
        function set radius(v:Number) { _radius = v; }
      }
    `);

    expect(containsString(bytes, "addProperty")).toBe(true);
    expect(containsString(bytes, "radius")).toBe(true);
    expect(containsString(bytes, "prototype")).toBe(true);
    // ActionCallMethod (0x52) for the addProperty call
    expect(bytes).toContain(0x52);
  });
});
