/**
 * Tests for AS2 switch/case statement compilation.
 *
 * Verifies that switch/case statements compile to valid AVM1 bytecode using
 * a duplicate-and-compare strategy. Each case comparison uses ActionDuplicate
 * (0x4c) to copy the discriminant and ActionEquals2 (0x49) for equality.
 *
 * ActionEquals2  opcode = 0x49  (used for switch case comparison)
 * ActionDuplicate opcode = 0x4c
 * ActionNot       opcode = 0x14
 * ActionIf        opcode = 0x9d
 * ActionJump      opcode = 0x99  (break statements)
 * ActionPop       opcode = 0x17
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 switch/case compilation", () => {
  // -------------------------------------------------------------------------
  // Test 1: Basic switch/case with numbers compiles and uses comparison opcode
  // -------------------------------------------------------------------------

  it("1. basic switch/case with numbers compiles without error", () => {
    expect(
      compilesOk(`
        switch(x) {
          case 1: trace("one"); break;
          case 2: trace("two"); break;
          default: trace("other");
        }
      `)
    ).toBe(true);
  });

  it("1b. basic switch/case with numbers emits case comparison opcode (ActionEquals2 0x49)", () => {
    const bytes = compileAS2(`
      switch(x) {
        case 1: trace("one"); break;
        case 2: trace("two"); break;
        default: trace("other");
      }
    `);
    // ActionEquals2 (0x49) is emitted for each case comparison
    expect(bytes).toContain(0x49);
  });

  it("1c. basic switch/case with numbers emits ActionDuplicate (0x4c) for discriminant", () => {
    const bytes = compileAS2(`
      switch(x) {
        case 1: trace("one"); break;
        case 2: trace("two"); break;
        default: trace("other");
      }
    `);
    // ActionDuplicate (0x4c) copies the discriminant for each comparison
    expect(bytes).toContain(0x4c);
  });

  // -------------------------------------------------------------------------
  // Test 2: Switch with fall-through (no break) compiles
  // -------------------------------------------------------------------------

  it("2. switch with fall-through (no break) compiles without error", () => {
    expect(
      compilesOk(`
        switch(x) {
          case 1: trace("one");
          case 2: trace("two");
          default: trace("other");
        }
      `)
    ).toBe(true);
  });

  it("2b. fall-through switch — all case body strings appear in bytecode", () => {
    const bytes = compileAS2(`
      switch(x) {
        case 1: var first = 1;
        case 2: var second = 2;
      }
    `);
    expect(containsString(bytes, "first")).toBe(true);
    expect(containsString(bytes, "second")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: Switch with string cases compiles and uses comparison opcode
  // -------------------------------------------------------------------------

  it("3. switch with string cases compiles without error", () => {
    expect(
      compilesOk(`
        switch(name) {
          case "foo": trace("foo"); break;
          case "bar": trace("bar"); break;
          default: trace("other");
        }
      `)
    ).toBe(true);
  });

  it("3b. switch with string cases emits ActionEquals2 (0x49) for each comparison", () => {
    const bytes = compileAS2(`
      switch(name) {
        case "foo": var r = 1; break;
        case "bar": var r = 2; break;
        default: var r = 0;
      }
    `);
    // ActionEquals2 (0x49) used for string case comparison
    expect(bytes).toContain(0x49);
    // String values appear in bytecode
    expect(containsString(bytes, "foo")).toBe(true);
    expect(containsString(bytes, "bar")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 4: Empty switch body compiles
  // -------------------------------------------------------------------------

  it("4. empty switch body compiles without error", () => {
    expect(compilesOk("switch(x) {}")).toBe(true);
  });

  it("4b. empty switch body produces non-empty bytecode (discriminant is evaluated)", () => {
    const bytes = compileAS2("switch(x) {}");
    expect(bytes.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: Switch with only default compiles
  // -------------------------------------------------------------------------

  it("5. switch with only default compiles without error", () => {
    expect(
      compilesOk(`
        switch(x) {
          default: trace("other");
        }
      `)
    ).toBe(true);
  });

  it("5b. switch with only default — default body appears in bytecode", () => {
    const bytes = compileAS2(`
      switch(x) {
        default: var fallback = 42;
      }
    `);
    expect(bytes.length).toBeGreaterThan(0);
    expect(containsString(bytes, "fallback")).toBe(true);
  });

  it("5c. switch with only default — no comparison opcode emitted (no cases to compare)", () => {
    const bytes = compileAS2(`
      switch(x) {
        default: var fallback = 42;
      }
    `);
    // No case comparisons needed when there are no non-default cases
    let count49 = 0;
    for (const b of bytes) if (b === 0x49) count49++;
    expect(count49).toBe(0);
  });
});
