import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 Sound advanced methods", () => {
  it("Sound.setVolume() compiles", () => {
    compilesOk(`
      var snd = new Sound();
      snd.setVolume(80);
    `);
  });

  it("Sound.getVolume() compiles", () => {
    compilesOk(`
      var snd = new Sound();
      var vol = snd.getVolume();
    `);
  });

  it("Sound.setPan() compiles", () => {
    compilesOk(`
      var snd = new Sound();
      snd.setPan(-50);
    `);
  });

  it("Sound.getPan() compiles", () => {
    compilesOk(`
      var snd = new Sound();
      var pan = snd.getPan();
    `);
  });

  it("Sound.setTransform() compiles", () => {
    compilesOk(`
      var snd = new Sound();
      var t = {ll:80, lr:20, rl:20, rr:80};
      snd.setTransform(t);
    `);
  });

  it("Sound.getTransform() compiles", () => {
    compilesOk(`
      var snd = new Sound();
      var t = snd.getTransform();
    `);
  });

  it("Sound.duration property compiles", () => {
    compilesOk(`
      var snd = new Sound();
      var dur = snd.duration;
    `);
  });

  it("Sound.position property compiles", () => {
    compilesOk(`
      var snd = new Sound();
      snd.start();
      var pos = snd.position;
    `);
  });

  it("Sound.id3 object compiles", () => {
    compilesOk(`
      var snd = new Sound();
      snd.onID3 = function() {
        trace(snd.id3.songname);
        trace(snd.id3.artist);
        trace(snd.id3.album);
      };
    `);
  });

  it("Sound volume with target clip compiles", () => {
    compilesOk(`
      var snd = new Sound(this.musicClip);
      snd.attachSound("bgMusic");
      snd.start(0, 99);
      snd.setVolume(50);
    `);
  });
});
