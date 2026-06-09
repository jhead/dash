import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 flash.geom.Point", () => {
  it("import and new Point() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(10, 20);
    `);
  });

  it("Point.x and Point.y properties compile", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(5, 10);
      var x = p.x;
      var y = p.y;
    `);
  });

  it("Point.add() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(1, 2);
      var b = new Point(3, 4);
      var c = a.add(b);
    `);
  });

  it("Point.subtract() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(5, 5);
      var b = new Point(2, 3);
      var c = a.subtract(b);
    `);
  });

  it("Point.distance() static method compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(0, 0);
      var b = new Point(3, 4);
      var d = Point.distance(a, b);
    `);
  });

  it("Point.length property compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(3, 4);
      var len = p.length;
    `);
  });

  it("Point.clone() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(10, 20);
      var copy = p.clone();
    `);
  });
});

describe("AS2 flash.geom.Rectangle", () => {
  it("import and new Rectangle() compiles", () => {
    compilesOk(`
      import flash.geom.Rectangle;
      var r = new Rectangle(0, 0, 100, 50);
    `);
  });

  it("Rectangle properties compile", () => {
    compilesOk(`
      import flash.geom.Rectangle;
      var r = new Rectangle(10, 20, 100, 50);
      var x = r.x;
      var y = r.y;
      var w = r.width;
      var h = r.height;
      var right = r.right;
      var bottom = r.bottom;
    `);
  });

  it("Rectangle.contains() compiles", () => {
    compilesOk(`
      import flash.geom.Rectangle;
      var r = new Rectangle(0, 0, 100, 100);
      var inside = r.contains(50, 50);
    `);
  });

  it("Rectangle.intersection() compiles", () => {
    compilesOk(`
      import flash.geom.Rectangle;
      var a = new Rectangle(0, 0, 100, 100);
      var b = new Rectangle(50, 50, 100, 100);
      var inter = a.intersection(b);
    `);
  });

  it("Rectangle.union() compiles", () => {
    compilesOk(`
      import flash.geom.Rectangle;
      var a = new Rectangle(0, 0, 50, 50);
      var b = new Rectangle(50, 50, 50, 50);
      var u = a.union(b);
    `);
  });

  it("Rectangle.isEmpty() compiles", () => {
    compilesOk(`
      import flash.geom.Rectangle;
      var r = new Rectangle(0, 0, 0, 0);
      var empty = r.isEmpty();
    `);
  });
});
