import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Number class", () => {
  it("new Number(n) compiles", () => {
    compilesOk(`var n = new Number(42);`);
  });

  it("Number(str) conversion compiles", () => {
    compilesOk(`var n = Number("3.14");`);
  });

  it("n.toFixed() compiles", () => {
    compilesOk(`
      var n = 3.14159;
      var s = n.toFixed(2);
    `);
  });

  it("n.toPrecision() compiles", () => {
    compilesOk(`
      var n = 123.456;
      var s = n.toPrecision(5);
    `);
  });

  it("n.toExponential() compiles", () => {
    compilesOk(`
      var n = 12345;
      var s = n.toExponential(2);
    `);
  });

  it("n.toString(radix) compiles", () => {
    compilesOk(`
      var n = 255;
      var hex = n.toString(16);
      var bin = n.toString(2);
      var oct = n.toString(8);
    `);
  });

  it("Number.MAX_VALUE compiles", () => {
    compilesOk(`var max = Number.MAX_VALUE;`);
  });

  it("Number.MIN_VALUE compiles", () => {
    compilesOk(`var min = Number.MIN_VALUE;`);
  });

  it("Number.POSITIVE_INFINITY compiles", () => {
    compilesOk(`var inf = Number.POSITIVE_INFINITY;`);
  });

  it("Number.NEGATIVE_INFINITY compiles", () => {
    compilesOk(`var ninf = Number.NEGATIVE_INFINITY;`);
  });

  it("Number.NaN compiles", () => {
    compilesOk(`var nan = Number.NaN;`);
  });

  it("isNaN() global function compiles", () => {
    compilesOk(`
      var x = isNaN("hello");
      if (isNaN(Number("abc"))) { trace("not a number"); }
    `);
  });

  it("isFinite() global function compiles", () => {
    compilesOk(`
      var x = isFinite(42);
      var y = isFinite(1 / 0);
    `);
  });

  it("parseInt and parseFloat compile", () => {
    compilesOk(`
      var i = parseInt("42px");
      var f = parseFloat("3.14em");
      var hex = parseInt("ff", 16);
    `);
  });
});
