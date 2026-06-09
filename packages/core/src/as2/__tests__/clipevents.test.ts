import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClip clip events", () => {
  it("mc.onEnterFrame assignment compiles", () => {
    compilesOk(`this.myClip.onEnterFrame = function() { trace("tick"); };`);
  });

  it("mc.onLoad assignment compiles", () => {
    compilesOk(`this.myClip.onLoad = function() { trace("loaded"); };`);
  });

  it("mc.onUnload assignment compiles", () => {
    compilesOk(`this.myClip.onUnload = function() { trace("unloaded"); };`);
  });

  it("mc.onPress assignment compiles", () => {
    compilesOk(`this.myBtn.onPress = function() { trace("press"); };`);
  });

  it("mc.onRelease assignment compiles", () => {
    compilesOk(`this.myBtn.onRelease = function() { trace("release"); };`);
  });

  it("mc.onReleaseOutside assignment compiles", () => {
    compilesOk(`this.myBtn.onReleaseOutside = function() { trace("outside"); };`);
  });

  it("mc.onRollOver and onRollOut compile", () => {
    compilesOk(`
      this.myBtn.onRollOver = function() { trace("over"); };
      this.myBtn.onRollOut = function() { trace("out"); };
    `);
  });

  it("mc.onMouseMove assignment compiles", () => {
    compilesOk(`this.myClip.onMouseMove = function() { trace(_xmouse); };`);
  });

  it("mc.onMouseDown and onMouseUp compile", () => {
    compilesOk(`
      this.myClip.onMouseDown = function() { trace("down"); };
      this.myClip.onMouseUp = function() { trace("up"); };
    `);
  });

  it("mc.onDragOver and onDragOut compile", () => {
    compilesOk(`
      this.myBtn.onDragOver = function() { trace("drag over"); };
      this.myBtn.onDragOut = function() { trace("drag out"); };
    `);
  });

  it("delete clip event handler compiles", () => {
    compilesOk(`
      this.myClip.onEnterFrame = function() { trace("running"); };
      delete this.myClip.onEnterFrame;
    `);
  });
});
