import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 display list depth manipulation", () => {
  it("createEmptyMovieClip compiles", () => {
    compilesOk(`var mc = this.createEmptyMovieClip("myClip", 1);`);
  });

  it("attachMovie compiles", () => {
    compilesOk(`var mc = this.attachMovie("symbolId", "instanceName", 1);`);
  });

  it("attachMovie with initObject compiles", () => {
    compilesOk(`
      var mc = this.attachMovie("Ball", "ball1", 1, {_x: 100, _y: 200});
    `);
  });

  it("duplicateMovieClip compiles", () => {
    compilesOk(`duplicateMovieClip(this.myClip, "myClip2", 2);`);
  });

  it("removeMovieClip compiles", () => {
    compilesOk(`removeMovieClip(this.myClip);`);
  });

  it("mc.removeMovieClip() method compiles", () => {
    compilesOk(`
      var mc = this.attachMovie("Foo", "foo", 1);
      mc.removeMovieClip();
    `);
  });

  it("swapDepths compiles", () => {
    compilesOk(`
      var mc1 = this.attachMovie("A", "a", 1);
      var mc2 = this.attachMovie("B", "b", 2);
      mc1.swapDepths(mc2);
    `);
  });

  it("swapDepths with number compiles", () => {
    compilesOk(`
      var mc = this.attachMovie("A", "a", 5);
      mc.swapDepths(10);
    `);
  });

  it("getDepth compiles", () => {
    compilesOk(`
      var mc = this.attachMovie("A", "a", 3);
      var d = mc.getDepth();
    `);
  });

  it("getNextHighestDepth compiles", () => {
    compilesOk(`
      var d = this.getNextHighestDepth();
      var mc = this.attachMovie("A", "a", d);
    `);
  });

  it("getInstanceAtDepth compiles", () => {
    compilesOk(`
      var mc = this.getInstanceAtDepth(1);
      if (mc) trace(mc._name);
    `);
  });

  it("depth-based particle system pattern compiles", () => {
    compilesOk(`
      for (var i = 0; i < 10; i++) {
        var depth = this.getNextHighestDepth();
        var p = this.attachMovie("Particle", "p" + i, depth);
        p._x = Math.random() * 550;
        p._y = Math.random() * 400;
      }
    `);
  });
});
