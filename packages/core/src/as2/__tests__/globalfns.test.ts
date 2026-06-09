import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 global property functions", () => {
  it("setProperty(target, prop, value) compiles", () => {
    compilesOk(`setProperty(this.myClip, _visible, false);`);
  });

  it("setProperty with property constants compile", () => {
    compilesOk(`
      setProperty(this.myClip, _x, 100);
      setProperty(this.myClip, _y, 200);
      setProperty(this.myClip, _alpha, 50);
    `);
  });

  it("getProperty(target, prop) compiles", () => {
    compilesOk(`var x = getProperty(this.myClip, _x);`);
  });

  it("eval() compiles", () => {
    compilesOk(`
      var clipName = "mc" + i;
      var mc = eval(clipName);
    `);
  });

  it("eval with path compiles", () => {
    compilesOk(`
      var target = "_root.container.item" + idx;
      var clip = eval(target);
      clip._visible = true;
    `);
  });

  it("Number() conversion compiles", () => {
    compilesOk(`
      var n = Number("42");
      var n2 = Number(true);
      var n3 = Number(null);
    `);
  });

  it("String() conversion compiles", () => {
    compilesOk(`
      var s = String(42);
      var s2 = String(true);
    `);
  });

  it("Boolean() conversion compiles", () => {
    compilesOk(`
      var b = Boolean(0);
      var b2 = Boolean("");
      var b3 = Boolean(null);
    `);
  });

  it("void operator compiles", () => {
    compilesOk(`
      var x = void 0;
      void this.doSomething();
    `);
  });

  it("call() frame action compiles", () => {
    compilesOk(`
      call("myFrame");
    `);
  });
});
