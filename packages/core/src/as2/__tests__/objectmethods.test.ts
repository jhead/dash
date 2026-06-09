import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Object built-in methods", () => {
  it("obj.toString() compiles", () => {
    compilesOk(`
      var obj = {name: "test"};
      var s = obj.toString();
    `);
  });

  it("obj.valueOf() compiles", () => {
    compilesOk(`
      var n = new Number(42);
      var v = n.valueOf();
    `);
  });

  it("obj.hasOwnProperty() compiles", () => {
    compilesOk(`
      var obj = {x: 1};
      var has = obj.hasOwnProperty("x");
    `);
  });

  it("obj.isPrototypeOf() compiles", () => {
    compilesOk(`
      function Foo() {}
      var f = new Foo();
      var r = Foo.prototype.isPrototypeOf(f);
    `);
  });

  it("obj.propertyIsEnumerable() compiles", () => {
    compilesOk(`
      var obj = {a: 1};
      var e = obj.propertyIsEnumerable("a");
    `);
  });

  it("delete operator compiles", () => {
    compilesOk(`
      var obj = {x: 1, y: 2};
      delete obj.x;
    `);
  });

  it("delete on array element compiles", () => {
    compilesOk(`
      var arr = [1, 2, 3];
      delete arr[1];
    `);
  });

  it("in operator compiles", () => {
    compilesOk(`
      var obj = {a: 1};
      var has = ("a" in obj);
    `);
  });

  it("instanceof operator compiles", () => {
    compilesOk(`
      function Foo() {}
      var f = new Foo();
      var r = f instanceof Foo;
    `);
  });

  it("typeof operator compiles", () => {
    compilesOk(`
      var x = 42;
      var t = typeof x;
    `);
  });

  it("void operator compiles", () => {
    compilesOk(`
      var r = void(0);
    `);
  });
});
