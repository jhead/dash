import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

function compilesOk(src: string) { expect(() => compileAS2(src)).not.toThrow(); }
function getBytes(src: string): Uint8Array { return compileAS2(src); }

describe("AS2 switch statement", () => {
  it("basic switch/case/break compiles", () => {
    compilesOk(`
      switch (x) {
        case 1: trace("one"); break;
        case 2: trace("two"); break;
        default: trace("other");
      }
    `);
  });

  it("switch with only default compiles", () => {
    compilesOk(`
      switch (x) {
        default: trace("default");
      }
    `);
  });

  it("switch with no default compiles", () => {
    compilesOk(`
      switch (x) {
        case 1: trace("one"); break;
        case 2: trace("two"); break;
      }
    `);
  });

  it("switch fall-through (no break) compiles", () => {
    compilesOk(`
      switch (x) {
        case 1:
        case 2: trace("one or two"); break;
        case 3: trace("three");
      }
    `);
  });

  it("string switch compiles", () => {
    compilesOk(`
      var state = "idle";
      switch (state) {
        case "idle": trace("idle"); break;
        case "running": trace("running"); break;
        case "paused": trace("paused"); break;
        default: trace("unknown");
      }
    `);
  });

  it("switch with return inside function compiles", () => {
    compilesOk(`
      function describe(n) {
        switch (n) {
          case 0: return "zero";
          case 1: return "one";
          default: return "many";
        }
      }
    `);
  });

  it("nested switch compiles", () => {
    compilesOk(`
      switch (a) {
        case 1:
          switch (b) {
            case 10: trace("1,10"); break;
            case 20: trace("1,20"); break;
          }
          break;
        case 2: trace("2"); break;
      }
    `);
  });

  it("switch emits ActionJump (0x99) for branching", () => {
    const bytes = getBytes(`switch (x) { case 1: trace("a"); break; case 2: trace("b"); break; }`);
    expect(bytes.includes(0x99)).toBe(true); // ActionJump
  });

  it("switch with complex expression in case compiles", () => {
    compilesOk(`
      switch (getState()) {
        case STATE_INIT: init(); break;
        case STATE_PLAY: play(); break;
        case STATE_END: end(); break;
      }
    `);
  });
});
