import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClip visual transform properties", () => {
  it("mc._visible read/write compiles", () => {
    compilesOk(`
      this.myClip._visible = false;
      var v = this.myClip._visible;
    `);
  });

  it("mc._alpha read/write compiles", () => {
    compilesOk(`
      this.myClip._alpha = 50;
      var a = this.myClip._alpha;
    `);
  });

  it("mc._xscale and _yscale compile", () => {
    compilesOk(`
      this.myClip._xscale = 200;
      this.myClip._yscale = 200;
    `);
  });

  it("mc._rotation read/write compiles", () => {
    compilesOk(`
      this.myClip._rotation = 45;
      var r = this.myClip._rotation;
    `);
  });

  it("mc._width and _height (read) compile", () => {
    compilesOk(`
      var w = this.myClip._width;
      var h = this.myClip._height;
    `);
  });

  it("mc._x and _y read/write compile", () => {
    compilesOk(`
      this.myClip._x = 100;
      this.myClip._y = 200;
      var x = this.myClip._x;
      var y = this.myClip._y;
    `);
  });

  it("mc._xmouse and _ymouse (read-only) compile", () => {
    compilesOk(`
      var mx = this.myClip._xmouse;
      var my = this.myClip._ymouse;
    `);
  });

  it("mc._parent compiles", () => {
    compilesOk(`
      var parent = this.myClip._parent;
      parent._visible = false;
    `);
  });

  it("mc._root compiles", () => {
    compilesOk(`
      var root = _root;
      _root.score = 100;
    `);
  });

  it("_level0 access compiles", () => {
    compilesOk(`
      var level = _level0;
      _level0.gotoAndPlay(1);
    `);
  });

  it("compound transform animation compiles", () => {
    compilesOk(`
      this.onEnterFrame = function() {
        this._rotation += 2;
        this._alpha = Math.max(0, this._alpha - 1);
        if (this._alpha <= 0) {
          this._visible = false;
          delete this.onEnterFrame;
        }
      };
    `);
  });
});
