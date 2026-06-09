import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 ActionScript event model", () => {
  it("on(press) handler on button timeline compiles", () => {
    compilesOk(`
      on(press) {
        trace("pressed");
      }
    `);
  });

  it("on(release) handler compiles", () => {
    compilesOk(`
      on(release) {
        gotoAndPlay(2);
      }
    `);
  });

  it("on(rollOver) and on(rollOut) compile", () => {
    compilesOk(`
      on(rollOver) { this._alpha = 80; }
      on(rollOut) { this._alpha = 100; }
    `);
  });

  it("on(keyPress) handler compiles", () => {
    compilesOk(`
      on(keyPress, "<Enter>") {
        trace("enter pressed");
      }
    `);
  });

  it("onClipEvent(enterFrame) handler compiles", () => {
    compilesOk(`
      onClipEvent(enterFrame) {
        this._x += 5;
      }
    `);
  });

  it("onClipEvent(load) and onClipEvent(unload) compile", () => {
    compilesOk(`
      onClipEvent(load) { trace("loaded"); }
      onClipEvent(unload) { trace("unloaded"); }
    `);
  });

  it("addEventListener call compiles", () => {
    compilesOk(`
      var btn = new Button();
      btn.addEventListener("click", function(e) { trace(e.type); });
    `);
  });

  it("removeEventListener call compiles", () => {
    compilesOk(`
      function handler(e) { trace(e); }
      obj.addEventListener("change", handler);
      obj.removeEventListener("change", handler);
    `);
  });

  it("EventDispatcher usage compiles", () => {
    compilesOk(`
      class MyDispatcher extends EventDispatcher {
        function MyDispatcher() {
          EventDispatcher.initialize(this);
        }
      }
      var d = new MyDispatcher();
      d.addEventListener("change", function() {});
    `);
  });

  it("mc.onEnterFrame assignment compiles", () => {
    compilesOk(`
      this.onEnterFrame = function() {
        this._x += 2;
      };
    `);
  });
});
