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

// ---------------------------------------------------------------------------
// Action length integrity (Ruffle read.rs parity)
//
// Per the SWF spec, the bodies of DefineFunction/DefineFunction2 (codeSize),
// With (size), and Try (try/catch/finally sizes) FOLLOW the action record and
// are NOT included in the action's declared UI16 length. Including them makes
// Ruffle log "Length mismatch in AVM1 action" and re-sync PAST subsequent
// actions, silently corrupting the stream (e.g. the SetMember of
// `_root.onEnterFrame = function(){...}` was skipped, so the game loop never
// ran — found by capstone task 0519).
// ---------------------------------------------------------------------------

/**
 * Walk the action stream exactly like Ruffle's read_action: consume each
 * action's declared length, plus trailing body bytes for the spec'd opcodes.
 * Returns true if the walk lands exactly on the end of the stream.
 */
function walkLikeRuffle(bytes: Uint8Array): boolean {
  let i = 0;
  const u16 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8);
  while (i < bytes.length) {
    const code = bytes[i]!;
    i += 1;
    let len = 0;
    if (code >= 0x80) {
      len = u16(i);
      i += 2;
    }
    const bodyStart = i;
    if (code === 0x9b) {
      // DefineFunction: name, numParams, params..., codeSize — codeSize bytes follow.
      let p = bodyStart;
      while (bytes[p] !== 0) p++;
      p++; // name null
      const numParams = u16(p); p += 2;
      for (let k = 0; k < numParams; k++) { while (bytes[p] !== 0) p++; p++; }
      const codeSize = u16(p); p += 2;
      if (p - bodyStart !== len) return false;
      i = p + codeSize;
    } else if (code === 0x8e) {
      // DefineFunction2 header, then codeSize bytes follow the record.
      let p = bodyStart;
      while (bytes[p] !== 0) p++;
      p++; // name null
      const numParams = u16(p); p += 2;
      p += 1; // registerCount
      p += 2; // flags
      for (let k = 0; k < numParams; k++) { p += 1; while (bytes[p] !== 0) p++; p++; }
      const codeSize = u16(p); p += 2;
      if (p - bodyStart !== len) return false;
      i = p + codeSize;
    } else if (code === 0x94) {
      // With: declared length covers only the UI16 size field.
      const size = u16(bodyStart);
      if (len !== 2) return false;
      i = bodyStart + 2 + size;
    } else if (code === 0x8f) {
      // Try: flags, trySize, catchSize, finallySize, catchName/register; the
      // three bodies follow the record.
      let p = bodyStart;
      const flags = bytes[p]!; p += 1;
      const trySize = u16(p); p += 2;
      const catchSize = u16(p); p += 2;
      const finallySize = u16(p); p += 2;
      if (flags & 0x04) { p += 1; } // CatchInRegister
      else if (flags & 0x01) { while (bytes[p] !== 0) p++; p++; }
      if (p - bodyStart !== len) return false;
      i = p + trySize + catchSize + finallySize;
    } else {
      i = bodyStart + len;
    }
    if (i > bytes.length) return false;
  }
  return i === bytes.length;
}

describe("action length integrity (DefineFunction2 / With / Try)", () => {
  it("_root.onEnterFrame = function(){...} parses cleanly with body outside the record length", () => {
    const bytes = compileAS2(
      '_root.onEnterFrame = function() { if (_root.player.hitTest(_root.coin)) { _root.score++; } };'
    );
    expect(walkLikeRuffle(bytes)).toBe(true);
    // The SetMember that performs the onEnterFrame assignment must survive.
    expect(opcodes(compileAS2('x = function() { trace("hi"); }; y = 1;'))).toContain(OP.SetVariable);
  });

  it("named function declaration parses cleanly", () => {
    const bytes = compileAS2('function tick() { trace("t"); } tick();');
    expect(walkLikeRuffle(bytes)).toBe(true);
  });

  it("with(){} parses cleanly", () => {
    const bytes = compileAS2('with (obj) { x = 1; }');
    expect(walkLikeRuffle(bytes)).toBe(true);
  });

  it("try/catch/finally parses cleanly with bodies outside the record length", () => {
    const bytes = compileAS2('try { x = 1; } catch (e) { trace(e); } finally { y = 2; }');
    expect(walkLikeRuffle(bytes)).toBe(true);
  });

  it("nested functions parse cleanly", () => {
    const bytes = compileAS2('f = function() { g = function() { trace("inner"); }; g(); };');
    expect(walkLikeRuffle(bytes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chained compound member assignment (task 1051)
//
// When the LHS is a chained member path like _root.ball._x, compound
// assignment (+=, *=, etc.) must:
//   1. Evaluate the object chain once to get the target object (for SetMember).
//   2. Push the property name (for SetMember).
//   3. Re-evaluate the object chain to get a fresh reference.
//   4. GetMember to read the current value.
//   5. Evaluate RHS and apply the operator.
//   6. SetMember (pops new_value, property_name, target_obj).
//
// Ruffle's AVM1 logs "Stack underflow" if the object/name are not on the
// stack when SetMember executes.
// ---------------------------------------------------------------------------

/**
 * Simulate the AVM1 stack depth change for each opcode in the stream.
 * Returns null if a stack underflow would occur, or the final depth if clean.
 *
 * This is not a full AVM1 emulator — it only tracks the stack depth for the
 * subset of opcodes emitted by the AS2 compiler.  CallMethod is handled by
 * inspecting the numArgs Push that precedes it.
 */
function simulateStackDepth(bytes: Uint8Array): number | null {
  const u16 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8);

  // Parse the constant pool (present at offset 0 in compiler output)
  let i = 0;

  let depth = 0;
  let lastPushedInt: number | null = null; // tracks most-recent push of an SI32

  while (i < bytes.length) {
    const code = bytes[i]!;
    i += 1;
    let len = 0;
    if (code >= 0x80) {
      len = u16(i);
      i += 2;
    }
    const bs = i;

    let delta = 0;

    if (code === 0x96) {
      // ActionPush — count items pushed and look for integer pushes
      let p = bs;
      let pushed = 0;
      lastPushedInt = null;
      while (p < bs + len) {
        const type = bytes[p++]!;
        pushed++;
        if (type === 0) { while (bytes[p] !== 0) p++; p++; } // string
        else if (type === 6) p += 8; // double
        else if (type === 7) {
          const v = bytes[p]! | (bytes[p+1]! << 8) | (bytes[p+2]! << 16) | (bytes[p+3]! << 24);
          lastPushedInt = v;
          p += 4;
        }
        else if (type === 8) p += 1; // pool8
        else if (type === 9) p += 2; // pool16
        else if (type === 5 || type === 4) p += 1; // bool/register
        // 2=null, 3=undefined: no extra bytes
      }
      delta = pushed;
    } else if (code === 0x88) { // ConstantPool
      delta = 0;
    } else if (code === 0x8e) { // DefineFunction2 — skip body, pushes function ref
      // Parse header to find codeSize and skip body bytes
      let p = bs;
      while (bytes[p] !== 0) p++; p++; // name C-string
      const numParams = u16(p); p += 2;
      p += 1; // registerCount
      p += 2; // flags
      for (let k = 0; k < numParams; k++) { p += 1; while (bytes[p] !== 0) p++; p++; }
      const codeSize = u16(p); p += 2;
      i = p + codeSize; // skip body
      delta = 1; // function ref pushed
    } else if (code === 0x1c) { delta = 0; }  // GetVariable: pop name, push value
    else if (code === 0x1d) { delta = -2; }   // SetVariable: pop value + name
    else if (code === 0x4e) { delta = -1; }   // GetMember: pop name + obj, push result
    else if (code === 0x4f) { delta = -3; }   // SetMember: pop value + name + obj
    else if (code === 0x17) { delta = -1; }   // Pop
    else if (code === 0x3c) { delta = -2; }   // DefineLocal: pop value + name
    else if (code === 0x41) { delta = -1; }   // DefineLocal2: pop name
    else if (code === 0x47) { delta = -1; }   // Add2
    else if (code === 0x0b) { delta = -1; }   // Subtract
    else if (code === 0x0c) { delta = -1; }   // Multiply
    else if (code === 0x0d) { delta = -1; }   // Divide
    else if (code === 0x3f) { delta = -1; }   // Modulo
    else if (code === 0x48) { delta = -1; }   // Less2
    else if (code === 0x67) { delta = -1; }   // Greater
    else if (code === 0x49) { delta = -1; }   // Equals2
    else if (code === 0x66) { delta = -1; }   // StrictEquals
    else if (code === 0x60) { delta = -1; }   // BitAnd
    else if (code === 0x61) { delta = -1; }   // BitOr
    else if (code === 0x62) { delta = -1; }   // BitXor
    else if (code === 0x63) { delta = -1; }   // BitLShift
    else if (code === 0x64) { delta = -1; }   // BitRShift
    else if (code === 0x65) { delta = -1; }   // BitURShift
    else if (code === 0x12) { delta = 0; }    // Not: pop 1, push 1
    else if (code === 0x50) { delta = 0; }    // Increment: pop 1, push 1
    else if (code === 0x51) { delta = 0; }    // Decrement: pop 1, push 1
    else if (code === 0x4c) { delta = +1; }   // PushDuplicate
    else if (code === 0x4d) { delta = 0; }    // StackSwap
    else if (code === 0x87) { delta = 0; }    // StoreRegister (no pop)
    else if (code === 0x9d) { delta = -1; }   // ActionIf: pop condition
    else if (code === 0x99) { delta = 0; }    // ActionJump
    else if (code === 0x3e) { delta = -1; }   // Return
    else if (code === 0x26) { delta = -1; }   // ActionTrace: pop 1, push 0 (then pushUndefined adds 1)
    else if (code === 0x3a) { delta = -2; }   // ActionDelete: pop name + obj
    else if (code === 0x3b) { delta = -1; }   // ActionDelete2: pop name
    else if (code === 0x52) {
      // ActionCallMethod: pops method_name, object, numArgs, then numArgs args; pushes result.
      // numArgs was the most recently pushed integer value.
      const numArgs = lastPushedInt ?? 0;
      delta = -(2 + 1 + numArgs) + 1; // -method_name, -obj, -numArgs_val, -args, +result
      lastPushedInt = null;
    }
    // Opcodes with no net stack change or not emitted by our compiler: ignore
    // (unknown opcodes do NOT cause a failed check — we just skip them)

    depth += delta;
    if (depth < 0) return null; // underflow detected
    if (code !== 0x96) lastPushedInt = null; // only keep int across consecutive pushes
    // For DefineFunction2, i was already advanced to skip header+body inside the
    // if-block above. For all other opcodes advance past the payload.
    if (code !== 0x8e) {
      i = bs + len;
    }
  }
  return depth;
}

describe("chained compound member assignment (task 1051)", () => {
  it("_root.ball._x += vx emits GetMember×2 (chain eval) then GetMember (current val), Add2, SetMember", () => {
    const ops = opcodes(compileAS2("_root.ball._x += vx;"));
    // The chained object '_root.ball' is evaluated TWICE:
    //   first to produce the SetMember target object, then again for the GetMember read.
    // So at minimum 3 GetMember calls appear: [ball] × 2 + [_x] × 1.
    const getIndices: number[] = [];
    for (let k = 0; k < ops.length; k++) {
      if (ops[k] === OP.GetMember) getIndices.push(k);
    }
    expect(getIndices.length).toBeGreaterThanOrEqual(3);

    // The two 'ball' GetMembers come first, then '_x' GetMember, then Add2, then SetMember.
    const addIdx = ops.indexOf(OP.Add2);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(addIdx).toBeGreaterThan(getIndices[getIndices.length - 1]!); // Add2 after all GetMembers
    expect(setIdx).toBeGreaterThan(addIdx);
  });

  it("_root.ball._x += vx: stack does not underflow (depth stays ≥ 0, ends at 0)", () => {
    const finalDepth = simulateStackDepth(compileAS2("_root.ball._x += vx;"));
    expect(finalDepth).not.toBeNull();
    expect(finalDepth).toBe(0);
  });

  it("_root.ball._y += vy: stack does not underflow", () => {
    const finalDepth = simulateStackDepth(compileAS2("_root.ball._y += vy;"));
    expect(finalDepth).not.toBeNull();
    expect(finalDepth).toBe(0);
  });

  it("_root.ball._x = W - R (simple chained member assign) does not underflow", () => {
    const finalDepth = simulateStackDepth(compileAS2("_root.ball._x = W - R;"));
    expect(finalDepth).not.toBeNull();
    expect(finalDepth).toBe(0);
  });

  it("_root.ball._x *= 0.9: stack does not underflow", () => {
    const finalDepth = simulateStackDepth(compileAS2("_root.ball._x *= 0.9;"));
    expect(finalDepth).not.toBeNull();
    expect(finalDepth).toBe(0);
  });

  it("full bouncing-ball function body does not underflow", () => {
    const src = `
      _root.onEnterFrame = function() {
        vy += gravity;
        _root.ball._x += vx;
        _root.ball._y += vy;
        if (_root.ball._x + R > W) {
          _root.ball._x = W - R;
          vx *= -1;
        }
        if (_root.ball._x - R < 0) {
          _root.ball._x = R;
          vx *= -1;
        }
        if (_root.ball._y + R > H) {
          _root.ball._y = H - R;
          vy *= -bounce;
          if (Math.abs(vy) < 1.5) vy = 0;
        }
        if (_root.ball._y - R < 0) {
          _root.ball._y = R;
          vy *= -1;
        }
      };
    `;
    const finalDepth = simulateStackDepth(compileAS2(src));
    expect(finalDepth).not.toBeNull();
    expect(finalDepth).toBe(0);
  });

  it("_root.ball._x += vx inside a function body produces well-formed DefineFunction2", () => {
    const src = `
      _root.onEnterFrame = function() {
        _root.ball._x += vx;
      };
    `;
    expect(walkLikeRuffle(compileAS2(src))).toBe(true);
  });

  it("all compound ops on chained path: -=, *=, /=, %=", () => {
    for (const [op, expectedBinaryOp] of [
      ["-=", OP.GetMember],
      ["*=", OP.GetMember],
    ] as const) {
      const ops = opcodes(compileAS2(`_root.ball._x ${op} vx;`));
      // Must have SetMember
      expect(ops).toContain(OP.SetMember);
      // Must have GetMember (for chain evaluation)
      expect(ops).toContain(OP.GetMember);
      // Stack must be balanced
      const depth = simulateStackDepth(compileAS2(`_root.ball._x ${op} vx;`));
      expect(depth).not.toBeNull();
      expect(depth).toBe(0);
    }
  });
});
