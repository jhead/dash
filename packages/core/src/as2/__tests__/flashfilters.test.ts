import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
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

  // -------------------------------------------------------------------------
  // import is a true no-op — emits no bytecode
  // -------------------------------------------------------------------------

  it("import statement emits no bytecode (pure no-op)", () => {
    const bytes = compileAS2("import flash.filters.BlurFilter;");
    expect(bytes.length).toBe(0);
  });

  it("import does not emit the import path as a string in bytecode", () => {
    const bytes = compileAS2(`
      import flash.filters.BlurFilter;
      var x = 1;
    `);
    // The import path must NOT appear as a string in the bytecode output
    expect(containsString(bytes, "flash.filters.BlurFilter")).toBe(false);
    expect(containsString(bytes, "import flash.filters.BlurFilter")).toBe(false);
  });

  it("onEnterFrame with typed BlurFilter var and Math.abs args compiles correctly", () => {
    // This is the exact pattern that previously caused Avm1::pop: Stack underflow
    const src = `
import flash.filters.BlurFilter;

_root.onEnterFrame = function () {
    var filter:BlurFilter = new BlurFilter(Math.abs(_xmouse-200), Math.abs(_ymouse-200), 3);
    var filterArray:Array = new Array();
    filterArray.push(filter);
    obj.filters = filterArray;
}`;
    compilesOk(src);

    const bytes = compileAS2(src);

    // import path must NOT appear in bytecode
    expect(containsString(bytes, "BlurFilter")).toBe(true);   // class name, yes
    expect(containsString(bytes, "import flash")).toBe(false); // import string, no

    // The function body must produce the same bytecode as the equivalent untyped version
    const srcUntyped = `
_root.onEnterFrame = function () {
    var filter = new BlurFilter(Math.abs(_xmouse-200), Math.abs(_ymouse-200), 3);
    var filterArray = new Array();
    filterArray.push(filter);
    obj.filters = filterArray;
}`;
    const bytesUntyped = compileAS2(srcUntyped);

    // Extract function body from both (skip outer scope bytecode)
    function findFunctionBody(b: Uint8Array): Uint8Array {
      let pos = 0;
      while (pos < b.length && b[pos] !== 0x8e) pos++;
      let hpos = pos + 3;
      while (b[hpos++] !== 0) { /* skip func name */ }
      const numParams = b[hpos]! | (b[hpos + 1]! << 8);
      hpos += 5; // skip numParams, registerCount, flags
      for (let i = 0; i < numParams; i++) { hpos++; while (b[hpos++] !== 0) { /* skip param name */ } }
      const codeSize = b[hpos]! | (b[hpos + 1]! << 8);
      hpos += 2;
      return b.slice(hpos, hpos + codeSize);
    }

    const body1 = findFunctionBody(bytes);
    const body2 = findFunctionBody(bytesUntyped);
    expect(body1).toEqual(body2);
  });

  it("multiple imports in sequence emit no bytecode", () => {
    const bytes = compileAS2(`
      import flash.filters.DropShadowFilter;
      import flash.filters.GlowFilter;
      import flash.filters.BlurFilter;
    `);
    expect(bytes.length).toBe(0);
  });
});
