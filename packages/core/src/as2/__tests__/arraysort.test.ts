import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Array sort extensions", () => {
  it("Array.sortOn() with single field compiles", () => {
    compilesOk(`
      var items = [{name: "b"}, {name: "a"}];
      items.sortOn("name");
    `);
  });

  it("Array.sortOn() with multiple fields compiles", () => {
    compilesOk(`
      var items = [{first: "b", last: "x"}, {first: "a", last: "z"}];
      items.sortOn(["last", "first"]);
    `);
  });

  it("Array.NUMERIC flag compiles", () => {
    compilesOk(`
      var a = [10, 2, 30];
      a.sort(Array.NUMERIC);
    `);
  });

  it("Array.DESCENDING flag compiles", () => {
    compilesOk(`
      var a = [1, 2, 3];
      a.sort(Array.DESCENDING);
    `);
  });

  it("Array.CASEINSENSITIVE flag compiles", () => {
    compilesOk(`
      var a = ["B", "a", "C"];
      a.sort(Array.CASEINSENSITIVE);
    `);
  });

  it("sort with numeric comparator compiles", () => {
    compilesOk(`
      var a = [3, 1, 4, 1, 5];
      a.sort(function(x, y) { return x - y; });
    `);
  });

  it("sort reverse with comparator compiles", () => {
    compilesOk(`
      var a = [1, 2, 3];
      a.sort(function(x, y) { return y - x; });
    `);
  });

  it("sortOn with Array.DESCENDING flag compiles", () => {
    compilesOk(`
      var items = [{age: 10}, {age: 5}];
      items.sortOn("age", Array.DESCENDING | Array.NUMERIC);
    `);
  });
});
