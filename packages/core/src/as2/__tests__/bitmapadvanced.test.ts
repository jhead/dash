/**
 * Tests for AS2 BitmapData advanced methods.
 *
 * Verifies that advanced BitmapData method calls and the ColorTransform
 * constructor compile without error. Methods already covered by
 * bitmapdata.test.ts (setPixel, getPixel, fillRect, copyPixels, draw) are
 * not repeated here.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 BitmapData advanced methods", () => {
  it("BitmapData.copyPixels() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      import flash.geom.Rectangle;
      import flash.geom.Point;
      var src = new BitmapData(100, 100);
      var dst = new BitmapData(50, 50);
      var rect = new Rectangle(0, 0, 50, 50);
      var pt = new Point(0, 0);
      dst.copyPixels(src, rect, pt);
    `);
  });

  it("BitmapData.draw() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100);
      bmp.draw(this.myClip);
    `);
  });

  it("BitmapData.fillRect() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      import flash.geom.Rectangle;
      var bmp = new BitmapData(100, 100);
      var rect = new Rectangle(10, 10, 50, 50);
      bmp.fillRect(rect, 0xFFFF0000);
    `);
  });

  it("BitmapData.floodFill() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100, false, 0xFFFFFFFF);
      bmp.floodFill(50, 50, 0xFFFF0000);
    `);
  });

  it("BitmapData.getPixel() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100);
      var color = bmp.getPixel(10, 20);
    `);
  });

  it("BitmapData.setPixel() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100);
      bmp.setPixel(10, 20, 0xFF0000);
    `);
  });

  it("BitmapData.getPixel32() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100, true, 0);
      var argb = bmp.getPixel32(5, 5);
    `);
  });

  it("BitmapData.setPixel32() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100, true, 0);
      bmp.setPixel32(5, 5, 0x80FF0000);
    `);
  });

  it("BitmapData.lock() and unlock() compile", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100);
      bmp.lock();
      for (var i = 0; i < 100; i++) bmp.setPixel(i, i, 0xFF0000);
      bmp.unlock();
    `);
  });

  it("BitmapData.colorTransform() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      import flash.geom.Rectangle;
      import flash.geom.ColorTransform;
      var bmp = new BitmapData(100, 100);
      var rect = new Rectangle(0, 0, 100, 100);
      var ct = new ColorTransform(1.0, 0, 0, 1.0);
      bmp.colorTransform(rect, ct);
    `);
  });

  it("BitmapData.clone() compiles", () => {
    compilesOk(`
      import flash.display.BitmapData;
      var bmp = new BitmapData(100, 100, false, 0xFFFFFF);
      var copy = bmp.clone();
    `);
  });
});
