import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 getter and setter accessor syntax", () => {
  it("class with getter compiles", () => {
    compilesOk(`
      class Circle {
        private var _radius: Number = 0;
        function get radius(): Number { return _radius; }
      }
    `);
  });

  it("class with setter compiles", () => {
    compilesOk(`
      class Circle {
        private var _radius: Number = 0;
        function set radius(v: Number): Void { _radius = v; }
      }
    `);
  });

  it("class with both getter and setter compiles", () => {
    compilesOk(`
      class Circle {
        private var _radius: Number = 0;
        function get radius(): Number { return _radius; }
        function set radius(v: Number): Void { _radius = v; }
      }
    `);
  });

  it("getter with computed value compiles", () => {
    compilesOk(`
      class Rectangle {
        var width: Number = 0;
        var height: Number = 0;
        function get area(): Number { return width * height; }
      }
    `);
  });

  it("static getter compiles", () => {
    compilesOk(`
      class Config {
        private static var _instance: Config;
        static function get instance(): Config {
          if (!Config._instance) Config._instance = new Config();
          return Config._instance;
        }
      }
    `);
  });

  it("getter usage via property access compiles", () => {
    compilesOk(`
      class Foo {
        function get bar(): Number { return 42; }
      }
      var f = new Foo();
      var n = f.bar;
    `);
  });

  it("setter usage via assignment compiles", () => {
    compilesOk(`
      class Foo {
        function set bar(v: Number): Void { trace(v); }
      }
      var f = new Foo();
      f.bar = 99;
    `);
  });
});
