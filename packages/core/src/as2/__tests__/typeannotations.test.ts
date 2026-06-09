import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 type annotations and casting", () => {
  it("variable with type annotation compiles", () => {
    compilesOk(`var x: Number = 42;`);
  });

  it("function parameter type annotation compiles", () => {
    compilesOk(`
      function greet(name: String): Void {
        trace("Hello " + name);
      }
    `);
  });

  it("function return type annotation compiles", () => {
    compilesOk(`
      function add(a: Number, b: Number): Number {
        return a + b;
      }
    `);
  });

  it("Void return type compiles", () => {
    compilesOk(`
      function doThing(): Void { trace("done"); }
    `);
  });

  it("Array type annotation compiles", () => {
    compilesOk(`var items: Array = [];`);
  });

  it("class type annotation compiles", () => {
    compilesOk(`
      class Foo { }
      var f: Foo = new Foo();
    `);
  });

  it("explicit type cast (ClassName(expr)) compiles", () => {
    compilesOk(`
      var obj: Object = new Object();
      var s: String = String(obj);
    `);
  });

  it("class cast compiles", () => {
    compilesOk(`
      class Animal { }
      class Dog extends Animal { }
      var a: Animal = new Dog();
      var d: Dog = Dog(a);
    `);
  });

  it("Object and * wildcard type compile", () => {
    compilesOk(`
      var anything: Object = 42;
      var wild = "no type";
    `);
  });

  it("nested generic-style Array annotation compiles", () => {
    compilesOk(`var items: Array = new Array();`);
  });

  it("private/public/protected access modifiers compile", () => {
    compilesOk(`
      class Foo {
        public var pub: Number;
        private var priv: String;
        protected var prot: Boolean;
      }
    `);
  });
});
