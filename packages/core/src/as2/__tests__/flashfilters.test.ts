import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 flash.filters package", () => {
  it("import flash.filters.DropShadowFilter compiles", () => {
    compilesOk(`import flash.filters.DropShadowFilter;`);
  });

  it("new DropShadowFilter() compiles", () => {
    compilesOk(`
      import flash.filters.DropShadowFilter;
      var f = new DropShadowFilter(4, 45, 0x000000, 0.8, 4, 4, 1, 1);
    `);
  });

  it("new GlowFilter() compiles", () => {
    compilesOk(`
      import flash.filters.GlowFilter;
      var f = new GlowFilter(0xFF0000, 1, 6, 6, 2, 1);
    `);
  });

  it("new BlurFilter() compiles", () => {
    compilesOk(`
      import flash.filters.BlurFilter;
      var f = new BlurFilter(4, 4, 1);
    `);
  });

  it("new BevelFilter() compiles", () => {
    compilesOk(`
      import flash.filters.BevelFilter;
      var f = new BevelFilter(4, 45, 0xFFFFFF, 0.8, 0x000000, 0.8, 4, 4, 1, 1, "inner");
    `);
  });

  it("mc.filters array assignment compiles", () => {
    compilesOk(`
      import flash.filters.DropShadowFilter;
      import flash.filters.GlowFilter;
      var shadow = new DropShadowFilter();
      var glow = new GlowFilter(0xFF0000);
      myClip.filters = [shadow, glow];
    `);
  });

  it("filter property access compiles", () => {
    compilesOk(`
      import flash.filters.DropShadowFilter;
      var f = new DropShadowFilter(4, 45, 0x000000, 0.5);
      var dist = f.distance;
      var angle = f.angle;
      var color = f.color;
      var alpha = f.alpha;
    `);
  });

  it("filter clone() compiles", () => {
    compilesOk(`
      import flash.filters.BlurFilter;
      var f = new BlurFilter(8, 8);
      var copy = f.clone();
    `);
  });

  it("GradientGlowFilter compiles", () => {
    compilesOk(`
      import flash.filters.GradientGlowFilter;
      var f = new GradientGlowFilter(4, 45, [0xFF0000, 0x000000], [1, 0], [0, 255], 4, 4, 1, 1, "outer");
    `);
  });
});
