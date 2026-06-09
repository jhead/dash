import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }

describe("AS2 flash.geom.Matrix", () => {
  it("import Matrix compiles", () => {
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

  it("m.clone() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      var m2 = m.clone();
    `);
  });

  it("m.invert() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.invert();
    `);
  });

  it("m.concat() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m1 = new Matrix();
      var m2 = new Matrix();
      m1.concat(m2);
    `);
  });

  it("m.rotate() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.rotate(Math.PI / 4);
    `);
  });

  it("m.scale() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.scale(2, 3);
    `);
  });

  it("m.translate() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.translate(50, 100);
    `);
  });

  it("m.transformPoint() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      import flash.geom.Point;
      var m = new Matrix();
      var p = new Point(10, 20);
      var result = m.transformPoint(p);
    `);
  });

  it("m.deltaTransformPoint() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      import flash.geom.Point;
      var m = new Matrix();
      m.rotate(0.5);
      var delta = m.deltaTransformPoint(new Point(1, 0));
    `);
  });

  it("Matrix.createBox() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.createBox(1, 1, Math.PI / 6, 0, 0);
    `);
  });

  it("Matrix.createGradientBox() compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.createGradientBox(100, 100, 0, -50, -50);
    `);
  });

  it("Matrix identity properties (a,b,c,d,tx,ty) compile", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      trace(m.a + "," + m.b + "," + m.c + "," + m.d);
      trace(m.tx + "," + m.ty);
    `);
  });

  it("matrix used for drawing API compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.createGradientBox(200, 200, 0, -100, -100);
      this.graphics.beginGradientFill("linear", [0xFF0000, 0x0000FF], [100, 100], [0, 255], m);
    `);
  });
});
