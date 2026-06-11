/**
 * Tests for task 1098: assignment-as-expression must leave the assigned value
 * on the stack (not undefined).
 *
 * AS2 allows assignments to be used as sub-expressions, e.g.:
 *   var r = (a = 5);          // r should be 5, not undefined
 *   x = (a = 5);              // x should be 5
 *   while ((line = next()) != null) { ... }
 *
 * The fix: emit ActionDuplicate (0x4c) BEFORE the Set opcode so one copy of
 * the value is consumed by SetVariable/SetMember and one copy remains on the
 * stack as the expression result.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../index.js";

const ACTION_PUSH_DUPLICATE = 0x4c;
const ACTION_SET_VARIABLE   = 0x1d;
const ACTION_SET_MEMBER     = 0x4f;

/** Walk the action stream and return the list of opcodes (skipping payloads). */
function opcodes(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i]!;
    out.push(code);
    if (code >= 0x80) {
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      i += 3 + len;
    } else {
      i += 1;
    }
  }
  return out;
}

describe("assignment-as-expression (task 1098)", () => {
  it("simple identifier assignment as expression emits ActionDuplicate (0x4c)", () => {
    const bytes = compileAS2("var r = (a = 5);");
    expect(bytes.includes(ACTION_PUSH_DUPLICATE)).toBe(true);
  });

  it("ActionDuplicate appears before ActionSetVariable in identifier assignment", () => {
    const ops = opcodes(compileAS2("var r = (a = 5);"));
    const dupIdx = ops.indexOf(ACTION_PUSH_DUPLICATE);
    const setIdx = ops.indexOf(ACTION_SET_VARIABLE);
    expect(dupIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(dupIdx);
  });

  it("member assignment as expression emits ActionDuplicate (0x4c)", () => {
    const bytes = compileAS2("var r = (obj.prop = 5);");
    expect(bytes.includes(ACTION_PUSH_DUPLICATE)).toBe(true);
  });

  it("ActionDuplicate appears before ActionSetMember in member assignment", () => {
    const ops = opcodes(compileAS2("var r = (obj.prop = 5);"));
    const dupIdx = ops.indexOf(ACTION_PUSH_DUPLICATE);
    const setIdx = ops.indexOf(ACTION_SET_MEMBER);
    expect(dupIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(dupIdx);
  });

  it("chained assignment x = (a = 5) emits ActionDuplicate", () => {
    const bytes = compileAS2("x = (a = 5);");
    expect(bytes.includes(ACTION_PUSH_DUPLICATE)).toBe(true);
  });

  it("compound assignment-as-expression +=  emits ActionDuplicate", () => {
    const bytes = compileAS2("var r = (a += 5);");
    expect(bytes.includes(ACTION_PUSH_DUPLICATE)).toBe(true);
  });

  it("statement-level assignment also emits ActionDuplicate (value is popped by ActionPop)", () => {
    // Even in statement context, ActionDuplicate is emitted — the extra copy is
    // discarded by the statement-level ActionPop. This is correct and expected.
    const bytes = compileAS2("a = 5;");
    expect(bytes.includes(ACTION_PUSH_DUPLICATE)).toBe(true);
  });
});
