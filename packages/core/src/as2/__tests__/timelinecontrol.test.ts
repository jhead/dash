import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 MovieClip timeline control", () => {
  it("gotoAndPlay(number) compiles", () => {
    compilesOk(`gotoAndPlay(5);`);
  });

  it("gotoAndPlay(label) compiles", () => {
    compilesOk(`gotoAndPlay("myLabel");`);
  });

  it("gotoAndStop(number) compiles", () => {
    compilesOk(`gotoAndStop(1);`);
  });

  it("gotoAndStop(label) compiles", () => {
    compilesOk(`gotoAndStop("intro");`);
  });

  it("nextFrame() compiles", () => {
    compilesOk(`nextFrame();`);
  });

  it("prevFrame() compiles", () => {
    compilesOk(`prevFrame();`);
  });

  it("play() compiles", () => {
    compilesOk(`play();`);
  });

  it("stop() compiles", () => {
    compilesOk(`stop();`);
  });

  it("_totalframes property compiles", () => {
    compilesOk(`var total = this._totalframes;`);
  });

  it("_currentframe property compiles", () => {
    compilesOk(`var cur = this._currentframe;`);
  });

  it("_framesloaded property compiles", () => {
    compilesOk(`var loaded = this._framesloaded;`);
  });

  it("mc.gotoAndPlay() on child clip compiles", () => {
    compilesOk(`this.myClip.gotoAndPlay("start");`);
  });

  it("mc.gotoAndStop() on child clip compiles", () => {
    compilesOk(`this.myClip.gotoAndStop(1);`);
  });

  it("frame-based navigation in loop compiles", () => {
    compilesOk(`
      var cur = this._currentframe;
      var total = this._totalframes;
      if (cur >= total) {
        this.gotoAndStop(1);
      } else {
        this.nextFrame();
      }
    `);
  });
});
