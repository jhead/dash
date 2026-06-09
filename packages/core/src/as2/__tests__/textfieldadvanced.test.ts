import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 TextField advanced properties", () => {
  it("TextField.htmlText read/write compiles", () => {
    compilesOk(`
      this.myTF.htmlText = "<b>Hello</b> World";
      var html = this.myTF.htmlText;
    `);
  });

  it("TextField.multiline compiles", () => {
    compilesOk(`
      this.myTF.multiline = true;
    `);
  });

  it("TextField.wordWrap compiles", () => {
    compilesOk(`
      this.myTF.wordWrap = true;
    `);
  });

  it("TextField.selectable compiles", () => {
    compilesOk(`
      this.myTF.selectable = false;
    `);
  });

  it("TextField.password compiles", () => {
    compilesOk(`
      this.myTF.password = true;
    `);
  });

  it("TextField.autoSize compiles", () => {
    compilesOk(`
      this.myTF.autoSize = "left";
    `);
  });

  it("TextField.restrict compiles", () => {
    compilesOk(`
      this.myTF.restrict = "0-9";
    `);
  });

  it("TextField.maxChars compiles", () => {
    compilesOk(`
      this.myTF.maxChars = 100;
    `);
  });

  it("TextField.getLineMetrics() compiles", () => {
    compilesOk(`
      var metrics = this.myTF.getLineMetrics(0);
      var ascent = metrics.ascent;
    `);
  });

  it("TextField.getTextFormat() with range compiles", () => {
    compilesOk(`
      var fmt = this.myTF.getTextFormat(0, 5);
      trace(fmt.bold);
    `);
  });

  it("TextField.setNewTextFormat() compiles", () => {
    compilesOk(`
      var tf = new TextFormat();
      tf.font = "Arial";
      tf.size = 12;
      this.myTF.setNewTextFormat(tf);
    `);
  });

  it("TextField.scroll and maxscroll compile", () => {
    compilesOk(`
      this.myTF.scroll = 1;
      var max = this.myTF.maxscroll;
    `);
  });
});
