import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Number formatting methods", () => {
  it("toFixed() compiles", () => {
    compilesOk(`var s = (3.14159).toFixed(2);`);
  });

  it("toPrecision() compiles", () => {
    compilesOk(`var s = (123.456).toPrecision(5);`);
  });

  it("toExponential() compiles", () => {
    compilesOk(`var s = (12345).toExponential(2);`);
  });

  it("toLocaleString() compiles", () => {
    compilesOk(`var s = (1234567).toLocaleString();`);
  });

  it("Infinity arithmetic compiles", () => {
    compilesOk(`
      var inf = Infinity;
      var neg = -Infinity;
      var r1 = inf + 1;
      var r2 = inf - inf;
    `);
  });

  it("NaN propagation compiles", () => {
    compilesOk(`
      var n = NaN;
      var r = n + 1;
      var b = isNaN(r);
    `);
  });

  it("negative zero compiles", () => {
    compilesOk(`
      var nz = -0;
      var r = 1 / nz;
    `);
  });

  it("Number.MAX_VALUE and MIN_VALUE compile", () => {
    compilesOk(`
      var max = Number.MAX_VALUE;
      var min = Number.MIN_VALUE;
    `);
  });

  it("Number.POSITIVE_INFINITY and NEGATIVE_INFINITY compile", () => {
    compilesOk(`
      var posInf = Number.POSITIVE_INFINITY;
      var negInf = Number.NEGATIVE_INFINITY;
    `);
  });

  it("Number.NaN constant compiles", () => {
    compilesOk(`var nan = Number.NaN;`);
  });

  it("bitwise operations on large numbers compile", () => {
    compilesOk(`
      var n = 0xFFFFFFFF;
      var r = n | 0;
      var s = n >>> 0;
    `);
  });
});
