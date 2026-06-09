/**
 * Tests for AS2 SharedObject local storage class.
 *
 * Verifies that SharedObject.getLocal(), data property access/set,
 * flush(), clear(), size, onStatus handler, and local path arguments
 * all compile without error using the AS2 compiler.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 SharedObject local storage", () => {
  it("SharedObject.getLocal() compiles", () => {
    compilesOk(`var so = SharedObject.getLocal("myData");`);
  });

  it("SharedObject data property access compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      var vol = so.data.volume;
    `);
  });

  it("SharedObject data property set compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      so.data.volume = 80;
    `);
  });

  it("SharedObject.flush() compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("scores");
      so.data.highScore = 9999;
      so.flush();
    `);
  });

  it("SharedObject.clear() compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("temp");
      so.clear();
    `);
  });

  it("SharedObject.size property compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("data");
      var sz = so.size;
    `);
  });

  it("SharedObject with local path compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("game", "/");
    `);
  });

  it("SharedObject.onStatus handler compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("game");
      so.onStatus = function(info) { trace(info.code); };
    `);
  });
});
