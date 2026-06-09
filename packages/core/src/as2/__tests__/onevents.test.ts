import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 on() button event handlers", () => {
  it("on(press) compiles", () => {
    compilesOk(`on(press) { trace("pressed"); }`);
  });

  it("on(release) compiles", () => {
    compilesOk(`on(release) { trace("released"); }`);
  });

  it("on(rollOver) compiles", () => {
    compilesOk(`on(rollOver) { this._alpha = 80; }`);
  });

  it("on(rollOut) compiles", () => {
    compilesOk(`on(rollOut) { this._alpha = 100; }`);
  });

  it("on(dragOver) compiles", () => {
    compilesOk(`on(dragOver) { trace("drag over"); }`);
  });

  it("on(dragOut) compiles", () => {
    compilesOk(`on(dragOut) { trace("drag out"); }`);
  });

  it("on(releaseOutside) compiles", () => {
    compilesOk(`on(releaseOutside) { trace("outside"); }`);
  });

  it("multiple on() handlers compile", () => {
    compilesOk(`
      on(rollOver) { this._alpha = 80; }
      on(rollOut) { this._alpha = 100; }
      on(press) { gotoAndPlay("pressed"); }
      on(release) { gotoAndPlay("normal"); }
    `);
  });
});

describe("AS2 onClipEvent() handlers", () => {
  it("onClipEvent(load) compiles", () => {
    compilesOk(`onClipEvent(load) { trace("loaded"); }`);
  });

  it("onClipEvent(enterFrame) compiles", () => {
    compilesOk(`onClipEvent(enterFrame) { this._rotation += 2; }`);
  });

  it("onClipEvent(unload) compiles", () => {
    compilesOk(`onClipEvent(unload) { trace("unloaded"); }`);
  });

  it("onClipEvent(mouseMove) compiles", () => {
    compilesOk(`onClipEvent(mouseMove) { trace(_xmouse); }`);
  });

  it("onClipEvent(mouseDown) compiles", () => {
    compilesOk(`onClipEvent(mouseDown) { trace("mouse down"); }`);
  });

  it("onClipEvent(mouseUp) compiles", () => {
    compilesOk(`onClipEvent(mouseUp) { trace("mouse up"); }`);
  });

  it("onClipEvent(keyDown) compiles", () => {
    compilesOk(`onClipEvent(keyDown) { if (Key.isDown(Key.SPACE)) stop(); }`);
  });

  it("onClipEvent(data) compiles", () => {
    compilesOk(`onClipEvent(data) { trace("data received"); }`);
  });
});
