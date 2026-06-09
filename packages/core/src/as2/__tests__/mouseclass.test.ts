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
      var listener = {
        onMouseDown: function() { trace("down"); },
        onMouseUp: function() { trace("up"); },
        onMouseMove: function() { trace("move"); }
      };
      Mouse.addListener(listener);
    `);
  });

  it("Mouse.removeListener compiles", () => {
    compilesOk(`
      Mouse.removeListener(myListener);
    `);
  });

  it("_xmouse and _ymouse properties compile", () => {
    compilesOk(`
      var x = _xmouse;
      var y = _ymouse;
    `);
  });

  it("this._xmouse and this._ymouse compile", () => {
    compilesOk(`
      var x = this._xmouse;
      var y = this._ymouse;
    `);
  });
});
