/**
 * Tests for AS2 compiler handling of Array/String/Math built-in method calls.
 *
 * Verifies that method calls, property accesses, constructor calls, chained
 * calls, and static method calls on built-in types compile to the correct
 * AVM1 opcodes:
 *   - ActionCallMethod (0x52): method calls (obj.method(...))
 *   - ActionGetMember  (0x4e): property reads (obj.prop)
 *   - ActionNew        (0x40): constructor calls (new Foo(...))
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

const ACTION_CALL_METHOD = 0x52; // ActionCallMethod — method dispatch
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember  — property read
const ACTION_NEW         = 0x40; // ActionNew        — constructor call

// ---------------------------------------------------------------------------
// Array method calls
// ---------------------------------------------------------------------------

describe("Array method calls", () => {
  it("1. arr.push(1) compiles without error", () => {
    expect(compilesOk("arr.push(1);")).toBe(true);
  });

  it("2. arr.push(1) emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.push(1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "push")).toBe(true);
    expect(containsString(bytes, "arr")).toBe(true);
  });

  it("3. arr.pop() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.pop();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "pop")).toBe(true);
  });

  it("4. arr.join(',') compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('arr.join(",");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "join")).toBe(true);
  });

  it("5. arr.slice(0, 2) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.slice(0, 2);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "slice")).toBe(true);
  });

  it("5b. arr.shift() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.shift();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "shift")).toBe(true);
  });

  it("5c. arr.unshift(x) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.unshift(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "unshift")).toBe(true);
  });

  it("5d. arr.splice(0, 1) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.splice(0, 1);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "splice")).toBe(true);
  });

  it("5e. arr.sort() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.sort();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "sort")).toBe(true);
  });

  it("5f. arr.reverse() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.reverse();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "reverse")).toBe(true);
  });

  it("5g. arr.concat(b) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.concat(b);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "concat")).toBe(true);
  });

  it("5h. arr.indexOf(x) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("arr.indexOf(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "indexOf")).toBe(true);
  });

  it("6. arr.length is a property access — emits ActionGetMember (0x4e), not ActionCallMethod", () => {
    const bytes = compileAS2("var n = arr.length;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "length")).toBe(true);
    // Property access must NOT emit ActionCallMethod
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// String method calls
// ---------------------------------------------------------------------------

describe("String method calls", () => {
  it("7. str.split(',') compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2('str.split(",");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "split")).toBe(true);
  });

  it('8. str.indexOf("x") compiles and emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('str.indexOf("x");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "indexOf")).toBe(true);
  });

  it("9. str.charAt(0) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("str.charAt(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "charAt")).toBe(true);
  });

  it("10. str.toUpperCase() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("str.toUpperCase();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toUpperCase")).toBe(true);
  });

  it("10b. str.toLowerCase() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("str.toLowerCase();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "toLowerCase")).toBe(true);
  });

  it("10c. str.charCodeAt(0) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("str.charCodeAt(0);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "charCodeAt")).toBe(true);
  });

  it('10d. str.lastIndexOf("x") compiles and emits ActionCallMethod (0x52)', () => {
    const bytes = compileAS2('str.lastIndexOf("x");');
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "lastIndexOf")).toBe(true);
  });

  it("10e. str.substr(0, 5) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("str.substr(0, 5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "substr")).toBe(true);
  });

  it("10f. str.substring(0, 5) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("str.substring(0, 5);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "substring")).toBe(true);
  });

  it("11. str.length is a property access — emits ActionGetMember (0x4e), not ActionCallMethod", () => {
    const bytes = compileAS2("var n = str.length;");
    expect(containsByte(bytes, ACTION_GET_MEMBER)).toBe(true);
    expect(containsString(bytes, "length")).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Math static method calls
// ---------------------------------------------------------------------------

describe("Math static method calls", () => {
  it("12. Math.floor(x) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.floor(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "floor")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("13. Math.random() compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.random();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "random")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("14. Math.min(a, b) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.min(a, b);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "min")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("21. Math.ceil(x) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.ceil(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "ceil")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("22. Math.round(x) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.round(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "round")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("23. Math.abs(x) compiles and emits ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("Math.abs(x);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "abs")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
  });

  it("24. Math.max(a, b) compiles and emits ActionCallMethod (0x52) with 2 args", () => {
    const bytes = compileAS2("Math.max(a, b);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsString(bytes, "max")).toBe(true);
    expect(containsString(bytes, "Math")).toBe(true);
    expect(containsString(bytes, "a")).toBe(true);
    expect(containsString(bytes, "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constructor calls
// ---------------------------------------------------------------------------

describe("Constructor calls", () => {
  it("15. new Array() compiles and emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var a = new Array();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("16. new Array(5) compiles and emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var a = new Array(5);");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });

  it("17. new Date() compiles and emits ActionNew (0x40)", () => {
    const bytes = compileAS2("var d = new Date();");
    expect(containsByte(bytes, ACTION_NEW)).toBe(true);
    expect(containsString(bytes, "Date")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chained method calls
// ---------------------------------------------------------------------------

describe("Chained method calls", () => {
  it("18. arr.sort().join(',') compiles without error", () => {
    expect(compilesOk('arr.sort().join(",");')).toBe(true);
  });

  it("19. arr.sort().join(',') emits ActionCallMethod (0x52) twice", () => {
    const bytes = compileAS2('arr.sort().join(",");');
    // Count occurrences of 0x52
    let count = 0;
    for (const b of bytes) if (b === ACTION_CALL_METHOD) count++;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(containsString(bytes, "sort")).toBe(true);
    expect(containsString(bytes, "join")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Global function calls (ActionCallFunction 0x3D)
// ---------------------------------------------------------------------------

// AVM1 opcode for ActionCallFunction — used for global functions like parseInt
const ACTION_CALL_FUNCTION = 0x3d;

describe("Global function calls", () => {
  it("25. parseInt('5') compiles and emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("parseInt('5');");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "parseInt")).toBe(true);
  });

  it("26. parseFloat('3.14') compiles and emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("parseFloat('3.14');");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "parseFloat")).toBe(true);
  });

  it("27. isNaN(x) compiles and emits ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("isNaN(x);");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
    expect(containsString(bytes, "isNaN")).toBe(true);
  });

  it("28. parseInt does NOT emit ActionCallMethod (0x52) — it is a global, not a method", () => {
    const bytes = compileAS2("parseInt('5');");
    // Global functions use ActionCallFunction, not ActionCallMethod
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// String static method call — String.fromCharCode(n) → ActionMBAsciiToChar (0x37)
// ---------------------------------------------------------------------------

// Flash Professional emits ActionMBAsciiToChar instead of a generic ActionCallMethod.
const ACTION_MB_ASCII_TO_CHAR = 0x37; // ActionMBAsciiToChar — char code to string

describe("String static method call", () => {
  it("20. String.fromCharCode(65) emits ActionMBAsciiToChar (0x37)", () => {
    const bytes = compileAS2("String.fromCharCode(65);");
    expect(containsByte(bytes, ACTION_MB_ASCII_TO_CHAR)).toBe(true);
  });

  it("20b. String.fromCharCode(65) does NOT emit ActionCallMethod (0x52)", () => {
    const bytes = compileAS2("String.fromCharCode(65);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it("20c. String.fromCharCode(65) does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("String.fromCharCode(65);");
    const ACTION_CALL_FUNCTION = 0x3d;
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("20d. String.fromCharCode(n) with variable argument emits ActionMBAsciiToChar (0x37)", () => {
    const bytes = compileAS2("var s = String.fromCharCode(n);");
    expect(containsByte(bytes, ACTION_MB_ASCII_TO_CHAR)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it("20e. String.fromCharCode(expr) with complex expression emits ActionMBAsciiToChar (0x37)", () => {
    const bytes = compileAS2("var s = String.fromCharCode(a + b);");
    expect(containsByte(bytes, ACTION_MB_ASCII_TO_CHAR)).toBe(true);
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(false);
  });

  it("20f. String.fromCharCode with 0 args falls through to ActionCallMethod (not special-cased)", () => {
    const bytes = compileAS2("String.fromCharCode();");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_MB_ASCII_TO_CHAR)).toBe(false);
  });

  it("20g. String.fromCharCode with 2 args falls through to ActionCallMethod (not special-cased)", () => {
    const bytes = compileAS2("String.fromCharCode(65, 66);");
    expect(containsByte(bytes, ACTION_CALL_METHOD)).toBe(true);
    expect(containsByte(bytes, ACTION_MB_ASCII_TO_CHAR)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AVM1 built-ins: trace(), _root, _parent, _global, this, timeline functions
// ---------------------------------------------------------------------------

const ACTION_TRACE      = 0x26; // ActionTrace
const ACTION_GET_VAR    = 0x1c; // ActionGetVariable
const ACTION_STOP       = 0x07; // ActionStop
const ACTION_PLAY       = 0x06; // ActionPlay
const ACTION_NEXT_FRAME = 0x04; // ActionNextFrame
const ACTION_PREV_FRAME = 0x05; // ActionPrevFrame

// -- trace() -----------------------------------------------------------------

describe("trace()", () => {
  it('trace("hello") compiles without error', () => {
    expect(compilesOk('trace("hello");')).toBe(true);
  });

  it('trace("hello") emits ActionTrace (0x26)', () => {
    const bytes = compileAS2('trace("hello");');
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });

  it('trace("hello") pushes the string argument before ActionTrace', () => {
    const bytes = compileAS2('trace("hello");');
    expect(containsString(bytes, "hello")).toBe(true);
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });

  it("trace(x + 1) compiles — expression argument", () => {
    expect(compilesOk("trace(x + 1);")).toBe(true);
  });

  it("trace(x + 1) emits ActionTrace (0x26)", () => {
    const bytes = compileAS2("trace(x + 1);");
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });

  it('trace("a", "b") compiles — extra args are silently ignored', () => {
    expect(compilesOk('trace("a", "b");')).toBe(true);
  });

  it('trace("a", "b") emits ActionTrace (0x26) using the first argument', () => {
    const bytes = compileAS2('trace("a", "b");');
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
    expect(containsString(bytes, "a")).toBe(true);
  });

  it("trace() with no args compiles and still emits ActionTrace (0x26)", () => {
    const bytes = compileAS2("trace();");
    expect(containsByte(bytes, ACTION_TRACE)).toBe(true);
  });
});

// -- _root, _parent ----------------------------------------------------------

describe("_root and _parent", () => {
  it("_root.gotoAndPlay(2) compiles without error", () => {
    expect(compilesOk("_root.gotoAndPlay(2);")).toBe(true);
  });

  it("_root.gotoAndPlay(2) emits ActionGetVariable (0x1c) for _root", () => {
    const bytes = compileAS2("_root.gotoAndPlay(2);");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_root")).toBe(true);
  });

  it("_parent.myVar = 5 compiles without error", () => {
    expect(compilesOk("_parent.myVar = 5;")).toBe(true);
  });

  it("_parent.myVar = 5 emits ActionGetVariable (0x1c) for _parent", () => {
    const bytes = compileAS2("_parent.myVar = 5;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_parent")).toBe(true);
  });

  it("_root standalone emits ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("var x = _root;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_root")).toBe(true);
  });

  it("_parent standalone emits ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("var x = _parent;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_parent")).toBe(true);
  });
});

// -- _global -----------------------------------------------------------------

describe("_global", () => {
  it("_global.myClass = MyClass compiles without error", () => {
    expect(compilesOk("_global.myClass = MyClass;")).toBe(true);
  });

  it("_global.myClass = MyClass emits ActionGetVariable (0x1c) for _global", () => {
    const bytes = compileAS2("_global.myClass = MyClass;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_global")).toBe(true);
  });

  it("_global standalone emits ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("var x = _global;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_global")).toBe(true);
  });
});

// -- _level0 -----------------------------------------------------------------

describe("_level0", () => {
  it("_level0 standalone emits ActionGetVariable (0x1c)", () => {
    const bytes = compileAS2("var x = _level0;");
    expect(containsByte(bytes, ACTION_GET_VAR)).toBe(true);
    expect(containsString(bytes, "_level0")).toBe(true);
  });

  it("_level0.gotoAndPlay(1) compiles without error", () => {
    expect(compilesOk("_level0.gotoAndPlay(1);")).toBe(true);
  });
});

// -- this --------------------------------------------------------------------

describe("this", () => {
  it("this.x = 5 compiles without error", () => {
    expect(compilesOk("this.x = 5;")).toBe(true);
  });

  it("this.x = 5 references 'this' via ActionGetVariable or ActionPush", () => {
    // Compiler uses pushString("this") + ActionGetVariable (0x1c) for 'this'
    const bytes = compileAS2("this.x = 5;");
    expect(containsString(bytes, "this")).toBe(true);
  });

  it("this in method body compiles without error", () => {
    expect(compilesOk("function foo() { this.val = 1; }")).toBe(true);
  });

  it("this.method() compiles without error", () => {
    expect(compilesOk("this.method();")).toBe(true);
  });
});

// -- Timeline functions: stop(), play() --------------------------------------

describe("stop() and play()", () => {
  it("stop() compiles without error", () => {
    expect(compilesOk("stop();")).toBe(true);
  });

  it("stop() emits ActionStop (0x07)", () => {
    const bytes = compileAS2("stop();");
    expect(containsByte(bytes, ACTION_STOP)).toBe(true);
  });

  it("stop() does NOT emit ActionCallFunction (0x3D) — it is a native opcode", () => {
    const bytes = compileAS2("stop();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("play() compiles without error", () => {
    expect(compilesOk("play();")).toBe(true);
  });

  it("play() emits ActionPlay (0x06)", () => {
    const bytes = compileAS2("play();");
    expect(containsByte(bytes, ACTION_PLAY)).toBe(true);
  });

  it("play() does NOT emit ActionCallFunction (0x3D) — it is a native opcode", () => {
    const bytes = compileAS2("play();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// -- nextFrame() and prevFrame() ---------------------------------------------

describe("nextFrame() and prevFrame()", () => {
  it("nextFrame() compiles without error", () => {
    expect(compilesOk("nextFrame();")).toBe(true);
  });

  it("nextFrame() emits ActionNextFrame (0x04)", () => {
    const bytes = compileAS2("nextFrame();");
    expect(containsByte(bytes, ACTION_NEXT_FRAME)).toBe(true);
  });

  it("nextFrame() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("nextFrame();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });

  it("prevFrame() compiles without error", () => {
    expect(compilesOk("prevFrame();")).toBe(true);
  });

  it("prevFrame() emits ActionPrevFrame (0x05)", () => {
    const bytes = compileAS2("prevFrame();");
    expect(containsByte(bytes, ACTION_PREV_FRAME)).toBe(true);
  });

  it("prevFrame() does NOT emit ActionCallFunction (0x3D)", () => {
    const bytes = compileAS2("prevFrame();");
    expect(containsByte(bytes, ACTION_CALL_FUNCTION)).toBe(false);
  });
});

// -- gotoAndPlay / gotoAndStop -----------------------------------------------

describe("gotoAndPlay() and gotoAndStop()", () => {
  it("gotoAndPlay(2) compiles without error", () => {
    expect(compilesOk("gotoAndPlay(2);")).toBe(true);
  });

  it("gotoAndStop(2) compiles without error", () => {
    expect(compilesOk("gotoAndStop(2);")).toBe(true);
  });

  it("_root.gotoAndPlay(2) compiles without error", () => {
    expect(compilesOk("_root.gotoAndPlay(2);")).toBe(true);
  });

  it("_root.gotoAndStop('frame1') compiles without error", () => {
    expect(compilesOk("_root.gotoAndStop('frame1');")).toBe(true);
  });
});
