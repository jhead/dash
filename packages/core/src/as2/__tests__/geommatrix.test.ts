import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 flash.geom.Matrix class", () => {
  it("import flash.geom.Matrix compiles", () => {
    compilesOk(`import flash.geom.Matrix;`);
  });

  it("new Matrix() identity compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
    `);
  });

  it("new Matrix(a,b,c,d,tx,ty) compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix(1, 0, 0, 1, 100, 200);
    `);
  });

  it("matrix.translate() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.translate(50, 100);
    `);
  });

  it("matrix.scale() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.scale(2, 2);
    `);
  });

  it("matrix.rotate() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.rotate(Math.PI / 4);
    `);
  });

  it("matrix.concat() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var a = new Matrix(1, 0, 0, 1, 10, 20);
      var b = new Matrix(2, 0, 0, 2, 0, 0);
      a.concat(b);
    `);
  });

  it("matrix.identity() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix(2, 1, 1, 2, 10, 10);
      m.identity();
    `);
  });

  it("matrix.invert() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix(2, 0, 0, 2, 10, 10);
      m.invert();
    `);
  });

  it("matrix.transformPoint() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      import flash.geom.Matrix;
      var m = new Matrix();
      var p = new Point(10, 20);
      var tp = m.transformPoint(p);
    `);
  });

  it("matrix properties a,b,c,d,tx,ty compile", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      var a = m.a;
      var tx = m.tx;
      m.ty = 50;
    `);
  });
});
