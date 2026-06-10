/**
 * Tests for AS2 logical operator compilation (&&, ||, !).
 *
 * AVM1 compiles logical operators using short-circuit evaluation via
 * ActionIf (0x9D) rather than the older ActionAnd (0x10) / ActionOr (0x11)
 * opcodes. ActionNot (0x12) is used for the ! operator and as a helper in
 * short-circuit OR evaluation.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AS2 logical operators (&&, ||, !)", () => {
  // 1. a && b — compiles; uses short-circuit jump (ActionIf 0x9D)
  it("1. a && b compiles and emits ActionIf (0x9D) for short-circuit evaluation", () => {
    const bytes = compileAS2("a && b");
    // AVM1 compiles && as short-circuit using ActionIf (0x9D)
    expect(bytes).toContain(0x9d);
    // Does NOT use the old ActionAnd (0x10)
    expect(bytes).not.toContain(0x10);
  });

  // 2. a || b — compiles; uses short-circuit jump (ActionIf 0x9D)
  it("2. a || b compiles and emits ActionIf (0x9D) for short-circuit evaluation", () => {
    const bytes = compileAS2("a || b");
    // AVM1 compiles || as short-circuit using ActionIf (0x9D)
    expect(bytes).toContain(0x9d);
    // Does NOT use the old ActionOr (0x11)
    expect(bytes).not.toContain(0x11);
  });

  // 3. !a — emits ActionNot (0x12)
  it("3. !a emits ActionNot (0x12)", () => {
    const bytes = compileAS2("!a");
    expect(bytes).toContain(0x12);
  });

  // 4. a && b && c — compiles (chained AND)
  it("4. a && b && c compiles (chained AND)", () => {
    expect(compilesOk("a && b && c")).toBe(true);
    const bytes = compileAS2("a && b && c");
    expect(bytes).toContain(0x9d);
  });

  // 5. a || b || c — compiles (chained OR)
  it("5. a || b || c compiles (chained OR)", () => {
    expect(compilesOk("a || b || c")).toBe(true);
    const bytes = compileAS2("a || b || c");
    expect(bytes).toContain(0x9d);
  });

  // 6. !(a && b) — compiles
  it("6. !(a && b) compiles", () => {
    expect(compilesOk("!(a && b)")).toBe(true);
    const bytes = compileAS2("!(a && b)");
    // Both ActionNot and ActionIf should appear
    expect(bytes).toContain(0x12);
    expect(bytes).toContain(0x9d);
  });

  // 7. if (a && b) { } — compiles
  it("7. if (a && b) { } compiles", () => {
    expect(compilesOk("if (a && b) { }")).toBe(true);
  });

  // 8. if (a || b) { } — compiles
  it("8. if (a || b) { } compiles", () => {
    expect(compilesOk("if (a || b) { }")).toBe(true);
  });

  // 9. var x = a || b — compiles (logical in assignment)
  it("9. var x = a || b compiles (logical in assignment)", () => {
    expect(compilesOk("var x = a || b")).toBe(true);
    const bytes = compileAS2("var x = a || b");
    expect(bytes).toContain(0x9d);
  });

  // 10. var x = a && b — compiles
  it("10. var x = a && b compiles", () => {
    expect(compilesOk("var x = a && b")).toBe(true);
    const bytes = compileAS2("var x = a && b");
    expect(bytes).toContain(0x9d);
  });
});
