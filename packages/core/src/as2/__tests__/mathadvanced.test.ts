import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Math advanced", () => {
  it("Math.sin and Math.cos compile", () => {
    compilesOk(`
      var x = Math.cos(Math.PI / 4);
      var y = Math.sin(Math.PI / 4);
    `);
  });

  it("Math.tan and Math.atan compile", () => {
    compilesOk(`
      var t = Math.tan(0.5);
      var at = Math.atan(1.0);
    `);
  });

  it("Math.asin and Math.acos compile", () => {
    compilesOk(`
      var as = Math.asin(0.5);
      var ac = Math.acos(0.5);
    `);
  });

  it("Math.atan2 compiles", () => {
    compilesOk(`
      var angle = Math.atan2(3, 4);
    `);
  });

  it("Math.pow and Math.sqrt compile", () => {
    compilesOk(`
      var p = Math.pow(2, 10);
      var s = Math.sqrt(144);
    `);
  });

  it("Math.exp and Math.log compile", () => {
    compilesOk(`
      var e = Math.exp(1);
      var l = Math.log(Math.E);
    `);
  });

  it("Math.ceil, floor, round compile", () => {
    compilesOk(`
      var c = Math.ceil(1.3);
      var f = Math.floor(1.9);
      var r = Math.round(1.5);
    `);
  });

  it("Math.random compiles", () => {
    compilesOk(`
      var r = Math.random();
    `);
  });

  it("Math.max with many args compiles", () => {
    compilesOk(`
      var m = Math.max(1, 5, 3, 2, 4);
    `);
  });

  it("Math.min with many args compiles", () => {
    compilesOk(`
      var m = Math.min(10, 5, 8, 2, 7);
    `);
  });

  it("Math.PI and Math.E constants compile", () => {
    compilesOk(`
      var pi = Math.PI;
      var e = Math.E;
      var twoPi = 2 * Math.PI;
    `);
  });

  it("Math.abs compiles", () => {
    compilesOk(`
      var a = Math.abs(-42);
    `);
  });

  it("trigonometry in a rotation formula compiles", () => {
    compilesOk(`
      var angle = 45 * (Math.PI / 180);
      var cosA = Math.cos(angle);
      var sinA = Math.sin(angle);
      var x = 100 * cosA - 50 * sinA;
      var y = 100 * sinA + 50 * cosA;
    `);
  });
});
