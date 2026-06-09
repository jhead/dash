import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClip depth management", () => {
  it("mc.swapDepths(target) compiles", () => {
    compilesOk(`
      this.clipA.swapDepths(this.clipB);
    `);
  });

  it("mc.swapDepths(depth) compiles", () => {
    compilesOk(`
      this.myClip.swapDepths(10);
    `);
  });

  it("mc.getDepth() compiles", () => {
    compilesOk(`
      var d = this.myClip.getDepth();
    `);
  });

  it("mc.getNextHighestDepth() compiles", () => {
    compilesOk(`
      var depth = this.getNextHighestDepth();
      this.attachMovie("item", "item" + depth, depth);
    `);
  });

  it("mc.getInstanceAtDepth() compiles", () => {
    compilesOk(`
      var clip = this.getInstanceAtDepth(5);
    `);
  });

  it("_level0 depth access compiles", () => {
    compilesOk(`
      var clip = _level0.getInstanceAtDepth(1);
    `);
  });

  it("creating multiple clips at increasing depths compiles", () => {
    compilesOk(`
      for (var i = 0; i < 5; i++) {
        var depth = this.getNextHighestDepth();
        var mc = this.attachMovie("item", "item" + i, depth);
        mc._x = i * 50;
      }
    `);
  });
});
