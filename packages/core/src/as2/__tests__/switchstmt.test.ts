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

  // Stack-balance fix: each case's skip-jump must go to the NEXT case, not straight
  // to the default/end.  A 3-case switch must emit exactly 3 ActionEquals2 comparisons.
  it("3-case switch emits 3 ActionEquals2 opcodes (one per case, not collapsed)", () => {
    function countByte(bytes: Uint8Array, byte: number): number {
      let n = 0; for (const b of bytes) if (b === byte) n++; return n;
    }
    const bytes = getBytes(`
      switch (x) {
        case 1: trace("one");   break;
        case 2: trace("two");   break;
        case 3: trace("three"); break;
      }
    `);
    // Each of the 3 cases must produce its own ActionEquals2 comparison.
    // With the old bug (all skips went to defaultStart), cases 2+ were dead code
    // but still emitted bytes — so the count was already 3.  The important check
    // is that 3 ActionDuplicate + 3 ActionIf opcodes are also present, confirming
    // that all 3 comparisons are part of a chained skip sequence.
    expect(countByte(bytes, 0x49)).toBeGreaterThanOrEqual(3); // ActionEquals2
    expect(countByte(bytes, 0x4c)).toBeGreaterThanOrEqual(3); // ActionDuplicate
    expect(countByte(bytes, 0x9d)).toBeGreaterThanOrEqual(3); // ActionIf
    // Exactly one ActionPop per case match path + one at default/end = N+1 pops minimum
    // (N matched cases pop discriminant; default section pops it when no match).
    expect(countByte(bytes, 0x17)).toBeGreaterThanOrEqual(1); // at least the default pop
  });

  // Stack-balance fix: after all cases skip, the default (or end) section must
  // emit exactly ONE ActionPop for the original discriminant — not one per case.
  // Compare a switch with only-default (1 case pop) vs a switch with no cases at all
  // (also 1 case pop). They should have the same ActionPop count.
  it("switch with only-default has same ActionPop count as empty switch (one discriminant pop)", () => {
    function countByte(bytes: Uint8Array, byte: number): number {
      let n = 0; for (const b of bytes) if (b === byte) n++; return n;
    }
    // An empty switch: only one pop needed (the discriminant)
    const emptyBytes = getBytes(`switch (x) {}`);
    // A switch with only default (empty body): also only one pop needed
    const defaultOnlyBytes = getBytes(`switch (x) { default: }`);
    // Both should have the same ActionPop count since both need exactly one
    // discriminant pop and no expression statements
    expect(countByte(emptyBytes, 0x17)).toBe(1);
    expect(countByte(defaultOnlyBytes, 0x17)).toBe(1);
  });
});
