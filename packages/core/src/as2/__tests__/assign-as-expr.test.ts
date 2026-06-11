/**
 * Tests for task 1098: assignment-as-expression must leave the assigned value
 * on the stack (not undefined).
 *
 * AS2 allows assignments to be used as sub-expressions, e.g.:
 *   var r = (a = 5);          // r should be 5, not undefined
 *   x = (a = 5);              // x should be 5
 *   while ((line = next()) != null) { ... }
 *
 * The fix: emit ActionStoreRegister r0 (0x87 01 00 00) BEFORE the
 * Set opcode so the value is saved to a register while SetVariable/SetMember
 * still sees the correct [name, value] / [obj, name, value] stack layout.
 * After the Set action, ActionPush(register 0) restores the value as the
 * expression result.
 *
 * Why NOT ActionDuplicate (0x4c)?
 *   Dup copies TOS, giving [name, value, value].  SetVariable then pops the
 *   top duplicate as the value AND the second duplicate as the variable NAME
 *   (not the actual name string), silently setting the wrong variable and
 *   leaving the real name orphaned on the stack.  SetMember has the same
 *   problem.  StoreRegister avoids this by saving without altering the stack.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../index.js";

const ACTION_STORE_REGISTER = 0x87;
const ACTION_SET_VARIABLE   = 0x1d;
const ACTION_SET_MEMBER     = 0x4f;
// ActionPush type byte 4 = register
const ACTION_PUSH           = 0x96;
const PUSH_TYPE_REGISTER    = 0x04;

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

/**
 * Return true if the bytes contain an ActionPush(register N) sequence:
 *   96 02 00 04 <reg>
 */
function containsPushRegister(bytes: Uint8Array, reg: number): boolean {
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (
      bytes[i]     === ACTION_PUSH &&
      bytes[i + 1] === 0x02 &&
      bytes[i + 2] === 0x00 &&
      bytes[i + 3] === PUSH_TYPE_REGISTER &&
      bytes[i + 4] === reg
    ) return true;
  }
  return false;
}

describe("assignment-as-expression (task 1098)", () => {
  it("simple identifier assignment as expression emits ActionStoreRegister before ActionSetVariable", () => {
    const ops = opcodes(compileAS2("var r = (a = 5);"));
    const storeIdx = ops.indexOf(ACTION_STORE_REGISTER);
    const setIdx   = ops.indexOf(ACTION_SET_VARIABLE);
    expect(storeIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(storeIdx);
  });

  it("simple identifier assignment as expression emits Push(register 0) after ActionSetVariable", () => {
    const bytes = compileAS2("var r = (a = 5);");
    expect(containsPushRegister(bytes, 0)).toBe(true);
    // Push(r0) must appear after SetVariable
    const ops = opcodes(bytes);
    const setIdx  = ops.indexOf(ACTION_SET_VARIABLE);
    const pushIdx = ops.lastIndexOf(0x96); // last ActionPush
    expect(pushIdx).toBeGreaterThan(setIdx);
  });

  it("member assignment as expression emits ActionStoreRegister before ActionSetMember", () => {
    const ops = opcodes(compileAS2("var r = (obj.prop = 5);"));
    const storeIdx = ops.indexOf(ACTION_STORE_REGISTER);
    const setIdx   = ops.indexOf(ACTION_SET_MEMBER);
    expect(storeIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(storeIdx);
  });

  it("member assignment as expression emits Push(register 0) after ActionSetMember", () => {
    const bytes = compileAS2("var r = (obj.prop = 5);");
    expect(containsPushRegister(bytes, 0)).toBe(true);
  });

  it("chained assignment x = (a = 5) emits ActionStoreRegister", () => {
    const ops = opcodes(compileAS2("x = (a = 5);"));
    expect(ops).toContain(ACTION_STORE_REGISTER);
  });

  it("compound identifier assignment-as-expression +=  emits ActionStoreRegister", () => {
    const ops = opcodes(compileAS2("var r = (a += 5);"));
    expect(ops).toContain(ACTION_STORE_REGISTER);
  });

  it("statement-level assignment emits ActionStoreRegister (value is popped by ActionPop)", () => {
    // Even in statement context, StoreRegister is emitted — the Push(r0) result is
    // discarded by the statement-level ActionPop.  This is correct and expected.
    const ops = opcodes(compileAS2("a = 5;"));
    expect(ops).toContain(ACTION_STORE_REGISTER);
  });

  it("assignment-as-expression does NOT emit ActionDuplicate (0x4c) for identifier lhs", () => {
    // ActionDuplicate is WRONG for SetVariable: it inserts a copy between name and
    // value, causing SetVariable to use the duplicate as the variable name.
    const ops = opcodes(compileAS2("var r = (a = 5);"));
    // Only SetVariable should be present — no extraneous 0x4c before it
    // (0x4c may appear elsewhere in the bytecode for switch statements, but not
    // directly before SetVariable from assignment).
    const setIdx = ops.indexOf(ACTION_SET_VARIABLE);
    // The opcode immediately before SetVariable must NOT be ActionDuplicate
    expect(ops[setIdx - 1]).not.toBe(0x4c);
  });
});
