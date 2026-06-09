import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Capabilities class", () => {
  it("System.capabilities.os compiles", () => {
    compilesOk(`var os = System.capabilities.os;`);
  });

  it("System.capabilities.version compiles", () => {
    compilesOk(`var ver = System.capabilities.version;`);
  });

  it("System.capabilities.language compiles", () => {
    compilesOk(`var lang = System.capabilities.language;`);
  });

  it("System.capabilities.screenResolutionX/Y compile", () => {
    compilesOk(`
      var w = System.capabilities.screenResolutionX;
      var h = System.capabilities.screenResolutionY;
    `);
  });

  it("System.capabilities.screenDPI compiles", () => {
    compilesOk(`var dpi = System.capabilities.screenDPI;`);
  });

  it("System.capabilities.hasAudio compiles", () => {
    compilesOk(`var audio = System.capabilities.hasAudio;`);
  });

  it("System.capabilities.hasMP3 compiles", () => {
    compilesOk(`var mp3 = System.capabilities.hasMP3;`);
  });

  it("System.capabilities.playerType compiles", () => {
    compilesOk(`var ptype = System.capabilities.playerType;`);
  });

  it("System.capabilities.manufacturer compiles", () => {
    compilesOk(`var mfg = System.capabilities.manufacturer;`);
  });

  it("System.capabilities.hasVideoEncoder compiles", () => {
    compilesOk(`var hasVid = System.capabilities.hasVideoEncoder;`);
  });

  it("flash.system.Capabilities import compiles", () => {
    compilesOk(`import flash.system.Capabilities;`);
  });

  it("conditional capability check compiles", () => {
    compilesOk(`
      if (System.capabilities.hasAudio && System.capabilities.hasMP3) {
        trace("MP3 audio supported");
      }
      trace("Running on: " + System.capabilities.os);
    `);
  });
});
