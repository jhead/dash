import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }

describe("AS2 numeric edge cases", () => {
  it("NaN literal compiles", () => { compilesOk(`var n = NaN;`); });
  it("isNaN() compiles", () => { compilesOk(`trace(isNaN(NaN));`); });
  it("isNaN() with number compiles", () => { compilesOk(`trace(isNaN(42));`); });
  it("isNaN() with string compiles", () => { compilesOk(`trace(isNaN("hello"));`); });
  it("Infinity literal compiles", () => { compilesOk(`var inf = Infinity;`); });
  it("isFinite() compiles", () => { compilesOk(`trace(isFinite(42));`); });
  it("isFinite() with Infinity compiles", () => { compilesOk(`trace(isFinite(Infinity));`); });
  it("parseInt() compiles", () => { compilesOk(`var n = parseInt("42px");`); });
  it("parseInt() with radix compiles", () => { compilesOk(`var n = parseInt("ff", 16);`); });
  it("parseFloat() compiles", () => { compilesOk(`var n = parseFloat("3.14");`); });
  it("Number.MAX_VALUE compiles", () => { compilesOk(`var max = Number.MAX_VALUE;`); });
  it("Number.MIN_VALUE compiles", () => { compilesOk(`var min = Number.MIN_VALUE;`); });
  it("Number.POSITIVE_INFINITY compiles", () => { compilesOk(`var inf = Number.POSITIVE_INFINITY;`); });
  it("Number.NEGATIVE_INFINITY compiles", () => { compilesOk(`var ninf = Number.NEGATIVE_INFINITY;`); });
  it("Number.NaN compiles", () => { compilesOk(`var nan = Number.NaN;`); });
  it("division by zero is Infinity compiles", () => { compilesOk(`var inf = 1 / 0;`); });
  it("modulo with NaN compiles", () => { compilesOk(`var n = NaN % 5;`); });
  it("NaN comparison compiles", () => { compilesOk(`if (isNaN(x)) { trace("nan"); }`); });
});
