/**
 * Tests for AS2 compiler: `new` on chained member expressions (task 0867).
 *
 * `new mx.transitions.easing.Strong()` must emit ActionNewObject (0x40) with
 * the FULL dotted path "mx.transitions.easing.Strong" pushed as a string —
 * NOT the result of resolving the member chain via GetVariable/GetMember.
 *
 * AVM1 ActionNewObject pops the class name as a string, so emitting
 * GetVariable("mx") → GetMember("transitions") → ... as the "class name"
 * would leave an object on the stack where a string is expected, causing
 * a runtime failure.
 *
 * Key opcodes:
 *   ActionNewObject  (0x40) — constructor call
 *   ActionGetMember  (0x4e) — should NOT appear as the constructor resolution
 *   ActionGetVariable(0x1c) — should NOT appear as the constructor resolution
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

/** Returns true if the exact null-terminated UTF-8 string s appears in bytes. */
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
// Opcode constants
// ---------------------------------------------------------------------------

const ACTION_NEW_OBJECT  = 0x40; // ActionNewObject
const ACTION_GET_MEMBER  = 0x4e; // ActionGetMember
const ACTION_GET_VAR     = 0x1c; // ActionGetVariable

// ---------------------------------------------------------------------------
// Two-segment chain: new pkg.ClassName()
// ---------------------------------------------------------------------------

describe("new on two-segment member chain", () => {
  it("1. new pkg.ClassName() compiles without error", () => {
    expect(compilesOk("var t = new pkg.ClassName();")).toBe(true);
  });

  it("2. new pkg.ClassName() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("var t = new pkg.ClassName();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("3. new pkg.ClassName() pushes full dotted string 'pkg.ClassName'", () => {
    const bytes = compileAS2("var t = new pkg.ClassName();");
    expect(containsString(bytes, "pkg.ClassName")).toBe(true);
  });

  it("4. new pkg.ClassName() pushes 'pkg.ClassName' before ActionNewObject (not via GetMember chain)", () => {
    // The full dotted class name must appear as a string literal in the bytecode.
    // The fix: compiler uses memberExprToString to produce "pkg.ClassName" and pushes
    // it as a string, rather than resolving GetVariable("pkg") → GetMember("ClassName").
    const bytes = compileAS2("var t = new pkg.ClassName();");
    // The full dotted string must be present
    expect(containsString(bytes, "pkg.ClassName")).toBe(true);
    // The partial strings must NOT appear individually (i.e. no separate "pkg" push)
    // Note: 0x4e (ActionGetMember) cannot be asserted absent here because the byte
    // value 0x4e = 'N' appears inside the string "pkg.ClassName" itself. Instead we
    // verify the full dotted form is pushed, and that "pkg" alone is not a null-terminated
    // string (it would be if the old GetVariable("pkg") path were taken).
    expect(containsString(bytes, "pkg")).toBe(false); // no standalone "pkg" push
  });
});

// ---------------------------------------------------------------------------
// Three-segment chain: new mx.transitions.Tween()
// ---------------------------------------------------------------------------

describe("new on three-segment member chain (mx.transitions.Tween)", () => {
  it("5. new mx.transitions.Tween() compiles without error", () => {
    expect(compilesOk("var t = new mx.transitions.Tween();")).toBe(true);
  });

  it("6. new mx.transitions.Tween() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("7. new mx.transitions.Tween() pushes 'mx.transitions.Tween' as string", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    expect(containsString(bytes, "mx.transitions.Tween")).toBe(true);
  });

  it("8. new mx.transitions.Tween() does NOT push 'mx' as standalone variable lookup", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    // Under the fix, "mx" is NOT pushed as a standalone string (no GetVariable("mx")).
    // The full dotted string is pushed instead.
    expect(containsString(bytes, "mx")).toBe(false);
  });

  it("9. new mx.transitions.Tween() does NOT push 'transitions' as standalone string", () => {
    const bytes = compileAS2("var t = new mx.transitions.Tween();");
    // "transitions" must not appear as a standalone null-terminated string
    expect(containsString(bytes, "transitions")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Four-segment chain: new mx.transitions.easing.Strong()
// ---------------------------------------------------------------------------

describe("new on four-segment member chain (mx.transitions.easing.Strong)", () => {
  it("10. new mx.transitions.easing.Strong() compiles without error", () => {
    expect(compilesOk("var s = new mx.transitions.easing.Strong();")).toBe(true);
  });

  it("11. new mx.transitions.easing.Strong() emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2("var s = new mx.transitions.easing.Strong();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("12. new mx.transitions.easing.Strong() pushes full path as string", () => {
    const bytes = compileAS2("var s = new mx.transitions.easing.Strong();");
    expect(containsString(bytes, "mx.transitions.easing.Strong")).toBe(true);
  });

  it("13. new mx.transitions.easing.Strong() does NOT push 'easing' as standalone string", () => {
    const bytes = compileAS2("var s = new mx.transitions.easing.Strong();");
    // Under the fix, "easing" is NOT pushed as a standalone string —
    // it is embedded in the full dotted class name string.
    expect(containsString(bytes, "easing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Constructor with arguments
// ---------------------------------------------------------------------------

describe("new on chained member with arguments", () => {
  it("14. new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1) compiles", () => {
    expect(
      compilesOk("var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);")
    ).toBe(true);
  });

  it("15. new mx.transitions.Tween with args emits ActionNewObject (0x40)", () => {
    const bytes = compileAS2(
      "var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);"
    );
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
  });

  it("16. new mx.transitions.Tween with args pushes dotted class name", () => {
    const bytes = compileAS2(
      "var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);"
    );
    expect(containsString(bytes, "mx.transitions.Tween")).toBe(true);
  });

  it("17. new mx.transitions.Tween with args includes arg strings in output", () => {
    const bytes = compileAS2(
      "var t = new mx.transitions.Tween(obj, '_x', easing, 0, 100, 1);"
    );
    expect(containsString(bytes, "_x")).toBe(true);
    expect(containsString(bytes, "obj")).toBe(true);
    expect(containsString(bytes, "easing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plain identifier still works correctly
// ---------------------------------------------------------------------------

describe("new on plain identifier (regression guard)", () => {
  it("18. new MyClass() still pushes 'MyClass' as string", () => {
    const bytes = compileAS2("var x = new MyClass();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
    expect(containsString(bytes, "MyClass")).toBe(true);
  });

  it("19. new Array() still works correctly", () => {
    const bytes = compileAS2("var a = new Array();");
    expect(containsByte(bytes, ACTION_NEW_OBJECT)).toBe(true);
    expect(containsString(bytes, "Array")).toBe(true);
  });
});
