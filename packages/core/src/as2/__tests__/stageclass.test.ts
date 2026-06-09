import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Stage class", () => {
  it("Stage.width and Stage.height compile", () => {
    compilesOk(`
      var w = Stage.width;
      var h = Stage.height;
    `);
  });

  it("Stage.scaleMode compiles", () => {
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
        trace(Stage.width + "x" + Stage.height);
      };
      Stage.addListener(listener);
    `);
  });

  it("Stage.removeListener compiles", () => {
    compilesOk(`
      Stage.removeListener(myListener);
    `);
  });

  it("System.capabilities compiles", () => {
    compilesOk(`
      var os = System.capabilities.os;
      var screen = System.capabilities.screenResolutionX;
    `);
  });

  it("System.capabilities.playerType compiles", () => {
    compilesOk(`
      var isPlugin = (System.capabilities.playerType == "PlugIn");
    `);
  });
});
