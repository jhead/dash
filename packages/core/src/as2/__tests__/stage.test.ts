import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Stage class", () => {
  it("Stage.width compiles", () => {
    compilesOk(`var w = Stage.width;`);
  });

  it("Stage.height compiles", () => {
    compilesOk(`var h = Stage.height;`);
  });

  it("Stage.scaleMode read compiles", () => {
    compilesOk(`var sm = Stage.scaleMode;`);
  });

  it("Stage.scaleMode write compiles", () => {
    compilesOk(`Stage.scaleMode = "noScale";`);
  });

  it("Stage.align compiles", () => {
    compilesOk(`Stage.align = "TL";`);
  });

  it("Stage.showMenu compiles", () => {
    compilesOk(`Stage.showMenu = false;`);
  });

  it("Stage.addListener compiles", () => {
    compilesOk(`
      var listener = {};
      listener.onResize = function() {
        trace("resized: " + Stage.width + "x" + Stage.height);
      };
      Stage.addListener(listener);
    `);
  });

  it("Stage.removeListener compiles", () => {
    compilesOk(`
      var listener = {};
      Stage.addListener(listener);
      Stage.removeListener(listener);
    `);
  });

  it("Stage.displayState compiles", () => {
    compilesOk(`var ds = Stage.displayState;`);
  });
});
