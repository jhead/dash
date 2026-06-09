/**
 * Tests for AS2 prototype chain and property lookup.
 *
 * Verifies that prototype property assignments, hasOwnProperty, isPrototypeOf,
 * __proto__ access, inherited method calls, property shadowing, and
 * Object.prototype extension all compile correctly.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 prototype chain and property lookup", () => {
  it("assigns to prototype", () => {
    compilesOk(`
      function Animal() {}
      Animal.prototype.speak = function() { return "..."; };
    `);
  });

  it("hasOwnProperty call compiles", () => {
    compilesOk(`
      var obj = {a: 1};
      var r = obj.hasOwnProperty("a");
    `);
  });

  it("isPrototypeOf call compiles", () => {
    compilesOk(`
      function A() {}
      function B() {}
      B.prototype = new A();
      var b = new B();
      var r = A.prototype.isPrototypeOf(b);
    `);
  });

  it("__proto__ property access compiles", () => {
    compilesOk(`
      var obj = {};
      var p = obj.__proto__;
    `);
  });

  it("inherited method call via prototype chain compiles", () => {
    compilesOk(`
      function Base() {}
      Base.prototype.greet = function() { return "hi"; };
      function Child() {}
      Child.prototype = new Base();
      var c = new Child();
      var r = c.greet();
    `);
  });

  it("property shadowing: child overrides parent method", () => {
    compilesOk(`
      function Base() {}
      Base.prototype.name = "base";
      function Child() {}
      Child.prototype = new Base();
      Child.prototype.name = "child";
      var c = new Child();
    `);
  });

  it("Object.prototype extension compiles", () => {
    compilesOk(`
      Object.prototype.myMethod = function() { return 42; };
      var obj = {};
      obj.myMethod();
    `);
  });
});
