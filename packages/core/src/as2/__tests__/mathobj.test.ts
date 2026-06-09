import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Math object", () => {
  it("Math.abs() compiles", () => { compilesOk(`var x = Math.abs(-5);`); });
  it("Math.ceil() compiles", () => { compilesOk(`var x = Math.ceil(1.5);`); });
  it("Math.floor() compiles", () => { compilesOk(`var x = Math.floor(1.9);`); });
  it("Math.round() compiles", () => { compilesOk(`var x = Math.round(1.5);`); });
  it("Math.sqrt() compiles", () => { compilesOk(`var x = Math.sqrt(9);`); });
  it("Math.pow() compiles", () => { compilesOk(`var x = Math.pow(2, 8);`); });
  it("Math.min() compiles", () => { compilesOk(`var x = Math.min(3, 5);`); });
  it("Math.max() compiles", () => { compilesOk(`var x = Math.max(3, 5);`); });
  it("Math.random() compiles", () => { compilesOk(`var x = Math.random();`); });
  it("Math.sin() compiles", () => { compilesOk(`var x = Math.sin(Math.PI);`); });
  it("Math.cos() compiles", () => { compilesOk(`var x = Math.cos(0);`); });
  it("Math.tan() compiles", () => { compilesOk(`var x = Math.tan(Math.PI / 4);`); });
  it("Math.asin() compiles", () => { compilesOk(`var x = Math.asin(1);`); });
  it("Math.acos() compiles", () => { compilesOk(`var x = Math.acos(1);`); });
  it("Math.atan() compiles", () => { compilesOk(`var x = Math.atan(1);`); });
  it("Math.atan2() compiles", () => { compilesOk(`var x = Math.atan2(1, 1);`); });
  it("Math.log() compiles", () => { compilesOk(`var x = Math.log(Math.E);`); });
  it("Math.exp() compiles", () => { compilesOk(`var x = Math.exp(1);`); });
  it("Math.PI constant compiles", () => { compilesOk(`var pi = Math.PI;`); });
  it("Math.E constant compiles", () => { compilesOk(`var e = Math.E;`); });
  it("Math.LN2 constant compiles", () => { compilesOk(`var ln2 = Math.LN2;`); });
  it("Math.SQRT2 constant compiles", () => { compilesOk(`var s = Math.SQRT2;`); });
  it("Math expressions in animation pattern compile", () => {
    compilesOk(`
      var angle = 0;
      onClipEvent(enterFrame) {
        angle += 0.05;
        this._x = 275 + Math.cos(angle) * 100;
        this._y = 200 + Math.sin(angle) * 100;
      }
    `);
  });
});
