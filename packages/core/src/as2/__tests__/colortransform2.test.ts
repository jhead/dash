import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 flash.geom.ColorTransform", () => {
  it("import and new ColorTransform() compiles", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform();
    `);
  });

  it("new ColorTransform with all params compiles", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 0);
    `);
  });

  it("ColorTransform multiplier properties compile", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform();
      ct.redMultiplier = 1;
      ct.greenMultiplier = 0.5;
      ct.blueMultiplier = 0.5;
      ct.alphaMultiplier = 1;
    `);
  });

  it("ColorTransform offset properties compile", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform();
      ct.redOffset = 50;
      ct.greenOffset = 0;
      ct.blueOffset = 0;
      ct.alphaOffset = 0;
    `);
  });

  it("ColorTransform.rgb property compiles", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform();
      ct.rgb = 0xFF0000;
      var rgb = ct.rgb;
    `);
  });

  it("mc.transform.colorTransform assignment compiles", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var ct = new ColorTransform(1, 1, 1, 0.5, 0, 0, 0, 0);
      myMovieClip.transform.colorTransform = ct;
    `);
  });

  it("mc.transform.colorTransform read compiles", () => {
    compilesOk(`
      var ct = myClip.transform.colorTransform;
      trace(ct.alphaMultiplier);
    `);
  });

  it("ColorTransform.concat() compiles", () => {
    compilesOk(`
      import flash.geom.ColorTransform;
      var a = new ColorTransform(0.5, 0.5, 0.5, 1);
      var b = new ColorTransform(1, 1, 1, 0.5);
      a.concat(b);
    `);
  });
});
