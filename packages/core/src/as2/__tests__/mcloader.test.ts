import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClipLoader", () => {
  it("new MovieClipLoader() compiles", () => {
    compilesOk(`var mcl = new MovieClipLoader();`);
  });

  it("mcl.loadClip() compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      mcl.loadClip("banner.swf", this.container);
    `);
  });

  it("mcl.unloadClip() compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      mcl.unloadClip(this.container);
    `);
  });

  it("mcl.getProgress() compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      var prog = mcl.getProgress(this.target);
      var loaded = prog.bytesLoaded;
      var total = prog.bytesTotal;
    `);
  });

  it("onLoadStart handler compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      mcl.onLoadStart = function(mc) { trace("start: " + mc); };
    `);
  });

  it("onLoadProgress handler compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      mcl.onLoadProgress = function(mc, loaded, total) {
        trace(Math.round(loaded/total*100) + "%");
      };
    `);
  });

  it("onLoadComplete handler compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      mcl.onLoadComplete = function(mc) {
        mc.play();
      };
    `);
  });

  it("onLoadError handler compiles", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      mcl.onLoadError = function(mc, code) {
        trace("Error: " + code);
      };
    `);
  });

  it("mcl.addListener / removeListener compile", () => {
    compilesOk(`
      var mcl = new MovieClipLoader();
      var listener = {};
      mcl.addListener(listener);
      mcl.removeListener(listener);
    `);
  });
});
