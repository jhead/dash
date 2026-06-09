import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Mouse class", () => {
  it("Mouse.show() compiles", () => {
    compilesOk(`Mouse.show();`);
  });

  it("Mouse.hide() compiles", () => {
    compilesOk(`Mouse.hide();`);
  });

  it("Mouse.addListener compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onMouseMove = function() {
        trace(_xmouse + ", " + _ymouse);
      };
      Mouse.addListener(listener);
    `);
  });

  it("Mouse.removeListener compiles", () => {
    compilesOk(`
      var listener = {};
      Mouse.addListener(listener);
      Mouse.removeListener(listener);
    `);
  });

  it("onMouseDown handler compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onMouseDown = function() { trace("click"); };
      Mouse.addListener(listener);
    `);
  });

  it("onMouseUp handler compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onMouseUp = function() { trace("release"); };
      Mouse.addListener(listener);
    `);
  });

  it("_xmouse and _ymouse compile", () => {
    compilesOk(`
      var mx = _xmouse;
      var my = _ymouse;
    `);
  });

  it("mc._xmouse and mc._ymouse compile", () => {
    compilesOk(`
      var x = this.myClip._xmouse;
      var y = this.myClip._ymouse;
    `);
  });

  it("startDrag() compiles", () => {
    compilesOk(`
      this.myClip.startDrag();
    `);
  });

  it("startDrag(lockCenter, bounds) compiles", () => {
    compilesOk(`
      this.myClip.startDrag(true, 0, 0, 550, 400);
    `);
  });

  it("stopDrag() compiles", () => {
    compilesOk(`
      this.myClip.stopDrag();
    `);
  });

  it("drag pattern compiles", () => {
    compilesOk(`
      this.myClip.onPress = function() { this.startDrag(true); };
      this.myClip.onRelease = function() { this.stopDrag(); };
    `);
  });
});
