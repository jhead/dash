import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 global built-in functions", () => {
  it("trace() compiles", () => {
    compilesOk(`trace("hello");`);
  });

  it("trace() with expression compiles", () => {
    compilesOk(`trace(1 + 2 + " items");`);
  });

  it("getTimer() compiles", () => {
    compilesOk(`var t = getTimer();`);
  });

  it("random(n) compiles", () => {
    compilesOk(`var r = random(100);`);
  });

  it("Math.random() compiles (modern form)", () => {
    compilesOk(`var r = Math.random();`);
  });

  it("escape() compiles", () => {
    compilesOk(`var s = escape("hello world");`);
  });

  it("unescape() compiles", () => {
    compilesOk(`var s = unescape("hello%20world");`);
  });

  it("parseInt and parseFloat compile as global calls", () => {
    compilesOk(`
      var n = parseInt("42");
      var f = parseFloat("3.14");
    `);
  });

  it("isNaN and isFinite compile", () => {
    compilesOk(`
      var a = isNaN(NaN);
      var b = isFinite(Infinity);
    `);
  });

  it("eval() compiles", () => {
    compilesOk(`var result = eval("1 + 2");`);
  });

  it("ord() and chr() compile", () => {
    compilesOk(`
      var code = ord("A");
      var ch = chr(65);
    `);
  });

  it("setTimeout/clearTimeout compile", () => {
    compilesOk(`
      var id = setTimeout(function() { trace("done"); }, 1000);
      clearTimeout(id);
    `);
  });
});
