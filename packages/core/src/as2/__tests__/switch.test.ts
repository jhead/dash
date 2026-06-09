/**
 * Tests for AS2 switch/case/default statement compilation.
 *
 * Verifies that switch statements compile to valid AVM1 bytecode using an
 * if-else chain strategy: each case uses ActionDuplicate + ActionEquals2 +
 * ActionNot + ActionIf to skip bodies that don't match the discriminant.
 *
 * ActionEquals2 opcode = 0x49
 * ActionDuplicate opcode = 0x4c
 * ActionNot opcode = 0x14
 * ActionIf opcode = 0x9d
 * ActionJump opcode = 0x99
 * ActionPop opcode = 0x17
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(source: string): boolean {
  try {
    compileAS2(source);
    return true;
  } catch {
    return false;
  }
}

function containsString(bytes: Uint8Array, s: string): boolean {
  const enc = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - enc.length; i++) {
    for (let j = 0; j < enc.length; j++) {
      if (bytes[i + j] !== enc[j]) continue outer;
    }
    if (bytes[i + enc.length] === 0) return true;
  }
  return false;
}

function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
}

// ---------------------------------------------------------------------------
// switch/case/default tests
// ---------------------------------------------------------------------------

describe("AS2 switch statement compilation", () => {
  // ---- Single case matching ------------------------------------------------

  it("single case matching — compiles without error", () => {
    expect(
      compilesOk(`
        switch (x) {
          case 1:
            var a = 10;
            break;
        }
      `)
    ).toBe(true);
  });

  it("single case matching — produces ActionEquals2 (0x49) opcode", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
          var a = 10;
          break;
      }
    `);
    // At least one ActionEquals2 should appear for the single case comparison
    expect(bytes).toContain(0x49); // ActionEquals2
  });

  it("single case matching — produces ActionDuplicate for discriminant copy", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 42:
          var result = 1;
          break;
      }
    `);
    expect(bytes).toContain(0x4c); // ActionDuplicate
  });

  // ---- Default case --------------------------------------------------------

  it("default case is included — compiles without error", () => {
    expect(
      compilesOk(`
        switch (x) {
          case 1:
            var a = 1;
            break;
          default:
            var b = 99;
        }
      `)
    ).toBe(true);
  });

  it("default case body is compiled into bytecode", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
          var matched = 1;
          break;
        default:
          var fallback = 99;
      }
    `);
    // "fallback" variable name should appear in the output
    expect(containsString(bytes, "fallback")).toBe(true);
  });

  it("switch with only default — compiles without error", () => {
    expect(
      compilesOk(`
        switch (x) {
          default:
            var onlyDefault = 42;
        }
      `)
    ).toBe(true);
  });

  it("switch with only default — default body is present in bytecode", () => {
    const bytes = compileAS2(`
      switch (x) {
        default:
          var fallback = 42;
      }
    `);
    expect(bytes.length).toBeGreaterThan(0);
    expect(containsString(bytes, "fallback")).toBe(true);
    // ActionPop (0x17) cleans up the discriminant when entering default
    expect(bytes).toContain(0x17);
  });

  // ---- Break prevents fall-through -----------------------------------------

  it("break in switch emits ActionJump (0x99)", () => {
    const bytes = compileAS2(`
      switch (v) {
        case 1:
          var x = 1;
          break;
      }
    `);
    // break compiles as ActionJump
    expect(bytes).toContain(0x99);
  });

  it("multiple breaks produce multiple ActionJump opcodes", () => {
    const bytes = compileAS2(`
      switch (v) {
        case 1:
          var a = 1;
          break;
        case 2:
          var b = 2;
          break;
      }
    `);
    // At least 2 ActionJump opcodes (one per break) plus the skip jumps
    expect(countByte(bytes, 0x99)).toBeGreaterThanOrEqual(2);
  });

  // ---- Fall-through (no break) runs both cases ----------------------------

  it("fall-through without break — both case bodies appear in bytecode", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
          var first = 1;
        case 2:
          var second = 2;
      }
    `);
    expect(containsString(bytes, "first")).toBe(true);
    expect(containsString(bytes, "second")).toBe(true);
  });

  it("fall-through without break — compiles without error", () => {
    expect(
      compilesOk(`
        switch (x) {
          case 1:
            var a = 1;
          case 2:
            var b = 2;
          case 3:
            var c = 3;
        }
      `)
    ).toBe(true);
  });

  // ---- Empty switch --------------------------------------------------------

  it("empty switch — compiles without error", () => {
    expect(compilesOk(`switch (x) {}`)).toBe(true);
  });

  it("empty switch — produces non-empty bytecode (discriminant is evaluated)", () => {
    const bytes = compileAS2(`switch (x) {}`);
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ---- Nested switch -------------------------------------------------------

  it("nested switch inside switch — compiles without error", () => {
    expect(
      compilesOk(`
        switch (a) {
          case 1:
            switch (b) {
              case 10:
                var r = 10;
                break;
            }
            break;
          case 2:
            var r = 2;
            break;
        }
      `)
    ).toBe(true);
  });

  it("nested switch — inner and outer case values appear in bytecode", () => {
    const bytes = compileAS2(`
      switch (a) {
        case 1:
          switch (b) {
            case 10:
              var inner = 10;
              break;
          }
          break;
        case 2:
          var outer = 2;
          break;
      }
    `);
    expect(containsString(bytes, "inner")).toBe(true);
    expect(containsString(bytes, "outer")).toBe(true);
    // Nested switches each produce their own ActionEquals2
    expect(countByte(bytes, 0x49)).toBeGreaterThanOrEqual(2);
  });

  // ---- Structural opcode counts -------------------------------------------

  it("two-case switch produces two ActionEquals2 and two ActionDuplicate", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
          var a = 1;
          break;
        case 2:
          var b = 2;
          break;
      }
    `);
    expect(countByte(bytes, 0x49)).toBeGreaterThanOrEqual(2); // ActionEquals2 per case
    expect(countByte(bytes, 0x4c)).toBeGreaterThanOrEqual(2); // ActionDuplicate per case
    expect(countByte(bytes, 0x9d)).toBeGreaterThanOrEqual(2); // ActionIf per case skip
  });

  it("switch with default — no equality check emitted for default case", () => {
    const noCasesBytes = compileAS2(`
      switch (x) {
        default:
          var a = 1;
      }
    `);
    const oneCaseBytes = compileAS2(`
      switch (x) {
        case 1:
          var a = 1;
          break;
        default:
          var b = 2;
      }
    `);
    // switch with only default has 0 ActionEquals2; one non-default case has 1
    expect(countByte(noCasesBytes, 0x49)).toBe(0);
    expect(countByte(oneCaseBytes, 0x49)).toBe(1);
  });

  // ---- Switch over various discriminant types ------------------------------

  it("switch over string discriminant — compiles without error", () => {
    expect(
      compilesOk(`
        switch (name) {
          case "foo":
            var x = 1;
            break;
          case "bar":
            var x = 2;
            break;
          default:
            var x = 0;
        }
      `)
    ).toBe(true);
  });

  it("switch over expression discriminant — compiles without error", () => {
    expect(
      compilesOk(`
        switch (a + b) {
          case 10:
            var r = "ten";
            break;
          default:
            var r = "other";
        }
      `)
    ).toBe(true);
  });
});
