import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Array advanced methods", () => {
  it("Array.splice() delete only compiles", () => {
    compilesOk(`
      var a = [1, 2, 3, 4, 5];
      a.splice(2, 1);
    `);
  });

  it("Array.splice() insert compiles", () => {
    compilesOk(`
      var a = [1, 2, 3];
      a.splice(1, 0, 10, 11);
    `);
  });

  it("Array.slice() compiles", () => {
    compilesOk(`
      var a = [1, 2, 3, 4, 5];
      var sub = a.slice(1, 3);
    `);
  });

  it("Array.sort() default compiles", () => {
    compilesOk(`
      var a = [3, 1, 2];
      a.sort();
    `);
  });

  it("Array.sort(fn) custom comparator compiles", () => {
    compilesOk(`
      var a = [3, 1, 2];
      a.sort(function(x, y) { return x - y; });
    `);
  });

  it("Array.sortOn() single field compiles", () => {
    compilesOk(`
      var people = [{name:"Bob"}, {name:"Alice"}];
      people.sortOn("name");
    `);
  });

  it("Array.sortOn() with flags compiles", () => {
    compilesOk(`
      var items = [{val:3}, {val:1}];
      items.sortOn("val", Array.NUMERIC | Array.DESCENDING);
    `);
  });

  it("Array sort flags compile", () => {
    compilesOk(`
      var ci = Array.CASEINSENSITIVE;
      var desc = Array.DESCENDING;
      var uniq = Array.UNIQUESORT;
      var retIdx = Array.RETURNINDEXEDARRAY;
      var num = Array.NUMERIC;
    `);
  });

  it("Array.join() compiles", () => {
    compilesOk(`
      var a = [1, 2, 3];
      var s = a.join(", ");
    `);
  });

  it("Array.concat() compiles", () => {
    compilesOk(`
      var a = [1, 2];
      var b = [3, 4];
      var c = a.concat(b);
    `);
  });

  it("Array.indexOf() compiles", () => {
    compilesOk(`
      var a = [10, 20, 30];
      var idx = a.indexOf(20);
    `);
  });

  it("Array reverse and toString compile", () => {
    compilesOk(`
      var a = [1, 2, 3];
      a.reverse();
      var s = a.toString();
    `);
  });
});
