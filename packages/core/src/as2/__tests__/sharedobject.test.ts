import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }

describe("AS2 SharedObject", () => {
  it("SharedObject.getLocal() compiles", () => {
    compilesOk(`var so = SharedObject.getLocal("myData");`);
  });

  it("SharedObject.getLocal with path compiles", () => {
    compilesOk(`var so = SharedObject.getLocal("myData", "/");`);
  });

  it("so.data property access compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      var vol = so.data.volume;
    `);
  });

  it("so.data property write compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      so.data.volume = 75;
      so.data.playerName = "Player1";
    `);
  });

  it("so.flush() compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      so.data.score = 100;
      so.flush();
    `);
  });

  it("so.clear() compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      so.clear();
    `);
  });

  it("so.getSize() compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("myData");
      var size = so.getSize();
    `);
  });

  it("so.onStatus callback compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("prefs");
      so.onStatus = function(info) {
        if (info.level == "error") trace("save failed");
      };
      so.flush();
    `);
  });

  it("SharedObject.getRemote() compiles", () => {
    compilesOk(`
      var so = SharedObject.getRemote("data", "rtmp://server/app");
    `);
  });

  it("SharedObject persistence pattern compiles", () => {
    compilesOk(`
      var so = SharedObject.getLocal("game");
      if (so.data.highScore == undefined) {
        so.data.highScore = 0;
        so.data.level = 1;
      }
      trace("High score: " + so.data.highScore);
    `);
  });
});
