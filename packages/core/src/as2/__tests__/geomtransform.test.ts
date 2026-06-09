import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 flash.geom.Transform", () => {
  it("import flash.geom.Transform compiles", () => {
    compilesOk(`import flash.geom.Transform;`);
  });

  it("new Transform(mc) compiles", () => {
    compilesOk(`
      import flash.geom.Transform;
      var t = new Transform(this.myClip);
    `);
  });

  it("mc.transform property compiles", () => {
    compilesOk(`
      var t = this.myClip.transform;
    `);
  });

  it("transform.matrix read compiles", () => {
    compilesOk(`
      var t = this.myClip.transform;
      var m = t.matrix;
    `);
  });

  it("transform.matrix write compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.rotate(Math.PI / 4);
      this.myClip.transform.matrix = m;
    `);
  });

  it("transform.colorTransform read compiles", () => {
    compilesOk(`
      var ct = this.myClip.transform.colorTransform;
    `);
  });

  it("transform.colorTransform write compiles", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform(1, 0, 0, 1, 100, 0, 0, 0);
      this.myClip.transform.colorTransform = ct;
    `);
  });

  it("transform.pixelBounds compiles", () => {
    compilesOk(`
      var bounds = this.myClip.transform.pixelBounds;
      var w = bounds.width;
    `);
  });

  it("transform.concatenatedMatrix compiles", () => {
    compilesOk(`
      var cm = this.myClip.transform.concatenatedMatrix;
    `);
  });

  it("transform.concatenatedColorTransform compiles", () => {
    compilesOk(`
      var cct = this.myClip.transform.concatenatedColorTransform;
    `);
  });

  it("matrix rotation and translation compiles", () => {
    compilesOk(`
      import flash.geom.Matrix;
      var m = new Matrix();
      m.translate(-50, -50);
      m.rotate(Math.PI / 2);
      m.translate(50, 50);
      this.myClip.transform.matrix = m;
    `);
  });
});
