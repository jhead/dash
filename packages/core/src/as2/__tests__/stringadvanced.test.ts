import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 String advanced methods", () => {
  it("String.split(separator) compiles", () => {
    compilesOk(`
      var parts = "a,b,c".split(",");
    `);
  });

  it("String.split(regex) compiles", () => {
    compilesOk(`
      var parts = "hello world".split(/\\s+/);
    `);
  });

  it("String.split('') compiles", () => {
    compilesOk(`
      var chars = "hello".split("");
    `);
  });

  it("String.match(regex) compiles", () => {
    compilesOk(`
      var m = "hello world".match(/\\w+/g);
    `);
  });

  it("String.replace(regex, str) compiles", () => {
    compilesOk(`
      var s = "hello world".replace(/world/, "Flash");
    `);
  });

  it("String.replace(regex, fn) compiles", () => {
    compilesOk(`
      var s = "hello world".replace(/(\\w+)/g, function(match) {
        return match.toUpperCase();
      });
    `);
  });

  it("String.search(regex) compiles", () => {
    compilesOk(`
      var idx = "hello".search(/l+/);
    `);
  });

  it("String.toUpperCase/toLowerCase compile", () => {
    compilesOk(`
      var upper = "hello".toUpperCase();
      var lower = "WORLD".toLowerCase();
    `);
  });

  it("String.charCodeAt() compiles", () => {
    compilesOk(`
      var code = "A".charCodeAt(0);
    `);
  });

  it("String.fromCharCode() static method compiles", () => {
    compilesOk(`
      var ch = String.fromCharCode(65);
      var str = String.fromCharCode(72, 101, 108, 108, 111);
    `);
  });

  it("String.substr() compiles", () => {
    compilesOk(`
      var sub = "hello world".substr(6, 5);
    `);
  });

  it("String.substring() compiles", () => {
    compilesOk(`
      var sub = "hello world".substring(6, 11);
    `);
  });

  it("String concatenation and length compile", () => {
    compilesOk(`
      var s = "Flash" + " " + "8";
      var len = s.length;
    `);
  });

  it("String.indexOf() and lastIndexOf() compile", () => {
    compilesOk(`
      var idx = "hello world".indexOf("o");
      var last = "hello world".lastIndexOf("o");
    `);
  });
});
