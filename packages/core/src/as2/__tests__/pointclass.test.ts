import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }

describe("AS2 flash.geom.Point", () => {
  it("import Point compiles", () => { compilesOk(`import flash.geom.Point;`); });
  it("new Point(x, y) compiles", () => { compilesOk(`import flash.geom.Point; var p = new Point(10, 20);`); });
  it("new Point() zero-arg compiles", () => { compilesOk(`import flash.geom.Point; var p = new Point();`); });
  it("p.x and p.y properties compile", () => {
    compilesOk(`import flash.geom.Point; var p = new Point(1, 2); trace(p.x + "," + p.y);`);
  });
  it("p.length compiles", () => {
    compilesOk(`import flash.geom.Point; var p = new Point(3, 4); trace(p.length);`);
  });
  it("p.add() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(1, 2);
      var b = new Point(3, 4);
      var c = a.add(b);
    `);
  });
  it("p.subtract() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(5, 5);
      var b = new Point(1, 2);
      var c = a.subtract(b);
    `);
  });
  it("p.normalize() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(3, 4);
      p.normalize(1);
    `);
  });
  it("p.offset() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(0, 0);
      p.offset(10, 20);
    `);
  });
  it("Point.distance() static compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(0, 0);
      var b = new Point(3, 4);
      var d = Point.distance(a, b);
    `);
  });
  it("p.clone() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = new Point(5, 10);
      var p2 = p.clone();
    `);
  });
  it("p.equals() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(1, 2);
      var b = new Point(1, 2);
      trace(a.equals(b));
    `);
  });
  it("Point.interpolate() static compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var a = new Point(0, 0);
      var b = new Point(100, 100);
      var mid = Point.interpolate(a, b, 0.5);
    `);
  });
  it("Point.polar() static compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var p = Point.polar(5, Math.PI / 4);
    `);
  });
  it("Point used in geometry calculation compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var center = new Point(275, 200);
      var mouse = new Point(_root._xmouse, _root._ymouse);
      var d = Point.distance(center, mouse);
      trace("distance: " + d);
    `);
  });
});
