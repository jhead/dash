import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) {
  expect(() => compileAS2(src)).not.toThrow();
}

describe("AS2 on(keyPress) with named keys", () => {
  it("on(keyPress '<Enter>') compiles", () => {
    compilesOk(`on(keyPress '<Enter>') { trace("enter"); }`);
  });

  it("on(keyPress '<Escape>') compiles", () => {
    compilesOk(`on(keyPress '<Escape>') { trace("escape"); }`);
  });

  it("on(keyPress '<Tab>') compiles", () => {
    compilesOk(`on(keyPress '<Tab>') { trace("tab"); }`);
  });

  it("on(keyPress '<Space>') compiles", () => {
    compilesOk(`on(keyPress '<Space>') { trace("space"); }`);
  });

  it("on(keyPress '<Left>') compiles", () => {
    compilesOk(`on(keyPress '<Left>') { trace("left"); }`);
  });

  it("on(keyPress '<Right>') compiles", () => {
    compilesOk(`on(keyPress '<Right>') { trace("right"); }`);
  });

  it("on(keyPress '<Up>') compiles", () => {
    compilesOk(`on(keyPress '<Up>') { trace("up"); }`);
  });

  it("on(keyPress '<Down>') compiles", () => {
    compilesOk(`on(keyPress '<Down>') { trace("down"); }`);
  });

  it("on(keyPress 'a') character key compiles", () => {
    compilesOk(`on(keyPress 'a') { trace("a"); }`);
  });

  it("multiple on(keyPress) handlers compile", () => {
    compilesOk(`
      on(keyPress '<Left>') { this._x -= 5; }
      on(keyPress '<Right>') { this._x += 5; }
      on(keyPress '<Up>') { this._y -= 5; }
      on(keyPress '<Down>') { this._y += 5; }
    `);
  });
});
