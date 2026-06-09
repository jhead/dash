import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 hitTest and collision detection", () => {
  it("mc.hitTest(x, y) point test compiles", () => {
    compilesOk(`
      var hit = this.myClip.hitTest(100, 150);
    `);
  });

  it("mc.hitTest(x, y, shapeFlag) compiles", () => {
    compilesOk(`
      var hit = this.myClip.hitTest(100, 150, true);
    `);
  });

  it("mc.hitTest(target) clip-vs-clip test compiles", () => {
    compilesOk(`
      var hit = this.clipA.hitTest(this.clipB);
    `);
  });

  it("getBounds() compiles", () => {
    compilesOk(`
      var bounds = this.myClip.getBounds(this);
      var left = bounds.xMin;
      var right = bounds.xMax;
      var top = bounds.yMin;
      var bottom = bounds.yMax;
    `);
  });

  it("getBounds(_root) compiles", () => {
    compilesOk(`
      var bounds = this.myClip.getBounds(_root);
    `);
  });

  it("globalToLocal() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var pt = new Point(_xmouse, _ymouse);
      this.myClip.globalToLocal(pt);
      var localX = pt.x;
    `);
  });

  it("localToGlobal() compiles", () => {
    compilesOk(`
      import flash.geom.Point;
      var pt = new Point(0, 0);
      this.myClip.localToGlobal(pt);
      var globalX = pt.x;
    `);
  });

  it("hitTest in game loop compiles", () => {
    compilesOk(`
      this.onEnterFrame = function() {
        var i = this.bullets.length;
        while (--i >= 0) {
          if (this.bullets[i].hitTest(this.enemy)) {
            this.bullets[i].removeMovieClip();
            this.enemy._visible = false;
          }
        }
      };
    `);
  });

  it("bounding box overlap test compiles", () => {
    compilesOk(`
      function overlaps(a, b) {
        var ab = a.getBounds(_root);
        var bb = b.getBounds(_root);
        return ab.xMax > bb.xMin && ab.xMin < bb.xMax &&
               ab.yMax > bb.yMin && ab.yMin < bb.yMax;
      }
    `);
  });
});
