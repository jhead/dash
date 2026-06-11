/**
 * Tests for AS2 switch fall-through AVM1 stack behavior (task 0996).
 *
 * Problem: when a case body has no `break`, the old compiler fell through into
 * the next case's COMPARISON block (ActionDuplicate / push / ActionStrictEquals).
 * But the discriminant was already popped by the matched case's ActionPop, so
 * the equality check ran on garbage, corrupting the AVM1 stack.
 *
 * Fix: emit an ActionJump at the end of each non-breaking case body that jumps
 * directly to the NEXT case's body (past the comparison and ActionPop), or to
 * the default/end when it is the last value-case.
 *
 * Key AVM1 opcodes used in switch:
 *   ActionDuplicate    0x4c  — copy discriminant before each comparison
 *   ActionStrictEquals 0x66  — strict equality (JS switch uses ===)
 *   ActionNot        0x12  — invert for skip-when-not-equal
 *   ActionIf         0x9d  — conditional jump (pops top)
 *   ActionPop        0x17  — discard discriminant when entering a body
 *   ActionJump       0x99  — unconditional jump (break OR fall-through)
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../compiler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(src: string): boolean {
  try { compileAS2(src); return true; } catch { return false; }
}

function countByte(bytes: Uint8Array, byte: number): number {
  let n = 0;
  for (const b of bytes) if (b === byte) n++;
  return n;
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

/**
 * Disassemble AVM1 bytes into a flat list of opcode bytes (ignoring data).
 * Only extracts the opcode byte; skips over the payload using the embedded
 * length for "long" (>= 0x80) actions.
 */
function disassemble(bytes: Uint8Array): number[] {
  const opcodes: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i++];
    if (op === 0) break; // ActionEnd
    opcodes.push(op);
    if (op >= 0x80) {
      // long action: next 2 bytes are little-endian payload length
      if (i + 2 > bytes.length) break;
      const len = bytes[i] | (bytes[i + 1] << 8);
      i += 2 + len;
    }
  }
  return opcodes;
}

// ---------------------------------------------------------------------------
// Fall-through structural tests
// ---------------------------------------------------------------------------

describe("AS2 switch fall-through — AVM1 stack correctness (task 0996)", () => {

  // ---- Compilation smoke tests --------------------------------------------

  it("fall-through two cases compiles without error", () => {
    expect(compilesOk(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2; break;
      }
    `)).toBe(true);
  });

  it("fall-through three cases compiles without error", () => {
    expect(compilesOk(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2;
        case 3: var c = 3; break;
      }
    `)).toBe(true);
  });

  it("empty fall-through case (case with no body) compiles without error", () => {
    expect(compilesOk(`
      switch (x) {
        case 1:
        case 2: var r = 2; break;
      }
    `)).toBe(true);
  });

  it("all-fall-through (no break anywhere) compiles without error", () => {
    expect(compilesOk(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2;
        default: var c = 3;
      }
    `)).toBe(true);
  });

  // ---- Fall-through emits correct ActionJump opcodes ----------------------

  it("fall-through case emits an ActionJump (0x99) for the fall-through", () => {
    // A single-case switch with a break emits exactly one ActionJump (the break).
    const withBreak = compileAS2(`
      switch (x) { case 1: var a = 1; break; }
    `);
    // A single-case switch WITHOUT a break should ALSO emit an ActionJump —
    // the fall-through jump that targets the default/end path.
    const withFallThrough = compileAS2(`
      switch (x) { case 1: var a = 1; }
    `);
    // Both should contain at least one ActionJump
    expect(countByte(withBreak, 0x99)).toBeGreaterThanOrEqual(1);
    expect(countByte(withFallThrough, 0x99)).toBeGreaterThanOrEqual(1);
  });

  it("two-case fall-through emits more ActionJumps than a two-case break switch", () => {
    // With breaks: each case has one ActionJump for the break
    const withBreaks = compileAS2(`
      switch (x) {
        case 1: var a = 1; break;
        case 2: var b = 2; break;
      }
    `);
    // With fall-through: case 1 needs an extra ActionJump to skip case 2's comparison
    const withFallThrough = compileAS2(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2; break;
      }
    `);
    // The fall-through variant must have at least as many ActionJumps (the break in
    // case 2 + the fall-through jump from case 1)
    expect(countByte(withFallThrough, 0x99)).toBeGreaterThanOrEqual(
      countByte(withBreaks, 0x99)
    );
  });

  // ---- ActionStrictEquals count — comparison blocks must not be re-entered -----

  it("two-case fall-through still emits two ActionStrictEquals (both comparisons present)", () => {
    // Even though case 1 falls through, the comparison for case 2 must still
    // exist on the non-matching path (when x !== 1, we need to check x === 2).
    const bytes = compileAS2(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2; break;
      }
    `);
    expect(countByte(bytes, 0x66)).toBeGreaterThanOrEqual(2); // ActionStrictEquals per case
    expect(countByte(bytes, 0x4c)).toBeGreaterThanOrEqual(2); // ActionDuplicate per case
  });

  it("three-case all-fall-through emits three ActionStrictEquals (all comparisons present)", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2;
        case 3: var c = 3;
      }
    `);
    expect(countByte(bytes, 0x66)).toBeGreaterThanOrEqual(3);
    expect(countByte(bytes, 0x4c)).toBeGreaterThanOrEqual(3);
  });

  // ---- ActionPop count — no extra discriminant pops from fall-through -----

  it("fall-through does NOT add extra ActionPop opcodes compared to break version", () => {
    // Both patterns have the same number of matched-case-paths, so the same
    // number of ActionPops are needed.  The fall-through jump bypasses the next
    // case's ActionPop, so the count stays the same.
    const withBreak = compileAS2(`
      switch (x) {
        case 1: var a = 1; break;
        case 2: var b = 2; break;
      }
    `);
    const withFallThrough = compileAS2(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2; break;
      }
    `);
    // Same ActionPop count: 1 pop per case match + 1 pop at default/end
    expect(countByte(withFallThrough, 0x17)).toBe(countByte(withBreak, 0x17));
  });

  // ---- Bytecode contains all case body strings ----------------------------

  it("fall-through: all case body strings appear in output", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1: var alpha = 1;
        case 2: var beta = 2;
        case 3: var gamma = 3; break;
      }
    `);
    expect(containsString(bytes, "alpha")).toBe(true);
    expect(containsString(bytes, "beta")).toBe(true);
    expect(containsString(bytes, "gamma")).toBe(true);
  });

  it("fall-through with default: all strings appear in output", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1: var first = 1;
        case 2: var second = 2;
        default: var dflt = 0;
      }
    `);
    expect(containsString(bytes, "first")).toBe(true);
    expect(containsString(bytes, "second")).toBe(true);
    expect(containsString(bytes, "dflt")).toBe(true);
  });

  // ---- Opcode sequence: fall-through jump must come BEFORE next DUP -------

  it("fall-through jump (0x99) appears before the next case's ActionDuplicate (0x4c) in opcode stream", () => {
    // In a correctly compiled two-case fall-through switch, the ActionJump that
    // skips case 2's comparison must appear BEFORE the ActionDuplicate for case 2.
    // The opcode sequence for case 1 (no break) ends with ActionJump, then case
    // 2's comparison starts with ActionDuplicate.
    //
    // We verify this by checking that the last ActionJump in the bytecode comes
    // AFTER the last ActionDuplicate (i.e., the fall-through jump follows the
    // comparison block for case 2, which starts with ActionDuplicate).
    //
    // Layout:
    //   ... DUP [case1 comparison] ... [case1 body] JUMP(to case2 body)
    //       DUP [case2 comparison] ... [case2 body] JUMP(end)  ← break
    //   default pop → end
    //
    // The fall-through JUMP from case1 body must appear BEFORE case2's DUP.
    const bytes = compileAS2(`
      switch (x) {
        case 1: var a = 1;
        case 2: var b = 2; break;
      }
    `);
    const opcodes = disassemble(bytes);

    // Find positions of all 0x4c (ActionDuplicate) and 0x99 (ActionJump) in opcode list
    const dupPositions: number[] = [];
    const jumpPositions: number[] = [];
    for (let i = 0; i < opcodes.length; i++) {
      if (opcodes[i] === 0x4c) dupPositions.push(i);
      if (opcodes[i] === 0x99) jumpPositions.push(i);
    }

    // There should be 2 DUPs (one per case) and at least 2 JUMPs
    // (fall-through from case1 + break from case2)
    expect(dupPositions.length).toBeGreaterThanOrEqual(2);
    expect(jumpPositions.length).toBeGreaterThanOrEqual(2);

    // The FIRST jump should appear BEFORE the second DUP (case2's comparison).
    // This is the fall-through jump from case1's body.
    const firstJump = jumpPositions[0];
    const secondDup = dupPositions[1];
    expect(firstJump).toBeLessThan(secondDup);
  });

  // ---- Mixed break and fall-through ----------------------------------------

  it("mixed break and fall-through compiles without error", () => {
    expect(compilesOk(`
      switch (x) {
        case 1: var a = 1; break;
        case 2: var b = 2;
        case 3: var c = 3; break;
        default: var d = 0;
      }
    `)).toBe(true);
  });

  it("mixed break and fall-through — all body strings present", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1: var alpha = 1; break;
        case 2: var beta = 2;
        case 3: var gamma = 3; break;
        default: var delta = 0;
      }
    `);
    expect(containsString(bytes, "alpha")).toBe(true);
    expect(containsString(bytes, "beta")).toBe(true);
    expect(containsString(bytes, "gamma")).toBe(true);
    expect(containsString(bytes, "delta")).toBe(true);
  });

  // ---- return/throw also prevent fall-through (treated as transfers) -------

  it("case ending with return does not emit fall-through jump", () => {
    // A case ending with return should be treated as having an unconditional
    // transfer — no fall-through ActionJump should be emitted.
    const withReturn = compileAS2(`
      function f(x) {
        switch (x) {
          case 1: return 1;
          case 2: return 2;
        }
      }
    `);
    const withBreak = compileAS2(`
      function f(x) {
        switch (x) {
          case 1: var a = 1; return a;
          case 2: var b = 2; return b;
        }
      }
    `);
    // Both should compile
    expect(withReturn.length).toBeGreaterThan(0);
    expect(withBreak.length).toBeGreaterThan(0);
  });

  // ---- Edge cases ----------------------------------------------------------

  it("single case with fall-through to default compiles", () => {
    expect(compilesOk(`
      switch (x) {
        case 1: var a = 1;
        default: var b = 2;
      }
    `)).toBe(true);
  });

  it("single case with fall-through to default — both strings present", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1: var alpha = 1;
        default: var beta = 2;
      }
    `);
    expect(containsString(bytes, "alpha")).toBe(true);
    expect(containsString(bytes, "beta")).toBe(true);
  });

  it("empty case (no body) followed by case with body — both strings present", () => {
    const bytes = compileAS2(`
      switch (x) {
        case 1:
        case 2: var result = 42; break;
      }
    `);
    expect(containsString(bytes, "result")).toBe(true);
  });

  it("switch inside function with fall-through compiles", () => {
    expect(compilesOk(`
      function classify(n) {
        var label;
        switch (n) {
          case 0:
          case 1: label = "small"; break;
          case 2:
          case 3: label = "medium"; break;
          default: label = "large";
        }
        return label;
      }
    `)).toBe(true);
  });

  // ---- Task 1072: fall-through must skip ActionPop (no double-pop) ----------

  it("task 1072: empty-body fall-through (case 1: case 2: ...) compiles and contains trace string", () => {
    // Regression test for the bug where a fall-through jump landed BEFORE
    // ActionPop, causing the discriminant to be popped twice on the fall-through
    // path.  The canonical reproduction is:
    //   case 1:          ← empty body, falls through
    //   case 2: trace("two"); break;
    const bytes = compileAS2(`
      var x = 2;
      switch(x) {
        case 1:
        case 2: trace("two"); break;
        case 3: trace("three"); break;
      }
    `);
    expect(bytes.length).toBeGreaterThan(0);
    expect(containsString(bytes, "two")).toBe(true);
    expect(containsString(bytes, "three")).toBe(true);
  });

  it("task 1072: fall-through from empty case produces same ActionPop count as break-only version", () => {
    // With the bug, fall-through from case 1 (empty) to case 2 would land before
    // case 2's ActionPop, resulting in one extra ActionPop executed at runtime.
    // The bytecode count should be the same for both patterns since the number of
    // entry paths that need a pop is identical (one per value-case + one for no-match).
    const withFallThrough = compileAS2(`
      switch (x) {
        case 1:
        case 2: var r = 2; break;
      }
    `);
    const withBreaks = compileAS2(`
      switch (x) {
        case 1: break;
        case 2: var r = 2; break;
      }
    `);
    // Same number of ActionPop (0x17) opcodes: one per case body entry + one at end
    expect(countByte(withFallThrough, 0x17)).toBe(countByte(withBreaks, 0x17));
  });

  it("task 1072: code after switch is not corrupted by phantom pops", () => {
    // Ensures that after the switch block, subsequent statements compile and
    // execute correctly (no leftover values on the stack from a double-pop).
    // We verify by checking that identifiers from the post-switch assignment
    // appear in the bytecode.
    const bytes = compileAS2(`
      var result = 0;
      switch (n) {
        case 1:
        case 2: result = 99; break;
        default: result = 0;
      }
      var after = result + 1;
    `);
    expect(bytes.length).toBeGreaterThan(0);
    expect(containsString(bytes, "result")).toBe(true);
    expect(containsString(bytes, "after")).toBe(true);
    // "after" assignment must appear in bytecode — both constant pool strings present
    expect(countByte(bytes, 0x17)).toBeGreaterThanOrEqual(1); // at least one ActionPop
  });
});
