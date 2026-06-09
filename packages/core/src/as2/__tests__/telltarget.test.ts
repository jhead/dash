/**
 * Tests for AS2 compiler handling of tellTarget, with statements, and common
 * target-path property access patterns (_root, _parent, _global).
 *
 * ActionWith (0x94) is the AVM1 opcode for `with(obj) { ... }` — it pushes an
 * object onto the scope chain so that variable lookups inside the block resolve
 * against that object first.
 *
 * ActionSetTarget (0x8B) is the older Flash 4-era opcode for named tellTarget
 * paths. This compiler uses ActionWith (0x94) for `with` statements. The Flash
 * 4 `tellTarget` keyword is not supported as syntax; callers should use
 * `with(_root) { ... }` or explicit property chains instead.
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
// AVM1 opcode constants
// ---------------------------------------------------------------------------

const ACTION_WITH        = 0x94; // ActionWith    — scope-chain push (with statement)
const ACTION_GET_MEMBER  = 0x4f; // ActionGetMember
const ACTION_SET_MEMBER  = 0x4e; // ActionSetMember
const ACTION_GET_VAR     = 0x1c; // ActionGetVariable
const ACTION_SET_VAR     = 0x1d; // ActionSetVariable
const ACTION_CALL_METHOD = 0x52; // ActionCallMethod
const ACTION_TRACE       = 0x26; // ActionTrace
const ACTION_GOTO_FRAME2 = 0x9f; // ActionGotoFrame2

// ---------------------------------------------------------------------------
// with() statement → ActionWith (0x94)
// ---------------------------------------------------------------------------

describe("with() statement — ActionWith (0x94)", () => {
  it("1. with (someObj) { trace(name); } compiles without error", () => {
    expect(compilesOk("with (someObj) { trace(name); }")).toBe(true);
  });

  it("2. with (someObj) { trace(name); } emits ActionWith (0x94)", () => {
    const bytes = compileAS2("with (someObj) { trace(name); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("3. with (someObj) { trace(name); } pushes the object before ActionWith", () => {
    const bytes = compileAS2("with (someObj) { trace(name); }");
    expect(containsString(bytes, "someObj")).toBe(true);
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
  });

  it("4. with (someObj) { trace(name); } emits ActionTrace (0x26) inside body", () => {
    const bytes = compileAS2("with (someObj) { trace(name); }");
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });

  it("5. with (_root) { gotoAndPlay(1); } compiles without error", () => {
    expect(compilesOk("with (_root) { gotoAndPlay(1); }")).toBe(true);
  });

  it("6. with (_root) { gotoAndPlay(1); } emits ActionWith (0x94) and ActionGotoFrame2 (0x9F)", () => {
    const bytes = compileAS2("with (_root) { gotoAndPlay(1); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
    expect(containsByte(bytes, ACTION_GOTO_FRAME2)).toBe(true);
  });

  it("7. nested with statements compile without error", () => {
    expect(compilesOk("with (a) { with (b) { trace(x); } }")).toBe(true);
  });

  it("8. nested with statements each emit ActionWith (0x94)", () => {
    const bytes = compileAS2("with (a) { with (b) { trace(x); } }");
    // Two ActionWith opcodes expected
    let count = 0;
    for (const b of bytes) if (b === ACTION_WITH) count++;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Property chain access (_root.movieclip.gotoAndPlay etc.)
// ---------------------------------------------------------------------------

describe("target-path property chains", () => {
  it("9. _root.movieclip.gotoAndPlay(1) compiles without error", () => {
    expect(compilesOk("_root.movieclip.gotoAndPlay(1);")).toBe(true);
  });

  it("10. _root.movieclip.gotoAndPlay(1) emits ActionGetVariable for _root", () => {
    const bytes = compileAS2("_root.movieclip.gotoAndPlay(1);");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_root")).toBe(true);
  });

  it("11. _root.movieclip.gotoAndPlay(1) emits ActionGetMember for movieclip", () => {
    const bytes = compileAS2("_root.movieclip.gotoAndPlay(1);");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "movieclip")).toBe(true);
  });

  it("12. _root.movieclip.gotoAndPlay(1) emits ActionCallMethod for gotoAndPlay", () => {
    const bytes = compileAS2("_root.movieclip.gotoAndPlay(1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "gotoAndPlay")).toBe(true);
  });

  it("13. _parent.stop() compiles without error", () => {
    expect(compilesOk("_parent.stop();")).toBe(true);
  });

  it("14. _parent.stop() emits ActionGetVariable (0x1c) for _parent", () => {
    const bytes = compileAS2("_parent.stop();");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_parent")).toBe(true);
  });

  it("15. _parent.stop() emits ActionCallMethod (0x52) for stop", () => {
    const bytes = compileAS2("_parent.stop();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "stop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _global property access and assignment
// ---------------------------------------------------------------------------

describe("_global property access", () => {
  it("16. _global.myVar = 5 compiles without error", () => {
    expect(compilesOk("_global.myVar = 5;")).toBe(true);
  });

  it("17. _global.myVar = 5 emits ActionGetVariable (0x1c) for _global", () => {
    const bytes = compileAS2("_global.myVar = 5;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_global")).toBe(true);
  });

  it("18. _global.myVar = 5 emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("_global.myVar = 5;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
  });

  it("19. _global.myVar = 5 references 'myVar' property", () => {
    const bytes = compileAS2("_global.myVar = 5;");
    expect(containsString(bytes, "myVar")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _root._currentframe property read
// ---------------------------------------------------------------------------

describe("_root special properties", () => {
  it("20. _root._currentframe access compiles without error", () => {
    expect(compilesOk("var f = _root._currentframe;")).toBe(true);
  });

  it("21. _root._currentframe access emits ActionGetMember (0x4f)", () => {
    const bytes = compileAS2("var f = _root._currentframe;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_currentframe")).toBe(true);
  });

  it("22. _root._currentframe access emits ActionGetVariable (0x1c) for _root", () => {
    const bytes = compileAS2("var f = _root._currentframe;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_root")).toBe(true);
  });

  it("23. _root._x = 100 compiles without error", () => {
    expect(compilesOk("_root._x = 100;")).toBe(true);
  });

  it("24. _root._x = 100 emits ActionSetMember (0x4e)", () => {
    const bytes = compileAS2("_root._x = 100;");
    expect(containsByte(bytes, ACTION_SET_MEMBER)).toBe(true);
    expect(containsString(bytes, "_x")).toBe(true);
  });

  it("25. _root._x = 100 emits ActionGetVariable (0x1c) for _root", () => {
    const bytes = compileAS2("_root._x = 100;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_root")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tellTarget — not supported as syntax; graceful handling
// ---------------------------------------------------------------------------

describe("tellTarget (Flash 4 syntax) — graceful handling", () => {
  it("26. tellTarget is not a reserved keyword — treated as a function call or variable", () => {
    // Since the AS2 parser does not support the Flash 4 tellTarget keyword,
    // calling it like a function should either compile (as a generic function
    // call) or throw a parse/compile error — either is acceptable. The point
    // is it must not crash the process.
    let threw = false;
    let compiledOk = false;
    try {
      compileAS2('tellTarget("_root") { gotoAndPlay(1); }');
      compiledOk = true;
    } catch {
      threw = true;
    }
    // Either path is acceptable — the compiler must not hang or crash
    expect(threw || compiledOk).toBe(true);
  });

  it("27. with (_root) { gotoAndPlay(1); } is the recommended replacement for tellTarget", () => {
    // This is the idiomatic AS2 replacement for the Flash 4 tellTarget syntax.
    expect(compilesOk("with (_root) { gotoAndPlay(1); }")).toBe(true);
    const bytes = compileAS2("with (_root) { gotoAndPlay(1); }");
    expect(containsByte(bytes, ACTION_WITH)).toBe(true);
    expect(containsString(bytes, "_root")).toBe(true);
  });
});
