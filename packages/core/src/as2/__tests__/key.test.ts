import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Key class", () => {
  it("Key.isDown() compiles", () => {
    compilesOk(`var down = Key.isDown(Key.LEFT);`);
  });

  it("Key.getCode() compiles", () => {
    compilesOk(`var code = Key.getCode();`);
  });

  it("Key.getAscii() compiles", () => {
    compilesOk(`var ascii = Key.getAscii();`);
  });

  it("Key constant ENTER compiles", () => {
    compilesOk(`var k = Key.ENTER;`);
  });

  it("Key constant ESCAPE compiles", () => {
    compilesOk(`var k = Key.ESCAPE;`);
  });

  it("Key constant arrow keys compile", () => {
    compilesOk(`
      var left = Key.LEFT;
      var right = Key.RIGHT;
      var up = Key.UP;
      var down = Key.DOWN;
    `);
  });

  it("Key constant SPACE and BACKSPACE compile", () => {
    compilesOk(`
      var sp = Key.SPACE;
      var bs = Key.BACKSPACE;
    `);
  });

  it("Key.addListener with onKeyDown compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onKeyDown = function() {
        if (Key.isDown(Key.SPACE)) {
          trace("space pressed");
        }
      };
      Key.addListener(listener);
    `);
  });

  it("Key.addListener with onKeyUp compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onKeyUp = function() {
        trace("key " + Key.getCode() + " released");
      };
      Key.addListener(listener);
    `);
  });

  it("Key.removeListener compiles", () => {
    compilesOk(`
      var listener = {};
      Key.addListener(listener);
      Key.removeListener(listener);
    `);
  });
});
