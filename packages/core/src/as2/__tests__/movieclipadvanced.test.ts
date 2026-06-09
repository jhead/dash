import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClip advanced", () => {
  it("createEmptyMovieClip() compiles", () => {
    compilesOk(`
      var mc = this.createEmptyMovieClip("newClip", 1);
    `);
  });

  it("attachBitmap() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100, false, 0xff0000);
      var mc = this.createEmptyMovieClip("bmpHolder", 1);
      mc.attachBitmap(bmp, 1);
    `);
  });

  it("setMask() compiles", () => {
    compilesOk(`
      this.contentClip.setMask(this.maskClip);
    `);
  });

  it("MovieClip drawing API: lineStyle + moveTo + lineTo compiles", () => {
    compilesOk(`
      var mc = this.createEmptyMovieClip("drawing", 1);
      mc.lineStyle(2, 0x000000, 100);
      mc.moveTo(0, 0);
      mc.lineTo(100, 0);
      mc.lineTo(100, 100);
      mc.lineTo(0, 0);
    `);
  });

  it("MovieClip drawing API: beginFill + endFill compiles", () => {
    compilesOk(`
      var mc = this.createEmptyMovieClip("filled", 1);
      mc.beginFill(0xff0000, 100);
      mc.moveTo(0, 0);
      mc.lineTo(50, 0);
      mc.lineTo(50, 50);
      mc.lineTo(0, 0);
      mc.endFill();
    `);
  });

  it("MovieClip drawing API: beginGradientFill compiles", () => {
    compilesOk(`
      var mc = this.createEmptyMovieClip("grad", 1);
      var matrix = {matrixType:"box", x:0, y:0, w:100, h:100, r:0};
      mc.beginGradientFill("linear", [0xff0000, 0x0000ff], [100, 100], [0, 255], matrix);
      mc.moveTo(0, 0);
      mc.lineTo(100, 0);
      mc.lineTo(100, 100);
      mc.lineTo(0, 100);
      mc.lineTo(0, 0);
      mc.endFill();
    `);
  });

  it("MovieClip drawing API: curveTo compiles", () => {
    compilesOk(`
      var mc = this.createEmptyMovieClip("curved", 1);
      mc.lineStyle(1, 0x000000);
      mc.moveTo(0, 50);
      mc.curveTo(50, 0, 100, 50);
    `);
  });

  it("MovieClip drawing API: clear() compiles", () => {
    compilesOk(`
      var mc = this.createEmptyMovieClip("c", 1);
      mc.lineStyle(1, 0xff0000);
      mc.moveTo(0, 0);
      mc.lineTo(100, 100);
      mc.clear();
    `);
  });
});
