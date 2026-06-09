import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Number and Boolean conversions", () => {
  it("Number() coercion compiles", () => {
    compilesOk(`var n = Number("42");`);
  });

  it("Boolean() coercion compiles", () => {
    compilesOk(`var b = Boolean(0);`);
  });

  it("parseInt() compiles", () => {
    compilesOk(`var n = parseInt("42px");`);
  });

  it("parseInt() with radix compiles", () => {
    compilesOk(`var n = parseInt("FF", 16);`);
  });

  it("parseFloat() compiles", () => {
    compilesOk(`var n = parseFloat("3.14");`);
  });

  it("isNaN() compiles", () => {
    compilesOk(`var b = isNaN(NaN);`);
  });

  it("isFinite() compiles", () => {
    compilesOk(`var b = isFinite(Infinity);`);
  });

  it("toString() on number compiles", () => {
    compilesOk(`
      var n = 255;
      var s = n.toString(16);
    `);
  });

  it("toFixed() compiles", () => {
    compilesOk(`
      var n = 3.14159;
      var s = n.toFixed(2);
    `);
  });

  it("NaN and Infinity literals compile", () => {
    compilesOk(`
      var nan = NaN;
      var inf = Infinity;
    `);
  });

  it("implicit boolean conversion in if compiles", () => {
    compilesOk(`
      var x = 0;
      if (x) { trace("truthy"); }
    `);
  });

  it("double negation for boolean coercion compiles", () => {
    compilesOk(`
      var b = !!someValue;
    `);
  });

  it("Number.MAX_VALUE and Number.MIN_VALUE compile", () => {
    compilesOk(`
      var max = Number.MAX_VALUE;
      var min = Number.MIN_VALUE;
    `);
  });
});
