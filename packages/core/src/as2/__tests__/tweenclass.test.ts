/**
 * Tests for AS2 compiler: mx.transitions.Tween class compilation.
 *
 * Verifies that the Tween constructor, method calls, property assignments,
 * and easing property accesses compile correctly to AVM1 bytecode.
 *
 * Because mx.transitions.Tween uses a nested namespace path (not a plain
 * identifier), the compiler resolves it via a member-access chain:
 *   GetVariable("mx") → GetMember("transitions") → GetMember("Tween")
 *
 * Key opcodes verified:
 *   - ActionNew        (0x4a): constructor calls
 *   - ActionCallMethod (0x52): instance method calls (start, stop, rewind, fforward)
 *   - ActionGetMember  (0x4f): property reads (easing constants, namespace traversal)
 *   - ActionSetMember  (0x4e): callback assignment (onMotionFinished)
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

function containsByte(bytes: Uint8Array, byte: number): boolean {
  return bytes.includes(byte);
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
// AVM1 opcodes under test
// ---------------------------------------------------------------------------

const ACTION_NEW         = 0x4a; // ActionNew        — constructor call
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember  — property / member read
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember  — property / member write

// ---------------------------------------------------------------------------
// Setup helper: create a tween variable via the workaround form
// (using var Tween = mx.transitions.Tween avoids relying on ActionNew with
// a non-identifier callee, and tests the member-access chain directly)
// ---------------------------------------------------------------------------

const TWEEN_SETUP = `
  var obj = {};
  var Tween = mx.transitions.Tween;
  var t = new Tween(obj, "_x", mx.transitions.easing.Strong.easeOut, 0, 100, 1, true);
`;

// ---------------------------------------------------------------------------
// mx.transitions.Tween constructor
// ---------------------------------------------------------------------------

describe("mx.transitions.Tween constructor", () => {
  it("new mx.transitions.Tween(...) via alias compiles without error", () => {
    expect(compilesOk(TWEEN_SETUP)).toBe(true);
  });

  it("new mx.transitions.Tween(...) via alias emits ActionNew (0x4a)", () => {
    const bytes = compileAS2(TWEEN_SETUP);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });

  it("var Tween = mx.transitions.Tween emits ActionGetMember (0x4f) for namespace chain", () => {
    const bytes = compileAS2("var Tween = mx.transitions.Tween;");
    // Must traverse: mx → .transitions → .Tween (two GetMember calls)
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "mx")).toBe(true);
    expect(containsString(bytes, "transitions")).toBe(true);
    expect(containsString(bytes, "Tween")).toBe(true);
  });

  it("direct new mx.transitions.Tween(...) compiles without error", () => {
    // The callee is a MemberExpr chain — the compiler falls back to compileExpr
    // on the callee, emitting the namespace traversal then ActionNew.
    expect(
      compilesOk(
        `var obj = {};
         new mx.transitions.Tween(obj, "_x", mx.transitions.easing.Strong.easeOut, 0, 100, 1, true);`
      )
    ).toBe(true);
  });

  it("direct new mx.transitions.Tween(...) emits ActionNew (0x4a)", () => {
    const bytes = compileAS2(
      `var obj = {};
       new mx.transitions.Tween(obj, "_x", mx.transitions.easing.Strong.easeOut, 0, 100, 1, true);`
    );
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// t.start()
// ---------------------------------------------------------------------------

describe("Tween start()", () => {
  it("t.start() compiles without error", () => {
    expect(compilesOk(`${TWEEN_SETUP} t.start();`)).toBe(true);
  });

  it("t.start() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`${TWEEN_SETUP} t.start();`);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "start")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// t.stop()
// ---------------------------------------------------------------------------

describe("Tween stop()", () => {
  it("t.stop() compiles without error", () => {
    expect(compilesOk(`${TWEEN_SETUP} t.stop();`)).toBe(true);
  });

  it("t.stop() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`${TWEEN_SETUP} t.stop();`);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "stop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// t.rewind()
// ---------------------------------------------------------------------------

describe("Tween rewind()", () => {
  it("t.rewind() compiles without error", () => {
    expect(compilesOk(`${TWEEN_SETUP} t.rewind();`)).toBe(true);
  });

  it("t.rewind() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`${TWEEN_SETUP} t.rewind();`);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "rewind")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// t.fforward()
// ---------------------------------------------------------------------------

describe("Tween fforward()", () => {
  it("t.fforward() compiles without error", () => {
    expect(compilesOk(`${TWEEN_SETUP} t.fforward();`)).toBe(true);
  });

  it("t.fforward() emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2(`${TWEEN_SETUP} t.fforward();`);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "fforward")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// t.onMotionFinished callback assignment
// ---------------------------------------------------------------------------

describe("Tween onMotionFinished callback", () => {
  it("t.onMotionFinished = function() {} compiles without error", () => {
    expect(
      compilesOk(`${TWEEN_SETUP} t.onMotionFinished = function() {};`)
    ).toBe(true);
  });

  it("t.onMotionFinished = function() {} emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2(`${TWEEN_SETUP} t.onMotionFinished = function() {};`);
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "onMotionFinished")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mx.transitions.easing property accesses
// ---------------------------------------------------------------------------

describe("mx.transitions.easing.Strong.easeOut property access", () => {
  it("compiles without error", () => {
    expect(compilesOk("var e = mx.transitions.easing.Strong.easeOut;")).toBe(true);
  });

  it("emits ActionGetMember (0x4f) for each step in the chain", () => {
    const bytes = compileAS2("var e = mx.transitions.easing.Strong.easeOut;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "mx")).toBe(true);
    expect(containsString(bytes, "transitions")).toBe(true);
    expect(containsString(bytes, "easing")).toBe(true);
    expect(containsString(bytes, "Strong")).toBe(true);
    expect(containsString(bytes, "easeOut")).toBe(true);
  });
});

describe("mx.transitions.easing.Regular.easeIn property access", () => {
  it("compiles without error", () => {
    expect(compilesOk("var e = mx.transitions.easing.Regular.easeIn;")).toBe(true);
  });

  it("emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var e = mx.transitions.easing.Regular.easeIn;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "Regular")).toBe(true);
    expect(containsString(bytes, "easeIn")).toBe(true);
  });
});

describe("mx.transitions.easing.Elastic.easeOut property access", () => {
  it("compiles without error", () => {
    expect(compilesOk("var e = mx.transitions.easing.Elastic.easeOut;")).toBe(true);
  });

  it("emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var e = mx.transitions.easing.Elastic.easeOut;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "Elastic")).toBe(true);
    expect(containsString(bytes, "easeOut")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined: full Tween usage pattern
// ---------------------------------------------------------------------------

describe("full Tween usage pattern", () => {
  it("complete tween sequence compiles without error", () => {
    expect(
      compilesOk(`
        var obj = { _x: 0 };
        var t = new mx.transitions.Tween(
          obj, "_x",
          mx.transitions.easing.Regular.easeOut,
          0, 100, 1, true
        );
        t.onMotionFinished = function() {
          trace("done");
        };
        t.start();
      `)
    ).toBe(true);
  });

  it("complete tween sequence emits all expected opcodes", () => {
    const bytes = compileAS2(`
      var obj = { _x: 0 };
      var t = new mx.transitions.Tween(
        obj, "_x",
        mx.transitions.easing.Regular.easeOut,
        0, 100, 1, true
      );
      t.onMotionFinished = function() {};
      t.start();
    `);
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);         // constructor
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);  // namespace traversal
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);  // onMotionFinished assignment
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true); // start()
  });
});
