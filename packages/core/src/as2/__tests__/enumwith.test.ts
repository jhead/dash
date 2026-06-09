/**
 * Tests for AS2 for-in enumeration and with statement.
 *
 * Verifies that for..in loops and with statements compile correctly,
 * covering plain objects, arrays, prototype properties, nested with,
 * and delete inside for..in.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 for-in enumeration and with statement", () => {
  it("for-in loop over object compiles", () => {
    compilesOk(`
      var obj = {a: 1, b: 2, c: 3};
      var keys = [];
      for (var k in obj) {
        keys.push(k);
      }
    `);
  });

  it("for-in with prototype properties compiles", () => {
    compilesOk(`
      function MyClass() {}
      MyClass.prototype.extra = true;
      var m = new MyClass();
      m.own = 1;
      for (var k in m) {}
    `);
  });

  it("with statement basic usage compiles", () => {
    compilesOk(`
      var obj = {x: 10, y: 20};
      with (obj) {
        trace(x + y);
      }
    `);
  });

  it("nested with statements compile", () => {
    compilesOk(`
      var a = {x: 1};
      var b = {y: 2};
      with (a) {
        with (b) {
          trace(x + y);
        }
      }
    `);
  });

  it("for-in over array indices compiles", () => {
    compilesOk(`
      var arr = [10, 20, 30];
      for (var i in arr) {
        trace(arr[i]);
      }
    `);
  });

  it("for-in with delete compiles", () => {
    compilesOk(`
      var obj = {a: 1, b: 2};
      for (var k in obj) {
        delete obj[k];
      }
    `);
  });
});
