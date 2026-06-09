import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 timer functions", () => {
  it("setInterval(fn, ms) compiles", () => {
    compilesOk(`
      var id = setInterval(function() { trace("tick"); }, 1000);
    `);
  });

  it("setInterval(obj, method, ms) compiles", () => {
    compilesOk(`
      var id = setInterval(this, "update", 100);
    `);
  });

  it("setInterval with args compiles", () => {
    compilesOk(`
      var id = setInterval(this, "onTimer", 500, "arg1", 42);
    `);
  });

  it("clearInterval(id) compiles", () => {
    compilesOk(`
      var id = setInterval(function() {}, 100);
      clearInterval(id);
    `);
  });

  it("setTimeout(fn, ms) compiles", () => {
    compilesOk(`
      var id = setTimeout(function() { trace("done"); }, 3000);
    `);
  });

  it("clearTimeout(id) compiles", () => {
    compilesOk(`
      var id = setTimeout(function() {}, 1000);
      clearTimeout(id);
    `);
  });

  it("_global.setInterval compiles", () => {
    compilesOk(`
      var id = _global.setInterval(function() { trace("tick"); }, 250);
    `);
  });

  it("interval with conditional clearInterval compiles", () => {
    compilesOk(`
      var count = 0;
      var id = setInterval(function() {
        count++;
        if (count >= 10) {
          clearInterval(id);
          trace("done after 10 ticks");
        }
      }, 100);
    `);
  });

  it("multiple intervals compile", () => {
    compilesOk(`
      var id1 = setInterval(function() { updateUI(); }, 16);
      var id2 = setInterval(function() { checkInput(); }, 50);
      var id3 = setInterval(function() { autoSave(); }, 30000);
    `);
  });
});
