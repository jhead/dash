import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }

describe("AS2 Mouse class", () => {
  it("Mouse.show() compiles", () => { compilesOk(`Mouse.show();`); });
  it("Mouse.hide() compiles", () => { compilesOk(`Mouse.hide();`); });

  it("Mouse.addListener compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onMouseMove = function() { trace("moved"); };
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

  it("onMouseMove callback pattern compiles", () => {
    compilesOk(`
      var listener = {
        onMouseMove: function() {
          trace(_root._xmouse + "," + _root._ymouse);
        },
        onMouseDown: function() { trace("down"); },
        onMouseUp: function() { trace("up"); }
      };
      Mouse.addListener(listener);
    `);
  });

  it("_xmouse/_ymouse on _root compiles", () => {
    compilesOk(`
      var x = _root._xmouse;
      var y = _root._ymouse;
      trace(x + "," + y);
    `);
  });

  it("_xmouse/_ymouse on movie clip compiles", () => {
    compilesOk(`
      var clipX = this._xmouse;
      var clipY = this._ymouse;
    `);
  });

  it("custom cursor pattern compiles", () => {
    compilesOk(`
      Mouse.hide();
      var cursor = this.attachMovie("Cursor", "myCursor", 9999);
      var listener = {};
      listener.onMouseMove = function() {
        cursor._x = _root._xmouse;
        cursor._y = _root._ymouse;
        updateAfterEvent();
      };
      Mouse.addListener(listener);
    `);
  });

  it("updateAfterEvent() in mouse handler compiles", () => {
    compilesOk(`
      var l = {};
      l.onMouseMove = function() {
        updateAfterEvent();
      };
      Mouse.addListener(l);
    `);
  });

  it("hitTest with mouse coordinates compiles", () => {
    compilesOk(`
      var l = {};
      l.onMouseMove = function() {
        var hit = this.targetClip.hitTest(_root._xmouse, _root._ymouse, true);
        if (hit) trace("over target");
      };
      Mouse.addListener(l);
    `);
  });
});
