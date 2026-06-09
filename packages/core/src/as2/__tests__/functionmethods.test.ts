import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Function object methods", () => {
  it("Function.call() with this context compiles", () => {
    compilesOk(`
      function greet(prefix) { trace(prefix + " " + this.name); }
      var obj = { name: "World" };
      greet.call(obj, "Hello");
    `);
  });

  it("Function.apply() with arguments array compiles", () => {
    compilesOk(`
      function sum(a, b, c) { return a + b + c; }
      var args = [1, 2, 3];
      sum.apply(null, args);
    `);
  });

  it("Function.call() with null this compiles", () => {
    compilesOk(`
      function foo() { return 42; }
      foo.call(null);
    `);
  });

  it("Method.call() on object method compiles", () => {
    compilesOk(`
      var obj = {
        getValue: function() { return this.val; },
        val: 10
      };
      var other = { val: 99 };
      obj.getValue.call(other);
    `);
  });

  it("Function.length property access compiles", () => {
    compilesOk(`
      function add(a, b) { return a + b; }
      var arity = add.length;
    `);
  });

  it("Function stored in variable and called compiles", () => {
    compilesOk(`
      var fn = function(x) { return x * 2; };
      fn.call(null, 5);
    `);
  });

  it("anonymous function .apply compiles", () => {
    compilesOk(`
      (function(a, b) { return a + b; }).apply(null, [3, 4]);
    `);
  });
});
