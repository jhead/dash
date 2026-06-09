import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClip lifecycle", () => {
  it("duplicateMovieClip() global form compiles", () => {
    compilesOk(`duplicateMovieClip(this.myClip, "copy", 10);`);
  });

  it("mc.duplicateMovieClip() method form compiles", () => {
    compilesOk(`
      var copy = this.myClip.duplicateMovieClip("copy1", 10);
    `);
  });

  it("removeMovieClip() global form compiles", () => {
    compilesOk(`removeMovieClip(this.myClip);`);
  });

  it("mc.removeMovieClip() method form compiles", () => {
    compilesOk(`this.myClip.removeMovieClip();`);
  });

  it("attachMovie() basic compiles", () => {
    compilesOk(`
      var mc = this.attachMovie("MySymbol", "instance1", 1);
    `);
  });

  it("attachMovie() with initObj compiles", () => {
    compilesOk(`
      var mc = this.attachMovie("Bullet", "bullet" + i, i, {
        _x: this.gun._x,
        _y: this.gun._y,
        speed: 5
      });
    `);
  });

  it("mc._name property compiles", () => {
    compilesOk(`
      var name = this.myClip._name;
    `);
  });

  it("mc._target property compiles", () => {
    compilesOk(`
      var target = this.myClip._target;
    `);
  });

  it("mc._url property compiles", () => {
    compilesOk(`
      var url = this._url;
    `);
  });

  it("Clip pooling pattern compiles", () => {
    compilesOk(`
      var depth = 0;
      for (var i = 0; i < 5; i++) {
        var mc = this.attachMovie("Enemy", "enemy" + i, depth++);
        mc._x = Math.random() * 550;
        mc._y = Math.random() * 400;
      }
    `);
  });

  it("Clip cleanup pattern compiles", () => {
    compilesOk(`
      var children = [];
      var i = 10;
      while (--i >= 0) {
        var child = this["child" + i];
        if (child) { child.removeMovieClip(); }
      }
    `);
  });
});
