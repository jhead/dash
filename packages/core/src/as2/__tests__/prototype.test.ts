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

// ---------------------------------------------------------------------------
// AS2 Object and Function prototype chain — extended coverage
// ---------------------------------------------------------------------------

describe("AS2 Object and prototype chain", () => {
  it("obj.hasOwnProperty() compiles", () => {
    compilesOk(`
      var obj = {a: 1};
      var has = obj.hasOwnProperty("a");
    `);
  });

  it("obj.isPrototypeOf() compiles", () => {
    compilesOk(`
      function Animal() {}
      function Dog() {}
      Dog.prototype = new Animal();
      var d = new Dog();
      var isProto = Animal.prototype.isPrototypeOf(d);
    `);
  });

  it("obj.constructor compiles", () => {
    compilesOk(`
      function MyClass() {}
      var obj = new MyClass();
      var ctor = obj.constructor;
    `);
  });

  it("typeof operator compiles", () => {
    compilesOk(`
      var x = 42;
      var t = typeof x;
      if (typeof x == "number") { trace("num"); }
      if (typeof undefined == "undefined") { trace("undef"); }
    `);
  });

  it("instanceof operator compiles", () => {
    compilesOk(`
      var a = [1, 2, 3];
      var isArr = a instanceof Array;
    `);
  });

  it("Function.prototype assignment compiles", () => {
    compilesOk(`
      function Animal(name) { this.name = name; }
      Animal.prototype.speak = function() { trace(this.name); };
      var a = new Animal("Cat");
      a.speak();
    `);
  });

  it("prototype chain inheritance compiles", () => {
    compilesOk(`
      function Shape() { this.color = "red"; }
      Shape.prototype.getColor = function() { return this.color; };
      function Circle(r) { Shape.call(this); this.radius = r; }
      Circle.prototype = new Shape();
      var c = new Circle(5);
      trace(c.getColor());
    `);
  });

  it("Object.registerClass() compiles", () => {
    compilesOk(`
      function MyMovieClip() {}
      Object.registerClass("MyMovieClip", MyMovieClip);
    `);
  });

  it("AsBroadcaster.initialize() pattern compiles", () => {
    compilesOk(`
      var events = {};
      AsBroadcaster.initialize(events);
      events.addListener({onMyEvent: function() {}});
      events.broadcastMessage("onMyEvent");
    `);
  });

  it("delete operator compiles", () => {
    compilesOk(`
      var obj = {a: 1, b: 2};
      delete obj.a;
    `);
  });

  it("for...in loop compiles", () => {
    compilesOk(`
      var obj = {x: 1, y: 2, z: 3};
      for (var key in obj) {
        trace(key + " = " + obj[key]);
      }
    `);
  });

  it("Object.prototype.__proto__ compiles", () => {
    compilesOk(`
      function Base() {}
      function Child() {}
      Child.prototype.__proto__ = Base.prototype;
    `);
  });
});
