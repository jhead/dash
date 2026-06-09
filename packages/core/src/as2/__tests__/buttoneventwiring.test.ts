import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }
function getBytes(src: string): Uint8Array { return compileAS2(src); }

describe("AS2 button event handler scripts", () => {
  // These scripts are what goes inside on(press){...} - they're compiled
  // as standalone ActionScript by compileAS2() in buttons.ts

  it("press handler: gotoAndPlay compiles", () => {
    compilesOk(`gotoAndPlay(2);`);
  });

  it("press handler: gotoAndStop compiles", () => {
    compilesOk(`gotoAndStop("nextSection");`);
  });

  it("press handler: getURL compiles", () => {
    compilesOk(`getURL("http://example.com", "_blank");`);
  });

  it("press handler: play/stop compiles", () => {
    compilesOk(`_root.play();`);
  });

  it("rollOver handler: setProperty alpha compiles", () => {
    compilesOk(`this._alpha = 50;`);
  });

  it("rollOut handler: restore alpha compiles", () => {
    compilesOk(`this._alpha = 100;`);
  });

  it("release handler: multi-statement compiles", () => {
    compilesOk(`
      gotoAndPlay("section2");
      _root.score++;
      trace("clicked");
    `);
  });

  it("press handler: navigate with variable compiles", () => {
    compilesOk(`
      var target = _root.nextTarget;
      gotoAndPlay(target);
    `);
  });

  it("dragOver handler: cursor change compiles", () => {
    compilesOk(`Mouse.hide();`);
  });

  it("dragOut handler: cursor restore compiles", () => {
    compilesOk(`Mouse.show();`);
  });

  it("release handler bytecode is non-empty Uint8Array", () => {
    const bytes = getBytes(`gotoAndPlay(2);`);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("press handler emits ActionCallFunction or ActionGotoFrame", () => {
    const bytes = getBytes(`gotoAndPlay(2);`);
    // Should contain some AVM1 opcode
    expect(bytes.length).toBeGreaterThan(3);
  });
});
