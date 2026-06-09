import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }

describe("AS2 RegExp", () => {
  it("new RegExp() compiles", () => {
    compilesOk(`var re = new RegExp("hello");`);
  });

  it("new RegExp() with flags compiles", () => {
    compilesOk(`var re = new RegExp("hello", "gi");`);
  });

  it("regex literal compiles", () => {
    compilesOk(`var re = /hello/;`);
  });

  it("regex literal with flags compiles", () => {
    compilesOk(`var re = /hello/gi;`);
  });

  it("re.test() compiles", () => {
    compilesOk(`
      var re = /hello/i;
      trace(re.test("Hello World"));
    `);
  });

  it("re.exec() compiles", () => {
    compilesOk(String.raw`
      var re = /(\d+)/;
      var m = re.exec("abc 123 def");
    `);
  });

  it("String.match() with regex compiles", () => {
    compilesOk(String.raw`
      var s = "Hello World";
      var matches = s.match(/\w+/g);
    `);
  });

  it("String.replace() with regex compiles", () => {
    compilesOk(`
      var s = "Hello World";
      var result = s.replace(/world/i, "Flash");
    `);
  });

  it("String.search() with regex compiles", () => {
    compilesOk(`
      var s = "Hello World";
      var idx = s.search(/world/i);
    `);
  });

  it("String.split() with regex compiles", () => {
    compilesOk(String.raw`
      var s = "a1b2c3d";
      var parts = s.split(/\d/);
    `);
  });

  it("regex global flag iteration compiles", () => {
    compilesOk(String.raw`
      var re = /\d+/g;
      var text = "phone: 555-1234";
      var m;
      while ((m = re.exec(text)) != null) {
        trace(m[0]);
      }
    `);
  });

  it("regex with backreference compiles", () => {
    compilesOk(String.raw`
      var re = /(\w+)\s\1/;
      trace(re.test("the the"));
    `);
  });

  it("regex case insensitive flag compiles", () => {
    compilesOk(`var re = new RegExp("pattern", "i"); trace(re.test("PATTERN"));`);
  });
});
