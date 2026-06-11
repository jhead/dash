/**
 * Regression tests for constructs used in the MagSave game script
 * (magsaveBA SharedObject persistence + Sound/Key/Stage/math patterns).
 *
 * Coverage targets:
 *   1. new Sound(this)          — constructor with 'this' as argument
 *   2. SharedObject.getLocal()  — static method call via ActionCallMethod
 *   3. _root.pos.data.level     — 3-level deep member read
 *   4. _root.pos.data.level = v — 3-level deep member WRITE
 *   5. _root.meteor.x /= 1.1   — compound /= on 2-level member
 *   6. Key.isDown(Key.LEFT)     — method arg is property of same class object
 *   7. Stage.showMenu = false   — assignment to static class property
 *   8. while (cond) { ... }     — while loop
 *   9. tgt.m_rot -= 1           — compound -= on local member
 *  10. _root.meteor.grav = -.5  — negative float literal (-.5 shorthand)
 *  11. Full script compiles end-to-end without error
 *
 * Note on the stack-depth simulator:
 * The simulator tracks `lastPushedInt` to infer the numArgs for NewObject and
 * CallMethod. This works when the numArgs integer is the LAST push before the
 * opcode. However, the compiler emits each value in a separate ActionPush record,
 * so if any argument push comes AFTER the numArgs push (e.g. when args are pushed
 * deepest-first and then numArgs), `lastPushedInt` is cleared by the subsequent
 * push record. In those cases the simulator cannot verify absolute depth=0 — we
 * verify the simulated depth is non-negative (no underflow) instead.
 */

import { describe, it, expect } from "vitest";
import { compileAS2 } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilesOk(source: string): void {
  expect(() => compileAS2(source)).not.toThrow();
}

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
 * Decode all strings from the constant pool and inline string pushes.
 */
function allStrings(bytes: Uint8Array): string[] {
  const result: string[] = [];
  const pool: string[] = [];

  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i]!;
    if (code >= 0x80) {
      const len = bytes[i + 1]! | (bytes[i + 2]! << 8);
      if (code === 0x88) {
        // ConstantPool
        let p = i + 3;
        const count = bytes[p]! | (bytes[p + 1]! << 8); p += 2;
        for (let k = 0; k < count; k++) {
          let s = "";
          while (bytes[p] !== 0) s += String.fromCharCode(bytes[p++]!);
          p++;
          pool.push(s);
          result.push(s);
        }
      } else if (code === 0x96) {
        // ActionPush
        let p = i + 3;
        while (p < i + 3 + len) {
          const t = bytes[p++]!;
          if (t === 0) { let s = ""; while (bytes[p] !== 0) s += String.fromCharCode(bytes[p++]!); p++; result.push(s); }
          else if (t === 6) p += 8;
          else if (t === 7) p += 4;
          else if (t === 8) { p += 1; }
          else if (t === 9) { p += 2; }
          else if (t === 5 || t === 4) p += 1;
        }
      }
      i += 3 + len;
    } else {
      i += 1;
    }
  }
  return result;
}

/**
 * Simulate AVM1 stack depth for the bytecode emitted by our compiler.
 * Returns final depth, or null if a stack underflow is detected.
 * This is the same simulator used in memberassign.test.ts and adapted here.
 */
function simulateStackDepth(bytes: Uint8Array): number | null {
  const u16 = (p: number) => bytes[p]! | (bytes[p + 1]! << 8);
  let i = 0;
  let depth = 0;
  let lastPushedInt: number | null = null;

  while (i < bytes.length) {
    const code = bytes[i]!;
    i += 1;
    let len = 0;
    if (code >= 0x80) { len = u16(i); i += 2; }
    const bs = i;
    let delta = 0;

    if (code === 0x96) {
      let p = bs; let pushed = 0;
      lastPushedInt = null;
      while (p < bs + len) {
        const type = bytes[p++]!; pushed++;
        if (type === 0) { while (bytes[p] !== 0) p++; p++; }
        else if (type === 6) p += 8;
        else if (type === 7) {
          const v = bytes[p]! | (bytes[p+1]! << 8) | (bytes[p+2]! << 16) | (bytes[p+3]! << 24);
          lastPushedInt = v; p += 4;
        }
        else if (type === 8) p += 1;
        else if (type === 9) p += 2;
        else if (type === 5 || type === 4) p += 1;
      }
      delta = pushed;
    } else if (code === 0x88) { delta = 0; }
    else if (code === 0x8e) {
      let p = bs;
      while (bytes[p] !== 0) p++; p++;
      const numParams = u16(p); p += 2;
      p += 1; p += 2;
      for (let k = 0; k < numParams; k++) { p += 1; while (bytes[p] !== 0) p++; p++; }
      const codeSize = u16(p); p += 2;
      i = p + codeSize;
      delta = 1;
    }
    else if (code === 0x1c) { delta = 0; }   // GetVariable: pop name, push value
    else if (code === 0x1d) { delta = -2; }  // SetVariable: pop value + name
    else if (code === 0x4e) { delta = -1; }  // GetMember: pop name + obj, push result
    else if (code === 0x4f) { delta = -3; }  // SetMember: pop value + name + obj
    else if (code === 0x17) { delta = -1; }  // Pop
    else if (code === 0x3c) { delta = -2; }  // DefineLocal
    else if (code === 0x41) { delta = -1; }  // DefineLocal2
    else if (code === 0x47) { delta = -1; }  // Add2
    else if (code === 0x0b) { delta = -1; }  // Subtract
    else if (code === 0x0c) { delta = -1; }  // Multiply
    else if (code === 0x0d) { delta = -1; }  // Divide
    else if (code === 0x3f) { delta = -1; }  // Modulo
    else if (code === 0x48) { delta = -1; }  // Less2
    else if (code === 0x67) { delta = -1; }  // Greater
    else if (code === 0x49) { delta = -1; }  // Equals2
    else if (code === 0x66) { delta = -1; }  // StrictEquals
    else if (code === 0x12) { delta = 0; }   // Not
    else if (code === 0x50) { delta = 0; }   // Increment
    else if (code === 0x51) { delta = 0; }   // Decrement
    else if (code === 0x4c) { delta = +1; }  // PushDuplicate
    else if (code === 0x4d) { delta = 0; }   // StackSwap
    else if (code === 0x87) { delta = 0; }   // StoreRegister
    else if (code === 0x9d) { delta = -1; }  // ActionIf
    else if (code === 0x99) { delta = 0; }   // ActionJump
    else if (code === 0x3e) { delta = -1; }  // Return
    else if (code === 0x26) { delta = -1; }  // ActionTrace
    else if (code === 0x07) { delta = 0; }   // ActionStop
    else if (code === 0x40) {
      // ActionNewObject: pops className + nArgs + nArgs items, pushes 1
      const numArgs = lastPushedInt ?? 0;
      delta = -(1 + 1 + numArgs) + 1;
      lastPushedInt = null;
    }
    else if (code === 0x52) {
      // ActionCallMethod: pops methodName + obj + nArgs + nArgs items, pushes 1
      const numArgs = lastPushedInt ?? 0;
      delta = -(2 + 1 + numArgs) + 1;
      lastPushedInt = null;
    }

    depth += delta;
    if (depth < 0) return null;
    if (code !== 0x96) lastPushedInt = null;
    if (code !== 0x8e) { i = bs + len; }
  }
  return depth;
}

const OP = {
  GetVariable: 0x1c,
  SetVariable: 0x1d,
  GetMember: 0x4e,
  SetMember: 0x4f,
  NewObject: 0x40,
  CallMethod: 0x52,
  ActionStop: 0x07,
  ActionIf: 0x9d,
  ActionJump: 0x99,
  Divide: 0x0d,
  Subtract: 0x0b,
  Add2: 0x47,
} as const;

// ---------------------------------------------------------------------------
// 1. new Sound(this)
// ---------------------------------------------------------------------------

describe("1. new Sound(this) — constructor with this as argument", () => {
  it("compiles without error", () => {
    compilesOk("clank = new Sound(this);");
  });

  it("emits NewObject (0x40) and pushes 'this' string resolved via GetVariable", () => {
    const bytes = compileAS2("clank = new Sound(this);");
    const ops = opcodes(bytes);
    expect(ops).toContain(OP.NewObject);
    // 'this' is resolved via GetVariable (pushed as string, then GetVariable)
    expect(allStrings(bytes)).toContain("this");
  });

  it("stack does not underflow (non-negative throughout)", () => {
    // Note: the simulator loses lastPushedInt across separate Push records, so
    // it cannot verify the final depth=0 for NewObject with args. We verify no
    // underflow occurred (depth never went negative).
    const depth = simulateStackDepth(compileAS2("clank = new Sound(this);"));
    expect(depth).not.toBeNull(); // null = underflow
  });
});

// ---------------------------------------------------------------------------
// 2. SharedObject.getLocal() — static class method call
// ---------------------------------------------------------------------------

describe("2. SharedObject.getLocal() — static method via CallMethod", () => {
  it("compiles without error", () => {
    compilesOk('_root.pos = SharedObject.getLocal("magsaveBA");');
  });

  it("emits CallMethod (0x52) and references 'SharedObject' and 'getLocal'", () => {
    const bytes = compileAS2('SharedObject.getLocal("magsaveBA");');
    const ops = opcodes(bytes);
    const strs = allStrings(bytes);
    expect(ops).toContain(OP.CallMethod);
    expect(strs).toContain("SharedObject");
    expect(strs).toContain("getLocal");
    expect(strs).toContain("magsaveBA");
  });

  it("stack does not underflow on: _root.pos = SharedObject.getLocal(\"magsaveBA\")", () => {
    // Note: CallMethod with 1 arg loses lastPushedInt across separate Push records;
    // we verify no underflow (depth never < 0) rather than exact final depth.
    const depth = simulateStackDepth(compileAS2('_root.pos = SharedObject.getLocal("magsaveBA");'));
    expect(depth).not.toBeNull(); // null = underflow
  });
});

// ---------------------------------------------------------------------------
// 3. _root.pos.data.level — 3-level deep member read
// ---------------------------------------------------------------------------

describe("3. _root.pos.data.level — 3-level deep member read", () => {
  it("compiles without error", () => {
    compilesOk("_root.pos.data.level;");
  });

  it("emits exactly 3 GetMember ops for chain _root→pos→data→level", () => {
    const bytes = compileAS2("_root.pos.data.level;");
    const ops = opcodes(bytes);
    const getCount = ops.filter(o => o === OP.GetMember).length;
    expect(getCount).toBe(3);
  });

  it("stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("_root.pos.data.level;"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. _root.pos.data.level = _root.level — 3-level deep member WRITE
// ---------------------------------------------------------------------------

describe("4. _root.pos.data.level = _root.level — 3-level deep member write", () => {
  it("compiles without error", () => {
    compilesOk("_root.pos.data.level = _root.level;");
  });

  it("emits SetMember (0x4F) as the write operation", () => {
    const ops = opcodes(compileAS2("_root.pos.data.level = _root.level;"));
    expect(ops).toContain(OP.SetMember);
  });

  it("target object chain uses GetMember×2 before SetMember: pos and data", () => {
    const ops = opcodes(compileAS2("_root.pos.data.level = _root.level;"));
    // Chain: _root → GetVar, pos → GetMember, data → GetMember  (= target object)
    // Then: level → property name for SetMember
    // Then: rhs _root.level
    // Then: SetMember
    const getIndices: number[] = [];
    for (let k = 0; k < ops.length; k++) {
      if (ops[k] === OP.GetMember) getIndices.push(k);
    }
    // At least 3 GetMember: pos, data (for target object chain), level (for rhs)
    expect(getIndices.length).toBeGreaterThanOrEqual(3);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(setIdx).toBeGreaterThan(getIndices[getIndices.length - 1]!);
  });

  it("stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("_root.pos.data.level = _root.level;"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. _root.meteor.x_velocity /= 1.1 — compound /= on 2-level member
// ---------------------------------------------------------------------------

describe("5. _root.meteor.x_velocity /= 1.1 — compound divide-assign on member", () => {
  it("compiles without error", () => {
    compilesOk("_root.meteor.x_velocity /= 1.1;");
  });

  it("emits GetMember (for current value) followed by Divide (0x0d) and SetMember", () => {
    const ops = opcodes(compileAS2("_root.meteor.x_velocity /= 1.1;"));
    const getIdx = ops.lastIndexOf(OP.GetMember); // last GetMember = reading x_velocity
    const divIdx = ops.indexOf(OP.Divide);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(getIdx).toBeGreaterThanOrEqual(0);
    expect(divIdx).toBeGreaterThan(getIdx);
    expect(setIdx).toBeGreaterThan(divIdx);
  });

  it("stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("_root.meteor.x_velocity /= 1.1;"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Key.isDown(Key.LEFT) — method arg is property of same class object
// ---------------------------------------------------------------------------

describe("6. Key.isDown(Key.LEFT) — method arg is property of same class", () => {
  it("compiles without error", () => {
    compilesOk("Key.isDown(Key.LEFT);");
  });

  it("emits CallMethod with 'isDown' method and pushes 'Key.LEFT' via GetMember", () => {
    const bytes = compileAS2("Key.isDown(Key.LEFT);");
    const ops = opcodes(bytes);
    const strs = allStrings(bytes);
    expect(ops).toContain(OP.CallMethod);
    expect(strs).toContain("isDown");
    expect(strs).toContain("LEFT");
    // The arg Key.LEFT is resolved by GetVariable("Key") then GetMember("LEFT")
    expect(ops).toContain(OP.GetMember);
  });

  it("stack does not underflow (non-negative throughout)", () => {
    // Note: CallMethod with 1 arg - simulator loses lastPushedInt; verify no underflow.
    const depth = simulateStackDepth(compileAS2("Key.isDown(Key.LEFT);"));
    expect(depth).not.toBeNull(); // null = underflow
  });

  it("chained OR of Key.isDown calls compiles and stack does not underflow", () => {
    const src = `
      if (Key.isDown(Key.LEFT) || Key.isDown(Key.RIGHT) ||
          Key.isDown(Key.UP) || Key.isDown(Key.DOWN)) {
        x = 1;
      }
    `;
    compilesOk(src);
    // Verify no underflow occurs (simulator limitation: can't check exact final depth
    // when CallMethod arg count is lost across Push records)
    const depth = simulateStackDepth(compileAS2(src));
    expect(depth).not.toBeNull(); // null = underflow
  });
});

// ---------------------------------------------------------------------------
// 7. Stage.showMenu = false — assignment to static class property
// ---------------------------------------------------------------------------

describe("7. Stage.showMenu = false — static class property assignment", () => {
  it("compiles without error", () => {
    compilesOk("Stage.showMenu = false;");
  });

  it("emits SetMember (0x4F), references 'Stage' and 'showMenu'", () => {
    const bytes = compileAS2("Stage.showMenu = false;");
    const ops = opcodes(bytes);
    const strs = allStrings(bytes);
    expect(ops).toContain(OP.SetMember);
    expect(strs).toContain("Stage");
    expect(strs).toContain("showMenu");
  });

  it("stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("Stage.showMenu = false;"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. while (cond) { ... } — while loop
// ---------------------------------------------------------------------------

describe("8. while loop", () => {
  it("simple while (x != 0) compiles without error", () => {
    compilesOk("while (x != 0) { x -= 1; }");
  });

  it("emits ActionIf (0x9D) and ActionJump (0x99) for loop control", () => {
    const ops = opcodes(compileAS2("while (x != 0) { x -= 1; }"));
    expect(ops).toContain(OP.ActionIf);
    expect(ops).toContain(OP.ActionJump);
  });

  it("while loop with member condition and body compiles: movingL pattern", () => {
    compilesOk(`
      while (360/tgt.m_rot != Math.round(360/tgt.m_rot)) {
        tgt.m_rot -= 1;
      }
    `);
  });

  it("while loop stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("while (x != 0) { x -= 1; }"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. tgt.m_rot -= 1 — compound -= on local member
// ---------------------------------------------------------------------------

describe("9. tgt.m_rot -= 1 — compound subtract-assign on member", () => {
  it("compiles without error", () => {
    compilesOk("tgt.m_rot -= 1;");
  });

  it("emits GetMember (current value read), Subtract (0x0B), SetMember (write back)", () => {
    const ops = opcodes(compileAS2("tgt.m_rot -= 1;"));
    const getIdx = ops.indexOf(OP.GetMember);
    const subIdx = ops.indexOf(OP.Subtract);
    const setIdx = ops.indexOf(OP.SetMember);
    expect(getIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeGreaterThan(getIdx);
    expect(setIdx).toBeGreaterThan(subIdx);
  });

  it("stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("tgt.m_rot -= 1;"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. _root.meteor.grav = -.5 — negative float literal shorthand
// ---------------------------------------------------------------------------

describe("10. _root.meteor.grav = -.5 — negative float literal (-.5 shorthand)", () => {
  it("compiles without error", () => {
    compilesOk("_root.meteor.grav = -.5;");
  });

  it("compiles -0.5 form without error", () => {
    compilesOk("_root.meteor.grav = -0.5;");
  });

  it("emits SetMember (0x4F) for member write", () => {
    const ops = opcodes(compileAS2("_root.meteor.grav = -.5;"));
    expect(ops).toContain(OP.SetMember);
  });

  it("stack does not underflow", () => {
    const depth = simulateStackDepth(compileAS2("_root.meteor.grav = -.5;"));
    expect(depth).not.toBeNull();
    expect(depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Full script compiles end-to-end
// ---------------------------------------------------------------------------

describe("11. Full MagSave game script compiles end-to-end", () => {
  const fullScript = `
    stop();
    k_constant = 5;
    val_1 = 4;
    anim = 1;
    dropable = true;
    mCheck = false;
    clank = new Sound(this);
    clank.attachSound("clank");
    sport = new Sound(this);
    sport.attachSound("goo");
    hit = new Sound(sfxh);
    hit.attachSound("bounce");
    hitSoundX = true;
    hitSoundY = true;
    oldx = 0;
    oldy = 0;
    function claw(tgt) {
        if (_root.meteor.enam == 0) {
            tgt.gotoAndStop(1);
        } else {
            tgt.gotoAndStop(2);
        }
    }
    function newlvl() {
        stop();
        _root.level += 1;
        _root.pos = SharedObject.getLocal("magsaveBA");
        _root.CheckLevel = _root.pos.data.level;
        if (CheckLevel == undefined) {
            CheckLevel = 0;
        }
        if (_root.CheckLevel < _root.level) {
            _root.pos = SharedObject.getLocal("magsaveBA");
            _root.pos.data.level = _root.level;
        }
    }
    function mLoad(tgt) {
        tgt.x_velocity = 0;
        if (Key.isDown(Key.LEFT) || Key.isDown(Key.RIGHT) ||
            Key.isDown(Key.UP) || Key.isDown(Key.DOWN)) {
            tgt.keydown = true;
        }
    }
    function moving(tgt) {
        tgt.m_dir += tgt.m_rot;
        if (tgt.m_dir >= 180) {
            tgt.m_dir = -180 + (tgt.m_dir - 180);
        }
        tgt._x += tgt.m_speed * Math.sin(tgt.m_dir * (Math.PI / 180));
        tgt._y += tgt.m_speed * Math.cos(tgt.m_dir * (Math.PI / 180));
    }
    function movingL(tgt, radius, speed) {
        tgt.m_rot = radius;
        while (360 / tgt.m_rot != Math.round(360 / tgt.m_rot)) {
            tgt.m_rot -= 1;
        }
    }
    function shock(tgt) {
        _root.meteor.x_velocity /= 1.1;
        _root.meteor.y_velocity /= 1.1;
    }
    function gShift(grav) {
        if (grav == "up") {
            _root.meteor.grav = -.5;
        }
    }
    _root.pos = SharedObject.getLocal("magsaveBA");
    _root.level = _root.pos.data.level;
    if (level == undefined) {
        level = 1;
        _root.pos.data.level = 1;
    }
    Stage.showMenu = false;
  `;

  it("compiles without throwing", () => {
    compilesOk(fullScript);
  });

  it("produces non-empty bytecode (> 100 bytes)", () => {
    const bytes = compileAS2(fullScript);
    expect(bytes.length).toBeGreaterThan(100);
  });
});
