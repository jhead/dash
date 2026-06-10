/**
 * Regression tests for task 0706: member-target assignment must emit
 * ActionSetMember — with the CORRECT SWF opcode values.
 *
 * History: the compiler's opcode table had many values that did not match the
 * SWF specification (verified against ruffle/swf/src/avm1/opcode.rs):
 *   - SetMember was emitted as 0x4E (which is actually GetMember) and
 *     GetMember as 0x4F (actually SetMember) — every `obj.prop = v` write and
 *     `obj.prop` read executed the OPPOSITE operation in Ruffle.
 *   - Add2 was emitted as 0x64 (actually BitRShift), Not as 0x14 (actually
 *     StringLength), Increment as 0x47 (actually Add2), NewObject as 0x4A
 *     (actually ToNumber), DefineLocal as 0x42 (actually InitArray), etc.
 *   - Compound member assignment (`obj.prop += v`) and member inc/dec
 *     (`obj.prop++`) compiled to no-ops that never wrote back.
 *
 * These tests pin the exact opcode bytes against the SWF spec values so a
 * future regression of the opcode table fails loudly.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../index.js";

// Correct AVM1 opcodes per the SWF spec (and Ruffle's opcode.rs).
const OP = {
  Not: 0x12,
  Pop: 0x17,
  GetVariable: 0x1c,
  SetVariable: 0x1d,
  DefineLocal: 0x3c,
  Modulo: 0x3f,
  NewObject: 0x40,
  InitArray: 0x42,
  Add2: 0x47,
  Less2: 0x48,
  Equals2: 0x49,
  PushDuplicate: 0x4c,
  StackSwap: 0x4d,
  GetMember: 0x4e,
  SetMember: 0x4f,
  Increment: 0x50,
  Decrement: 0x51,
  BitLShift: 0x63,
  BitRShift: 0x64,
  BitURShift: 0x65,
  StrictEquals: 0x66,
  StoreRegister: 0x87,
} as const;

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

describe("member-target assignment (task 0706)", () => {
  it("obj.prop = v emits ActionSetMember (0x4F), not ActionGetMember (0x4E)", () => {
    const ops = opcodes(compileAS2("obj.prop = 5;"));
    expect(ops).toContain(OP.SetMember);
    expect(ops).not.toContain(OP.GetMember);
  });

  it("nested member write _root.coin._x = 275 emits GetMember (read chain) then SetMember (write)", () => {
    const ops = opcodes(compileAS2("_root.coin._x = 275;"));
    // _root.coin is a read → GetMember; final ._x = is a write → SetMember
    const getIdx = ops.indexOf(OP.GetMember);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(getIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(getIdx);
  });

  it("compound member assignment this._x += 5 reads then writes back", () => {
    const ops = opcodes(compileAS2("this._x += 5;"));
    const getIdx = ops.indexOf(OP.GetMember);
    const addIdx = ops.indexOf(OP.Add2);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(getIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(getIdx);
    expect(setIdx).toBeGreaterThan(addIdx);
  });

  it("member increment _root._score++ stores back via SetMember", () => {
    const ops = opcodes(compileAS2("_root._score++;"));
    const incIdx = ops.indexOf(OP.Increment);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(incIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(incIdx);
    // result preserved across SetMember via StoreRegister
    expect(ops).toContain(OP.StoreRegister);
  });

  it("member decrement obj.count-- stores back via SetMember", () => {
    const ops = opcodes(compileAS2("obj.count--;"));
    const decIdx = ops.indexOf(OP.Decrement);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(decIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(decIdx);
  });

  it("indexed compound assignment arr[i] += 1 reads then writes back", () => {
    const ops = opcodes(compileAS2("arr[i] += 1;"));
    const getIdx = ops.indexOf(OP.GetMember);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(getIdx).toBeGreaterThanOrEqual(0);
    expect(setIdx).toBeGreaterThan(getIdx);
  });
});

describe("opcode table sanity (SWF spec values)", () => {
  it("a + b emits Add2 (0x47), not BitRShift (0x64)", () => {
    const ops = opcodes(compileAS2("a + b;"));
    expect(ops).toContain(OP.Add2);
    expect(ops).not.toContain(OP.BitRShift);
  });

  it("!a emits Not (0x12), not StringLength (0x14)", () => {
    const ops = opcodes(compileAS2("!a;"));
    expect(ops).toContain(OP.Not);
    expect(ops).not.toContain(0x14);
  });

  it("a < b emits Less2 (0x48)", () => {
    expect(opcodes(compileAS2("a < b;"))).toContain(OP.Less2);
  });

  it("a == b emits Equals2 (0x49); a === b emits StrictEquals (0x66)", () => {
    expect(opcodes(compileAS2("a == b;"))).toContain(OP.Equals2);
    expect(opcodes(compileAS2("a === b;"))).toContain(OP.StrictEquals);
  });

  it("a % b emits Modulo (0x3F)", () => {
    expect(opcodes(compileAS2("a % b;"))).toContain(OP.Modulo);
  });

  it("shifts emit BitLShift/BitRShift/BitURShift (0x63/0x64/0x65)", () => {
    expect(opcodes(compileAS2("a << 2;"))).toContain(OP.BitLShift);
    expect(opcodes(compileAS2("a >> 2;"))).toContain(OP.BitRShift);
    expect(opcodes(compileAS2("a >>> 2;"))).toContain(OP.BitURShift);
  });

  it("var x = 1 emits DefineLocal (0x3C), not InitArray (0x42)", () => {
    const ops = opcodes(compileAS2("var x = 1;"));
    expect(ops).toContain(OP.DefineLocal);
    expect(ops).not.toContain(OP.InitArray);
  });

  it("[1, 2] emits InitArray (0x42)", () => {
    expect(opcodes(compileAS2("var a = [1, 2];"))).toContain(OP.InitArray);
  });

  it("new Foo() emits NewObject (0x40), not ToNumber (0x4A)", () => {
    const ops = opcodes(compileAS2("var f = new Foo();"));
    expect(ops).toContain(OP.NewObject);
    expect(ops).not.toContain(0x4a);
  });

  it("i++ emits Increment (0x50) and StackSwap (0x4D), not Add2/CastOp", () => {
    const ops = opcodes(compileAS2("i++;"));
    expect(ops).toContain(OP.Increment);
    expect(ops).toContain(OP.StackSwap);
    expect(ops).not.toContain(0x2b); // CastOp
  });

  it("i-- emits Decrement (0x51)", () => {
    expect(opcodes(compileAS2("i--;"))).toContain(OP.Decrement);
  });
});
